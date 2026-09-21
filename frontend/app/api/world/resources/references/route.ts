import {
  bearerToken,
  listAuthorizedResourceReferences,
  parseContextBody,
  readJsonBody
} from "../../../../../lib/server/resource-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const context = parseContextBody(await readJsonBody(request));
    const references = await listAuthorizedResourceReferences(bearerToken(request.headers.get("authorization")), context);
    return Response.json({ references }, { headers: privateHeaders() });
  } catch (error) {
    return failureResponse(error);
  }
}

function privateHeaders(): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "Vary": "Authorization",
    "X-Content-Type-Options": "nosniff",
  };
}

function failureResponse(error: unknown): Response {
  const status = isFailure(error) ? error.status : 500;
  const code = isFailure(error) ? error.code : "resource_read_failed";
  return Response.json({ error: code }, { headers: privateHeaders(), status });
}

function isFailure(error: unknown): error is { code: string; status: number } {
  return typeof error === "object" && error !== null && "code" in error && "status" in error;
}
