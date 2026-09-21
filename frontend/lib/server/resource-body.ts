import { ResourceReadFailure } from "../world-operator/resource-read-policy.ts";

export const MAX_RESOURCE_REQUEST_BODY_BYTES = 16 * 1024;

export function assertRequestBodySize(contentLength: string | null): void {
  if (!contentLength) { return; }
  const length = Number(contentLength);
  if (!Number.isSafeInteger(length) || length < 0 || length > MAX_RESOURCE_REQUEST_BODY_BYTES) {
    throw new ResourceReadFailure("resource_request_too_large", 413);
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  assertRequestBodySize(request.headers.get("content-length"));
  if (!request.body) { throw new ResourceReadFailure("invalid_resource_request", 400); }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      // The stream must be consumed serially; this is the bounded read itself.
      // oxlint-disable-next-line no-await-in-loop
      const result = await reader.read();
      if (result.done) { break; }
      total += result.value.byteLength;
      if (total > MAX_RESOURCE_REQUEST_BODY_BYTES) {
        void reader.cancel();
        throw new ResourceReadFailure("resource_request_too_large", 413);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ResourceReadFailure("invalid_resource_request", 400);
  }
}
