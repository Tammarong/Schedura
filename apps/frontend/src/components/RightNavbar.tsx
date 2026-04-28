import { motion, AnimatePresence } from "framer-motion";
import { useContext, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTheme } from "next-themes";
import { AuthContext } from "@/context/AuthContext";
import { api, getToken } from "@/lib/api";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Users,
  Zap,
  Layers,
  Activity,
  StickyNote,
  User,
  LogOut,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  Menu as MenuIcon,
  X,
  Calendar,
  MessageSquare,
  Circle,
} from "lucide-react";
import { ChatheadContext } from "@/providers/chathead-context";

/* ----------------------------- types ----------------------------- */
export type CurrentUser = {
  id: number | string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  isOnline?: boolean;
};

type RightNavbarProps = {
  currentUser?: CurrentUser | null;
  onLogout?: () => Promise<void> | void;
  dashboardPath?: string; // default: '/dashboard'
};

/** Typed nav items */
type NavItemBase = { icon: LucideIcon; label: string };
type NavLinkItem = NavItemBase & { to: string };
type NavProfileItem = Omit<NavItemBase, "label"> & { label: "Profile" };
type DesktopNavItem = NavLinkItem | NavProfileItem;

/** Lightweight friend item used by the rail */
type Friend = {
  id: number;
  username: string;
  displayName: string;
  isOnline: boolean;
  avatarUrl?: string;
};

/** Shapes from Friends page / backend */
type UserLite = {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
};
type FriendItem = {
  since: string;
  user: UserLite;
};

/* ----------------------- constants & helpers ---------------------- */
const RAIL_WIDTH = 64;
const PANEL_WIDTH = 272;
const BRAND = "Schedura";
const STORY_ROUTE = "/story";
const GROUP_SCHEDULE_ROUTE = "/group-schedule";

const isPathActive = (pathname: string, target: string) => {
  if (target.startsWith("/profile")) return pathname.startsWith("/profile");
  return pathname === target;
};

/* Minimal JWT decode (like Posts.tsx) */
function decodeJwtPayload(token: string): null | { username?: string } {
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return (json && typeof json === "object" ? json : null) as { username?: string } | null;
  } catch {
    return null;
  }
}

/* ----------------------- runtime guards ----------------------- */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function hasProp<T extends string>(v: unknown, prop: T): v is Record<T, unknown> {
  return isObject(v) && prop in v;
}
function isString(v: unknown): v is string {
  return typeof v === "string";
}
function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isUserLite(v: unknown): v is UserLite {
  return (
    isObject(v) &&
    isNumber(v.id) &&
    isString(v.username) &&
    isString(v.displayName) &&
    (!("avatarUrl" in v) ||
      v.avatarUrl === null ||
      isString((v as { avatarUrl?: unknown }).avatarUrl))
  );
}

function isFriendItemShape(v: unknown): v is FriendItem {
  return isObject(v) && hasProp(v, "user") && isUserLite(v.user);
}

function getStatusFromError(e: unknown): number | undefined {
  if (isObject(e) && "status" in e && isNumber((e as { status?: unknown }).status)) {
    return (e as { status: number }).status;
  }
  return undefined;
}

/* Parse a single unknown item into Friend or null */
function parseFriend(x: unknown): Friend | null {
  if (isFriendItemShape(x)) {
    const u = x.user;
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatarUrl: isString(u.avatarUrl ?? undefined) ? (u.avatarUrl as string) : undefined,
      isOnline: false,
    };
  }
  if (!isObject(x)) return null;

  const idRaw = x["id"];
  const id =
    (isNumber(idRaw) && idRaw) ||
    (isString(idRaw) && !Number.isNaN(Number(idRaw)) && Number(idRaw)) ||
    null;
  if (id === null) return null;

  const usernameRaw = x["username"];
  const username = isString(usernameRaw) ? usernameRaw : null;

  const displayNameRaw = x["displayName"] ?? x["display_name"] ?? username;
  const displayName = isString(displayNameRaw) ? displayNameRaw : null;

  if (!username || !displayName) return null;

  const onlineRaw = x["isOnline"] ?? x["online"];
  const isOnline = isBool(onlineRaw) ? onlineRaw : false;

  const avatar =
    (isString(x["avatarUrl"]) ? (x["avatarUrl"] as string) : undefined) ??
    (isString(x["avatar_url"]) ? (x["avatar_url"] as string) : undefined);

  const base: Friend = { id, username, displayName, isOnline };
  return avatar ? { ...base, avatarUrl: avatar } : base;
}

