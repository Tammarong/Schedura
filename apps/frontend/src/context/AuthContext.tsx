// src/context/AuthContext.tsx
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";
import { api, getToken, clearToken, API_BASE, installUnauthorizedHandler } from "@/lib/api";

/* ---------- Config: turn cookie-based refresh ON only if you actually use it ---------- */
const USE_REFRESH_COOKIE =
  String(import.meta.env.VITE_USE_REFRESH_COOKIE ?? "false").toLowerCase() === "true";

/* ---------- Types ---------- */
export type User = {
  id: number | string;
  username: string;
  email?: string;
  displayName: string;
  avatarUrl?: string | null;
};

type RawUser = {
  id: number | string;
  username: string;
  email?: string;
  display_name?: string;
  displayName?: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  login: (u: User) => void;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/* ---------- Helpers ---------- */
function mapUser(u: RawUser | undefined | null): User | null {
  if (!u || !u.id) return null;
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    displayName: u.displayName ?? u.display_name ?? u.username,
    avatarUrl: u.avatarUrl ?? u.avatar_url ?? null,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Accepts { user: RawUser }, { data: { user } }, or a RawUser at root. */
function extractRawUser(payload: unknown): RawUser | null {
  if (!isRecord(payload)) return null;

  if ("user" in payload) {
    return extractRawUser((payload as { user?: unknown }).user);
  }
  if ("data" in payload && isRecord((payload as { data?: unknown }).data)) {
    const d = (payload as { data: unknown }).data;
    if (isRecord(d) && "user" in d) return extractRawUser((d as { user?: unknown }).user);
  }

  const id = (payload as { id?: unknown }).id;
  const username = (payload as { username?: unknown }).username;
  const hasId = typeof id === "string" || typeof id === "number";
  if (hasId && typeof username === "string") return payload as RawUser;

  return null;
}

// Be liberal about keys so we work with legacy code.
const TOKEN_KEYS = [
  "schedura_access_token",
  "access_token",
  "auth_token",
  "token",
] as const;
type TokenKey = (typeof TOKEN_KEYS)[number];

function clearAllTokens(): void {
  try {
    clearToken(); // canonical key
  } catch {}
  TOKEN_KEYS.forEach((k) => {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {}
  });
}

function writeTokenEverywhere(token: string, persist: "local" | "session") {
  TOKEN_KEYS.forEach((k) => {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {}
  });
  const store = persist === "local" ? localStorage : sessionStorage;
  TOKEN_KEYS.forEach((k) => {
    try {
      store.setItem(k, token);
    } catch {}
  });
}

/* ---------- Provider ---------- */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Optional: cookie-based refresh (only if USE_REFRESH_COOKIE)
  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (!USE_REFRESH_COOKIE) return false;
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { token?: string; user?: RawUser };
      if (data.token) writeTokenEverywhere(data.token, "local");
      if (data.user) setUser(mapUser(data.user));
      return Boolean(data.token);
    } catch {
      return false;
    }
  }, []);

  // Let api() know whether to try silent refresh on 401
  useEffect(() => {
    installUnauthorizedHandler(USE_REFRESH_COOKIE ? refreshAccessToken : async () => false);
  }, [refreshAccessToken]);

  // Accept /users/current_user or /auth/me with flexible shapes
  const fetchMe = useCallback(async (): Promise<User | null> => {
    try {
      const res = await api<unknown>("/users/current_user", { method: "GET" });
      const raw = extractRawUser(res);
      if (raw) return mapUser(raw);
    } catch {}
    try {
      const res2 = await api<unknown>("/auth/me", { method: "GET" });
      const raw2 = extractRawUser(res2);
      if (raw2) return mapUser(raw2);
    } catch {}
    return null;
  }, []);

  const refresh = useCallback(async () => {
    const existing = getToken();

    // 1) No token? Only try cookie-refresh if enabled; otherwise guest.
    if (!existing) {
      setLoading(true);
      if (USE_REFRESH_COOKIE) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          try {
            const u = await fetchMe();
            setUser(u);
          } finally {
            setLoading(false);
          }
          return;
        }
      }
      setUser(null);
      setLoading(false);
      return;
    }

    // 2) Validate token
    setLoading(true);
    try {
      const u = await fetchMe();
      setUser(u);
    } catch {
      if (USE_REFRESH_COOKIE) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          try {
            const u2 = await fetchMe();
            setUser(u2);
          } finally {
            setLoading(false);
          }
          return;
        }
      }
      clearAllTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [fetchMe, refreshAccessToken]);

  const logout = useCallback(async () => {
    try {
      // Only call server logout if you actually use a refresh cookie
      if (USE_REFRESH_COOKIE) {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      }
    } catch {}
    clearAllTokens();
    setUser(null);
    setLoading(false);
  }, []);

  const login = useCallback((u: User) => {
    setUser(u);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh(); // bootstrap
  }, [refresh]);

  // Keep multiple tabs in sync with token changes
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      const key = e.key as TokenKey | null;
      if (key === null || TOKEN_KEYS.includes(key)) void refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, logout, login }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
};

export { AuthContext };
