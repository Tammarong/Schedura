// src/pages/Story.tsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api, apiUrl, getToken } from "@/lib/api"; // + getToken
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  X,
  ChevronLeft,
  ChevronRight,
  Volume2,
  Plus,
  PlusCircle,
  Trash2,
} from "lucide-react";

/* --------------------------------- types --------------------------------- */

export type Story = {
  id: number;
  userId: number; // runtime may be string on some backends; we normalize in comparisons
  caption: string | null;
  visibility: "public" | "followers" | "auto";
  media: {
    url: string | null;
    mime?: string | null;
    width?: number | null;
    height?: number | null;
    seconds?: number | null;
  };
  createdAt: string;
  expiresAt: string;
  archivedAt: string | null;
  hasSeen?: boolean;
};

type FeedResponse = { items: Story[] };

type UserLite = {
  id: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

/* -------------------------------- helpers -------------------------------- */

function isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u);
}

/** Story controller returns `/stories/:id/media` (no `/api`). For relative paths, call apiUrl(path). */
function absoluteMediaUrl(u: string | null): string | null {
  if (!u) return null;
  return isAbsoluteUrl(u) ? u : apiUrl(u);
}

/** Same treatment for avatar or other user-hosted assets. */
function absoluteAvatarUrl(u: string | null): string | null {
  if (!u) return null;
  return isAbsoluteUrl(u) ? u : apiUrl(u);
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const s = Math.max(1, Math.floor((now - d) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d2 = Math.floor(h / 24);
  return `${d2}d`;
}

function readString(obj: unknown, key: string): string | null {
  if (obj && typeof obj === "object" && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (obj && typeof obj === "object" && key in obj) {
    const v = (obj as Record<string, unknown>)[key];
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/* --------------------------- identity + equality -------------------------- */

function decodeJwtPayload(token: string): null | { id?: string | number; username?: string } {
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (json && typeof json === "object") return json as any;
    return null;
  } catch {
    return null;
  }
}

/** Coerce two ids to string and compare; tolerates number vs string vs uuid. */
function idEq(a: unknown, b: unknown) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

type Me = { id: string | number | null; username: string | null };

/** Resolve current user via /users/current_user -> /api/users/current_user -> JWT */
function useMyIdentity(): Me {
  const [me, setMe] = useState<Me>({ id: null, username: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      const paths = ["/users/current_user", "/api/users/current_user"];
      for (const path of paths) {
        try {
          const data = await api<any>(path);
          const id = (data?.user?.id ?? data?.id) ?? null;
          const username =
            (data?.user?.username ?? data?.username) ?? null;
          if (alive) {
            setMe({ id, username });
            return;
          }
        } catch {
          // try next
        }
      }
      // Fallback: JWT
      try {
        const tok = getToken?.();
        if (tok) {
          const payload = decodeJwtPayload(tok);
          if (alive && payload) {
            setMe({ id: payload.id ?? null, username: payload.username ?? null });
          }
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return me;
}

/* ------------------------------- constants ------------------------------- */

const NEW_STORY_ROUTE = "/story/new";

/* ------------------------------- data hooks ------------------------------ */

// Expose setItems so we can mutate locally after deletes
function useStoriesFeed() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Story[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await api<FeedResponse>("/stories/feed");
        if (!alive) return;
        setItems(res.items || []);
        setErr(null);
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { loading, err, items, setItems };
}

type Threads = Array<{
  userId: number;
  latestAt: string;
  items: Story[];
  unseenCount: number;
}>;

function useThreads(items: Story[]): Threads {
  return useMemo(() => {
    const map = new Map<number, Story[]>();
    for (const s of items) {
      // runtime safety if backend returns string ids: still key the map by Number if possible
      const k = typeof (s as any).userId === "string" ? Number((s as any).userId) : (s as any).userId;
      const key = Number.isFinite(k) ? k : (s as any).userId;
      if (!map.has(key)) map.set(key as number, []);
      map.get(key as number)!.push(s);
    }
    const out: Threads = [];
    for (const [userId, arr] of map) {
      const sorted = [...arr].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const latestAt =
        sorted[sorted.length - 1]?.createdAt ?? "1970-01-01T00:00:00.000Z";
      const unseenCount = sorted.reduce((acc, s) => acc + (s.hasSeen ? 0 : 1), 0);
      out.push({ userId, items: sorted, latestAt, unseenCount });
    }
    out.sort((a, b) => {
      const aSeen = a.unseenCount === 0 ? 1 : 0;
      const bSeen = b.unseenCount === 0 ? 1 : 0;
      if (aSeen !== bSeen) return aSeen - bSeen;
      return new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime();
    });
    return out;
  }, [items]);
}

// Fetch minimal user profiles so we can show username/avatar in tray & viewer.
function useUsersLite(userIds: number[]) {
  const [map, setMap] = useState<Record<number, UserLite>>({});
  useEffect(() => {
    let alive = true;
    const ids = Array.from(new Set(userIds)).filter((n) => Number.isFinite(n));
    if (!ids.length) return;

    async function fetchBatch(): Promise<Record<number, UserLite>> {
      const candidates = [
        `/users/brief?ids=${ids.join(",")}`,
        `/users/by-ids?ids=${ids.join(",")}`,
      ];

      for (const path of candidates) {
        try {
          const resp = await api<{ users?: unknown }>(path);
          const usersUnknown = resp.users;
          if (Array.isArray(usersUnknown)) {
            const acc: Record<number, UserLite> = {};
            for (const u of usersUnknown) {
              const id = readNumber(u, "id");
              const username =
                readString(u, "username") ??
                readString(u, "user_name") ??
                (id != null ? `user-${id}` : null);
              const displayName =
                readString(u, "display_name") ?? readString(u, "displayName");
              const avatarUrl =
                readString(u, "avatar_url") ?? readString(u, "avatarUrl");
              if (id != null) {
                acc[id] = {
                  id,
                  username,
                  displayName: displayName ?? null,
                  avatarUrl: avatarUrl ?? null,
                };
              }
            }
            return acc;
          }
        } catch {
          // try next
        }
      }

      // Fallback: one-by-one
      const acc: Record<number, UserLite> = {};
      for (const id of ids) {
        try {
          const u = await api<unknown>(`/users/${id}`);
          const username =
            readString(u, "username") ??
            readString(u, "user_name") ??
            `user-${id}`;
          const displayName =
            readString(u, "display_name") ?? readString(u, "displayName");
          const avatarUrl =
            readString(u, "avatar_url") ?? readString(u, "avatarUrl");
          acc[id] = {
            id,
            username,
            displayName: displayName ?? null,
            avatarUrl: avatarUrl ?? null,
          };
        } catch {
          acc[id] = {
            id,
            username: `user-${id}`,
            displayName: null,
            avatarUrl: null,
          };
        }
      }
      return acc;
    }

    (async () => {
      const result = await fetchBatch();
      if (!alive) return;
      setMap((prev) => ({ ...prev, ...result }));
    })();

    return () => {
      alive = false;
    };
  }, [userIds.join(",")]);

  return map;
}

/* ------------------------------ page (tray) ------------------------------- */

export default function StoryPage() {
  const nav = useNavigate();
  const { loading, err, items, setItems } = useStoriesFeed();
  const threads = useThreads(items);
  const usersMap = useUsersLite(threads.map((t) => t.userId));
  const me = useMyIdentity(); // robust identity

  const [open, setOpen] = useState(false);
  const [activeThreadIdx, setActiveThreadIdx] = useState<number>(0);

  // Remove deleted stories locally
  const handleDeleted = useCallback(
    (storyId: number) => {
      setItems((prev) => prev.filter((s) => s.id !== storyId));
    },
    [setItems]
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-teal-400 to-emerald-300">
            Stories
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
            Quick moments from your network — tap to view, hold to pause.
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => nav(-1)} className="hidden sm:inline-flex">
            Back
          </Button>
          {/* Post New Story (header CTA) */}
          <Button
            onClick={() => nav(NEW_STORY_ROUTE)}
            aria-label="Post a new story"
            className="group relative overflow-hidden bg-gradient-to-r from-sky-600 via-teal-500 to-emerald-400 text-white shadow-md hover:brightness-110"
          >
            <span className="relative z-10 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Post Story
            </span>
            <span className="absolute inset-0 -translate-x-full group-hover:translate-x-0 transition-transform duration-500 bg-white/10" />
          </Button>
        </div>
      </div>

      {/* Tray */}
      <Card className="mb-4 border-muted/60 bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/40">
        <CardContent className="p-3">
          {loading ? (
            <div className="flex gap-3 overflow-x-auto no-scrollbar">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center w-[72px] shrink-0">
                  <Skeleton className="h-16 w-16 rounded-full mb-2" />
                  <Skeleton className="h-3 w-12 rounded" />
                </div>
              ))}
            </div>
          ) : err ? (
            <div className="text-sm text-destructive">{err}</div>
          ) : (
            <div className="flex gap-3 overflow-x-auto no-scrollbar">
              {/* New story bubble (always first) */}
              <button
                onClick={() => nav(NEW_STORY_ROUTE)}
                className="flex flex-col items-center w-[72px] shrink-0 group"
                title="Add to your story"
              >
                <div className="relative p-[2px] rounded-full bg-gradient-to-tr from-sky-500 via-teal-400 to-emerald-300 shadow-sm">
                  <div className="rounded-full bg-background p-[2px]">
                    <Avatar size={64} src={null} alt="Your story" />
                  </div>
                  <div className="absolute -bottom-1 -right-1 grid place-items-center rounded-full bg-primary text-primary-foreground border border-background w-6 h-6 shadow">
                    <PlusCircle className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-1 text-[11px] max-w-[68px] truncate text-foreground/90">
                  Your Story
                </div>
              </button>

              {/* Existing threads */}
              {threads.length === 0 ? (
                <div className="text-sm text-muted-foreground self-center pl-1">
                  No active stories right now. Be the first to post!
                </div>
              ) : (
                threads.map((t, idx) => {
                  const u = usersMap[t.userId];
                  const seen = t.unseenCount === 0;
                  const ringClass = seen
                    ? "bg-gradient-to-tr from-muted to-muted"
                    : "bg-gradient-to-tr from-sky-500 via-teal-400 to-emerald-300";
                  return (
                    <button
                      key={t.userId}
                      className="flex flex-col items-center w-[72px] shrink-0 group"
                      onClick={() => {
                        setActiveThreadIdx(idx);
                        setOpen(true);
                      }}
                      title={u?.username ?? `user-${t.userId}`}
                    >
                      <motion.div
                        whileHover={{ scale: 1.04 }}
                        className={`p-[2px] rounded-full ${ringClass} shadow-sm`}
                      >
                        <div className="rounded-full bg-background p-[2px]">
                          <Avatar size={64} src={u?.avatarUrl} alt={u?.username ?? ""} />
                        </div>
                      </motion.div>
                      <div className="mt-1 text-[11px] max-w-[68px] truncate">
                        {u?.username ?? `user-${t.userId}`}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Floating Action Button (mobile) */}
      <Button
        onClick={() => nav(NEW_STORY_ROUTE)}
        aria-label="Create story"
        className="md:hidden fixed bottom-20 right-4 z-40 rounded-full shadow-lg bg-gradient-to-br from-sky-600 via-teal-500 to-emerald-400 text-white h-12 w-12 p-0"
      >
        <Plus className="h-5 w-5" />
      </Button>

      {/* Full-screen viewer */}
      <StoryViewer
        open={open}
        onOpenChange={setOpen}
        threads={threads}
        usersMap={usersMap}
        initialThreadIndex={activeThreadIdx}
        me={me}                  // pass full identity
        onDeleted={handleDeleted}
      />
    </div>
  );
}

/* ---------------------------- story viewer UI ----------------------------- */

function StoryViewer({
  open,
  onOpenChange,
  threads,
  usersMap,
  initialThreadIndex = 0,
  me,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  threads: Threads;
  usersMap: Record<number, UserLite>;
  initialThreadIndex?: number;
  me: { id: string | number | null; username: string | null };
  onDeleted?: (storyId: number) => void;
}) {
  const [threadIdx, setThreadIdx] = useState(initialThreadIndex);
  const [storyIdx, setStoryIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [muted] = useState(true);
  const [viewed, setViewed] = useState<Set<number>>(new Set());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const [progress, setProgress] = useState(0);
  const holdRef = useRef(false);

  useEffect(() => {
    if (open) {
      setThreadIdx(initialThreadIndex);
      setStoryIdx(0);
      setProgress(0);
      startedAtRef.current = performance.now();
    }
  }, [open, initialThreadIndex]);

  const currentThread = threads[threadIdx];
  const current = currentThread?.items[storyIdx];
  const user = currentThread ? usersMap[currentThread.userId] : undefined;

  // Robust owner check: by id OR username
  const isOwner =
    !!current &&
    (idEq((current as any).userId, me.id) ||
      (!!me.username && !!user?.username && me.username === user.username));

  const durationMs = useMemo(() => {
    const sec = current?.media.seconds;
    const base = typeof sec === "number" && sec > 0 ? sec : 5;
    return Math.max(3, Math.min(10, base)) * 1000;
  }, [current?.media.seconds]);

  // Mark as viewed when active
  useEffect(() => {
    if (!current) return;
    if (viewed.has(current.id)) return;
    setViewed((prev) => new Set(prev).add(current.id));
    api(`/stories/${current.id}/view`, { method: "POST" }).catch(() => {});
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress loop
  useEffect(() => {
    if (!open || !current) return;
    if (paused || holdRef.current) return;

    const startTs = performance.now();
    startedAtRef.current = startTs;

    const loop = (ts: number) => {
      const elapsed = ts - startedAtRef.current;
      const p = Math.min(1, elapsed / durationMs);
      setProgress(p);
      if (p >= 1) {
        next();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, current?.id, paused, durationMs]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onOpenChange(false);
      else if (e.key.toLowerCase() === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = useCallback(() => {
    if (!currentThread) return;
    if (storyIdx < currentThread.items.length - 1) {
      setStoryIdx((i) => i + 1);
      setProgress(0);
    } else if (threadIdx < threads.length - 1) {
      setThreadIdx((t) => t + 1);
      setStoryIdx(0);
      setProgress(0);
    } else {
      onOpenChange(false);
    }
  }, [storyIdx, threadIdx, currentThread, threads.length, onOpenChange]);

  const prev = useCallback(() => {
    if (!currentThread) return;
    if (storyIdx > 0) {
      setStoryIdx((i) => Math.max(0, i - 1));
      setProgress(0);
    } else if (threadIdx > 0) {
      const newThread = threads[threadIdx - 1];
      setThreadIdx((t) => t - 1);
      setStoryIdx(Math.max(0, newThread.items.length - 1));
      setProgress(0);
    } else {
      onOpenChange(false);
    }
  }, [storyIdx, threadIdx, currentThread, threads, onOpenChange]);

  // Swipe gestures (mobile)
  useEffect(() => {
    const el = containerRef.current;
    if (!open || !el) return;
    let startX = 0;
    let startY = 0;
    let dx = 0;
    let dy = 0;

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      dx = 0;
      dy = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      dx = t.clientX - startX;
      dy = t.clientY - startY;
    };
    const onTouchEnd = () => {
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next();
        else prev();
      }
    };

    el.addEventListener("touchstart", onTouchStart);
    el.addEventListener("touchmove", onTouchMove);
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [open, next, prev]);

  // Pause on press/hold (center area)
  const onHoldDown = () => {
    holdRef.current = true;
    setPaused(true);
  };
  const onHoldUp = () => {
    holdRef.current = false;
    setPaused(false);
    startedAtRef.current = performance.now() - progress * durationMs;
  };

  // Owner delete handler
  const handleDelete = async () => {
    if (!current) return;
    const ok = window.confirm("Delete this story permanently?");
    if (!ok) return;
    try {
      await api(`/stories/${current.id}`, { method: "DELETE" });
      onDeleted?.(current.id);
      onOpenChange(false);
    } catch {
      alert("Failed to delete story. Please try again.");
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="p-0 max-w-[100vw] w-[100vw] h-[100vh] md:max-w-[900px] md:w-[900px] md:h-[90vh] bg-black/90 border-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div ref={containerRef} className="relative w-full h-full grid md:grid-cols-[1fr]">
          {/* Close */}
          <button
            className="absolute z-30 top-3 right-3 text-white/80 hover:text-white"
            onClick={() => onOpenChange(false)}
            title="Close"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Owner Delete (top-left) */}
          {isOwner && (
            <button
              onClick={handleDelete}
              title="Delete story"
              className="absolute z-30 top-3 left-3 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-full text-white/90 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/15"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-xs font-medium hidden sm:inline">Delete</span>
            </button>
          )}

          {/* Left / Right navigation hints (desktop) */}
          <div
            className="hidden md:flex absolute z-20 inset-y-0 left-0 w-[18%] cursor-pointer items-center justify-start px-3"
            onClick={prev}
            aria-label="Previous"
          >
            <ChevronLeft className="w-7 h-7 text-white/70" />
          </div>
          <div
            className="hidden md:flex absolute z-20 inset-y-0 right-0 w-[18%] cursor-pointer items-center justify-end px-3"
            onClick={next}
            aria-label="Next"
          >
            <ChevronRight className="w-7 h-7 text-white/70" />
          </div>

          {/* Core stage (strict 9:16) */}
          <div className="m-auto">
            <div
              className="relative bg-black rounded-none md:rounded-xl overflow-hidden shadow-2xl"
              style={{ aspectRatio: "9 / 16", width: "min(92vw, 430px)" } as CSSProperties}
              onPointerDown={onHoldDown}
              onPointerUp={onHoldUp}
              onPointerLeave={onHoldUp}
            >
              {/* Tap zones */}
              <div className="absolute inset-0 grid grid-cols-3 z-10">
                <button aria-label="Back" onClick={prev} className="w-full h-full" />
                <button
                  aria-label="Hold to pause"
                  onMouseDown={onHoldDown}
                  onMouseUp={onHoldUp}
                  onTouchStart={onHoldDown}
                  onTouchEnd={onHoldUp}
                />
                <button aria-label="Next" onClick={next} className="w-full h-full" />
              </div>

              {/* Progress bars */}
              {currentThread && (
                <div className="absolute top-0 left-0 right-0 z-20 flex gap-1 p-2">
                  {currentThread.items.map((s, i) => {
                    const filled = i < storyIdx ? 1 : i > storyIdx ? 0 : progress;
                    return (
                      <div key={s.id} className="h-1 w-full bg-white/30 rounded">
                        <div
                          className="h-full bg-white rounded"
                          style={{
                            width: `${filled * 100}%`,
                            transition: i === storyIdx ? "none" : "width .2s",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Header */}
              <div className="absolute z-20 top-2 left-2 right-2 flex items-center gap-2 text-white drop-shadow">
                <div className="p-[2px] rounded-full bg-white/30">
                  <Avatar size={28} src={user?.avatarUrl} alt={user?.username ?? ""} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight truncate">
                    {user?.username ?? (currentThread ? `user-${currentThread.userId}` : "")}
                  </div>
                  {current && (
                    <div className="text-[11px] opacity-85 -mt-[1px]">
                      {timeAgo(current.createdAt)}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Volume2 className={`w-4 h-4 ${muted ? "opacity-40" : ""}`} />
                </div>
              </div>

              {/* Media */}
              <div className="absolute inset-0">
                <AnimatePresence mode="wait">
                  {current && (
                    <motion.div
                      key={current.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.22 }}
                      className="absolute inset-0"
                    >
                      <StoryMedia story={current} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Caption */}
              {current?.caption ? (
                <div className="absolute z-20 bottom-0 left-0 right-0 p-3 text-white/95 bg-gradient-to-t from-black/60 via-black/25 to-transparent">
                  <div className="text-sm whitespace-pre-wrap">{current.caption}</div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------- subviews -------------------------------- */

function StoryMedia({ story }: { story: Story }) {
  const src = absoluteMediaUrl(story.media.url);
  const isVideo = (story.media.mime ?? "").startsWith("video/");
  const [broken, setBroken] = useState(false);

  if (!src || broken) {
    return <div className="w-full h-full bg-neutral-900" />;
  }

  if (isVideo) {
    return (
      <video
        src={src}
        className="w-full h-full object-cover"
        playsInline
        muted
        autoPlay
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <img
      alt=""
      src={src}
      className="w-full h-full object-cover"
      draggable={false}
      onError={() => setBroken(true)}
    />
  );
}

function Avatar({
  src,
  alt,
  size = 40,
}: {
  src: string | null | undefined;
  alt?: string | null | undefined;
  size?: number;
}) {
  const style: CSSProperties = { width: size, height: size };
  const u = absoluteAvatarUrl(src ?? null);

  if (u) {
    return (
      <img
        src={u}
        alt={alt ?? ""}
        style={style}
        className="rounded-full object-cover bg-neutral-800"
        draggable={false}
        onError={(e) => {
          const el = e.currentTarget;
          el.src = ""; // drop to fallback
        }}
      />
    );
  }
  return (
    <div
      aria-label={alt ?? "avatar"}
      style={style}
      className="rounded-full bg-gradient-to-tr from-slate-600 to-slate-500"
    />
  );
}

/* ------------------------------- utilities ------------------------------- */
/**
 * .no-scrollbar::-webkit-scrollbar { display: none; }
 * .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
 */
