import { aesDecrypt, aesEncrypt, aesGcmDecrypt, generateAesKey, loadPublicKey, rsaEncrypt } from "./go2-crypto";
import { normalizeGo2Ip } from "./go2-config";
import { GO2_OLD_OFFER_PORT, GO2_PORT } from "./go2-topics";
import type { Go2Callbacks, Go2ConnectionConfig } from "./go2-types";
import { Go2WebRtcConnection } from "./go2-webrtc";

type SdpPayload = {
  id: string;
  sdp: string;
  type: "offer";
  token: "";
};

type ConNotifyResponse = {
  data1: string;
  data2: number;
};

function proxyUrl(path: string): string {
  return `/api/robots/go2/proxy${path}`;
}

function proxyHeaders(host: string, contentType?: string): Record<string, string> {
  const headers: Record<string, string> = { "X-Robot-Host": host };
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return headers;
}

async function responseErrorMessage(response: Response, label: string): Promise<string> {
  let detail = "";
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as { error?: unknown };
      detail = typeof parsed.error === "string" ? ` (${parsed.error})` : ` (${text})`;
    }
  } catch {
    // Keep the HTTP status when the error body is not JSON/text.
  }

  return `${label} failed: HTTP ${response.status}${detail}`;
}

function extractPathEnding(data1: string): string {
  const tail = data1.slice(-10);
  const lookup = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  let path = "";

  for (let i = 0; i < tail.length; i += 2) {
    const char = tail[i + 1];
    const index = lookup.indexOf(char);
    path += index >= 0 ? index.toString() : "0";
  }

  return path;
}

async function detectPort(ip: string): Promise<"new" | "old"> {
  const hostIp = normalizeGo2Ip(ip);
  try {
    const response = await fetch(proxyUrl("/con_notify"), {
      method: "POST",
      headers: proxyHeaders(`${hostIp}:${GO2_PORT}`),
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      return "new";
    }
  } catch {
    // Try old endpoint below.
  }

  try {
    const response = await fetch(proxyUrl("/"), {
      method: "HEAD",
      headers: proxyHeaders(`${hostIp}:${GO2_OLD_OFFER_PORT}`),
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      return "old";
    }
  } catch {
    // Surface a single clear error below.
  }

  throw new Error(`Go2 did not respond at ${hostIp}`);
}

async function exchangeSdpNew(ip: string, payload: SdpPayload): Promise<string> {
  const host = `${normalizeGo2Ip(ip)}:${GO2_PORT}`;
  const notifyResponse = await fetch(proxyUrl("/con_notify"), {
    method: "POST",
    headers: proxyHeaders(host)
  });

  if (!notifyResponse.ok) {
    throw new Error(await responseErrorMessage(notifyResponse, "con_notify"));
  }

  const notifyBase64 = await notifyResponse.text();
  const notifyJson = JSON.parse(atob(notifyBase64)) as ConNotifyResponse;
  if (notifyJson.data2 !== 2) {
    throw new Error("This Go2 requires a per-device AES key; Nemeia v0 supports data2=2 local connections first.");
  }

  const data1 = await aesGcmDecrypt(notifyJson.data1);
  const publicKeyBase64 = data1.slice(10, data1.length - 10);
  const publicKey = loadPublicKey(publicKeyBase64);
  const pathEnding = extractPathEnding(data1);
  const aesKey = generateAesKey();
  const encryptedSdp = await aesEncrypt(JSON.stringify(payload), aesKey);
  const encryptedKey = rsaEncrypt(aesKey, publicKey);

  const ingResponse = await fetch(proxyUrl(`/con_ing_${pathEnding}`), {
    method: "POST",
    headers: proxyHeaders(host, "application/x-www-form-urlencoded"),
    body: JSON.stringify({ data1: encryptedSdp, data2: encryptedKey })
  });

  if (!ingResponse.ok) {
    throw new Error(await responseErrorMessage(ingResponse, "con_ing"));
  }

  const encryptedAnswer = await ingResponse.text();
  const answerJson = JSON.parse(await aesDecrypt(encryptedAnswer, aesKey)) as { sdp?: string };
  if (!answerJson.sdp) {
    throw new Error("Go2 SDP answer did not include sdp");
  }

  return answerJson.sdp;
}

async function exchangeSdpOld(ip: string, payload: SdpPayload): Promise<string> {
  const hostIp = normalizeGo2Ip(ip);
  const response = await fetch(proxyUrl("/offer"), {
    method: "POST",
    headers: proxyHeaders(`${hostIp}:${GO2_OLD_OFFER_PORT}`, "application/json"),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "offer"));
  }

  const answer = (await response.json()) as { sdp?: string };
  if (!answer.sdp) {
    throw new Error("Go2 SDP answer did not include sdp");
  }

  return answer.sdp;
}

export async function testGo2Connection(config: Go2ConnectionConfig): Promise<"new" | "old"> {
  return detectPort(config.ip);
}

export async function connectGo2Local(
  config: Go2ConnectionConfig,
  callbacks: Go2Callbacks,
  onConnectionCreated?: (connection: Go2WebRtcConnection) => void
): Promise<Go2WebRtcConnection> {
  const method = await detectPort(config.ip);
  const connection = new Go2WebRtcConnection(callbacks);
  onConnectionCreated?.(connection);
  const offerSdp = await connection.createOffer();
  const payload: SdpPayload = {
    id: config.mode === "AP" ? "abcd" : "STA_localNetwork",
    sdp: offerSdp,
    type: "offer",
    token: ""
  };

  try {
    const answerSdp = method === "new" ? await exchangeSdpNew(config.ip, payload) : await exchangeSdpOld(config.ip, payload);
    if (answerSdp === "reject") {
      throw new Error("Go2 rejected the connection; another client may already be connected.");
    }
    await connection.setAnswer(answerSdp);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}
