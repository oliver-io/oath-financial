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
// Optional custom domain (plan §1): when `domain` is set (e.g.
// oath.oliver-io.online), an ACM cert is DNS-validated against the parent
// hosted zone and alias records point at the distribution. Cert must live in
// us-east-1 (CloudFront requirement) — the stack region already is.
const domain = cfg.get("domain");

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

// —— custom-domain resources (only when `domain` config is set) ——
let certificateArn: pulumi.Output<string> | undefined;
let zoneId: pulumi.Output<string> | undefined;
if (domain) {
  const parent = domain.split(".").slice(1).join(".");
  const zone = aws.route53.getZoneOutput({ name: parent, privateZone: false });
  zoneId = zone.zoneId;
  const cert = new aws.acm.Certificate("site-cert", {
    domainName: domain,
    validationMethod: "DNS",
  });
  const validationRecord = new aws.route53.Record("site-cert-validation", {
    zoneId: zone.zoneId,
    name: cert.domainValidationOptions[0].resourceRecordName,
    type: cert.domainValidationOptions[0].resourceRecordType,
    records: [cert.domainValidationOptions[0].resourceRecordValue],
    ttl: 300,
    allowOverwrite: true,
  });
  const validation = new aws.acm.CertificateValidation("site-cert-validated", {
    certificateArn: cert.arn,
    validationRecordFqdns: [validationRecord.fqdn],
  });
  certificateArn = validation.certificateArn;
}

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
  aliases: domain ? [domain] : undefined,
  viewerCertificate: certificateArn
    ? {
        acmCertificateArn: certificateArn,
        sslSupportMethod: "sni-only",
        minimumProtocolVersion: "TLSv1.2_2021",
      }
    : { cloudfrontDefaultCertificate: true },
});

if (domain && zoneId) {
  for (const type of ["A", "AAAA"] as const) {
    new aws.route53.Record(`site-alias-${type}`, {
      zoneId,
      name: domain,
      type,
      aliases: [
        {
          name: distribution.domainName,
          zoneId: distribution.hostedZoneId,
          evaluateTargetHealth: false,
        },
      ],
    });
  }
}

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
export const siteUrl = domain
  ? pulumi.output(`https://${domain}`)
  : pulumi.interpolate`https://${distribution.domainName}`;
