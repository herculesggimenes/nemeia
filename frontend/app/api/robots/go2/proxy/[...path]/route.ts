import type { NextRequest } from "next/server";

const ALLOWED_METHODS = new Set(["GET", "POST", "HEAD"]);

function targetUrl(request: NextRequest, pathParts: string[]): URL {
  const host = request.headers.get("x-robot-host");
  if (!host) {
    throw new Error("Missing X-Robot-Host header");
  }

  if (!/^[a-zA-Z0-9.-]+:\d+$/.test(host)) {
    throw new Error("Invalid X-Robot-Host header");
  }

  const path = pathParts.length > 0 ? `/${pathParts.join("/")}` : "/";
  return new URL(`http://${host}${path}${request.nextUrl.search}`);
}

function forwardedHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("content-type", contentType);
  }
  return headers;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }): Promise<Response> {
  if (!ALLOWED_METHODS.has(request.method)) {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const params = await context.params;
    const url = targetUrl(request, params.path ?? []);
    const body = request.method === "HEAD" || request.method === "GET" ? undefined : await request.arrayBuffer();
    const response = await fetch(url, {
      method: request.method,
      headers: forwardedHeaders(request),
      body,
      signal: AbortSignal.timeout(5000)
    });

    return new Response(request.method === "HEAD" ? null : await response.arrayBuffer(), {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "content-type": response.headers.get("content-type") ?? "text/plain"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
