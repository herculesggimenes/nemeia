import { createServer } from "node:http";

const MAX_BODY_BYTES = 1_000_000;

export function createMissionHttpServer({ api }) {
  return createServer(async (req, res) => {
    try {
      const body = await readJsonBody(req);
      const response = await api.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body
      });
      writeJson(res, response.status, response.headers, response.body);
    } catch (error) {
      writeJson(
        res,
        error.status ?? 400,
        { "content-type": "application/json" },
        {
          error_code: error.error_code ?? "BAD_REQUEST",
          message: String(error.message ?? "Bad request.").slice(0, 500),
          retryable: false
        }
      );
    }
  });
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

function writeJson(res, status, headers, body) {
  const bytes = Buffer.from(`${JSON.stringify(body)}\n`, "utf8");
  res.writeHead(status, {
    "content-type": headers?.["content-type"] ?? "application/json",
    "content-length": bytes.length
  });
  res.end(bytes);
}
