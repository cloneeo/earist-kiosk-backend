const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function resolveApiBaseUrl(): string {
  const fromEnv = String(import.meta.env.VITE_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");

  if (typeof window === "undefined") {
    return fromEnv;
  }

  const isViteDev = window.location.port === "5173";
  const pageIsHttps = window.location.protocol === "https:";

  if (fromEnv) {
    try {
      const parsed = new URL(fromEnv);
      const isLocalTarget = LOCAL_HOSTS.has(parsed.hostname);

      if (!isViteDev && isLocalTarget) {
        console.warn("Ignoring localhost VITE_API_BASE_URL in production; using same-origin API.");
        return "";
      }

      if (pageIsHttps && parsed.protocol === "http:") {
        console.warn("Ignoring insecure HTTP VITE_API_BASE_URL on HTTPS page; using same-origin API.");
        return "";
      }

      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
    } catch {
      console.warn("Ignoring invalid VITE_API_BASE_URL; using same-origin API.");
      return "";
    }
  }

  if (isViteDev) {
    return `${window.location.protocol}//${window.location.hostname}:3000`;
  }

  return "";
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = resolveApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}
