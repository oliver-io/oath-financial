// Shared plumbing for the deploy scripts — docs/plans/infra.md §3.
// Headers are the contract (plan §1 table): immutable for everything under a
// run id and for hashed assets; no-cache for the two mutable objects.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CloudFrontClient,
  CreateInvalidationCommand,
} from "@aws-sdk/client-cloudfront";
import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export const CC_IMMUTABLE = "public, max-age=31536000, immutable";
export const CC_NO_CACHE = "no-cache";

const CONTENT_TYPES: Record<string, string> = {
  ".parquet": "application/vnd.apache.parquet",
  ".json": "application/json",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot).toLowerCase()]) || "application/octet-stream";
}

/** Recursive file walk returning forward-slash paths relative to root. */
export function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push(relative(root, full).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return out.sort();
}

export interface StackOutputs {
  bucketName: string;
  distributionId: string;
  distributionDomain: string;
  siteUrl: string;
}

/** Read `pulumi stack output --json` for the given stack (default dev). */
export async function stackOutputs(stack: string): Promise<StackOutputs> {
  const infraDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const proc = Bun.spawn(
    ["pulumi", "stack", "output", "--json", "--stack", stack, "--cwd", infraDir],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`pulumi stack output failed (stack '${stack}'):\n${err}`);
  const parsed = JSON.parse(out) as Partial<StackOutputs>;
  for (const k of ["bucketName", "distributionId", "distributionDomain"] as const) {
    if (!parsed[k]) throw new Error(`stack output '${k}' missing — is the '${stack}' stack up?`);
  }
  return parsed as StackOutputs;
}

export const s3 = new S3Client({});
export const cloudfront = new CloudFrontClient({});

export async function putFile(
  bucket: string,
  key: string,
  localPath: string,
  cacheControl: string,
): Promise<void> {
  const body = new Uint8Array(await Bun.file(localPath).arrayBuffer());
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      CacheControl: cacheControl,
      ContentType: contentTypeFor(key),
    }),
  );
}

/** All object keys under a prefix (paginated). */
export async function listKeys(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of page.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = page.NextContinuationToken;
  } while (token);
  return keys;
}

export async function invalidate(distributionId: string, paths: string[]): Promise<void> {
  await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `deploy-${Date.now()}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    }),
  );
}

export function argValue(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}
