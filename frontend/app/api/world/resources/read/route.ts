import {
  bearerToken,
  readAuthorizedResource,
  readJsonBody
} from "../../../../../lib/server/resource-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const result = await readAuthorizedResource(bearerToken(request.headers.get("authorization")), await readJsonBody(request));
    const partial = result.offset > 0 || result.length < result.totalLength;
    return new Response(result.bytes as unknown as BodyInit, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(result.length),
        "Content-Range": `bytes ${result.offset}-${result.offset + result.length - 1}/${result.totalLength}`,
        "Content-Type": result.contentType,
        "Cross-Origin-Resource-Policy": "same-origin",
        "Referrer-Policy": "no-referrer",
        "Vary": "Authorization",
        "X-Content-Type-Options": "nosniff",
      },
      status: partial ? 206 : 200,
    });
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
