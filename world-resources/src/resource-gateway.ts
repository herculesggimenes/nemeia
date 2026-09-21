import { createHash, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  link,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  InvalidResourceError,
  OfflineQuarantineError,
  ResourceAuthorizationError,
  ResourceBackpressureError,
  ResourceCommitError,
  ResourceCorruptError,
  ResourceCrashError,
  ResourceGatewayError,
  ResourceIdentityConflictError,
  ResourceQuotaError,
  ResourceSchemaError,
  UnsafeStoragePathError,
} from "./errors.ts";

/** Gateway-local metadata; this is not the domain ResourceRef type. */
export interface LocalResourceDescriptor {
  readonly id: string;
  readonly schema: string;
  readonly sha256: string;
  readonly byteLength: number;
}

/** JSON/shared-codec boundary: native u64 byte counts are decimal strings here. */
export interface ResourceReferenceBoundary {
  readonly id: string;
  readonly schema: string;
  readonly sha256: string;
  readonly byteLength: string;
}

export function toResourceReferenceBoundary(resource: LocalResourceDescriptor): ResourceReferenceBoundary {
  return Object.freeze({
    id: resource.id,
    schema: resource.schema,
    sha256: resource.sha256,
    byteLength: String(resource.byteLength),
  });
}

export type ResourceBytes =
  | Uint8Array
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>;

export interface ResourceReferenceCommitRequest {
  readonly resources: readonly ResourceReferenceBoundary[];
  readonly bindingId: string;
  readonly producerId: string;
  readonly producerSession: string;
  readonly unitId: string;
}

/** Host callback around the real authenticated observation/map operation, not a module API. */
export interface ResourceReferenceCommitAdapter {
  commitPublishedReferences(request: ResourceReferenceCommitRequest): Promise<void>;
}

export interface ResourceReadAuthorizationRequest {
  readonly resource: ResourceReferenceBoundary;
  readonly offset: number;
  readonly length: number;
}

/** Bound by authenticated Agent/UI/world-client host code; never model-selected. */
export interface ResourceReadAuthorizer {
  authorizeRead(request: ResourceReadAuthorizationRequest): Promise<boolean> | boolean;
}

export type AuthorizedResourceReader = object;

export interface ProducerPackagePin {
  readonly name: string;
  readonly version: string;
  readonly sha256: string;
}

export interface EnrolledProducerBinding {
  readonly bindingId: string;
  readonly producerId: string;
  readonly producerSession: string;
  readonly unitId: string;
  readonly package: ProducerPackagePin;
  readonly credential: Uint8Array;
  readonly allowedSchemas: readonly string[];
  readonly referenceCommitAdapter: ResourceReferenceCommitAdapter;
}

export interface WorkerAuthenticationRequest {
  readonly bindingId: string;
  readonly credential: Uint8Array;
}

/** An opaque capability. Its binding is held in a private WeakMap, never in caller data. */
export type TrustedWorkerSession = object;

export interface PublishResourceInput {
  readonly id: string;
  readonly schema: string;
  readonly bytes: ResourceBytes;
  readonly expectedSha256?: string;
  readonly expectedByteLength?: number;
}

export interface ResourceReadRange {
  readonly offset: number;
  readonly length: number;
}

export interface ResourceGatewayLimits {
  readonly maxResourceBytes?: number;
  readonly quotaBytes?: number;
  readonly maxReadBytes?: number;
}

export type ResourceCrashPoint =
  | "after_temp_open"
  | "after_bytes_written"
  | "after_temp_fsync"
  | "before_publish"
  | "after_publish"
  | "before_reducer_commit"
  | "after_reducer_commit";

export interface ResourceGatewayHooks {
  readonly crashAt?: ResourceCrashPoint;
  readonly onCheckpoint?: (point: ResourceCrashPoint) => void | Promise<void>;
  /** Test-only seam for exercising short writes without replacing filesystem persistence. */
  readonly writeChunk?: (handle: FileHandle, chunk: Uint8Array, offset: number) => Promise<number>;
}

export interface OfflineQuarantineOptions {
  /** Quarantine is intentionally opt-in and only works for the exact configured test root. */
  readonly isolatedTestRoot?: string;
  readonly quiesced: boolean;
}

export interface OfflineReachabilityPlan {
  readonly planId: string;
  readonly root: string;
  readonly reachableIds: readonly string[];
  readonly candidateIds: readonly string[];
  readonly missingReferencedIds: readonly string[];
}

