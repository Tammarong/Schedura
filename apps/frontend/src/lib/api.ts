// src/lib/api.ts

/* ---------- Environment detection ---------- */
const isBrowser = typeof window !== "undefined";
const isLocal =
  isBrowser &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

/* ---------- API / Socket base ---------- */
// - Dev: talk to local backend
// - Prod: same-origin "/api" (Vercel rewrite -> Render)
export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  (isLocal ? "http://localhost:4000/api" : "/api");

// - Socket *origin*: dev uses localhost; prod uses same-origin by default
export const SOCKET_URL: string =
  (import.meta.env.VITE_SOCKET_URL as string | undefined) ??
  (isLocal ? "http://localhost:4000" : "/");

/* Derive Socket.IO path from API_BASE so client hits the correct mount.
   - If API_BASE = "/api" or "https://x/api" -> SOCKET_PATH = "/api/socket.io"
   - If API_BASE = "/"                      -> SOCKET_PATH = "/socket.io" */
export const SOCKET_PATH: string = (() => {
  const base = new URL(
    API_BASE,
    isBrowser ? window.location.origin : "http://localhost"
  );
  return `${base.pathname.replace(/\/$/, "")}/socket.io`;
})();

/* Robust socket origin for io(url, { path }) —
   - Uses VITE_SOCKET_URL if provided (e.g., direct Render origin)
   - Else derives origin from API_BASE (works with same-origin setups) */
export const SOCKET_WS_URL: string = (() => {
  const env = import.meta.env.VITE_SOCKET_URL as string | undefined;
  if (env) return env;
  const base = new URL(
    API_BASE,
    isBrowser ? window.location.origin : "http://localhost"
  );
  return base.origin; // e.g., "http://localhost:4000" in dev, site origin in prod
})();

/* ---------- Auth storage (Bearer token fallback) ---------- */
/** We support multiple keys for back-compat with older code. */
const TOKEN_KEYS = [
  "schedura_access_token",
  "access_token",
  "auth_token",
  "token",
] as const;
type TokenKey = (typeof TOKEN_KEYS)[number];

let memoryToken: string | null = null;