/* Reusable tiny avatar */
function TinyAvatar({
  name,
  username,
  avatarUrl,
  size = 24,
  title,
}: {
  name?: string;
  username?: string;
  avatarUrl?: string | null;
  size?: number;
  title?: string;
}) {
  const [err, setErr] = useState(false);
  const initials = (name?.trim() || username || "?").charAt(0).toUpperCase() || "?";
  const s = `${size}px`;
  const src = typeof avatarUrl === "string" && avatarUrl ? avatarUrl : undefined;
  const show = !!src && !err;

  return (
    <div className="relative" style={{ width: s, height: s }} title={title}>
      {show ? (
        <img
          src={src}
          alt={name || username || "user"}
          className="rounded-full object-cover border w-full h-full"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="rounded-full border w-full h-full bg-secondary text-foreground grid place-items-center">
          <span className="text-[10px] font-semibold">{initials}</span>
        </div>
      )}
    </div>
  );
}

/* ================================ Component ================================ */
export const RightNavbar: React.FC<RightNavbarProps> = ({
  currentUser,
  onLogout,
  dashboardPath = "/dashboard",
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [panelOpen, setPanelOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // next-themes
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /* ---------- AuthContext ---------- */
  type AuthCtxUser = {
    id?: number | string;
    username?: string;
    display_name?: string;
    displayName?: string;
    avatarUrl?: string | null;
  };
  type AuthCtx = { user?: AuthCtxUser | null; logout?: () => Promise<void> } | null;

  const authCtx = useContext(AuthContext) as AuthCtx;
  const authUser = authCtx?.user;
  const ctxLogout = authCtx?.logout;

  const normalizedUser: CurrentUser | null = useMemo(() => {
    if (currentUser) return currentUser;
    if (authUser?.username) {
      return {
        id: authUser.id ?? authUser.username!,
        username: authUser.username!,
        displayName:
          authUser.displayName ?? authUser.display_name ?? authUser.username!,
        avatarUrl: authUser.avatarUrl ?? null,
      };
    }
    return null;
  }, [currentUser, authUser]);

  /* Chathead context (open DM) */
  const chat = useContext(ChatheadContext);

  /* ---------- desktop right rail padding ---------- */
  useEffect(() => {
    if (!isMobile) {
      document.body.style.paddingRight = `${RAIL_WIDTH}px`;
      return () => {
        document.body.style.paddingRight = "";
      };
    }
    document.body.style.paddingRight = "";
  }, [isMobile]);

  /* ---------- nav model ---------- */
  const mainNav: Readonly<NavLinkItem[]> = useMemo(
    () => [
      { icon: Home, label: "Dashboard", to: dashboardPath },
      { icon: Activity, label: "Pulse", to: "/posts" },
      { icon: Layers, label: "Hubs", to: "/groups" },
      { icon: Calendar, label: "Schedule", to: GROUP_SCHEDULE_ROUTE },
      { icon: StickyNote, label: "Stacks", to: "/notes" },
      { icon: Zap, label: "Desk", to: "/desk" },
    ],
    [dashboardPath]
  );

  // Desktop (rail + expanded panel) includes Stories
  const fullNavDesktop: Readonly<DesktopNavItem[]> = useMemo(
    () => [
      { icon: User, label: "Profile" },
      ...mainNav,
      { icon: Circle, label: "Stories", to: STORY_ROUTE },
      { icon: Users, label: "Friends", to: "/friends" },
    ],
    [mainNav]
  );

  /* ---------- actions ---------- */
  const toggleTheme = () => {
    const next = (resolvedTheme ?? theme) === "dark" ? "light" : "dark";
    setTheme(next);
  };

  const handleLogout = async () => {
    try {
      if (onLogout) {
        await onLogout();
      } else if (ctxLogout) {
        await ctxLogout(); // clears tokens + user (and calls server if configured)
      } else {
        // ultra-fallback: still hit API using the helper so API_BASE/credentials apply
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
      }
    } catch (err) {
      console.error("Logout failed", err);
    } finally {
      setMobileMenuOpen(false);
      navigate("/login", { replace: true });
    }
  };

  /* ---------- resolve my username (mirrors Posts’ reliability) ---------- */
  const [myHandle, setMyHandle] = useState<string | null>(normalizedUser?.username ?? null);

  useEffect(() => {
    if (normalizedUser?.username) setMyHandle(normalizedUser.username);
  }, [normalizedUser?.username]);

  useEffect(() => {
    if (myHandle) return;
    let alive = true;

    (async () => {
      // 1) JWT
      const tok = getToken?.();
      if (tok) {
        const payload = decodeJwtPayload(tok);
        if (payload?.username && alive) {
          setMyHandle(payload.username);
          return;
        }
      }

      // 2) current URL
      const m = location.pathname.match(/^\/profile\/([^/]+)/);
      if (m?.[1] && alive) {
        setMyHandle(m[1]);
        return;
      }

      // 3) API helper
      try {
        const d1 = await api<{ user?: { username?: string }; username?: string }>(
          "/users/current_user"
        );
        const u1 = d1.user?.username ?? d1.username;
        if (u1 && alive) {
          setMyHandle(u1);
          return;
        }
      } catch {
        /* ignore */
      }

      // 4) Fallback path
      try {
        const d2 = await api<{ user?: { username?: string }; username?: string }>(
          "/api/users/current_user"
        );
        const u2 = d2.user?.username ?? d2.username;
        if (u2 && alive) {
          setMyHandle(u2);
          return;
        }
      } catch {
        /* ignore */
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // once

  const gotoProfile = () => {
    if (!myHandle) {
      console.warn("Could not resolve username for profile route.");
      return;
    }
    window.location.href = `/profile/${myHandle}`;
    setMobileMenuOpen(false);
  };

  /* ====================== HOISTED DESKTOP-ONLY STATE ====================== */
  const isDark = (resolvedTheme ?? theme) === "dark";

  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState<boolean>(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [friendsAuthRequired, setFriendsAuthRequired] = useState<boolean>(false);

  // Probe auth only when the panel opens
  useEffect(() => {
    if (!panelOpen) return;
    let cancelled = false;

    (async () => {
      try {
        await api<unknown>("/users/current_user");
        if (!cancelled) setFriendsAuthRequired(false);
      } catch (e: unknown) {
        if (!cancelled) {
          const status = getStatusFromError(e);
          if (status === 401) setFriendsAuthRequired(true);
          else setFriendsAuthRequired(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [panelOpen]);

  useEffect(() => {
    if (!panelOpen) return;

    let cancelled = false;

    (async () => {
      try {
        setFriendsLoading(true);
        setFriendsError(null);

        let raw: unknown = await api<unknown>("/friends", { method: "GET" });
        if (!Array.isArray(raw)) {
          raw = await api<unknown>("/api/friends", { method: "GET" });
        }
        if (!Array.isArray(raw)) {
          const err = new Error("Invalid friends response");
          (err as unknown as { status?: number }).status = 500;
          throw err;
        }

        const cleaned: Friend[] = (raw as unknown[])
          .map(parseFriend)
          .filter((f): f is Friend => f !== null);

        if (!cancelled) setFriends(cleaned.slice(0, 8));
      } catch (e: unknown) {
        if (!cancelled) {
          const status = getStatusFromError(e);
          if (status === 401) {
            setFriendsAuthRequired(true);
            setFriends([]);
            setFriendsError(null);
          } else {
            setFriendsError("Failed to load friends.");
          }
        }
      } finally {
        if (!cancelled) setFriendsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [panelOpen]);

  const openDM = (f: Friend) => {
    if (!chat?.openChat) return;
    chat.openChat({
      id: f.id,
      username: f.username,
      displayName: f.displayName,
      avatarUrl: f.avatarUrl ?? undefined,
      isOnline: f.isOnline,
    });
  };

  /* ====================== MOBILE NAV (bottom) ====================== */
  if (isMobile) {
    // Keep bottom bar unchanged: mainNav minus dashboard + notes
    const mobileNav = mainNav.filter(
      (item) => item.to !== dashboardPath && item.to !== "/notes"
    );

    // Mobile slide-out menu includes Stories
    const mobileFullMenuItems: DesktopNavItem[] = [
      { icon: User, label: "Profile" } as NavProfileItem,
      ...mainNav,
      { icon: Circle, label: "Stories", to: STORY_ROUTE } as NavLinkItem,
      { icon: Users, label: "Friends", to: "/friends" } as NavLinkItem,
    ];

    return (
      <>
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border"
          role="navigation"
          aria-label="Primary mobile"
        >
          <div className="flex justify-around items-center py-2 px-3">
            {mobileNav.map((item) => {
              const Icon = item.icon;
              const active = isPathActive(location.pathname, item.to);
              return (
                <Link key={item.to} to={item.to} aria-label={item.label}>
                  <motion.div
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    className={`flex flex-col items-center p-2 rounded-lg transition-colors ${
                      active ? "text-primary" : "text-muted-foreground hover:text-primary"
                    }`}
                  >
                    <Icon className="h-5 w-5 mb-1" />
                    <span className="text-[11px] font-medium">{item.label}</span>
                  </motion.div>
                </Link>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex flex-col items-center p-2"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-full-menu"
            >
              <MenuIcon className="h-5 w-5 mb-1" />
              <span className="text-[11px] font-medium">Menu</span>
            </Button>
          </div>
        </nav>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] bg-background/80 backdrop-blur-sm"
              onClick={() => setMobileMenuOpen(false)}
            >
              <motion.aside
                id="mobile-full-menu"
                role="dialog"
                aria-modal="true"
                initial={{ x: "100%" }}
                animate={{ x: 0 }}
                exit={{ x: "100%" }}
                transition={{ duration: 0.28, ease: "easeOut" }}
                className="fixed right-0 top-0 h-full w-80 bg-card border-l border-border shadow-lg p-6"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-between items-center mb-6 pb-4 border-b border-border/60">
                  <h2 className="text-lg font-bold">{BRAND}</h2>
                  <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                    <X className="h-5 w-5" />
                  </Button>
                </div>

                <div className="flex-1 space-y-2 mt-2">
                  {mobileFullMenuItems.map((item) => {
                    const Icon = item.icon;

                    if (!("to" in item)) {
                      const active = location.pathname.startsWith("/profile");
                      return (
                        <button
                          key="__profile__"
                          onClick={gotoProfile}
                          className={`w-full text-left flex items-center gap-3 p-3 rounded-lg transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground shadow"
                              : "hover:bg-secondary text-foreground hover:text-secondary-foreground"
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="font-medium">Profile</span>
                        </button>
                      );
                    }

                    const active = isPathActive(location.pathname, item.to);
                    return (
                      <Link key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)}>
                        <motion.div
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground shadow"
                              : "hover:bg-secondary text-foreground hover:text-secondary-foreground"
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="font-medium">{item.label}</span>
                        </motion.div>
                      </Link>
                    );
                  })}
                </div>

                <div className="space-y-2 mt-6">
                  <Button variant="ghost" onClick={toggleTheme} className="w-full justify-start p-3">
                    <div className="flex items-center gap-3">
                      {mounted && ((resolvedTheme ?? theme) === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />)}
                      <span className="font-medium">
                        {mounted && ((resolvedTheme ?? theme) === "dark" ? "Light Mode" : "Night Mode")}
                      </span>
                    </div>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleLogout}
                    className="w-full justify-start p-3 text-destructive hover:text-destructive-foreground hover:bg-destructive/10"
                  >
                    <div className="flex items-center gap-3">
                      <LogOut className="h-5 w-5" />
                      <span className="font-medium">Logout</span>
                    </div>
                  </Button>
                </div>
              </motion.aside>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  }

  /* ====================== DESKTOP NAV (right rail + overlay) ====================== */
  return (
    <>
      <div
        className="fixed top-0 right-0 h-full z-50 bg-card/95 backdrop-blur-lg border-l border-border"
        style={{ width: RAIL_WIDTH }}
        role="navigation"
        aria-label="Primary desktop"
        onMouseEnter={() => setPanelOpen(true)}
        onMouseLeave={() => setPanelOpen(false)}
      >
        <div className="flex flex-col h-full items-center py-3">
          <div className="mb-4">
            <Button
              variant="ghost"
              size="icon"
              aria-label={panelOpen ? "Collapse" : "Expand"}
              onClick={() => setPanelOpen((v) => !v)}
            >
              {panelOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </div>

          {/* icons only list */}
          <div className="flex-1 space-y-2">
            {fullNavDesktop.map((item) => {
              const Icon = item.icon;

              if (!("to" in item)) {
                const active = location.pathname.startsWith("/profile");
                return (
                  <button key="__profile__" aria-label="Profile" onClick={gotoProfile}>
                    <div
                      className={`mx-2 p-3 rounded-xl flex items-center justify-center transition-colors ${
                        active ? "bg-primary text-primary-foreground shadow" : "hover:bg-secondary text-foreground"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                  </button>
                );
              }

              const active = isPathActive(location.pathname, item.to);
              return (
                <Link key={item.to} to={item.to} aria-label={item.label}>
                  <div
                    className={`mx-2 p-3 rounded-xl flex items-center justify-center transition-colors ${
                      active ? "bg-primary text-primary-foreground shadow" : "hover:bg-secondary text-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="space-y-2 pb-3">
            <Button
              variant="ghost"
              size="icon"
              aria-label={(resolvedTheme ?? theme) === "dark" ? "Light mode" : "Night mode"}
              onClick={() => {
                const next = (resolvedTheme ?? theme) === "dark" ? "light" : "dark";
                setTheme(next);
              }}
              className={mounted && ((resolvedTheme ?? theme) === "dark") ? "text-yellow-500" : ""}
            >
              {mounted && ((resolvedTheme ?? theme) === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />)}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Logout"
              onClick={handleLogout}
              className="text-destructive"
            >
              <LogOut className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {panelOpen && (
          <motion.aside
            initial={{ x: PANEL_WIDTH, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: PANEL_WIDTH, opacity: 0 }}
            transition={{ type: "tween", duration: 0.22 }}
            className="fixed top-0 right-0 h-full z-[55] bg-card border-l border-border shadow-xl"
            style={{ width: PANEL_WIDTH }}
            onMouseEnter={() => setPanelOpen(true)}
            onMouseLeave={() => setPanelOpen(false)}
          >
            <div className="flex flex-col h-full p-4">
              {/* Header stays fixed */}
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-border">
                <h2 className="text-base font-semibold">{BRAND}</h2>
                <Button variant="ghost" size="icon" onClick={() => setPanelOpen(false)} aria-label="Close">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Scrollable middle content */}
              <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                {/* NAV LINKS */}
                <nav className="space-y-2 mb-4">
                  {fullNavDesktop.map((item) => {
                    const Icon = item.icon;

                    if (!("to" in item)) {
                      const active = location.pathname.startsWith("/profile");
                      return (
                        <button key="__profile__" onClick={gotoProfile} className="w-full text-left">
                          <motion.div
                            whileHover={{ scale: 1.01 }}
                            whileTap={{ scale: 0.99 }}
                            className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                              active
                                ? "bg-primary text-primary-foreground shadow"
                                : "hover:bg-secondary text-foreground hover:text-secondary-foreground"
                            }`}
                          >
                            <Icon className="h-5 w-5 shrink-0" />
                            <span className="font-medium">Profile</span>
                          </motion.div>
                        </button>
                      );
                    }

                    const active = isPathActive(location.pathname, item.to);
                    return (
                      <Link key={item.to} to={item.to}>
                        <motion.div
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                            active
                              ? "bg-primary text-primary-foreground shadow"
                              : "hover:bg-secondary text-foreground hover:text-secondary-foreground"
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="font-medium">{item.label}</span>
                        </motion.div>
                      </Link>
                    );
                  })}
                </nav>

                {/* FRIENDS BOX */}
                <FriendsBox
                  friends={friends}
                  friendsAuthRequired={friendsAuthRequired}
                  friendsLoading={friendsLoading}
                  friendsError={friendsError}
                  openDM={openDM}
                />
              </div>

              {/* Footer stays pinned */}
              <div className="pt-3 mt-4 border-t border-border space-y-2">
                <Button
                  variant="ghost"
                  className="w-full justify-start p-3"
                  onClick={() => {
                    const next = isDark ? "light" : "dark";
                    setTheme(next);
                  }}
                >
                  <div className="flex items-center gap-3">
                    {mounted && (isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />)}
                    <span className="font-medium">
                      {mounted && (isDark ? "Light Mode" : "Night Mode")}
                    </span>
                  </div>
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleLogout}
                  className="w-full justify-start p-3 text-destructive hover:text-destructive-foreground hover:bg-destructive/10"
                >
                  <div className="flex items-center gap-3">
                    <LogOut className="h-5 w-5" />
                    <span className="font-medium">Logout</span>
                  </div>
                </Button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
};

/* -------------------------- Extracted subview -------------------------- */
function FriendsBox({
  friends,
  friendsAuthRequired,
  friendsLoading,
  friendsError,
  openDM,
}: {
  friends: Friend[];
  friendsAuthRequired: boolean;
  friendsLoading: boolean;
  friendsError: string | null;
  openDM: (f: Friend) => void;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Friends</h3>
        <Link to="/friends" className="text-xs text-primary hover:underline">
          View all
        </Link>
      </div>

      <div className="rounded-lg border bg-background">
        {friendsAuthRequired ? (
          <div className="p-3 text-xs text-muted-foreground">Sign in to see friends.</div>
        ) : friendsLoading ? (
          <div className="p-3 text-xs text-muted-foreground">Loading…</div>
        ) : friendsError ? (
          <div className="p-3 text-xs text-destructive">{friendsError}</div>
        ) : friends.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">No friends yet.</div>
        ) : (
          <ul className="max-h-64 overflow-auto">
            {friends.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 hover:bg-secondary/50"
              >
                <Link
                  to={`/profile/${encodeURIComponent(f.username)}`}
                  title={`Open ${f.displayName}'s profile`}
                  aria-label={`Open ${f.displayName}'s profile`}
                  className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-primary/60"
                >
                  <TinyAvatar
                    name={f.displayName}
                    username={f.username}
                    avatarUrl={f.avatarUrl ?? null}
                    size={28}
                    title={f.displayName}
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{f.displayName}</div>
                  <div className="text-[11px] text-muted-foreground truncate">@{f.username}</div>
                </div>

                <div
                  className={`inline-flex items-center gap-1 text-[11px] ${
                    f.isOnline ? "text-emerald-600" : "text-muted-foreground"
                  }`}
                  title={f.isOnline ? "Online" : "Offline"}
                >
                  <Circle className={`h-3 w-3 ${f.isOnline ? "fill-emerald-500 stroke-emerald-500" : ""}`} />
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-2 gap-1"
                  onClick={() => openDM(f)}
                  title={`Message ${f.displayName}`}
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="hidden md:inline">Message</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
