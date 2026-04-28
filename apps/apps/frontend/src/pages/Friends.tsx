// src/pages/Friends.tsx
import { motion } from "framer-motion";
import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  UserPlus,
  Search as SearchIcon,
  MessageCircle,
  ShieldBan,
  X,
  Check,
  LockOpen,
  Loader2,
  RefreshCcw,
  Sparkles,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  LayoutGrid,
  List as ListIcon,
} from "lucide-react";
import { useChatheads } from "@/providers/chathead-context";
import { api } from "@/lib/api";

/* ---------------- Types matching the backend ---------------- */
type FriendStatus = "pending" | "accepted" | "rejected" | "blocked";
type BlockDir = "in" | "out" | "both" | null;

interface UserLite {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
}

interface FriendItem {
  since: string;
  user: UserLite;
}

interface PendingInItem {
  from: UserLite;
  since: string;
  status: FriendStatus; // pending
}

interface PendingOutItem {
  to: UserLite;
  since: string;
  status: FriendStatus; // pending
}

interface SearchUser extends UserLite {
  status?: FriendStatus | null;
  direction?: BlockDir; // allow "both" when blocked
}

/* ---------------- Small UI: Avatar (clickable) ---------------- */
function Avatar({
  user,
  size = 40,
  withLink = true,
}: {
  user: UserLite;
  size?: number;
  withLink?: boolean;
}) {
  const [err, setErr] = useState(false);
  const show = !!user.avatarUrl && !err;
  const initial = (user.displayName || user.username || "?").charAt(0).toUpperCase();

  const inner = show ? (
    <img
      src={user.avatarUrl!}
      onError={() => setErr(true)}
      className="w-full h-full rounded-full object-cover border"
      alt={user.displayName}
    />
  ) : (
    <div className="w-full h-full rounded-full border bg-secondary text-foreground/90 flex items-center justify-center">
      <span className="text-xs font-semibold">{initial}</span>
    </div>
  );

  const classBase =
    "block rounded-full ring-2 ring-transparent hover:ring-primary/40 focus-visible:ring-primary/60 transition outline-none";

  if (withLink) {
    return (
      <Link
        to={`/profile/${encodeURIComponent(user.username)}`}
        title={`View @${user.username}`}
        aria-label={`View profile of ${user.displayName}`}
        className={classBase}
        style={{ width: size, height: size }}
      >
        {inner}
      </Link>
    );
  }
  return (
    <div className={classBase} style={{ width: size, height: size }}>
      {inner}
    </div>
  );
}

/* ---------------- Error helpers (for api() errors) ---------------- */
type ApiErrLike = { status?: number; payload?: unknown; message?: string };

function isApiErrLike(e: unknown): e is ApiErrLike {
  return typeof e === "object" && e !== null && ("status" in (e as object) || "payload" in (e as object) || "message" in (e as object));
}

function errorStringFromPayload(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "error" in payload) {
    const v = (payload as { error?: unknown }).error;
    if (typeof v === "string" && v.trim()) return v;
  }
  if (payload && typeof payload === "object" && "message" in payload) {
    const v = (payload as { message?: unknown }).message;
    if (typeof v === "string" && v.trim()) return v;
  }
  return null;
}