export interface ResourceInventory {
  readonly retainedBytes: number;
  readonly resourceIds: readonly string[];
  readonly temporaryFiles: readonly string[];
}

export interface ResourceGatewayConfig extends ResourceGatewayLimits {
  readonly root: string;
  readonly bindings: readonly EnrolledProducerBinding[];
  readonly hooks?: ResourceGatewayHooks;
  /** Must be explicitly set for an isolated test root before quarantine can mutate it. */
  readonly allowOfflineQuarantine?: boolean;
}

interface BindingRecord extends EnrolledProducerBinding {
  readonly credential: Uint8Array;
}

interface StoredResourceMetadata {
  readonly id: string;
  readonly schema: string;
  readonly sha256: string;
  readonly byteLength: string;
  readonly bindingId: string;
  readonly producerId: string;
  readonly producerSession: string;
  readonly unitId: string;
}

const DEFAULT_MAX_RESOURCE_BYTES = 256 * 1024 * 1024;
const DEFAULT_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;
const DEFAULT_MAX_READ_BYTES = 8 * 1024 * 1024;
const SESSION_BINDINGS = new WeakMap<object, BindingRecord>();
const READ_AUTHORIZERS = new WeakMap<object, { gateway: ResourceGateway; authorizer: ResourceReadAuthorizer }>();

const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;
const SAFE_SCHEMA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isIterable(value: unknown): value is Iterable<Uint8Array> {
  return typeof value === "object" && value !== null && Symbol.iterator in value;
}

async function* chunksFrom(source: ResourceBytes): AsyncGenerator<Uint8Array> {
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (isAsyncIterable(source)) {
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) {
        throw new InvalidResourceError("Resource byte streams must yield Uint8Array chunks.");
      }
      yield chunk;
    }
    return;
  }
  if (isIterable(source)) {
    for (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) {
        throw new InvalidResourceError("Resource byte streams must yield Uint8Array chunks.");
      }
      yield chunk;
    }
    return;
  }
  throw new InvalidResourceError("Resource bytes must be a Uint8Array or an iterable of Uint8Array chunks.");
}

function validatePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidResourceError(`${name} must be a positive safe integer.`);
  }
}