/** Read token from memory → localStorage → sessionStorage (any known key) */
export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    for (const k of TOKEN_KEYS) {
      const v = localStorage.getItem(k) ?? sessionStorage.getItem(k);
      if (v) return v;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

/** Write token; choose persistence. "none" keeps it only in memory. */
export function setToken(
  token: string | null,
  persist: "local" | "session" | "none" = "none"
): void {
  memoryToken = token;
  try {
    // Clear old copies
    for (const k of TOKEN_KEYS) {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    }
    if (!token) return;
    if (persist !== "none") {
      const store = persist === "local" ? localStorage : sessionStorage;
      for (const k of TOKEN_KEYS) store.setItem(k, token);
    }
  } catch {
    // ignore storage errors
  }
}

/** Clear token everywhere. */
export function clearToken(): void {
  memoryToken = null;
  try {
    for (const k of TOKEN_KEYS) {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

/* ---------- URL builder ---------- */
export function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${base}${tail}`;
}

/* ---------- Types ---------- */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiOptions = {
  method?: HttpMethod;
  body?: Record<string, unknown> | FormData | undefined;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** allow opting out of credentials (default is include) */
  withCredentials?: boolean;
};

type ApiErrorShape = {
  error?: unknown;
  message?: unknown;
  details?: unknown;
};

/* ---------- Avatar back-compat injection ---------- */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Build absolute RAW avatar URL (bytes) using new endpoint
function buildAvatarRawUrl(obj: Record<string, unknown>): string | null {
  const username =
    typeof obj["username"] === "string" && obj["username"].trim() !== ""
      ? obj["username"].trim()
      : null;

  const idValue = obj["id"];
  const id =
    typeof idValue === "number"
      ? String(idValue)
      : typeof idValue === "string" && /^\d+$/.test(idValue)
      ? idValue
      : null;

  const param = username ?? id;
  if (!param) return null;

  const cacheBust = Date.now();
  return apiUrl(`/avatar/${encodeURIComponent(param)}/raw?cb=${cacheBust}`);
}

function needsAvatarInjection(obj: Record<string, unknown>): boolean {
  // Only attempt on user-like shapes
  if (!("username" in obj) && !("id" in obj)) return false;

  // If either camel or snake is present and non-empty, leave as-is
  const existing =
    (obj as { avatarUrl?: unknown }).avatarUrl ??
    (obj as { avatar_url?: unknown }).avatar_url;

  if (typeof existing === "string" && existing.trim() !== "") return false;
  if (existing !== undefined && existing !== null) return false;

  return true;
}

function injectAvatarUrls<T>(data: T): T {
  if (Array.isArray(data)) {
    return data.map(injectAvatarUrls) as unknown as T;
  }
  if (isPlainObject(data)) {
    const clone: Record<string, unknown> = { ...data };

    if (needsAvatarInjection(clone)) {
      const url = buildAvatarRawUrl(clone);
      if (url) {
        // Write both for max compatibility with old code paths
        (clone as any).avatarUrl = url;
        (clone as any).avatar_url = url;
      }
    }

    // Recurse into nested objects/arrays
    for (const key of Object.keys(clone)) {
      const v = clone[key];
      if (isPlainObject(v) || Array.isArray(v)) {
        clone[key] = injectAvatarUrls(v);
      }
    }
    return clone as unknown as T;
  }
  return data;
}

/* ---------- 401 handling: silent refresh + retry ---------- */
type UnauthorizedHandler = () => Promise<boolean>;
let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Install a custom 401 handler (e.g., to call /auth/refresh).
 * Should return true if a new token is available and we should retry.
 */
export function installUnauthorizedHandler(fn: UnauthorizedHandler): void {
  onUnauthorized = fn;
}

/** Default refresh implementation: POST /auth/refresh (cookie-based) */
async function defaultRefresh(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { token?: string };
    if (json.token) {
      // persist in local by default so user stays logged in next time
      setToken(json.token, "local");
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Set default so it works out of the box; AuthContext can override if needed.
onUnauthorized = defaultRefresh;

/* ---------- Core fetch helper ---------- */
/**
 * - Always sends `credentials: "include"` by default (for cookie sessions)
 * - Adds `Authorization: Bearer <token>` automatically if present
 * - On 401: tries a silent refresh once, then retries original request
 * - Parses JSON error bodies into readable messages
 * - Returns typed JSON (or throws on unexpected content-type)
 * - ✨ Recursively injects `avatarUrl` for user-like objects that lack it
 */
function normalizeBearer(token: string | null): string | null {
  if (!token) return null;
  return token.startsWith("Bearer ") ? token : `Bearer ${token}`;
}

export async function api<T>(
  path: string,
  options: ApiOptions = {}
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    signal,
    withCredentials = true,
  } = options;

  const token = getToken();
  const authHeader = normalizeBearer(token);
  const isForm = body instanceof FormData;

  const buildHeaders = (maybeAuth: string | null): HeadersInit =>
    isForm
      ? {
          // Only Accept; let the browser set multipart boundary for FormData
          Accept: "application/json",
          ...headers, // allow caller to override
          ...(maybeAuth ? { Authorization: maybeAuth } : {}),
        }
      : {
          // Do not set Content-Type for GET/HEAD; only when we have a JSON body
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers, // allow caller to override
          ...(maybeAuth ? { Authorization: maybeAuth } : {}),
        };

  const doFetch = async (maybeAuth: string | null): Promise<Response> =>
    fetch(apiUrl(path), {
      method,
      credentials: withCredentials ? "include" : "same-origin",
      headers: buildHeaders(maybeAuth),
      body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
      signal,
      redirect: "follow",
    });

  // First attempt
  let res = await doFetch(authHeader);

  // If unauthorized, try to refresh once and then retry
  if (res.status === 401 && onUnauthorized) {
    const refreshed = await onUnauthorized();
    if (refreshed) {
      const newAuth = normalizeBearer(getToken());
      res = await doFetch(newAuth);
    }
  }

  if (!res.ok) {
    // try JSON error payload first
    let msg = `${res.status} ${res.statusText}`;
    try {
      const maybeJson = (await res.json()) as ApiErrorShape;
      const cand =
        (typeof maybeJson.error === "string" && maybeJson.error) ||
        (typeof maybeJson.message === "string" && maybeJson.message);
      if (cand) msg = cand as string;
    } catch {
      try {
        const txt = await res.text();
        if (txt) msg = `${res.status} ${txt}`;
      } catch {
        /* ignore */
      }
    }

    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) {
    // No Content
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Unexpected content-type: "${contentType || "(empty)"}" for ${method} ${path}${
        text ? ` — body: ${text}` : ""
      }`
    );
  }

  const raw = (await res.json()) as T;
  return injectAvatarUrls<T>(raw);
}