function msgFrom(err: unknown): string {
  if (isApiErrLike(err)) {
    const fromPayload = errorStringFromPayload(err.payload);
    if (fromPayload) return fromPayload;
    if (typeof err.message === "string" && err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

/* ---------------- Tiny UI pieces ---------------- */
function LineSkeleton() {
  return <div className="h-3 w-full rounded bg-muted/60" />;
}

function CardSkeleton() {
  return (
    <Card className="border">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-muted/60" />
          <div className="flex-1 space-y-2">
            <LineSkeleton />
            <div className="w-1/2">
              <LineSkeleton />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground py-6 text-center">{text}</div>;
}

/* -------- Compact button helpers (prevents overflow) -------- */
function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}
type ButtonProps = React.ComponentProps<typeof Button>;

function IconBtn(props: ButtonProps) {
  const { className, children, ...rest } = props;
  return (
    <Button {...rest} size="icon" className={cx("h-8 w-8", className)}>
      {children}
    </Button>
  );
}

function SmallBtn(props: ButtonProps) {
  const { className, children, ...rest } = props;
  return (
    <Button {...rest} size="sm" className={cx("h-8 px-2 gap-1", className)}>
      {children}
    </Button>
  );
}

/* ---------------- Pagination helpers ---------------- */
type PageToken = number | "ellipsis";

function makePageWindow(current: number, total: number, windowSize = 7): PageToken[] {
  if (total <= windowSize) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages: PageToken[] = [];
  const side = Math.floor((windowSize - 3) / 2); // room around current
  const left = Math.max(2, current - side);
  const right = Math.min(total - 1, current + side);

  pages.push(1);
  if (left > 2) pages.push("ellipsis");
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < total - 1) pages.push("ellipsis");
  pages.push(total);

  return pages;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatSince(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "2-digit" }).format(d);
}

/* ---------------- Main Page ---------------- */
type SortKey = "name-asc" | "name-desc" | "newest" | "oldest";

export default function Friends() {
  // data
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [pendingIn, setPendingIn] = useState<PendingInItem[]>([]);
  const [pendingOut, setPendingOut] = useState<PendingOutItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);

  // auth
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  // ui state
  const [loading, setLoading] = useState(false);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recs, setRecs] = useState<SearchUser[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  // search
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // layout
  const [gridView, setGridView] = useState<boolean>(true);

  // pagination + sort
  const storedPageSize = Number(localStorage.getItem("friends.pageSize") || 24);
  const [pageSize, setPageSize] = useState<number>([12, 24, 48].includes(storedPageSize) ? storedPageSize : 24);
  const [friendPage, setFriendPage] = useState<number>(1);
  const [pendingPage, setPendingPage] = useState<number>(1);
  const [sentPage, setSentPage] = useState<number>(1);
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");

  // busy ids (disable buttons while calling)
  const [busyIds, setBusyIds] = useState<number[]>([]);

  // chatheads
  const { openChat } = useChatheads();

  // probe auth
  useEffect(() => {
    (async () => {
      try {
        await api("/users/current_user");
        setIsAuthed(true);
      } catch (err) {
        if (isApiErrLike(err) && err.status === 401) {
          setIsAuthed(false);
          setToast("Please log in to view friends.");
        } else {
          setToast(msgFrom(err));
        }
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  // load lists after auth
  const loadLists = useCallback(async () => {
    const [f, inReq, outReq] = await Promise.all([
      api<FriendItem[]>("/friends"),
      api<PendingInItem[]>("/friends/requests?direction=in"),
      api<PendingOutItem[]>("/friends/requests?direction=out"),
    ]);
    setFriends(f);
    setPendingIn(inReq);
    setPendingOut(outReq);
  }, []);

  useEffect(() => {
    if (!authChecked || !isAuthed) return;
    (async () => {
      try {
        setLoading(true);
        await loadLists();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [authChecked, isAuthed, loadLists]);

  // statuses utilities
  const idSet = useMemo(() => {
    const s = new Set<number>();
    friends.forEach((f) => s.add(f.user.id));
    pendingIn.forEach((p) => s.add(p.from.id));
    pendingOut.forEach((p) => s.add(p.to.id));
    return s;
  }, [friends, pendingIn, pendingOut]);

  const annotateStatuses = useCallback(async (users: UserLite[]): Promise<SearchUser[]> => {
    return Promise.all(
      users.map(async (u) => {
        try {
          const s = await api<{ status: FriendStatus | null; direction: BlockDir }>(`/friends/status/${u.id}`);
          return { ...u, status: s.status, direction: s.direction };
        } catch {
          return { ...u, status: null, direction: null };
        }
      })
    );
  }, []);

  // recommendations
  const shuffle = useCallback<<T>(arr: T[]) => T[]>((arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }, []);

  const loadRecommendations = useCallback(async () => {
    if (!isAuthed) return;
    setRecsLoading(true);
    try {
      const raw = await api<UserLite[]>(`/users/random?limit=16&_=${Date.now()}`);
      const withStatus = await annotateStatuses(raw);
      const filtered = withStatus.filter(
        (u) => !idSet.has(u.id) && !(u.status === "blocked" && (u.direction === "in" || u.direction === "both"))
      );
      setRecs(shuffle(filtered).slice(0, 12));
    } catch {
      setRecs([]);
    } finally {
      setRecsLoading(false);
    }
  }, [annotateStatuses, idSet, isAuthed, shuffle]);

  useEffect(() => {
    if (authChecked && isAuthed) {
      void loadRecommendations();
    }
  }, [authChecked, isAuthed, loadRecommendations]);

  // actions
  const markBusy = useCallback((id: number, busy: boolean) => {
    setBusyIds((prev) => (busy ? [...prev, id] : prev.filter((x) => x !== id)));
  }, []);

  const refreshAll = useCallback(async () => {
    await loadLists();
    await loadRecommendations();
  }, [loadLists, loadRecommendations]);

  const sendRequest = useCallback(
    async (toUserId: number) => {
      try {
        markBusy(toUserId, true);
        const r = await api<{ action: string }>("/friends/request", { method: "POST", body: { toUserId } });
        setToast(
          r.action === "auto-accepted"
            ? "Request auto-accepted 🎉"
            : r.action === "already-friends"
            ? "Already friends"
            : r.action === "already-pending"
            ? "Request already pending"
            : "Request sent"
        );
        await refreshAll();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(toUserId, false);
      }
    },
    [markBusy, refreshAll]
  );

  const accept = useCallback(
    async (userId: number) => {
      try {
        markBusy(userId, true);
        await api("/friends/accept", { method: "POST", body: { userId } });
        setToast("Friend request accepted");
        await refreshAll();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(userId, false);
      }
    },
    [markBusy, refreshAll]
  );

  const reject = useCallback(
    async (userId: number) => {
      try {
        markBusy(userId, true);
        await api("/friends/reject", { method: "POST", body: { userId } });
        setToast("Friend request rejected");
        await refreshAll();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(userId, false);
      }
    },
    [markBusy, refreshAll]
  );

  const cancel = useCallback(
    async (userId: number) => {
      try {
        markBusy(userId, true);
        await api("/friends/cancel", { method: "POST", body: { userId } });
        setToast("Friend request canceled");
        await refreshAll();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(userId, false);
      }
    },
    [markBusy, refreshAll]
  );

  const unfriend = useCallback(
    async (userId: number) => {
      try {
        markBusy(userId, true);
        await api("/friends/unfriend", { method: "POST", body: { userId } });
        setToast("Removed from friends");
        await refreshAll();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(userId, false);
      }
    },
    [markBusy, refreshAll]
  );

  const block = useCallback(
    async (userId: number) => {
      try {
        markBusy(userId, true);
        await api("/friends/block", { method: "POST", body: { userId } });
        setToast("User blocked");
        await refreshAll();
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(userId, false);
      }
    },
    [markBusy, refreshAll]
  );

  const unblock = useCallback(
    async (userId: number) => {
      try {
        markBusy(userId, true);
        await api("/friends/unblock", { method: "POST", body: { userId } });
        setToast("User unblocked");
        await refreshAll();
        setSearchResults((prev) => prev.map((u) => (u.id === userId ? { ...u, status: null, direction: null } : u)));
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        markBusy(userId, false);
      }
    },
    [markBusy, refreshAll]
  );

  // search
  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setSearchResults([]);
        return;
      }
      try {
        setIsSearching(true);
        const users = await api<UserLite[]>(`/users/search?query=${encodeURIComponent(q.trim())}`);
        const withStatus = await annotateStatuses(users);
        setSearchResults(withStatus);
      } catch (err) {
        setToast(msgFrom(err));
      } finally {
        setIsSearching(false);
      }
    },
    [annotateStatuses]
  );

  const doSearch = useCallback(async () => {
    await runSearch(searchQuery);
  }, [runSearch, searchQuery]);

  useEffect(() => {
    if (!isAuthed) return;
    const handle = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        void runSearch(searchQuery);
      } else if (searchQuery.trim().length === 0) {
        setSearchResults([]);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [searchQuery, runSearch, isAuthed]);

  // focus search with "/"
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // sorting + pagination
  const sortedFriends = useMemo(() => {
    const data = [...friends];
    switch (sortKey) {
      case "name-asc":
        return data.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
      case "name-desc":
        return data.sort((a, b) => b.user.displayName.localeCompare(a.user.displayName));
      case "newest":
        return data.sort((a, b) => new Date(b.since).getTime() - new Date(a.since).getTime());
      case "oldest":
        return data.sort((a, b) => new Date(a.since).getTime() - new Date(b.since).getTime());
      default:
        return data;
    }
  }, [friends, sortKey]);

  const totalFriendPages = Math.max(1, Math.ceil(sortedFriends.length / pageSize));
  const safeFriendPage = clamp(friendPage, 1, totalFriendPages);
  const friendSlice = useMemo(() => {
    const start = (safeFriendPage - 1) * pageSize;
    return sortedFriends.slice(start, start + pageSize);
  }, [sortedFriends, pageSize, safeFriendPage]);

  const totalPendingPages = Math.max(1, Math.ceil(pendingIn.length / pageSize));
  const safePendingPage = clamp(pendingPage, 1, totalPendingPages);
  const pendingSlice = useMemo(() => {
    const start = (safePendingPage - 1) * pageSize;
    return pendingIn.slice(start, start + pageSize);
  }, [pendingIn, pageSize, safePendingPage]);

  const totalSentPages = Math.max(1, Math.ceil(pendingOut.length / pageSize));
  const safeSentPage = clamp(sentPage, 1, totalSentPages);
  const sentSlice = useMemo(() => {
    const start = (safeSentPage - 1) * pageSize;
    return pendingOut.slice(start, start + pageSize);
  }, [pendingOut, pageSize, safeSentPage]);

  useEffect(() => {
    // reset pages when sort or pageSize changes
    setFriendPage(1);
    setPendingPage(1);
    setSentPage(1);
  }, [sortKey, pageSize]);

  const onChangePageSize = useCallback((n: number) => {
    setPageSize(n);
    localStorage.setItem("friends.pageSize", String(n));
  }, []);

  const openChatFor = useCallback(
    (u: UserLite) => {
      openChat({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        isOnline: false,
        avatarUrl: u.avatarUrl,
      });
    },
    [openChat]
  );

  const isBusy = useCallback((id: number) => busyIds.includes(id), [busyIds]);

  /* ---------------- UI ---------------- */
  return (
    <div className="min-h-screen p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="max-w-7xl mx-auto"
      >
        {/* Sticky header */}
        <div className="sticky top-3 z-30 mb-4">
          <Card className="border bg-gradient-to-r from-primary/5 via-transparent to-transparent backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <CardHeader className="pb-3 md:pb-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                    <Users className="h-6 w-6" />
                    Friends
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => void refreshAll()}
                      disabled={loading}
                      title="Refresh lists"
                    >
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                      <span className="hidden sm:inline">Refresh</span>
                    </Button>
                    <Button
                      variant={gridView ? "default" : "outline"}
                      size="sm"
                      className="gap-2"
                      onClick={() => setGridView((v) => !v)}
                      title={gridView ? "Grid view" : "List view"}
                    >
                      {gridView ? <LayoutGrid className="h-4 w-4" /> : <ListIcon className="h-4 w-4" />}
                      <span className="hidden sm:inline">{gridView ? "Grid" : "List"}</span>
                    </Button>
                  </div>
                </div>

                {/* Search */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Input
                      ref={searchInputRef}
                      placeholder="Search by username (press / to focus)…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void doSearch()}
                      className="pr-10"
                      disabled={!isAuthed}
                      aria-label="Search by username"
                    />
                    <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-60 pointer-events-none" />
                  </div>
                  <Button
                    className="sm:w-auto"
                    onClick={() => void doSearch()}
                    disabled={!isAuthed || searchQuery.trim().length === 0 || isSearching}
                  >
                    {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                    <span className="ml-2">Search</span>
                  </Button>
                </div>

                {!isAuthed && authChecked && (
                  <div className="text-xs text-muted-foreground">You must be logged in to search and manage friends.</div>
                )}
              </div>
            </CardHeader>

            {/* Instant results under search */}
            {isAuthed && searchResults.length > 0 && (
              <CardContent className="pt-0 pb-3">
                <div className="mt-2 space-y-2">
                  {searchResults.map((u) => {
                    const isBlockedByMe = u.status === "blocked" && (u.direction === "out" || u.direction === "both");
                    const isBlockedMe = u.status === "blocked" && u.direction === "in";
                    return (
                      <Card key={u.id} className="border">
                        <CardContent className="p-3 flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar user={u} />
                            <div className="min-w-0">
                              <Link to={`/profile/${encodeURIComponent(u.username)}`} className="font-medium truncate hover:underline">
                                {u.displayName}
                              </Link>
                              <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                              {u.status && (
                                <div className="text-[11px] mt-1 text-muted-foreground">
                                  status: {u.status} {u.direction ? `(${u.direction})` : ""}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* allow wrapping here to avoid spillover on narrow widths */}
                          <div className="flex items-center gap-1 flex-wrap justify-end">
                            {u.status === "accepted" ? (
                              <>
                                <SmallBtn variant="secondary" className="gap-2" onClick={() => openChatFor(u)} title="Message">
                                  <MessageCircle className="h-4 w-4" />
                                  <span className="hidden sm:inline">Message</span>
                                </SmallBtn>
                                <SmallBtn
                                  variant="outline"
                                  className="gap-2"
                                  disabled={isBusy(u.id)}
                                  onClick={() => unfriend(u.id)}
                                  title="Unfriend"
                                >
                                  {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                  <span className="hidden sm:inline">Unfriend</span>
                                </SmallBtn>
                              </>
                            ) : u.status === "pending" && u.direction === "in" ? (
                              <>
                                <SmallBtn className="gap-2" disabled={isBusy(u.id)} onClick={() => accept(u.id)} title="Accept">
                                  {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                  <span className="hidden sm:inline">Accept</span>
                                </SmallBtn>
                                <SmallBtn variant="outline" className="gap-2" disabled={isBusy(u.id)} onClick={() => reject(u.id)} title="Reject">
                                  {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                  <span className="hidden sm:inline">Reject</span>
                                </SmallBtn>
                              </>
                            ) : u.status === "pending" && u.direction === "out" ? (
                              <SmallBtn variant="outline" className="gap-2" disabled={isBusy(u.id)} onClick={() => cancel(u.id)} title="Cancel">
                                {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                <span className="hidden sm:inline">Cancel</span>
                              </SmallBtn>
                            ) : u.status === "blocked" ? (
                              u.direction === "out" || u.direction === "both" ? (
                                <SmallBtn variant="secondary" className="gap-2" disabled={isBusy(u.id)} onClick={() => unblock(u.id)} title="Unblock">
                                  {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
                                  <span className="hidden sm:inline">Unblock</span>
                                </SmallBtn>
                              ) : (
                                <SmallBtn variant="outline" className="gap-2" disabled title="They blocked you">
                                  <ShieldBan className="h-4 w-4" />
                                  <span className="hidden sm:inline">Blocked you</span>
                                </SmallBtn>
                              )
                            ) : (
                              <SmallBtn className="gap-2" disabled={isBusy(u.id)} onClick={() => sendRequest(u.id)} title="Add">
                                {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                <span className="hidden sm:inline">Add</span>
                              </SmallBtn>
                            )}

                            {/* Secondary: Block/Unblock */}
                            {u.status === "blocked" && (u.direction === "out" || u.direction === "both") ? (
                              <SmallBtn variant="secondary" className="gap-2" disabled={isBusy(u.id)} onClick={() => unblock(u.id)}>
                                {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
                                <span className="hidden sm:inline">Unblock</span>
                              </SmallBtn>
                            ) : (
                              <SmallBtn
                                variant="destructive"
                                className="gap-2"
                                disabled={isBusy(u.id) || (u.status === "blocked" && u.direction === "in")}
                                onClick={() => block(u.id)}
                                title={u.status === "blocked" && u.direction === "in" ? "They blocked you" : "Block"}
                              >
                                {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                                <span className="hidden sm:inline">{u.status === "blocked" && u.direction === "in" ? "Blocked" : "Block"}</span>
                              </SmallBtn>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Body: left tools + right content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT: tools */}
          <div className="lg:col-span-3 space-y-6">
            {/* Filters / Sort / Page size */}
            <Card className="border sticky top-[92px]">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Filters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Sort */}
                <div>
                  <div className="text-xs mb-1 text-muted-foreground">Sort</div>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    aria-label="Sort friends"
                  >
                    <option value="name-asc">Name A → Z</option>
                    <option value="name-desc">Name Z → A</option>
                    <option value="newest">Newest friends</option>
                    <option value="oldest">Oldest friends</option>
                  </select>
                </div>

                {/* Page size */}
                <div>
                  <div className="text-xs mb-1 text-muted-foreground">Page size</div>
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={pageSize}
                    onChange={(e) => onChangePageSize(Number(e.target.value))}
                    aria-label="Friends per page"
                  >
                    <option value={12}>12</option>
                    <option value={24}>24</option>
                    <option value={48}>48</option>
                  </select>
                </div>

                {/* Quick tips */}
                <div className="text-[11px] text-muted-foreground">
                  Tip: Use <kbd className="px-1 py-0.5 rounded border">/</kbd> to focus search. Use the buttons below each card to
                  chat, unfriend or block.
                </div>
              </CardContent>
            </Card>

            {/* Recommendations */}
            {isAuthed && (
              <Card className="border">
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-base md:text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    People you may know
                  </CardTitle>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-2"
                    onClick={() => void loadRecommendations()}
                    disabled={recsLoading}
                    title="Shuffle"
                  >
                    {recsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                    <span className="hidden sm:inline">Refresh</span>
                  </Button>
                </CardHeader>
                <CardContent className="pt-0">
                  {recsLoading && recs.length === 0 ? (
                    <div className="grid grid-cols-1 gap-3">
                      <CardSkeleton />
                      <CardSkeleton />
                    </div>
                  ) : recs.length === 0 ? (
                    <Empty text="No recommendations right now." />
                  ) : (
                    <div className="grid grid-cols-1 gap-3">
                      {recs.map((u) => {
                        const isBlockedMe = u.status === "blocked" && u.direction === "in";
                        return (
                          <div key={u.id} className="rounded-xl border bg-card p-3 hover:shadow-md transition">
                            <div className="flex items-center gap-3">
                              <Avatar user={u} size={44} />
                              <div className="min-w-0">
                                <Link to={`/profile/${encodeURIComponent(u.username)}`} className="font-medium truncate hover:underline">
                                  {u.displayName}
                                </Link>
                                <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                size="sm"
                                className="gap-2 w-full"
                                disabled={isBusy(u.id) || isBlockedMe}
                                onClick={() => sendRequest(u.id)}
                                title={isBlockedMe ? "They blocked you" : "Add Friend"}
                              >
                                {isBusy(u.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                                Add
                              </Button>
                              <Button size="sm" variant="outline" className="w-10" onClick={() => void loadRecommendations()} title="Skip">
                                <RefreshCcw className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* RIGHT: main content */}
          <div className="lg:col-span-9 space-y-6">
            {/* Tabs */}
            <Tabs defaultValue="friends" className="space-y-4">
              <TabsList className="grid w-full grid-cols-3 h-auto">
                <TabsTrigger value="friends" className="flex items-center gap-2 text-xs sm:text-sm py-2">
                  <Users className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Friends</span>
                  <span className="ml-1 text-[11px] text-muted-foreground">({friends.length})</span>
                </TabsTrigger>
                <TabsTrigger value="pending" className="flex items-center gap-2 text-xs sm:text-sm py-2">
                  <UserPlus className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Pending</span>
                  <span className="ml-1 text-[11px] text-muted-foreground">({pendingIn.length})</span>
                </TabsTrigger>
                <TabsTrigger value="sent" className="flex items-center gap-2 text-xs sm:text-sm py-2">
                  <UserPlus className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">Sent</span>
                  <span className="ml-1 text-[11px] text-muted-foreground">({pendingOut.length})</span>
                </TabsTrigger>
              </TabsList>

              {/* Friends Tab */}
              <TabsContent value="friends" className="space-y-3">
                <ResultHeader
                  total={friends.length}
                  page={safeFriendPage}
                  pageSize={pageSize}
                  label="friends"
                />
                {(!isAuthed && authChecked) ? (
                  <Empty text="Please log in to see your friends." />
                ) : loading ? (
                  <GridSkeleton gridView={gridView} />
                ) : friendSlice.length ? (
                  <>
                    <FriendsGrid
                      items={friendSlice}
                      gridView={gridView}
                      isBusy={isBusy}
                      openChatFor={openChatFor}
                      unfriend={unfriend}
                      block={block}
                    />
                    <PaginationBar
                      current={safeFriendPage}
                      totalPages={totalFriendPages}
                      onPage={(p) => setFriendPage(p)}
                    />
                  </>
                ) : (
                  <Empty text="No friends yet." />
                )}
              </TabsContent>

              {/* Pending Tab */}
              <TabsContent value="pending" className="space-y-3">
                <ResultHeader total={pendingIn.length} page={safePendingPage} pageSize={pageSize} label="incoming requests" />
                {(!isAuthed && authChecked) ? (
                  <Empty text="Please log in to view requests." />
                ) : loading ? (
                  <GridSkeleton gridView={gridView} />
                ) : pendingSlice.length ? (
                  <>
                    <PendingInGrid
                      items={pendingSlice}
                      gridView={gridView}
                      isBusy={isBusy}
                      accept={accept}
                      reject={reject}
                      block={block}
                    />
                    <PaginationBar
                      current={safePendingPage}
                      totalPages={totalPendingPages}
                      onPage={(p) => setPendingPage(p)}
                    />
                  </>
                ) : (
                  <Empty text="No incoming requests." />
                )}
              </TabsContent>

              {/* Sent Tab */}
              <TabsContent value="sent" className="space-y-3">
                <ResultHeader total={pendingOut.length} page={safeSentPage} pageSize={pageSize} label="sent requests" />
                {(!isAuthed && authChecked) ? (
                  <Empty text="Please log in to view sent requests." />
                ) : loading ? (
                  <GridSkeleton gridView={gridView} />
                ) : sentSlice.length ? (
                  <>
                    <PendingOutGrid
                      items={sentSlice}
                      gridView={gridView}
                      isBusy={isBusy}
                      cancel={cancel}
                      block={block}
                    />
                    <PaginationBar
                      current={safeSentPage}
                      totalPages={totalSentPages}
                      onPage={(p) => setSentPage(p)}
                    />
                  </>
                ) : (
                  <Empty text="No sent requests." />
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </motion.div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-foreground text-background px-3 py-2 rounded shadow-lg flex items-center gap-2 z-50">
          <span className="text-sm">{toast}</span>
          <button className="ml-2 text-sm opacity-80 hover:opacity-100" onClick={() => setToast(null)} aria-label="Close toast">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Chunked grids (grid or list) ---------------- */

function FriendsGrid({
  items,
  gridView,
  isBusy,
  openChatFor,
  unfriend,
  block,
}: {
  items: FriendItem[];
  gridView: boolean;
  isBusy: (id: number) => boolean;
  openChatFor: (u: UserLite) => void;
  unfriend: (id: number) => Promise<void>;
  block: (id: number) => Promise<void>;
}) {
  if (gridView) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((f) => (
          <Card key={f.user.id} className="border shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Avatar user={f.user} size={48} />
                <div className="min-w-0">
                  <Link to={`/profile/${encodeURIComponent(f.user.username)}`} className="font-medium truncate hover:underline">
                    {f.user.displayName}
                  </Link>
                  <div className="text-xs text-muted-foreground truncate">@{f.user.username}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Friends since {formatSince(f.since)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <IconBtn variant="secondary" onClick={() => openChatFor(f.user)} title="Message">
                  <MessageCircle className="h-4 w-4" />
                  <span className="sr-only">Message</span>
                </IconBtn>
                <IconBtn variant="outline" disabled={isBusy(f.user.id)} onClick={() => unfriend(f.user.id)} title="Unfriend">
                  {isBusy(f.user.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  <span className="sr-only">Unfriend</span>
                </IconBtn>
                <IconBtn variant="destructive" disabled={isBusy(f.user.id)} onClick={() => block(f.user.id)} title="Block">
                  {isBusy(f.user.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                  <span className="sr-only">Block</span>
                </IconBtn>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  // list view
  return (
    <div className="space-y-2">
      {items.map((f) => (
        <Card key={f.user.id} className="border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar user={f.user} />
              <div className="min-w-0">
                <Link to={`/profile/${encodeURIComponent(f.user.username)}`} className="font-medium truncate hover:underline">
                  {f.user.displayName}
                </Link>
                <div className="text-xs text-muted-foreground truncate">@{f.user.username}</div>
                <div className="text-[11px] text-muted-foreground">Friends since {formatSince(f.since)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end shrink-0">
              <SmallBtn variant="secondary" className="gap-2" onClick={() => openChatFor(f.user)} title="Message">
                <MessageCircle className="h-4 w-4" />
                <span className="hidden lg:inline">Message</span>
              </SmallBtn>
              <SmallBtn variant="outline" className="gap-2" disabled={isBusy(f.user.id)} onClick={() => unfriend(f.user.id)} title="Unfriend">
                {isBusy(f.user.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                <span className="hidden lg:inline">Unfriend</span>
              </SmallBtn>
              <SmallBtn variant="destructive" className="gap-2" disabled={isBusy(f.user.id)} onClick={() => block(f.user.id)} title="Block">
                {isBusy(f.user.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                <span className="hidden lg:inline">Block</span>
              </SmallBtn>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PendingInGrid({
  items,
  gridView,
  isBusy,
  accept,
  reject,
  block,
}: {
  items: PendingInItem[];
  gridView: boolean;
  isBusy: (id: number) => boolean;
  accept: (id: number) => Promise<void>;
  reject: (id: number) => Promise<void>;
  block: (id: number) => Promise<void>;
}) {
  if (gridView) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((p) => (
          <Card key={p.from.id} className="border shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Avatar user={p.from} size={48} />
                <div className="min-w-0">
                  <Link to={`/profile/${encodeURIComponent(p.from.username)}`} className="font-medium truncate hover:underline">
                    {p.from.displayName}
                  </Link>
                  <div className="text-xs text-muted-foreground truncate">@{p.from.username}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Requested {formatSince(p.since)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <IconBtn disabled={isBusy(p.from.id)} onClick={() => accept(p.from.id)} title="Accept">
                  {isBusy(p.from.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  <span className="sr-only">Accept</span>
                </IconBtn>
                <IconBtn variant="outline" disabled={isBusy(p.from.id)} onClick={() => reject(p.from.id)} title="Reject">
                  {isBusy(p.from.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  <span className="sr-only">Reject</span>
                </IconBtn>
                <IconBtn variant="destructive" disabled={isBusy(p.from.id)} onClick={() => block(p.from.id)} title="Block">
                  {isBusy(p.from.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                  <span className="sr-only">Block</span>
                </IconBtn>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((p) => (
        <Card key={p.from.id} className="border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar user={p.from} />
              <div className="min-w-0">
                <Link to={`/profile/${encodeURIComponent(p.from.username)}`} className="font-medium truncate hover:underline">
                  {p.from.displayName}
                </Link>
                <div className="text-xs text-muted-foreground truncate">@{p.from.username}</div>
                <div className="text-[11px] text-muted-foreground">Requested {formatSince(p.since)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end shrink-0">
              <SmallBtn className="gap-2" disabled={isBusy(p.from.id)} onClick={() => accept(p.from.id)} title="Accept">
                {isBusy(p.from.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                <span className="hidden sm:inline">Accept</span>
              </SmallBtn>
              <SmallBtn variant="outline" className="gap-2" disabled={isBusy(p.from.id)} onClick={() => reject(p.from.id)} title="Reject">
                {isBusy(p.from.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                <span className="hidden sm:inline">Reject</span>
              </SmallBtn>
              <SmallBtn variant="destructive" className="gap-2" disabled={isBusy(p.from.id)} onClick={() => block(p.from.id)} title="Block">
                {isBusy(p.from.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                <span className="hidden sm:inline">Block</span>
              </SmallBtn>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PendingOutGrid({
  items,
  gridView,
  isBusy,
  cancel,
  block,
}: {
  items: PendingOutItem[];
  gridView: boolean;
  isBusy: (id: number) => boolean;
  cancel: (id: number) => Promise<void>;
  block: (id: number) => Promise<void>;
}) {
  if (gridView) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((p) => (
          <Card key={p.to.id} className="border shadow-sm hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Avatar user={p.to} size={48} />
                <div className="min-w-0">
                  <Link to={`/profile/${encodeURIComponent(p.to.username)}`} className="font-medium truncate hover:underline">
                    {p.to.displayName}
                  </Link>
                  <div className="text-xs text-muted-foreground truncate">@{p.to.username}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Requested {formatSince(p.since)}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1">
                <IconBtn variant="outline" disabled={isBusy(p.to.id)} onClick={() => cancel(p.to.id)} title="Cancel request">
                  {isBusy(p.to.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  <span className="sr-only">Cancel</span>
                </IconBtn>
                <IconBtn variant="destructive" disabled={isBusy(p.to.id)} onClick={() => block(p.to.id)} title="Block">
                  {isBusy(p.to.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                  <span className="sr-only">Block</span>
                </IconBtn>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((p) => (
        <Card key={p.to.id} className="border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-3 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar user={p.to} />
              <div className="min-w-0">
                <Link to={`/profile/${encodeURIComponent(p.to.username)}`} className="font-medium truncate hover:underline">
                  {p.to.displayName}
                </Link>
                <div className="text-xs text-muted-foreground truncate">@{p.to.username}</div>
                <div className="text-[11px] text-muted-foreground">Requested {formatSince(p.since)}</div>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-end shrink-0">
              <SmallBtn variant="outline" className="gap-2" disabled={isBusy(p.to.id)} onClick={() => cancel(p.to.id)} title="Cancel request">
                {isBusy(p.to.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                <span className="hidden sm:inline">Cancel</span>
              </SmallBtn>
              <SmallBtn variant="destructive" className="gap-2" disabled={isBusy(p.to.id)} onClick={() => block(p.to.id)} title="Block">
                {isBusy(p.to.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                <span className="hidden sm:inline">Block</span>
              </SmallBtn>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/* ---------------- Pagination & helpers ---------------- */

function ResultHeader({ total, page, pageSize, label }: { total: number; page: number; pageSize: number; label: string }) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="text-xs text-muted-foreground">
      {total === 0 ? `No ${label}.` : `Showing ${start}–${end} of ${total} ${label}.`}
    </div>
  );
}

function PaginationBar({
  current,
  totalPages,
  onPage,
}: {
  current: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  const windowTokens = useMemo(() => makePageWindow(current, totalPages, 9), [current, totalPages]);
  const goto = (p: number) => onPage(clamp(p, 1, totalPages));
  const btn =
    "h-8 min-w-8 px-2 rounded-md border text-xs hover:bg-accent hover:text-accent-foreground aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground";

  return (
    <div className="flex items-center justify-center gap-1 pt-2">
      <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => goto(1)} disabled={current === 1} aria-label="First page">
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => goto(current - 1)} disabled={current === 1} aria-label="Previous page">
        <ChevronLeft className="h-4 w-4" />
      </Button>

      {windowTokens.map((t, i) =>
        t === "ellipsis" ? (
          <span key={`e${i}`} className="px-2 text-xs text-muted-foreground select-none">
            …
          </span>
        ) : (
          <button
            key={t}
            className={btn}
            aria-current={t === current}
            onClick={() => goto(t)}
            aria-label={`Page ${t}`}
          >
            {t}
          </button>
        )
      )}

      <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => goto(current + 1)} disabled={current === totalPages} aria-label="Next page">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="sm" className="h-8 px-2" onClick={() => goto(totalPages)} disabled={current === totalPages} aria-label="Last page">
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function GridSkeleton({ gridView }: { gridView: boolean }) {
  if (gridView) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  );
}
