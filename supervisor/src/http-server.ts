import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { KernelError } from "./kernel-errors.ts";

const MAX_BODY_BYTES = 1_000_000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function createSupervisorHttpServer({ kernel }) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://supervisor.local");
      const body = await readJsonBody(req);
      const response = handleSupervisorRequest({ body, kernel, method: req.method ?? "GET", url });
      writeJson(res, response.status, response.body);
    } catch (error) {
      writeJson(res, statusForError(error), errorBody(error));
    }
  });
  server.on("upgrade", (req, socket) => {
    handleEventsUpgrade({ kernel, req, socket });
  });
  return server;
}

export function handleSupervisorRequest({ body = {}, kernel, method, url }) {
  try {
    if (method === "GET" && url.pathname === "/status") {
      return ok(kernel.status());
    }

    if (method === "POST" && url.pathname === "/stop") {
      return ok(kernel.stop({ source: stringOr(body.source, "supervisor_http") }));
    }

    if (method === "POST" && url.pathname === "/clear-stop") {
      return ok(kernel.clearStop());
    }

    if (method === "POST" && url.pathname === "/execute") {
      return ok(kernel.execute(body.authorization ?? body));
    }

    if (method === "POST" && url.pathname === "/chunks") {
      return ok(kernel.submitChunk(body));
    }

    if (method === "POST" && url.pathname === "/tick") {
      return ok(kernel.tick());
    }

    if (method === "POST" && url.pathname === "/upstream-lost") {
      return ok(kernel.upstreamLost({ source: stringOr(body.source, "supervisor_http") }));
    }

    if (method === "GET" && url.pathname === "/events") {
      return ok({
        items: kernel.events({ after: Number(url.searchParams.get("after") ?? 0) })
      });
    }

    return {
      status: 404,
      body: {
        error_code: "SUPERVISOR_ROUTE_NOT_FOUND",
        message: `${method} ${url.pathname} is not a Supervisor Kernel route.`,
        retryable: false
      }
    };
  } catch (error) {
    return {
      status: statusForError(error),
      body: errorBody(error)
    };
  }
}

async function readJsonBody(req) {
  if (req.method === "GET" || req.method === "HEAD") {
    return {};
  }

  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      const error = new Error("Request body exceeds maximum size.");
      error.error_code = "REQUEST_BODY_TOO_LARGE";
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.trim() === "") {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.error_code = "JSON_INVALID";
    error.status = 400;
    throw error;
  }
}

function ok(body) {
  return { status: 200, body };
}

function stringOr(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function statusForError(error) {
  if (error?.status) {
    return error.status;
  }
  if (error instanceof KernelError) {
    return 409;
  }
  return 400;
}

function errorBody(error) {
  return {
    error_code: error?.error_code ?? "SUPERVISOR_BAD_REQUEST",
    message: String(error?.message ?? "Supervisor request failed.").slice(0, 500),
    retryable: false,
    ...(error?.details && Object.keys(error.details).length > 0 ? { details: error.details } : {})
  };
}

function writeJson(res, status, body) {
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": bytes.length
  });
  res.end(bytes);
}

function handleEventsUpgrade({ kernel, req, socket }) {
  const url = new URL(req.url ?? "/", "http://supervisor.local");
  if (url.pathname !== "/events") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || key.length === 0) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "\r\n"
  ].join("\r\n"));

  let cursor = Number(url.searchParams.get("after") ?? 0);
  const sendNewEvents = () => {
    if (socket.destroyed) {
      return;
    }
    for (const event of kernel.events({ after: cursor })) {
      cursor = Math.max(cursor, event.seq ?? cursor);
      socket.write(encodeWebSocketText(JSON.stringify(event)));
    }
  };
  const timer = setInterval(sendNewEvents, 25);
  sendNewEvents();

  const cleanup = () => clearInterval(timer);
  socket.on("data", (data) => {
    if ((data[0] & 0x0f) === 0x08) {
      socket.write(Buffer.from([0x88, 0x00]));
      socket.end();
    }
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);
  socket.on("end", cleanup);
}

function encodeWebSocketText(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}
