export function validateRemoteServerBaseUrl(raw: string):
  | { ok: true; baseUrl: string }
  | { ok: false; message: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: "Remote server base URL must be a valid absolute URL." };
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (
    path === "/global/health"
    || path === "/config/providers"
    || path === "/provider"
    || path === "/session"
    || path === "/session/status"
    || /^\/session\/[^/]+(?:\/message)?$/.test(path)
  ) {
    return {
      ok: false,
      message: "Remote server base URL must point to the OpenCode server root or reverse-proxy base path, not a specific API endpoint.",
    };
  }

  url.pathname = path === "/" ? "/" : path;
  url.search = "";
  url.hash = "";
  return { ok: true, baseUrl: url.toString().replace(/\/$/, "") };
}
