export type ResourceErrorCode =
  | "invalid_resource"
  | "resource_unauthorized"
  | "schema_not_allowed"
  | "resource_writer_busy"
  | "quota_exceeded"
  | "resource_corrupt"
  | "resource_identity_conflict"
  | "resource_commit_failed"
  | "injected_crash"
  | "unsafe_storage_path"
  | "offline_quarantine_denied";

export class ResourceGatewayError extends Error {
  readonly code: ResourceErrorCode;

  constructor(code: ResourceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResourceGatewayError";
    this.code = code;
  }
}

export class InvalidResourceError extends ResourceGatewayError {
  constructor(message: string) {
    super("invalid_resource", message);
    this.name = "InvalidResourceError";
  }
}

export class ResourceAuthorizationError extends ResourceGatewayError {
  constructor() {
    super("resource_unauthorized", "A trusted enrolled worker binding is required.");
    this.name = "ResourceAuthorizationError";
  }
}

export class ResourceSchemaError extends ResourceGatewayError {
  constructor(message: string) {
    super("schema_not_allowed", message);
    this.name = "ResourceSchemaError";
  }
}

export class ResourceBackpressureError extends ResourceGatewayError {
  constructor() {
    super("resource_writer_busy", "The resource writer is busy; retry after backpressure clears.");
    this.name = "ResourceBackpressureError";
  }
}

export class ResourceQuotaError extends ResourceGatewayError {
  constructor(message: string) {
    super("quota_exceeded", message);
    this.name = "ResourceQuotaError";
  }
}

export class ResourceCorruptError extends ResourceGatewayError {
  constructor(message: string) {
    super("resource_corrupt", message);
    this.name = "ResourceCorruptError";
  }
}

export class ResourceIdentityConflictError extends ResourceGatewayError {
  constructor(message: string) {
    super("resource_identity_conflict", message);
    this.name = "ResourceIdentityConflictError";
  }
}

export class ResourceCommitError extends ResourceGatewayError {
  constructor(options?: ErrorOptions) {
    super(
      "resource_commit_failed",
      "The resource was durably published but its world reference commit failed; retry or reconcile offline.",
      options,
    );
    this.name = "ResourceCommitError";
  }
}

export class ResourceCrashError extends ResourceGatewayError {
  readonly point: string;

  constructor(point: string) {
    super("injected_crash", `Injected resource gateway crash at ${point}.`);
    this.name = "ResourceCrashError";
    this.point = point;
  }
}

export class UnsafeStoragePathError extends ResourceGatewayError {
  constructor(message: string) {
    super("unsafe_storage_path", message);
    this.name = "UnsafeStoragePathError";
  }
}

export class OfflineQuarantineError extends ResourceGatewayError {
  constructor(message: string) {
    super("offline_quarantine_denied", message);
    this.name = "OfflineQuarantineError";
  }
}
