/** Network fence for software-only E7 verification; never records request URLs. */
export function createNativeNetworkPolicy({ baseURL, uri, databaseName }) {
  const appOrigin = httpOrigin(baseURL);
  const worldOrigin = httpOrigin(uri);
  const subscribePath = `/v1/database/${encodeURIComponent(databaseName)}/subscribe`;
  return {
    allowHttp(rawURL, method = "GET") {
      const url = new URL(rawURL);
      // Canonical SDK exchanges the caller token for a short-lived socket token.
      // This is authentication only, not an HTTP World reducer/procedure path.
      if (url.origin === worldOrigin && url.pathname === "/v1/identity/websocket-token") {
        return method === "POST";
      }
      if (url.origin !== appOrigin) { return false; }
      if (url.pathname === "/api/world/resources/read" || url.pathname === "/api/world/resources/references") {
        return method === "POST";
      }
      if (method !== "GET" && method !== "HEAD") { return false; }
      return ["/", "/missions", "/settings", "/docs", "/framework", "/favicon.ico"].includes(url.pathname)
        || url.pathname.startsWith("/_next/") || url.pathname.startsWith("/assets/");
    },
    allowSocket(rawURL) {
      const url = new URL(rawURL);
      if (!["ws:", "wss:"].includes(url.protocol)) { return false; }
      const origin = httpOrigin(url);
      return (origin === worldOrigin && url.pathname === subscribePath)
        || (origin === appOrigin && url.pathname === "/_next/webpack-hmr");
    },
  };
}

export async function installNativeNetworkFence(context, policy, violations) {
  await context.route("**/*", (route) => {
    if (policy.allowHttp(route.request().url(), route.request().method())) { return route.continue(); }
    violations.push("forbidden_http_request_blocked");
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (policy.allowSocket(socket.url())) { socket.connectToServer(); return; }
    violations.push("forbidden_socket_blocked");
    return socket.close();
  });
  // Legacy Go2 peer transport must also fail before making a network connection.
  await context.addInitScript(() => {
    Object.defineProperty(window, "RTCPeerConnection", {
      configurable: false,
      // This constructor must travel inside Playwright's serialized initializer.
      // oxlint-disable-next-line unicorn/consistent-function-scoping
      value: function ForbiddenRobotTransport() { throw new Error("native_ui_robot_transport_forbidden"); },
    });
  });
}

function httpOrigin(rawURL) {
  const url = new URL(rawURL);
  if (url.protocol === "ws:") { url.protocol = "http:"; }
  if (url.protocol === "wss:") { url.protocol = "https:"; }
  return url.origin;
}