function validateSha256(value: string, name: string): string {
  if (!SHA256_PATTERN.test(value)) {
    throw new InvalidResourceError(`${name} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function validateResourceId(id: string): string {
  if (!SAFE_ID_PATTERN.test(id) || id === "." || id === "..") {
    throw new InvalidResourceError("Resource IDs must be opaque single path components.");
  }
  return id;
}

function validateSchema(schema: string): string {
  if (!SAFE_SCHEMA_PATTERN.test(schema)) {
    throw new ResourceSchemaError("Resource schema must be a bounded registered schema name.");
  }
  return schema;
}

function validatePackagePart(value: string, name: string): string {
  if (value.length === 0 || value.length > 256 || /[\u0000\r\n]/u.test(value)) {
    throw new InvalidResourceError(`${name} must be a bounded package identifier.`);
  }
  return value;
}

function validateLocalDescriptor(ref: LocalResourceDescriptor, maxResourceBytes: number): LocalResourceDescriptor {
  validateResourceId(ref.id);
  validateSchema(ref.schema);
  validateSha256(ref.sha256, "Resource digest");
  validatePositiveSafeInteger(ref.byteLength, "Resource byteLength");
  if (ref.byteLength > maxResourceBytes) {
    throw new ResourceQuotaError("Resource byteLength exceeds the configured maximum.");
  }
  return ref;
}

function parseBoundary(ref: ResourceReferenceBoundary, maxResourceBytes: number): LocalResourceDescriptor {
  validateResourceId(ref.id);
  validateSchema(ref.schema);
  validateSha256(ref.sha256, "Resource digest");
  if (!/^\d+$/u.test(ref.byteLength)) {
    throw new InvalidResourceError("Resource byteLength must be a decimal u64 string at the JSON boundary.");
  }
  const byteLength = Number(ref.byteLength);
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new InvalidResourceError("Bounded resource byteLength must be a positive safe integer.");
  }
  return validateLocalDescriptor({ ...ref, byteLength }, maxResourceBytes);
}

function compareDigest(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function rejectDotSegments(input: string): void {
  if (input.includes("\\")) {
    throw new UnsafeStoragePathError("Storage paths cannot contain backslashes.");
  }
  const parsed = parse(input);
  const segments = input.slice(parsed.root.length).split(sep).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new UnsafeStoragePathError("Storage paths cannot contain dot segments.");
  }
}

async function ensureDirectoryPath(directory: string): Promise<void> {
  const absolute = resolve(directory);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new UnsafeStoragePathError("Configured storage paths cannot traverse symlinks.");
      }
      if (!entry.isDirectory()) {
        throw new UnsafeStoragePathError("Configured storage path contains a non-directory component.");
      }
    } catch (error) {
      if (error instanceof ResourceGatewayError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) {
        throw new UnsafeStoragePathError("Configured storage path could not be made safe.");
      }
    }
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await ensureDirectoryPath(directory);
  const entry = await lstat(directory);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new UnsafeStoragePathError("Resource storage directories must be private directories.");
  }
  if ((entry.mode & 0o077) !== 0) {
    throw new UnsafeStoragePathError("Resource storage directories must not be group- or world-accessible.");
  }
}

const ROOT_MARKER = ".nemeia-world-resources-root";

async function initializeDedicatedRoot(root: string): Promise<void> {
  await ensurePrivateDirectory(root);
  const markerPath = join(root, ROOT_MARKER);
  try {
    const marker = await lstat(markerPath);
    if (marker.isSymbolicLink() || !marker.isFile()) {
      throw new UnsafeStoragePathError("The configured resource root marker is unsafe.");
    }
    return;
  } catch (error) {
    if (error instanceof ResourceGatewayError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const entries = await readdir(root);
  if (entries.length !== 0) {
    throw new UnsafeStoragePathError("The configured resource root must be a new or marked dedicated gateway directory.");
  }
  const marker = await open(markerPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
  await marker.close();
}

async function fsyncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function cleanupOwnedTemp(pathname: string): Promise<void> {
  try {
    await unlink(pathname);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
  }
}

async function fileDigest(pathname: string): Promise<{ byteLength: number; sha256: string }> {
  const handle = await open(pathname, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new ResourceCorruptError("The retained resource is not a regular file.");
    }
    const bytes = await handle.readFile();
    return {
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    if (error instanceof ResourceGatewayError) throw error;
    throw new ResourceCorruptError("The retained resource could not be read safely.");
  } finally {
    await handle.close();
  }
}

function metadataBytes(metadata: StoredResourceMetadata): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(metadata));
}

function metadataEqual(left: StoredResourceMetadata, right: StoredResourceMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ResourceGateway {
  readonly root: string;
  readonly limits: Required<ResourceGatewayLimits>;

  private readonly objectRoot: string;
  private readonly metadataRoot: string;
  private readonly tempRoot: string;
  private readonly quarantineRoot: string;
  private readonly bindings: Map<string, BindingRecord>;
  private readonly hooks?: ResourceGatewayHooks;
  private readonly allowOfflineQuarantine: boolean;
  private writerActive = false;
  private retainedBytes = 0;
  private readonly plans = new Map<string, OfflineReachabilityPlan>();

  private constructor(config: ResourceGatewayConfig) {
    this.root = config.root;
    this.objectRoot = join(this.root, "objects");
    this.metadataRoot = join(this.root, "metadata");
    this.tempRoot = join(this.root, "tmp");
    this.quarantineRoot = join(this.root, "quarantine");
    this.limits = {
      maxResourceBytes: config.maxResourceBytes ?? DEFAULT_MAX_RESOURCE_BYTES,
      quotaBytes: config.quotaBytes ?? DEFAULT_QUOTA_BYTES,
      maxReadBytes: config.maxReadBytes ?? DEFAULT_MAX_READ_BYTES,
    };
    this.bindings = new Map();
    this.hooks = config.hooks;
    this.allowOfflineQuarantine = config.allowOfflineQuarantine === true;

    if (!isAbsolute(this.root) || parse(this.root).root === resolve(this.root)) {
      throw new UnsafeStoragePathError("Resource root must be a non-root absolute path.");
    }
    rejectDotSegments(this.root);
    validatePositiveSafeInteger(this.limits.maxResourceBytes, "maxResourceBytes");
    validatePositiveSafeInteger(this.limits.quotaBytes, "quotaBytes");
    validatePositiveSafeInteger(this.limits.maxReadBytes, "maxReadBytes");
    if (this.limits.maxResourceBytes > this.limits.quotaBytes) {
      throw new InvalidResourceError("maxResourceBytes cannot exceed quotaBytes.");
    }

    for (const binding of config.bindings) {
      this.validateBinding(binding);
      if (this.bindings.has(binding.bindingId)) {
        throw new InvalidResourceError("Producer binding IDs must be unique.");
      }
      this.bindings.set(binding.bindingId, {
        ...binding,
        credential: new Uint8Array(binding.credential),
      });
    }
  }

  static async open(config: ResourceGatewayConfig): Promise<ResourceGateway> {
    rejectDotSegments(config.root);
    const gateway = new ResourceGateway({ ...config, root: resolve(config.root) });
    await initializeDedicatedRoot(gateway.root);
    await ensurePrivateDirectory(gateway.objectRoot);
    await ensurePrivateDirectory(gateway.metadataRoot);
    await ensurePrivateDirectory(gateway.tempRoot);
    await ensurePrivateDirectory(gateway.quarantineRoot);
    await gateway.refreshInventory();
    return gateway;
  }

  private validateBinding(binding: EnrolledProducerBinding): void {
    validateResourceId(binding.bindingId);
    validateResourceId(binding.producerId);
    validateResourceId(binding.producerSession);
    validateResourceId(binding.unitId);
    validatePackagePart(binding.package.name, "Producer package name");
    validatePackagePart(binding.package.version, "Producer package version");
    validateSha256(binding.package.sha256, "Producer package digest");
    if (binding.credential.byteLength === 0) {
      throw new InvalidResourceError("Producer credentials cannot be empty.");
    }
    for (const schema of binding.allowedSchemas) {
      if (schema !== "*") validateSchema(schema);
    }
  }

  private async refreshInventory(): Promise<ResourceInventory> {
    const entries = await readdir(this.objectRoot, { withFileTypes: true });
    let retainedBytes = 0;
    const resourceIds: string[] = [];
    for (const entry of entries) {
      validateResourceId(entry.name);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new UnsafeStoragePathError("Resource objects must be direct regular files, never links or directories.");
      }
      const metadata = await stat(join(this.objectRoot, entry.name));
      const stored = await this.readMetadata(entry.name);
      if (stored.byteLength !== String(metadata.size)) {
        throw new ResourceCorruptError("Resource metadata length does not match the retained bytes.");
      }
      retainedBytes += metadata.size;
      resourceIds.push(entry.name);
    }
    const metadataEntries = await readdir(this.metadataRoot, { withFileTypes: true });
    for (const entry of metadataEntries) {
      if (entry.isSymbolicLink() || !entry.isFile() || entry.name.endsWith(".part")) {
        throw new UnsafeStoragePathError("Resource metadata must be direct regular files, never links or directories.");
      }
      if (!resourceIds.includes(entry.name)) {
        throw new ResourceCorruptError("Resource metadata exists without retained bytes.");
      }
    }
    const temporaryFiles = (await readdir(this.tempRoot, { withFileTypes: true }))
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".part"));
    this.retainedBytes = retainedBytes;
    return {
      retainedBytes,
      resourceIds: resourceIds.sort(),
      temporaryFiles: temporaryFiles.sort(),
    };
  }

  async inventory(): Promise<ResourceInventory> {
    return this.refreshInventory();
  }

  authenticateWorker(request: WorkerAuthenticationRequest): TrustedWorkerSession {
    const binding = this.bindings.get(request.bindingId);
    if (!binding || !(request.credential instanceof Uint8Array)) {
      throw new ResourceAuthorizationError();
    }
    const presented = new Uint8Array(request.credential);
    if (presented.byteLength !== binding.credential.byteLength || !timingSafeEqual(presented, binding.credential)) {
      throw new ResourceAuthorizationError();
    }
    const session = Object.freeze({});
    SESSION_BINDINGS.set(session, binding);
    return session;
  }

  private bindingFor(session: TrustedWorkerSession): BindingRecord {
    if (typeof session !== "object" || session === null) {
      throw new ResourceAuthorizationError();
    }
    const binding = SESSION_BINDINGS.get(session);
    if (!binding || !this.bindings.has(binding.bindingId)) {
      throw new ResourceAuthorizationError();
    }
    return binding;
  }

  private async checkpoint(point: ResourceCrashPoint): Promise<void> {
    if (this.hooks?.onCheckpoint) await this.hooks.onCheckpoint(point);
    if (this.hooks?.crashAt === point) throw new ResourceCrashError(point);
  }

  private objectPath(id: string): string {
    validateResourceId(id);
    const pathname = join(this.objectRoot, id);
    if (relative(this.objectRoot, pathname) !== id) {
      throw new UnsafeStoragePathError("Resource object path escaped the configured root.");
    }
    return pathname;
  }

  private metadataPath(id: string): string {
    validateResourceId(id);
    const pathname = join(this.metadataRoot, id);
    if (relative(this.metadataRoot, pathname) !== id) {
      throw new UnsafeStoragePathError("Resource metadata path escaped the configured root.");
    }
    return pathname;
  }

  private async readMetadata(id: string): Promise<StoredResourceMetadata> {
    const pathname = this.metadataPath(id);
    const handle = await open(pathname, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => {
      throw new ResourceCorruptError("The retained resource metadata is missing or inaccessible.");
    });
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new ResourceCorruptError("The retained resource metadata is not a regular file.");
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(await readFile(handle)));
      } catch {
        throw new ResourceCorruptError("The retained resource metadata is not valid JSON.");
      }
      if (!value || typeof value !== "object") throw new ResourceCorruptError("The retained resource metadata is invalid.");
      const candidate = value as Record<string, unknown>;
      const fields = ["id", "schema", "sha256", "byteLength", "bindingId", "producerId", "producerSession", "unitId"];
      if (fields.some((field) => typeof candidate[field] !== "string")) {
        throw new ResourceCorruptError("The retained resource metadata shape is invalid.");
      }
      const result = candidate as unknown as StoredResourceMetadata;
      if (result.id !== id) throw new ResourceCorruptError("The retained resource metadata identity is invalid.");
      validateResourceId(result.id);
      validateSchema(result.schema);
      validateSha256(result.sha256, "Resource digest");
      if (!/^\d+$/u.test(result.byteLength) || BigInt(result.byteLength) <= 0n) {
        throw new ResourceCorruptError("The retained resource metadata length is invalid.");
      }
      validateResourceId(result.bindingId);
      validateResourceId(result.producerId);
      validateResourceId(result.producerSession);
      validateResourceId(result.unitId);
      return result;
    } finally {
      await handle.close();
    }
  }

  private metadataFor(binding: BindingRecord, resource: LocalResourceDescriptor): StoredResourceMetadata {
    return Object.freeze({
      id: resource.id,
      schema: resource.schema,
      sha256: resource.sha256,
      byteLength: String(resource.byteLength),
      bindingId: binding.bindingId,
      producerId: binding.producerId,
      producerSession: binding.producerSession,
      unitId: binding.unitId,
    });
  }

  private async publishMetadataStaged(
    tempPath: string,
    metadataPath: string,
    metadata: StoredResourceMetadata,
  ): Promise<boolean> {
    try {
      await link(tempPath, metadataPath);
      await fsyncDirectory(this.metadataRoot);
      await cleanupOwnedTemp(tempPath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const existing = await this.readMetadata(metadata.id);
      if (!metadataEqual(existing, metadata)) {
        throw new ResourceIdentityConflictError("The resource ID is already bound to different schema or producer metadata.");
      }
      await cleanupOwnedTemp(tempPath);
      return false;
    }
  }

  private reserve(nextByteLength: number, existingByteLength: number): void {
    if (nextByteLength > this.limits.maxResourceBytes) {
      throw new ResourceQuotaError("Resource exceeds the configured maximum size.");
    }
    const projected = this.retainedBytes - existingByteLength + nextByteLength;
    if (projected > this.limits.quotaBytes) {
      throw new ResourceQuotaError("Retained resource quota is full; apply backpressure before committing a reference.");
    }
  }

  private async existingSize(pathname: string): Promise<number> {
    try {
      const entry = await lstat(pathname);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new ResourceCorruptError("The resource identity is occupied by a non-regular file.");
      }
      return entry.size;
    } catch (error) {
      if (error instanceof ResourceGatewayError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  private async publishStaged(
    tempPath: string,
    objectPath: string,
    resource: LocalResourceDescriptor,
  ): Promise<boolean> {
    try {
      await link(tempPath, objectPath);
      await fsyncDirectory(this.objectRoot);
      await cleanupOwnedTemp(tempPath);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const existing = await fileDigest(objectPath);
      if (existing.byteLength !== resource.byteLength || !compareDigest(existing.sha256, resource.sha256)) {
        throw new ResourceIdentityConflictError("The resource ID is already bound to different immutable bytes.");
      }
      await cleanupOwnedTemp(tempPath);
      return false;
    }
  }

  private async writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const bytesWritten = this.hooks?.writeChunk
        ? await this.hooks.writeChunk(handle, chunk, offset)
        : (await handle.write(chunk, offset, chunk.byteLength - offset)).bytesWritten;
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > chunk.byteLength - offset) {
        throw new ResourceGatewayError("invalid_resource", "Resource write made no safe progress.");
      }
      offset += bytesWritten;
    }
  }

  async publishBytes(session: TrustedWorkerSession, input: PublishResourceInput): Promise<LocalResourceDescriptor> {
    const binding = this.bindingFor(session);
    validateResourceId(input.id);
    validateSchema(input.schema);
    if (!binding.allowedSchemas.includes(input.schema) && !binding.allowedSchemas.includes("*")) {
      throw new ResourceSchemaError("The enrolled producer is not permitted to publish this resource schema.");
    }
    if (input.expectedSha256 !== undefined) validateSha256(input.expectedSha256, "Expected digest");
    if (input.expectedByteLength !== undefined) {
      validatePositiveSafeInteger(input.expectedByteLength, "Expected byteLength");
      if (input.expectedByteLength > this.limits.maxResourceBytes) {
        throw new ResourceQuotaError("Expected byteLength exceeds the configured maximum.");
      }
    }
    if (this.writerActive) throw new ResourceBackpressureError();
    this.writerActive = true;

    const objectPath = this.objectPath(input.id);
    const metadataPath = this.metadataPath(input.id);
    const tempPath = join(this.tempRoot, `${randomUUID()}.part`);
    const metadataTempPath = join(this.tempRoot, `${randomUUID()}.metadata.part`);
    let crash = false;
    try {
      const oldSize = await this.existingSize(objectPath);
      if (oldSize > 0) {
        const existing = await this.readMetadata(input.id);
        if (existing.bindingId !== binding.bindingId || existing.producerId !== binding.producerId || existing.producerSession !== binding.producerSession || existing.unitId !== binding.unitId) {
          throw new ResourceAuthorizationError();
        }
        if (existing.schema !== input.schema) {
          throw new ResourceIdentityConflictError("The resource ID is already bound to a different schema.");
        }
      }
      const handle = await open(tempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
      try {
        await this.checkpoint("after_temp_open");
        const hash = createHash("sha256");
        let byteLength = 0;
        for await (const chunk of chunksFrom(input.bytes)) {
          byteLength += chunk.byteLength;
          this.reserve(byteLength, oldSize);
          hash.update(chunk);
          await this.writeAll(handle, chunk);
        }
        validatePositiveSafeInteger(byteLength, "Resource byteLength");
        const sha256 = hash.digest("hex");
        if (input.expectedByteLength !== undefined && input.expectedByteLength !== byteLength) {
          throw new ResourceCorruptError("Resource byteLength did not match the expected value.");
        }
        if (input.expectedSha256 !== undefined && !compareDigest(input.expectedSha256, sha256)) {
          throw new ResourceCorruptError("Resource digest did not match the expected value.");
        }
        const resource: LocalResourceDescriptor = Object.freeze({
          id: input.id,
          schema: input.schema,
          sha256,
          byteLength,
        });
        await this.checkpoint("after_bytes_written");
        await handle.sync();
        await this.checkpoint("after_temp_fsync");
        await handle.chmod(0o400);
        await handle.close();
        const metadata = this.metadataFor(binding, resource);
        const metadataHandle = await open(metadataTempPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
        try {
          await this.writeAll(metadataHandle, metadataBytes(metadata));
          await metadataHandle.sync();
          await metadataHandle.chmod(0o400);
        } finally {
          await metadataHandle.close().catch(() => undefined);
        }
        await this.checkpoint("before_publish");
        await this.publishStaged(tempPath, objectPath, resource);
        await this.publishMetadataStaged(metadataTempPath, metadataPath, metadata);
        await this.checkpoint("after_publish");
        const persisted = await fileDigest(objectPath);
        if (persisted.byteLength !== resource.byteLength || !compareDigest(persisted.sha256, resource.sha256)) {
          throw new ResourceCorruptError("Published bytes failed the pre-commit digest or length check.");
        }
        await this.refreshInventory();
        return resource;
      } finally {
        await handle.close().catch(() => undefined);
      }
    } catch (error) {
      crash = error instanceof ResourceCrashError;
      if (!crash) {
        await cleanupOwnedTemp(tempPath);
        await cleanupOwnedTemp(metadataTempPath);
      }
      throw error;
    } finally {
      this.writerActive = false;
      if (!crash) {
        await cleanupOwnedTemp(tempPath).catch(() => undefined);
        await cleanupOwnedTemp(metadataTempPath).catch(() => undefined);
      }
    }
  }

  createReader(authorizer: ResourceReadAuthorizer): AuthorizedResourceReader {
    if (!authorizer || typeof authorizer.authorizeRead !== "function") {
      throw new ResourceAuthorizationError();
    }
    const reader = Object.freeze({});
    READ_AUTHORIZERS.set(reader, { gateway: this, authorizer });
    return reader;
  }

  async read(
    reader: AuthorizedResourceReader,
    ref: ResourceReferenceBoundary,
    range: ResourceReadRange,
  ): Promise<Uint8Array> {
    const readRecord = typeof reader === "object" && reader !== null ? READ_AUTHORIZERS.get(reader) : undefined;
    if (!readRecord || readRecord.gateway !== this) throw new ResourceAuthorizationError();
    const localRef = parseBoundary(ref, this.limits.maxResourceBytes);
    validatePositiveSafeInteger(range.length, "Read length");
    if (!Number.isSafeInteger(range.offset) || range.offset < 0) {
      throw new InvalidResourceError("Read offset must be a non-negative safe integer.");
    }
    if (range.length > this.limits.maxReadBytes) {
      throw new ResourceQuotaError("Read length exceeds the configured bounded-read limit.");
    }
    if (range.offset + range.length > localRef.byteLength) {
      throw new InvalidResourceError("Read range exceeds the retained resource length.");
    }
    const allowed = await readRecord.authorizer.authorizeRead({
      resource: ref,
      offset: range.offset,
      length: range.length,
    });
    if (!allowed) throw new ResourceAuthorizationError();
    const pathname = this.objectPath(localRef.id);
    const handle = await open(pathname, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW).catch(() => {
      throw new ResourceCorruptError("The requested retained resource is missing or inaccessible.");
    });
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size !== localRef.byteLength) {
        throw new ResourceCorruptError("The requested retained resource length is invalid.");
      }
      const bytes = await readFile(handle);
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (!compareDigest(actual, localRef.sha256)) {
        throw new ResourceCorruptError("The requested retained resource digest is invalid.");
      }
      return new Uint8Array(bytes.subarray(range.offset, range.offset + range.length));
    } catch (error) {
      if (error instanceof ResourceGatewayError) throw error;
      throw new ResourceCorruptError("The requested retained resource could not be read safely.");
    } finally {
      await handle.close();
    }
  }

  async planOfflineReachability(references: Iterable<ResourceReferenceBoundary>): Promise<OfflineReachabilityPlan> {
    if (this.writerActive) {
      throw new OfflineQuarantineError("Reachability planning requires a quiesced resource writer.");
    }
    const inventory = await this.refreshInventory();
    const reachableIds = new Set<string>();
    for (const ref of references) reachableIds.add(parseBoundary(ref, this.limits.maxResourceBytes).id);
    const missingReferencedIds = [...reachableIds].filter((id) => !inventory.resourceIds.includes(id));
    const candidateIds = inventory.resourceIds.filter((id) => !reachableIds.has(id));
    const planId = randomUUID();
    const plan: OfflineReachabilityPlan = Object.freeze({
      planId,
      root: this.root,
      reachableIds: [...reachableIds].sort(),
      candidateIds: [...candidateIds].sort(),
      missingReferencedIds: missingReferencedIds.sort(),
    });
    this.plans.set(planId, plan);
    return plan;
  }

  async quarantineOffline(
    plan: OfflineReachabilityPlan,
    options: OfflineQuarantineOptions,
  ): Promise<readonly string[]> {
    if (!this.allowOfflineQuarantine || !options.quiesced) {
      throw new OfflineQuarantineError("Offline quarantine is disabled unless the gateway is explicitly quiesced for an isolated test.");
    }
    if (!options.isolatedTestRoot || resolve(options.isolatedTestRoot) !== this.root) {
      throw new OfflineQuarantineError("Offline quarantine requires the exact configured isolated test root.");
    }
    const saved = this.plans.get(plan.planId);
    if (!saved || saved.root !== this.root || saved !== plan) {
      throw new OfflineQuarantineError("The reachability plan is not owned by this gateway.");
    }
    if (saved.missingReferencedIds.length > 0) {
      throw new OfflineQuarantineError("Offline quarantine refuses a plan with missing referenced resources.");
    }
    if (this.writerActive) throw new OfflineQuarantineError("Offline quarantine requires no active resource writer.");
    await ensurePrivateDirectory(this.quarantineRoot);
    const moved: string[] = [];
    try {
      for (const id of saved.candidateIds) {
        const source = this.objectPath(id);
        const sourceMetadata = this.metadataPath(id);
        const destinationDirectory = join(this.quarantineRoot, `${id}.${saved.planId}`);
        const destination = join(destinationDirectory, "object");
        const destinationMetadata = join(destinationDirectory, "metadata");
        const entry = await lstat(source);
        if (entry.isSymbolicLink() || !entry.isFile()) {
          throw new OfflineQuarantineError("Offline quarantine encountered an unsafe resource object.");
        }
        await this.readMetadata(id);
        await ensurePrivateDirectory(destinationDirectory);
        await rename(source, destination);
        await rename(sourceMetadata, destinationMetadata);
        moved.push(id);
      }
      await fsyncDirectory(this.objectRoot);
      await fsyncDirectory(this.metadataRoot);
      await fsyncDirectory(this.quarantineRoot);
      await this.refreshInventory();
      this.plans.delete(saved.planId);
      return moved;
    } catch (error) {
      throw error instanceof ResourceGatewayError ? error : new OfflineQuarantineError("Offline quarantine failed safely.");
    }
  }
  async commitPublishedReferences(
    session: TrustedWorkerSession,
    resources: readonly LocalResourceDescriptor[],
  ): Promise<void> {
    const binding = this.bindingFor(session);
    if (resources.length === 0) throw new InvalidResourceError("At least one published resource is required for a commit.");
    if (this.writerActive) throw new ResourceBackpressureError();
    const seen = new Set<string>();
    const boundaries: ResourceReferenceBoundary[] = [];
    for (const resource of resources) {
      const local = validateLocalDescriptor(resource, this.limits.maxResourceBytes);
      if (seen.has(local.id)) throw new InvalidResourceError("A resource may occur only once in a commit group.");
      seen.add(local.id);
      if (!binding.allowedSchemas.includes(local.schema) && !binding.allowedSchemas.includes("*")) {
        throw new ResourceSchemaError("The enrolled producer is not permitted to commit this resource schema.");
      }
      const stored = await this.readMetadata(local.id);
      if (stored.bindingId !== binding.bindingId || stored.producerId !== binding.producerId || stored.producerSession !== binding.producerSession || stored.unitId !== binding.unitId) {
        throw new ResourceAuthorizationError();
      }
      if (stored.schema !== local.schema || stored.sha256 !== local.sha256 || stored.byteLength !== String(local.byteLength)) {
        throw new ResourceIdentityConflictError("The resource descriptor does not match its immutable retained metadata.");
      }
      const persisted = await fileDigest(this.objectPath(local.id));
      if (persisted.byteLength !== local.byteLength || !compareDigest(persisted.sha256, local.sha256)) {
        throw new ResourceCorruptError("A published resource failed the pre-commit digest or length check.");
      }
      boundaries.push(toResourceReferenceBoundary(local));
    }
    await this.checkpoint("before_reducer_commit");
    try {
      await binding.referenceCommitAdapter.commitPublishedReferences({
        resources: Object.freeze(boundaries),
        bindingId: binding.bindingId,
        producerId: binding.producerId,
        producerSession: binding.producerSession,
        unitId: binding.unitId,
      });
    } catch (error) {
      throw new ResourceCommitError({ cause: error });
    }
    await this.checkpoint("after_reducer_commit");
  }

  async publish(session: TrustedWorkerSession, input: PublishResourceInput): Promise<LocalResourceDescriptor> {
    const resource = await this.publishBytes(session, input);
    await this.commitPublishedReferences(session, [resource]);
    return resource;
  }
}
