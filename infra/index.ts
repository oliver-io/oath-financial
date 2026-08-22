// Trace Insights serving stack — docs/plans/infra.md §1.
// Exactly: one private versioned S3 bucket, CloudFront OAC, distribution with
// the parity cache-behavior table, and a least-privilege deploy *policy*
// (attached by the operator to a principal of their choosing — this program
// never creates credentials). Nothing else, per the deliberately-not-built list.

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();
const authMode = cfg.get("authMode") ?? "none"; // none | unlisted; sso reserved (plan §6)
if (authMode !== "none" && authMode !== "unlisted") {
  throw new Error(`authMode '${authMode}' is reserved and not implemented (plan §6)`);
}
if (cfg.get("domain")) {
  // ACM + Route53 are config-gated and not yet built (plan §1, optional row).
  throw new Error("domain config set, but ACM/Route53 support is not implemented yet");
}

// AWS-managed cache policies: headers travel with the objects; CloudFront just
// respects or ignores them per path class (plan §1 table).
const CACHING_OPTIMIZED = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const CACHING_DISABLED = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";

const bucket = new aws.s3.Bucket("site", {});
new aws.s3.BucketVersioning("site-versioning", {
  bucket: bucket.id,
  versioningConfiguration: { status: "Enabled" },
});
new aws.s3.BucketPublicAccessBlock("site-pab", {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

const oac = new aws.cloudfront.OriginAccessControl("site-oac", {
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

const ORIGIN_ID = "s3-site";
const behaviorBase = {
  targetOriginId: ORIGIN_ID,
  viewerProtocolPolicy: "redirect-to-https",
  allowedMethods: ["GET", "HEAD"],
  cachedMethods: ["GET", "HEAD"],
  compress: true,
};

const distribution = new aws.cloudfront.Distribution("site-cdn", {
  enabled: true,
  comment: "trace-insights static serving (SPA + runs/ data plane)",
  defaultRootObject: "index.html",
  priceClass: "PriceClass_100",
  origins: [
    {
      originId: ORIGIN_ID,
      domainName: bucket.bucketRegionalDomainName,
      originAccessControlId: oac.id,
    },
  ],
  // The two mutable objects bypass the CDN cache; everything else is immutable
  // by construction and cached long (plan §1 table).
  orderedCacheBehaviors: [
    { ...behaviorBase, pathPattern: "runs/latest.json", cachePolicyId: CACHING_DISABLED },
    { ...behaviorBase, pathPattern: "index.html", cachePolicyId: CACHING_DISABLED },
  ],
  defaultCacheBehavior: { ...behaviorBase, cachePolicyId: CACHING_OPTIMIZED },
  // SPA fallback per plan §1. KNOWN LIMITATION (reported, not silently adapted):
  // custom error responses are distribution-wide, so a missing key under /runs/
  // also falls back to index.html — parity checklist item 5 fails deployed until
  // the plan sanctions a viewer-request CloudFront Function (see PROGRESS_LOG).
  customErrorResponses: [
    { errorCode: 403, responseCode: 200, responsePagePath: "/index.html" },
    { errorCode: 404, responseCode: 200, responsePagePath: "/index.html" },
  ],
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: { cloudfrontDefaultCertificate: true },
});

new aws.s3.BucketPolicy("site-policy", {
  bucket: bucket.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "AllowCloudFrontOAC",
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: pulumi.interpolate`${bucket.arn}/*`,
        Condition: { StringEquals: { "AWS:SourceArn": distribution.arn } },
      },
    ],
  }),
});

// Least-privilege publish policy (plan §1). Created as a managed policy only;
// the operator attaches it to their own principal — no users/keys created here.
const deployPolicy = new aws.iam.Policy("deploy-publish", {
  description: "trace-insights deploy scripts: publish objects + invalidate the two mutable paths",
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "BucketList",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: bucket.arn,
      },
      {
        Sid: "ObjectsRW",
        Effect: "Allow",
        Action: ["s3:PutObject", "s3:DeleteObject"],
        Resource: pulumi.interpolate`${bucket.arn}/*`,
      },
      {
        Sid: "Invalidate",
        Effect: "Allow",
        Action: ["cloudfront:CreateInvalidation"],
        Resource: distribution.arn,
      },
    ],
  }),
});

export const bucketName = bucket.bucket;
export const distributionId = distribution.id;
export const distributionDomain = distribution.domainName;
export const deployPolicyArn = deployPolicy.arn;
export const siteUrl = pulumi.interpolate`https://${distribution.domainName}`;
