import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class FileSigningKeyStore {
  #path;
  #clock;
  #eventLog;

  constructor({ path, clock = () => new Date(), eventLog = null }) {
    if (!path) {
      throw new SigningKeyStoreError("SIGNING_KEY_PATH_REQUIRED", "FileSigningKeyStore requires a path.");
    }
    this.#path = path;
    this.#clock = clock;
    this.#eventLog = eventLog;
    mkdirSync(dirname(path), { recursive: true });
  }

  current() {
    if (!existsSync(this.#path)) {
      return this.rotate({ reason: "initial_key" });
    }
    return this.#load();
  }

  rotate({ reason = "manual_rotation" } = {}) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const public_key_pem = publicKey.export({ type: "spki", format: "pem" });
    const private_key_pem = privateKey.export({ type: "pkcs8", format: "pem" });
    const record = {
      schema_version: 1,
      algorithm: "ed25519",
      key_id: keyId(public_key_pem),
      created_at: this.#clock().toISOString(),
      public_key_pem,
      private_key_pem
    };
    writeJsonAtomically(this.#path, record);
    this.#eventLog?.append({
      source: "mission-server:key-store",
      event_type: "config.signing_key.rotated",
      severity: 1,
      refs: [record.key_id],
      payload: {
        key_id: record.key_id,
        algorithm: record.algorithm,
        reason
      }
    });
    return materialize(record);
  }

  #load() {
    assertPrivateFileMode(this.#path);
    let record;
    try {
      record = JSON.parse(readFileSync(this.#path, "utf8"));
    } catch (cause) {
      throw new SigningKeyStoreError("SIGNING_KEY_STORE_CORRUPT", "Signing key store is not valid JSON.", { cause });
    }
    validateRecord(record);
    return materialize(record);
  }
}

export class SigningKeyStoreError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "SigningKeyStoreError";
    this.error_code = error_code;
    this.details = details;
  }
}

function materialize(record) {
  return {
    key_id: record.key_id,
    algorithm: record.algorithm,
    created_at: record.created_at,
    publicKey: createPublicKey(record.public_key_pem),
    privateKey: createPrivateKey(record.private_key_pem),
    public_key_pem: record.public_key_pem
  };
}

function validateRecord(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new SigningKeyStoreError("SIGNING_KEY_STORE_CORRUPT", "Signing key store must contain an object.");
  }
  if (record.schema_version !== 1) {
    throw new SigningKeyStoreError("SIGNING_KEY_STORE_CORRUPT", "Signing key store schema_version is unsupported.");
  }
  if (record.algorithm !== "ed25519") {
    throw new SigningKeyStoreError("SIGNING_KEY_STORE_CORRUPT", "Signing key store algorithm must be ed25519.");
  }
  for (const field of ["key_id", "created_at", "public_key_pem", "private_key_pem"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new SigningKeyStoreError("SIGNING_KEY_STORE_CORRUPT", `Signing key store field ${field} is invalid.`);
    }
  }
  if (record.key_id !== keyId(record.public_key_pem)) {
    throw new SigningKeyStoreError("SIGNING_KEY_STORE_CORRUPT", "Signing key store key_id does not match public key.");
  }
}

function assertPrivateFileMode(path) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new SigningKeyStoreError("SIGNING_KEY_STORE_PERMISSIONS", "Signing key store must not be readable, writable, or executable by group or others.", {
      mode: `0o${mode.toString(8).padStart(3, "0")}`,
      required: "0o600"
    });
  }
}

function keyId(publicKeyPem) {
  return `ed25519:${createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 24)}`;
}

function writeJsonAtomically(path, value) {
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
}
