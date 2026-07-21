import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { canonicalize, withoutSignature } from "./canonical-json.ts";

export function signCanonicalJson(value, privateKey) {
  const key = normalizePrivateKey(privateKey);
  const bytes = Buffer.from(canonicalize(withoutSignature(value)), "utf8");
  return `ed25519:${sign(null, bytes, key).toString("base64")}`;
}

export function verifyCanonicalJson(value, publicKey) {
  if (typeof value?.signature !== "string" || !value.signature.startsWith("ed25519:")) {
    return false;
  }
  const key = normalizePublicKey(publicKey);
  const signature = Buffer.from(value.signature.slice("ed25519:".length), "base64");
  const bytes = Buffer.from(canonicalize(withoutSignature(value)), "utf8");
  return verify(null, bytes, key, signature);
}

function normalizePrivateKey(privateKey) {
  if (typeof privateKey === "string" || Buffer.isBuffer(privateKey)) {
    return createPrivateKey(privateKey);
  }
  return privateKey;
}

function normalizePublicKey(publicKey) {
  if (typeof publicKey === "string" || Buffer.isBuffer(publicKey)) {
    return createPublicKey(publicKey);
  }
  return publicKey;
}
