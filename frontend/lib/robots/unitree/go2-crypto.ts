import forge from "node-forge";

const CON_NOTIFY_KEY = new Uint8Array([
  232, 86, 130, 189, 22, 84, 155, 0, 142, 4, 166, 104, 43, 179, 235, 227
]);

export function generateAesKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function aesEncrypt(data: string, key: string): Promise<string> {
  const cipher = forge.cipher.createCipher("AES-ECB", key);
  cipher.start();
  cipher.update(forge.util.createBuffer(forge.util.encodeUtf8(data)));
  cipher.finish();
  return forge.util.encode64(cipher.output.getBytes());
}

export async function aesDecrypt(encryptedBase64: string, key: string): Promise<string> {
  const encrypted = forge.util.decode64(encryptedBase64);
  const decipher = forge.cipher.createDecipher("AES-ECB", key);
  decipher.start();
  decipher.update(forge.util.createBuffer(encrypted));
  const ok = decipher.finish();
  if (!ok) {
    throw new Error("AES-ECB decryption failed");
  }
  return forge.util.decodeUtf8(decipher.output.getBytes());
}

export async function aesGcmDecrypt(encryptedBase64: string, key: Uint8Array = CON_NOTIFY_KEY): Promise<string> {
  const raw = Uint8Array.from(atob(encryptedBase64), (char) => char.charCodeAt(0));
  const ciphertext = raw.slice(0, raw.length - 28);
  const nonce = raw.slice(raw.length - 28, raw.length - 16);
  const tag = raw.slice(raw.length - 16);

  const decipher = forge.cipher.createDecipher("AES-GCM", forge.util.createBuffer(String.fromCharCode(...key)));
  decipher.start({
    iv: forge.util.createBuffer(String.fromCharCode(...nonce)),
    tag: forge.util.createBuffer(String.fromCharCode(...tag))
  });
  decipher.update(forge.util.createBuffer(String.fromCharCode(...ciphertext)));
  const ok = decipher.finish();
  if (!ok) {
    throw new Error("AES-GCM decryption failed");
  }

  return forge.util.decodeUtf8(decipher.output.getBytes());
}

export function loadPublicKey(base64Der: string): forge.pki.rsa.PublicKey {
  const der = forge.util.decode64(base64Der);
  const asn1 = forge.asn1.fromDer(der);
  return forge.pki.publicKeyFromAsn1(asn1) as forge.pki.rsa.PublicKey;
}

export function rsaEncrypt(data: string, publicKey: forge.pki.rsa.PublicKey): string {
  const keySize = Math.ceil(publicKey.n.bitLength() / 8);
  const maxChunk = keySize - 11;
  const dataBytes = forge.util.encodeUtf8(data);
  const chunks: string[] = [];

  for (let i = 0; i < dataBytes.length; i += maxChunk) {
    const chunk = dataBytes.substring(i, i + maxChunk);
    chunks.push(publicKey.encrypt(chunk, "RSAES-PKCS1-V1_5"));
  }

  return forge.util.encode64(chunks.join(""));
}

export function validationResponse(challenge: string): string {
  const md5Hex = forge.md.md5.create().update(`UnitreeGo2_${challenge}`).digest().toHex();
  return forge.util.encode64(forge.util.hexToBytes(md5Hex));
}
