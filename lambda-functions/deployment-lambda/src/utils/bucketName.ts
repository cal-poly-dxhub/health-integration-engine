// Valid S3 bucket name: charset + length. Rejects IAM wildcards (*, ?) and other invalid chars,
// so a node-supplied name can never broaden a generated IAM resource ARN beyond one bucket.
const BUCKET_NAME_REGEX = /^[a-z0-9.-]{3,63}$/;

export function isValidBucketName(name: unknown): name is string {
  return typeof name === 'string' && BUCKET_NAME_REGEX.test(name);
}
