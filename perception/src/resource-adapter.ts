import type {
  AuthorizedResourceReader,
  LocalResourceDescriptor,
  PublishResourceInput,
  ResourceGateway,
  ResourceReadRange,
  ResourceReferenceBoundary,
  TrustedWorkerSession,
} from "../../world-resources/src/resource-gateway.ts";
import { sha256Hex, type ResourceRef } from "./types.ts";
import { toSafeByteLength } from "./world-types.ts";

export type ResourceGatewayPort = Pick<ResourceGateway, "publishBytes" | "commitPublishedReferences" | "read">;

/**
 * Thin adapter over the actual authenticated world-resources API. Perception
 * owns neither credentials nor durable bytes and never invents a URI scheme.
 */
export class ResourceGatewayAdapter {
  readonly #gateway: ResourceGatewayPort;
  readonly #session: TrustedWorkerSession;
  readonly #reader: AuthorizedResourceReader;

  constructor(input: { gateway: ResourceGatewayPort; session: TrustedWorkerSession; reader: AuthorizedResourceReader }) {
    this.#gateway = input.gateway;
    this.#session = input.session;
    this.#reader = input.reader;
  }

  async publish(bytes: Uint8Array, schema: string, idempotencyKey: string): Promise<ResourceRef> {
    const digest = sha256Hex(bytes);
    if (!idempotencyKey) throw new Error("resource_idempotency_key_required");
    // The key names the logical publish. Changed bytes/schema for the same key
    // must collide at the immutable gateway instead of silently becoming a new
    // resource with a different identity.
    const id = `perception_${sha256Hex(new TextEncoder().encode(idempotencyKey))}`;
    const input: PublishResourceInput = {
      id,
      schema,
      bytes: new Uint8Array(bytes),
      expectedSha256: digest,
      expectedByteLength: bytes.byteLength,
    };
    const local = await this.#gateway.publishBytes(this.#session, input);
    return fromGatewayRef(local);
  }

  async commit(resources: readonly ResourceRef[]): Promise<void> {
    await this.#gateway.commitPublishedReferences(this.#session, resources.map(toLocalDescriptor));
  }

  async read(resource: ResourceRef): Promise<Uint8Array> {
    const range: ResourceReadRange = { offset: 0, length: toSafeByteLength(resource.byteLength) };
    return this.#gateway.read(this.#reader, toGatewayBoundary(resource), range);
  }
}

export interface RetainedResourceGateway {
  publish(bytes: Uint8Array, schema: string, idempotencyKey: string): Promise<ResourceRef>;
  commit(resources: readonly ResourceRef[]): Promise<void>;
  read(resource: ResourceRef): Promise<Uint8Array>;
}

export function fromGatewayRef(resource: LocalResourceDescriptor): ResourceRef {
  return {
    id: resource.id,
    schema: resource.schema,
    sha256: resource.sha256,
    byteLength: BigInt(resource.byteLength),
  } as ResourceRef;
}

function toGatewayBoundary(resource: ResourceRef): ResourceReferenceBoundary {
  return {
    id: resource.id,
    schema: resource.schema,
    sha256: resource.sha256,
    byteLength: resource.byteLength.toString(10),
  };
}

function toLocalDescriptor(resource: ResourceRef): LocalResourceDescriptor {
  return {
    id: resource.id,
    schema: resource.schema,
    sha256: resource.sha256,
    byteLength: toSafeByteLength(resource.byteLength),
  };
}
