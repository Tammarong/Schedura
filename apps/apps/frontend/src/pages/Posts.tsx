// src/pages/Posts.tsx
import { motion } from "framer-motion";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  PlusCircle,
  Users,
  MessageSquare,
  Heart,
  UserPlus,
  Filter,
  X,
  Image as ImageIcon,
  Hash,
  Trash2,
  Loader2,
  Share2,
  Lightbulb,
  RefreshCcw,
  Flame,
  Award,
} from "lucide-react";
import { api, getToken } from "@/lib/api";

/* =========================================================
   POSTS (Pulse)
========================================================= */

/* ---------- minimal JWT decode (no verification, display-only) ---------- */
function decodeJwtPayload(token: string): null | { username?: string } {
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return json && typeof json === "object" ? (json as { username?: string }) : null;
  } catch {
    return null;
  }
}

/* ---------- streak types (matches controllers) ---------- */
type FlameInfo = { stage: number; label: string; nextCheckpoint: number; progressToNext: number };
type StreakInfo = {
  type: "study" | "post" | "groupMessage";
  group_id: number | null;
  current_count: number;
  longest_count: number;
  start_date: string | null;
  last_date: string | null;
  todayActive?: boolean;
  flame?: FlameInfo;
};

/* ---------- Title type (matches titles.controller pickTitle) ---------- */
type Title = {
  id: number;
  key: string;
  label: string | null;
  description: string | null;
  emoji: string | null;
  color: string | null; // hex or css color
  rarity?: number | "common" | "rare" | "epic" | "legendary" | null;
};

/* ---------- types ---------- */
type Group = {
  id: number;
  name: string;
  memberCount: number;
  isMember?: boolean;
};

type Post = {
  id: number;
  content: string;
  username: string;
  display_name: string;
  avatarUrl?: string | null;
  likes: number;
  comments: number;
  group_id?: number;
  created_at: string;
  attachedGroup?: Group;
  isLiked?: boolean;
  pictures?: string[];
  tags?: string[];
};

type Comment = {
  id: number;
  content: string;
  username: string;
  display_name: string;
  avatarUrl?: string | null;
  created_at: string;
};

type Relationship = "friend" | "pending" | "none";

type FriendListItemUser =
  | {
      id: number;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    }
  | null;

type FriendListItem = {
  since: string;
  user: FriendListItemUser;
};

type FriendStatusResponse = {
  status: "accepted" | "pending" | "rejected" | "blocked" | null;
  direction: "in" | "out" | "both" | null;
};

type UserProfileLite = {
  id: number;
  username: string;
};

/* ---------- constants ---------- */
const DEFAULT_TAGS = [
  "Study",
  "Hang Out",
  "Finding Friends",
  "Q&A",
  "Looking for Group",
  "Resources",
] as const;
type DefaultTag = (typeof DEFAULT_TAGS)[number];

const TIPS: string[] = [
  "Pro tip: Tag your post with a course code (e.g., #CAL1) to find classmates faster.",
  "Use 'Attach Group' to invite people to join from public.",
  "You can paste an image—Schedura will attach it for you.",
  "Dashboard has some secrets to discover.",
  "Filter by multiple tags to narrow the feed to what you need.",
  "Share a post link to invite friends who aren't on Schedura yet.",
];

/* ---------- helpers ---------- */
function clsx(...arr: Array<string | false | undefined>) {
  return arr.filter(Boolean).join(" ");
}

function Initials({
  name,
  username,
  className = "",
}: {
  name?: string;
  username?: string;
  className?: string;
}) {
  const base = (name?.trim() || username || "?").trim();
  const parts = base.split(/\s+/);
  const initials =
    parts.length === 1
      ? parts[0].slice(0, 2).toUpperCase()
      : ((parts[0][0] || "") + (parts[1][0] || "")).toUpperCase();
  return (
    <div
      className={clsx(
        "flex items-center justify-center rounded-full bg-primary/15 text-primary font-semibold",
        className
      )}
    >
      <span className="text-sm">{initials}</span>
    </div>
  );
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function timeAgo(iso: string): string {
  try {
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const now = new Date();
    const then = new Date(iso);
    const diffMs = then.getTime() - now.getTime();
    const abs = Math.abs(diffMs);
    const min = 60_000;
    const hr = 60 * min;
    const day = 24 * hr;
    if (abs < hr) return rtf.format(Math.round(diffMs / min), "minute");
    if (abs < day) return rtf.format(Math.round(diffMs / hr), "hour");
    return rtf.format(Math.round(diffMs / day), "day");
  } catch {
    return fmtDate(iso);
  }
}

function tryParseJson<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function pickString(o: Record<string, unknown>, key: string): string | null {
  const v = o[key];
  return typeof v === "string" ? v : null;
}

/* ---------- robust, typed normalization (no any) ---------- */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function toStringOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function toNumOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function toBoolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function toNullableString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function ensureArray<T = string>(val: unknown): T[] {
  if (Array.isArray(val)) return val as T[];
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      const parts = val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return parts as unknown as T[];
    }
  }
  return [];
}
function getArrayish(o: Record<string, unknown>): unknown {
  const candidates = ["comments", "data", "items", "results"];
  for (const k of candidates) {
    const v = o[k];
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      const parsed = tryParseJson<unknown>(v);
      if (Array.isArray(parsed)) return parsed;
    }
    if (isRecord(v) && Array.isArray((v as Record<string, unknown>).items)) {
      return (v as Record<string, unknown>).items as unknown;
    }
  }
  return null;
}
function normalizeCommentFromApi(o: Record<string, unknown>): Comment {
  const idRaw = o["id"];
  const id = typeof idRaw === "number" && Number.isFinite(idRaw) ? idRaw : 0;
  const content = pickString(o, "content") ?? "";
  const username = pickString(o, "username") ?? "";
  const display_name =
    pickString(o, "display_name") ??
    (typeof o["username"] === "string" ? (o["username"] as string) : "");
  const avatarUrl =
    (pickString(o, "avatarUrl") ?? pickString(o, "avatar_url")) || null;
  const created_at = pickString(o, "created_at") ?? new Date().toISOString();
  return { id, content, username, display_name, avatarUrl, created_at };
}
function normalizeCommentsResponse(raw: unknown): Comment[] {
  let src: unknown = raw;
  if (typeof src === "string") src = tryParseJson<unknown>(src) ?? [];
  if (isRecord(src)) {
    const arrish = getArrayish(src);
    if (arrish !== null) src = arrish;
    else if (isRecord((src as Record<string, unknown>).comment))
      src = [(src as Record<string, unknown>).comment as unknown];
  }
  const list = Array.isArray(src) ? src : [];
  const out: Comment[] = [];
  for (const c of list) if (isRecord(c)) out.push(normalizeCommentFromApi(c));
  return out;
}
function normalizeGroupsResponse(raw: unknown): Group[] {
  const fromTop = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray((raw as Record<string, unknown>).groups)
    ? ((raw as Record<string, unknown>).groups as unknown[])
    : [];
  return fromTop
    .map((g): Group | null => {
      if (!isRecord(g)) return null;
      const id = toNumOr(g.id, NaN);
      const name = toStringOr(g.name, "");
      if (!Number.isFinite(id) || !name) return null;
      return {
        id,
        name,
        memberCount: toNumOr(g.memberCount, 0),
        isMember:
          isRecord(g) && typeof (g as Record<string, unknown>).isMember === "boolean"
            ? ((g as Record<string, unknown>).isMember as boolean)
            : undefined,
      };
    })
    .filter((g): g is Group => g !== null);
}
function normalizePostsResponse(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (isRecord(raw)) {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.posts)) return r.posts as Record<string, unknown>[];
    if (Array.isArray(r.items)) return r.items as Record<string, unknown>[];
  }
  return [];
}
function normalizePostFromApi(p: Record<string, unknown>, groups: Group[]): Post {
  const id = toNumOr(p.id, 0);
  const content = toStringOr(p.content, "");
  const username = toStringOr(p.username, "");
  const display_name = toStringOr(
    (p as any).display_name ?? (p as any).displayName ?? (p as any).username,
    username
  );
  const avatarUrl = toNullableString(
    (p as any).avatarUrl ?? (p as any).avatar_url
  );
  const likes = toNumOr(p.likes, 0);
  const comments = toNumOr(p.comments, 0);
  const groupIdMaybe = toNumOr(p.group_id, NaN);
  const group_id = Number.isFinite(groupIdMaybe) ? groupIdMaybe : undefined;
  const created_at = toStringOr(p.created_at, new Date().toISOString());
  const isLiked = toBoolOr((p as any).isLiked ?? (p as any).liked, false);
  const pictures = ensureArray<string>((p as any).pictures);
  const tags = ensureArray<string>((p as any).tags);
  const attachedGroup =
    typeof group_id === "number"
      ? groups.find((g) => g.id === group_id)
      : undefined;
  return {
    id,
    content,
    username,
    display_name,
    avatarUrl,
    likes,
    comments,
    group_id,
    created_at,
    attachedGroup,
    isLiked,
    pictures,
    tags,
  };
}

/* ---------- Title helpers ---------- */
type RarityKey = "common" | "rare" | "epic" | "legendary";

type TitleChipProps = { title: Title; className?: string };

function rarityKeyFrom(value: Title["rarity"]): RarityKey {
  if (value == null) return "common";
  if (typeof value === "string") {
    if (value === "rare" || value === "epic" || value === "legendary") return value;
    return "common";
  }
  if (value <= 0) return "common";
  if (value === 1) return "rare";
  if (value === 2) return "epic";
  return "legendary";
}

const rarityRing: Record<RarityKey, string> = {
  common: "ring-border",
  rare: "ring-blue-200",
  epic: "ring-purple-200",
  legendary: "ring-amber-200",
};

function normalizeTitleFromApiObject(obj: Record<string, unknown>): Title | null {
  const id = toNumOr(obj.id, -1);
  const key = toStringOr(obj.key, "");
  const label = toStringOr(obj.label, "");
  const description = toNullableString((obj as any).description ?? null);
  const emoji = toNullableString((obj as any).emoji ?? null);
  const color = toNullableString((obj as any).color ?? null);
  const rarityRaw = (obj as any).rarity;
  let rarity: Title["rarity"] = null;
  if (typeof rarityRaw === "number" && Number.isFinite(rarityRaw)) {
    rarity = rarityRaw;
  } else if (typeof rarityRaw === "string") {
    const s = rarityRaw.toLowerCase();
    if (s === "common" || s === "rare" || s === "epic" || s === "legendary") {
      rarity = s;
    } else {
      const n = Number(s);
      if (Number.isFinite(n)) rarity = n as number;
    }
  }
  if (!label && id < 0) return null;
  return { id: id < 0 ? 0 : id, key, label, description, emoji, color, rarity };
}
function extractTitleFromResponse(raw: unknown): Title | null {
  if (!isRecord(raw)) return null;
  if (isRecord((raw as any).currentTitle)) {
    return normalizeTitleFromApiObject((raw as any).currentTitle);
  }
  if ("id" in raw || "label" in raw) {
    return normalizeTitleFromApiObject(raw);
  }
  return null;
}

function TitleChip({ title, className }: TitleChipProps) {
  const rarityKey = rarityKeyFrom(title.rarity);
  const style = title.color ? { backgroundColor: title.color } : undefined;

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
        "bg-muted text-foreground ring-1",
        rarityRing[rarityKey],
        className
      )}
      style={style}
      title={title.description ?? title.label ?? ""}
    >
      <Award className="h-3.5 w-3.5" />
      <span className="truncate max-w-[200px]">{title.label}</span>
    </span>
  );
}

/* ---------- Streak badge helpers (visual flame) ---------- */
const STAGE_BADGE_GRADIENT = [
  "bg-gradient-to-r from-sky-500 to-indigo-500",
  "bg-gradient-to-r from-indigo-500 to-purple-500",
  "bg-gradient-to-r from-purple-500 to-pink-500",
  "bg-gradient-to-r from-pink-500 to-rose-500",
  "bg-gradient-to-r from-amber-500 to-rose-500",
  "bg-gradient-to-r from-emerald-500 to-teal-500",
  "bg-gradient-to-r from-fuchsia-500 to-orange-500",
] as const;
function badgeClassFromStage(stage?: number | null) {
  const idx = Math.max(0, Math.min(STAGE_BADGE_GRADIENT.length - 1, Math.floor(stage ?? 0)));
  return STAGE_BADGE_GRADIENT[idx];
}

/* =========================================================
   Posts Page
========================================================= */
const Posts = () => {
  const navigate = useNavigate();

  /* ---------- POSTS state ---------- */
  const [posts, setPosts] = useState<Post[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [newPost, setNewPost] = useState<{
    content: string;
    attachedGroup: string;
    imageFile: File | null;
    tags: string[];
  }>({ content: "", attachedGroup: "", imageFile: null, tags: [] });

  const [loading, setLoading] = useState(false);
  const [postsLoading, setPostsLoading] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<{ username: string } | null>(
    null
  );

  // auth status: unknown | authed | guest
  const [authStatus, setAuthStatus] =
    useState<"unknown" | "authed" | "guest">("unknown");
  const isLoggedIn = authStatus === "authed";

  // Post streak state
  const [postStreak, setPostStreak] = useState<StreakInfo | null>(null);

  // create modal open
  const [createOpen, setCreateOpen] = useState(false);

  // only mark guest after two consecutive failures (avoid transient 401)
  const consecutiveFailRef = useRef(0);

  // reflect token changes across tabs (triggers re-probe)
  const [tokenBump, setTokenBump] = useState<number>(0);
  useEffect(() => {
    const onStorage = () => setTokenBump((n) => n + 1);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Relationship caches
  const [relCache, setRelCache] = useState<Map<string, Relationship>>(
    new Map()
  );
  const [relLoading, setRelLoading] = useState<Set<string>>(new Set());
  const [friendsSet, setFriendsSet] = useState<Set<string>>(new Set());

  // Title caches (NEW)
  const [titleCache, setTitleCache] = useState<Map<string, Title | null>>(
    new Map()
  );
  const [titleLoading, setTitleLoading] = useState<Set<string>>(new Set());

  // Comments modal state
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  // Feed filters
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showAll, setShowAll] = useState(true);
  const [customTagInput, setCustomTagInput] = useState("");

  // in-flight locks
  const [likingIds, setLikingIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  // rotating tips
  const [tipIndex, setTipIndex] = useState(0);
  const tipPauseRef = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      if (!tipPauseRef.current) setTipIndex((i) => (i + 1) % TIPS.length);
    }, 8000);
    return () => clearInterval(id);
  }, []);

  // trending tags (from fetched posts)
  const trending = useMemo(() => {
       const counts = new Map<string, number>();
    for (const p of posts) {
      for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag]) => tag);
  }, [posts]);

  /* ---------- central auth probe ---------- */
  async function checkAuthNow(): Promise<boolean> {
    try {
      const data = await api<{ username?: string }>("/users/current_user");
      if (data?.username) {
        setCurrentUser({ username: data.username });
        consecutiveFailRef.current = 0;
        setAuthStatus("authed");
        return true;
      }
      return false;
    } catch {
      consecutiveFailRef.current += 1;
      if (consecutiveFailRef.current >= 2) setAuthStatus("guest");
      return isLoggedIn;
    }
  }

  /* ---------- initial optimistic from token, then canonical ---------- */
  useEffect(() => {
    const token = getToken();
    if (token) {
      const payload = decodeJwtPayload(token);
      if (payload?.username) setCurrentUser({ username: payload.username });
    }
    void checkAuthNow();
  }, [tokenBump]);

  /* ---------- fetch post streak (if authed) ---------- */
  const fetchPostStreak = useCallback(async () => {
    try {
      const s = await api<StreakInfo>("/streaks/post");
      setPostStreak(s);
    } catch {
      setPostStreak(null);
    }
  }, []);
  useEffect(() => {
    if (isLoggedIn) void fetchPostStreak();
  }, [isLoggedIn, fetchPostStreak]);

  /* ---------- preload accepted friends ---------- */
  useEffect(() => {
    (async () => {
      try {
        const raw = await api<FriendListItem[]>("/friends");
        const usernames = raw
          .map((item) => (item?.user?.username ? item.user.username : ""))
          .filter(
            (u): u is string => typeof u === "string" && u.length > 0
          );

        const set = new Set(usernames);
        setFriendsSet(set);

        setRelCache((prev) => {
          const next = new Map(prev);
          usernames.forEach((u) => next.set(u, "friend"));
          return next;
        });
      } catch {
        // ignore
      }
    })();
  }, []);

  /* ---------- groups ---------- */
  useEffect(() => {
    (async () => {
      try {
        const raw = await api<unknown>("/groups/mine");
        const data = normalizeGroupsResponse(raw);
        setGroups(data);
      } catch {
        // ignore
      }
    })();
  }, []);

  /* ---------- posts (send cookie/bearer so isLiked is correct) ---------- */
  const fetchPosts = useCallback(async () => {
    try {
      setPostsLoading(true);
      const query =
        !showAll && activeTags.length > 0
          ? `?tags=${encodeURIComponent(activeTags.join(","))}`
          : "";
      const raw = await api<unknown>(`/posts${query}`);
      const arr = normalizePostsResponse(raw);
      const normalized = arr.map((p) => normalizePostFromApi(p, groups));
      setPosts(normalized);
    } catch {
      setPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }, [groups, activeTags, showAll]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  /* re-map attached group if group list changes */
  useEffect(() => {
    if (groups.length > 0) {
      setPosts((prev) =>
        prev.map((p) =>
          normalizePostFromApi(p as unknown as Record<string, unknown>, groups)
        )
      );
    }
  }, [groups]);

  /* ---------- relationship lookup ---------- */
  const ensureRelationship = useCallback(
    async (authorUsername: string) => {
      if (currentUser && authorUsername === currentUser.username) {
        setRelCache((prev) => {
          const next = new Map(prev);
          next.set(authorUsername, "friend");
          return next;
        });
        return;
      }
      if (friendsSet.has(authorUsername)) {
        setRelCache((prev) => {
          const next = new Map(prev);
          next.set(authorUsername, "friend");
          return next;
        });
        return;
      }
      if (relCache.has(authorUsername) || relLoading.has(authorUsername)) return;

      setRelLoading((prev) => new Set(prev).add(authorUsername));
      try {
        const uData = await api<UserProfileLite>(
          `/users/${encodeURIComponent(authorUsername)}`
        );
        const status = await api<FriendStatusResponse>(
          `/friends/status/${uData.id}`
        );
        const rel: Relationship =
          status.status === "accepted"
            ? "friend"
            : status.status === "pending"
            ? "pending"
            : "none";
        setRelCache((prev) => {
          const next = new Map(prev);
          next.set(authorUsername, rel);
          return next;
        });
      } catch {
        setRelCache((prev) => {
          const next = new Map(prev);
          next.set(authorUsername, "none");
          return next;
        });
      } finally {
        setRelLoading((prev) => {
          const next = new Set(prev);
          next.delete(authorUsername);
          return next;
        });
      }
    },
    [currentUser, relCache, relLoading, friendsSet]
  );

  useEffect(() => {
    const authors = Array.from(new Set(posts.map((p) => p.username)));
    authors.forEach((u) => void ensureRelationship(u));
  }, [posts, ensureRelationship]);

  /* ---------- title lookup (NEW) ---------- */
  const ensureTitleFor = useCallback(
    async (username: string) => {
      if (titleCache.has(username) || titleLoading.has(username)) return;
      setTitleLoading((prev) => new Set(prev).add(username));
      try {
        const resp = await api<unknown>(
          `/users/${encodeURIComponent(username)}/current-title`
        );
        const title = extractTitleFromResponse(resp);
        setTitleCache((prev) => {
          const next = new Map(prev);
          next.set(username, title);
          return next;
        });
      } catch {
        setTitleCache((prev) => {
          const next = new Map(prev);
          next.set(username, null);
          return next;
        });
      } finally {
        setTitleLoading((prev) => {
          const next = new Set(prev);
          next.delete(username);
          return next;
        });
      }
    },
    [titleCache, titleLoading]
  );

  useEffect(() => {
    const authors = Array.from(new Set(posts.map((p) => p.username)));
    authors.forEach((u) => void ensureTitleFor(u));
  }, [posts, ensureTitleFor]);

  /* ---------- create post (auth + streak ping) ---------- */
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await checkAuthNow();
    if (!ok) {
      alert("Please sign in to create a post.");
      return;
    }
    if (!newPost.content.trim()) return;
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append("content", newPost.content.trim());
      if (newPost.attachedGroup)
        formData.append("group_id", newPost.attachedGroup);
      if (newPost.imageFile) formData.append("image", newPost.imageFile);
      if (newPost.tags.length > 0)
        formData.append("tags", JSON.stringify(newPost.tags));

      const created = await api<unknown>("/posts", {
        method: "POST",
        body: formData,
      });
      const createdObj = isRecord(created) ? created : {};
      const normalized = normalizePostFromApi(createdObj, groups);

      setPosts((prev) => [normalized, ...prev]);
      setNewPost({ content: "", attachedGroup: "", imageFile: null, tags: [] });
      setImagePreview(null);

      if (currentUser?.username) void ensureTitleFor(currentUser.username);

      try {
        const ping = await api<{ ok: true; streak: StreakInfo }>(
          "/streaks/post/ping",
          { method: "POST", body: {} }
        );
        setPostStreak(ping.streak);
      } catch {
        void fetchPostStreak();
      }

      setCreateOpen(false);
    } catch (err) {
      console.error(err);
      alert("Error creating post");
    } finally {
      setLoading(false);
    }
  };

  /* ---------- add friend ---------- */
  const handleAddFriend = async (friendUsername: string) => {
    const ok = await checkAuthNow();
    if (!ok) {
      alert("Please sign in to add friends.");
      return;
    }
    try {
      await api<{ action?: string; id?: number }>("/friends/request", {
        method: "POST",
        body: { friendUsername },
      });
      setRelCache((prev) => {
        const next = new Map(prev);
        next.set(friendUsername, "pending");
        return next;
      });
    } catch (err) {
      console.error(err);
      alert("Error adding friend");
    }
  };

  /* ---------- join group ---------- */
  const handleJoinGroup = async (groupId: number) => {
    const ok = await checkAuthNow();
    if (!ok) {
      alert("Please sign in to join groups.");
      return;
    }
    try {
      await api("/groups/join", { method: "POST", body: { group_id: groupId } });
      setPosts((prev) =>
        prev.map((p) =>
          p.group_id === groupId
            ? {
                ...p,
                attachedGroup: p.attachedGroup
                  ? { ...p.attachedGroup, isMember: true }
                  : p.attachedGroup,
              }
            : p
        )
      );
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, memberCount: g.memberCount + 1 } : g
        )
      );
      navigate("/groups");
    } catch (err) {
      console.error(err);
      alert("Error joining group");
    }
  };

  /* ---------- view profile ---------- */
  const handleViewProfile = (username: string) => {
    navigate(`/profile/${encodeURIComponent(username)}`);
  };

  /* ---------- like ---------- */
  const handleLike = async (postId: number) => {
    const ok = await checkAuthNow();
    if (!ok) {
      alert("Please sign in to like posts.");
      return;
    }
    if (likingIds.has(postId)) return;
    setLikingIds((s) => new Set(s).add(postId));

    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? { ...p, isLiked: !p.isLiked, likes: p.isLiked ? p.likes - 1 : p.likes + 1 }
          : p
      )
    );

    try {
      const data = await api<{ likeCount: number; liked: boolean }>(
        `/posts/${postId}/like`,
        {
          method: "POST",
        }
      );
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, likes: data.likeCount, isLiked: data.liked } : p
        )
      );
    } catch (err) {
      console.error(err);
      alert("Error liking post");
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId
            ? {
                ...p,
                isLiked: !p.isLiked,
                likes: p.isLiked ? p.likes + 1 : p.likes - 1,
              }
            : p
        )
      );
    } finally {
      setLikingIds((s) => {
        const n = new Set(s);
        n.delete(postId);
        return n;
      });
    }
  };

  /* ---------- delete ---------- */
  const handleDeletePost = async (postId: number) => {
    const ok = await checkAuthNow();
    if (!ok) {
      alert("Please sign in to delete your post.");
      return;
    }
    if (!confirm("Delete this post?")) return;
    if (deletingIds.has(postId)) return;

    setDeletingIds((s) => new Set(s).add(postId));
    const prevPosts = posts;
    setPosts((p) => p.filter((x) => x.id !== postId));

    try {
      const data = await api<{ success?: boolean }>(`/posts/${postId}`, {
        method: "DELETE",
      });
      if (!data?.success) throw new Error("Failed to delete post");
    } catch (err) {
      console.error(err);
      alert("Error deleting post");
      setPosts(prevPosts);
    } finally {
      setDeletingIds((s) => {
        const n = new Set(s);
        n.delete(postId);
        return n;
      });
    }
  };

  /* ---------- comments ---------- */
  const fetchComments = async (postId: number) => {
    try {
      const raw = await api<unknown>(`/posts/${postId}/comments`);
      const normalized = normalizeCommentsResponse(raw);
      setComments(normalized);

      const uniqUsers = Array.from(new Set(normalized.map((c) => c.username)));
      uniqUsers.forEach((u) => void ensureTitleFor(u));
    } catch (err) {
      console.error(err);
      setComments([]);
    }
  };
  const handleAddComment = async (postId: number) => {
    const ok = await checkAuthNow();
    if (!ok) {
      alert("Please sign in to comment.");
      return;
    }
    if (!newComment.trim()) return;
    try {
      const createdRaw = await api<unknown>(`/posts/${postId}/comment`, {
        method: "POST",
        body: { content: newComment.trim() },
      });
      const created =
        isRecord(createdRaw) && isRecord((createdRaw as Record<string, unknown>).comment)
          ? normalizeCommentFromApi(
              (createdRaw as Record<string, unknown>).comment as Record<string, unknown>
            )
          : isRecord(createdRaw)
          ? normalizeCommentFromApi(createdRaw)
          : null;
      if (created) {
        setComments((prev) => [...prev, created]);
        void ensureTitleFor(created.username);
      } else {
        await fetchComments(postId);
      }
      setNewComment("");
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, comments: p.comments + 1 } : p))
      );
    } catch (err) {
      console.error(err);
      alert("Error adding comment");
    }
  };

  /* ---------- share ---------- */
  const handleShare = async (postId: number) => {
    const url = `${window.location.origin}/posts/${postId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Schedura", text: "Check out this post", url });
        return;
      }
    } catch {
      // fall through
    }
    try {
      await navigator.clipboard.writeText(url);
      alert("Post link copied to clipboard!");
    } catch {
      alert(url);
    }
  };

  /* ---------- tag helpers ---------- */
  const toggleCreateTag = (t: string) => {
    const tag = t.trim();
    if (!tag) return;
    setNewPost((prev) => {
      const exists = prev.tags.includes(tag);
      const tags = exists ? prev.tags.filter((x) => x !== tag) : [...prev.tags, tag];
      return { ...prev, tags };
    });
  };
  const toggleFilterTag = (t: string) => {
    setShowAll(false);
    setActiveTags((prev) => {
      const exists = prev.includes(t);
      const next = exists ? prev.filter((x) => x !== t) : [...prev, t];
      if (next.length === 0) setShowAll(true);
      return next;
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const addCustomCreateTag = () => {
    const trimmed = customTagInput.trim();
    if (!trimmed) return;
    if (!newPost.tags.includes(trimmed)) setNewPost((p) => ({ ...p, tags: [...p.tags, trimmed] }));
    setCustomTagInput("");
  };

  /* ---------- derived ---------- */
  const MAX_LEN = 1000;
  const remaining = MAX_LEN - newPost.content.length;

  /* ---------- skeleton ---------- */
  const SkeletonCard = () => (
    <Card className="border">
      <CardContent className="p-5 sm:p-6 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-muted" />
          <div className="space-y-2 flex-1">
            <div className="h-3 w-40 bg-muted rounded" />
            <div className="h-3 w-64 bg-muted rounded" />
          </div>
        </div>
        <div className="h-3 w-full bg-muted rounded mb-2" />
        <div className="h-3 w-4/5 bg-muted rounded mb-4" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-32 w-full bg-muted rounded" />
          <div className="h-32 w-full bg-muted rounded" />
        </div>
      </CardContent>
    </Card>
  );

  /* ---------- UI ---------- */
  const stage = postStreak?.flame?.stage ?? 0;
  const badgeGrad = badgeClassFromStage(stage);
  const postDays = postStreak?.current_count ?? 0;
  const postLongest = postStreak?.longest_count ?? 0;
  const pctToNext = Math.round((postStreak?.flame?.progressToNext ?? 0) * 100);
  const nextAt = postStreak?.flame?.nextCheckpoint ?? null;

  return (
    <div className="min-h-screen">
      {/* Header / hero */}
      <div className="max-w-7xl mx-auto px-4 pt-8 pb-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-2xl border bg-card shadow-sm p-6 md:p-8 mb-6"
        >
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                Schedura Pulse
              </h1>
              <p className="text-muted-foreground mt-1">
                Your community feed — connect, collaborate, and grow together.
              </p>
            </div>
            <div className="flex gap-2 self-start">
              <Button onClick={() => setCreateOpen(true)} className="gap-2 self-start">
                <PlusCircle className="h-4 w-4" />
                Create Post
              </Button>
            </div>
          </div>

          {/* Active filters summary */}
          {!showAll && activeTags.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-foreground/60">Filtering by:</span>
              {activeTags.map((t) => (
                <Badge
                  key={`active-${t}`}
                  variant="default"
                  className="cursor-pointer rounded-full"
                  onClick={() => toggleFilterTag(t)}
                >
                  <Hash className="h-3.5 w-3.5 mr-1" />
                  {t}
                  <X className="h-3.5 w-3.5 ml-1" />
                </Badge>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setShowAll(true);
                  setActiveTags([]);
                }}
              >
                Clear
              </Button>
            </div>
          )}
        </motion.div>

        {/* 3-column grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT: Filters + Tips */}
          <aside className="lg:col-span-3 space-y-6 lg:sticky lg:top-4">
            {/* Filter Card */}
            <Card className="bg-card border shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                    <Filter className="h-4 w-4" /> Filter
                  </div>
                  <Button
                    size="sm"
                    variant={showAll ? "default" : "secondary"}
                    onClick={() => {
                      setShowAll(true);
                      setActiveTags([]);
                    }}
                  >
                    All
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {DEFAULT_TAGS.map((t) => (
                    <Badge
                      key={t}
                      variant={
                        activeTags.includes(t) && !showAll ? "default" : "secondary"
                      }
                      className={clsx(
                        "cursor-pointer select-none px-3 py-1.5 text-sm rounded-full",
                        !showAll && activeTags.includes(t) && "ring-2 ring-primary"
                      )}
                      onClick={() => toggleFilterTag(t)}
                    >
                      <Hash className="h-3.5 w-3.5 mr-1" />
                      {t}
                    </Badge>
                  ))}
                </div>

                {/* Trending now (from feed) */}
                {trending.length > 0 && (
                  <>
                    <div className="text-xs text-foreground/60 mb-2">
                      Trending now
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {trending.map((t) => (
                        <Badge
                          key={`trend-${t}`}
                          variant={
                            activeTags.includes(t) && !showAll ? "default" : "secondary"
                          }
                          className="cursor-pointer select-none px-3 py-1.5 text-sm rounded-full"
                          onClick={() => toggleFilterTag(t)}
                        >
                          <Hash className="h-3.5 w-3.5 mr-1" />
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}

                {/* Active non-default tags badges */}
                {!showAll &&
                  activeTags
                    .filter((t) => !DEFAULT_TAGS.includes(t as DefaultTag))
                    .map((t) => (
                      <Badge
                        key={t}
                        variant="default"
                        className="cursor-pointer select-none px-3 py-1.5 text-sm rounded-full mr-2 mt-3"
                        onClick={() => toggleFilterTag(t)}
                      >
                        <Hash className="h-3.5 w-3.5 mr-1" />
                        {t}
                      </Badge>
                    ))}

                <div className="mt-4">
                  <Button variant="secondary" size="sm" onClick={() => fetchPosts()}>
                    <RefreshCcw className="h-4 w-4 mr-1" />
                    Refresh
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Rotating Tips */}
            <Card
              className="bg-gradient-to-br from-primary/10 to-transparent border shadow-sm overflow-hidden"
              onMouseEnter={() => (tipPauseRef.current = true)}
              onMouseLeave={() => (tipPauseRef.current = false)}
            >
              <CardContent className="p-5">
                <div className="flex items-center gap-2 text-primary mb-2">
                  <Lightbulb className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Tips for Schedura
                  </span>
                </div>
                <motion.p
                  key={tipIndex}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm leading-relaxed"
                >
                  {TIPS[tipIndex]}
                </motion.p>
                <div className="flex items-center gap-1 mt-3">
                  {TIPS.map((_, i) => (
                    <button
                      key={i}
                      aria-label={`Go to tip ${i + 1}`}
                      className={clsx(
                        "h-1.5 rounded-full transition-all",
                        i === tipIndex ? "w-5 bg-primary" : "w-2 bg-muted"
                      )}
                      onClick={() => setTipIndex(i)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>

          {/* CENTER: Feed */}
          <main className="lg:col-span-6 space-y-6">
            {/* POSTS FEED */}
            {postsLoading && (
              <>
                <SkeletonCard />
                <SkeletonCard />
              </>
            )}

            {!postsLoading && posts.length === 0 && (
              <Card className="border">
                <CardContent className="py-12 text-center">
                  <PlusCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {showAll
                      ? "No posts yet. Create your first post!"
                      : "No posts match these tags."}
                  </p>
                  <div className="mt-4">
                    <Button onClick={() => setCreateOpen(true)} className="gap-2">
                      <PlusCircle className="h-4 w-4" />
                      Create Post
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!postsLoading &&
              posts.map((post) => {
                const isOwner =
                  currentUser && post.username === currentUser.username;
                const deleting = deletingIds.has(post.id);
                const rel = relCache.get(post.username);
                const authorTitle = titleCache.get(post.username) ?? null;

                return (
                  <motion.div
                    key={post.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <Card className="border hover:shadow-lg transition-all duration-200">
                      <CardContent className="p-5 sm:p-6">
                        {/* Author + owner actions */}
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Link
                              to={`/profile/${encodeURIComponent(post.username)}`}
                              title={`View @${post.username}`}
                              className="shrink-0 cursor-pointer hover:ring-2 ring-primary/40 rounded-full"
                              aria-label={`View profile of ${post.display_name}`}
                            >
                              {post.avatarUrl ? (
                                <img
                                  src={post.avatarUrl}
                                  alt={post.display_name}
                                  className="h-10 w-10 rounded-full object-cover border"
                                  loading="lazy"
                                  onError={(e) => {
                                    (
                                      e.currentTarget as HTMLImageElement
                                    ).style.display = "none";
                                  }}
                                />
                              ) : (
                                <Initials
                                  name={post.display_name}
                                  username={post.username}
                                  className="h-10 w-10"
                                />
                              )}
                            </Link>
                            <div className="min-w-0">
                              <p className="font-semibold truncate max-w-[240px] sm:max-w-[320px]">
                                {post.display_name}
                              </p>
                              <p className="text-sm text-muted-foreground truncate max-w-[260px]">
                                @{post.username} •{" "}
                                <span title={fmtDate(post.created_at)}>
                                  {timeAgo(post.created_at)}
                                </span>
                              </p>
                              {authorTitle ? (
                                <div className="mt-1">
                                  <TitleChip title={authorTitle} />
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {currentUser && post.username !== currentUser.username && (
                              <>
                                {rel === "none" && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      handleAddFriend(post.username)
                                    }
                                  >
                                    <UserPlus className="h-4 w-4 mr-1" /> Add
                                    Friend
                                  </Button>
                                )}
                                {rel === "pending" && (
                                  <Button size="sm" variant="secondary" disabled>
                                    Request Sent
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    handleViewProfile(post.username)
                                  }
                                >
                                  View Profile
                                </Button>
                              </>
                            )}
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleShare(post.id)}
                              title="Share"
                              aria-label={`Share post ${post.id}`}
                            >
                              <Share2 className="h-4 w-4 mr-1" />
                              Share
                            </Button>
                            {isOwner && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeletePost(post.id)}
                                disabled={deleting}
                                aria-label={`Delete post ${post.id}`}
                              >
                                <Trash2 className="h-4 w-4 mr-1" />
                                {deleting ? "Deleting..." : "Delete"}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Tags row */}
                        {post.tags && post.tags.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {post.tags.map((t, idx) => (
                              <Badge
                                key={`${post.id}-tag-${idx}-${t}`}
                                variant="secondary"
                                className="rounded-full cursor-pointer"
                                onClick={() => toggleFilterTag(t)}
                                title={`Filter by ${t}`}
                              >
                                <Hash className="h-3.5 w-3.5 mr-1" />
                                {t}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Content */}
                        <p className="mb-4 whitespace-pre-wrap leading-relaxed">
                          {post.content}
                        </p>

                        {/* Images */}
                        {post.pictures && post.pictures.length > 0 && (
                          <div
                            className={clsx(
                              "gap-2 mb-4",
                              post.pictures.length === 1
                                ? "grid grid-cols-1"
                                : "grid grid-cols-2"
                            )}
                          >
                            {post.pictures.slice(0, 4).map((pic, idx) => (
                              <img
                                key={idx}
                                src={pic}
                                alt={`Post image ${idx + 1}`}
                                className={clsx(
                                  "rounded-lg w-full object-cover cursor-pointer",
                                  post.pictures.length === 1
                                    ? "max-h-96"
                                    : "max-h-60"
                                )}
                                loading="lazy"
                                onClick={() => setImagePreview(pic)}
                              />
                            ))}
                          </div>
                        )}

                        {/* Attached Group */}
                        {post.attachedGroup && (
                          <Card className="mb-4 bg-primary/5 border-primary/20">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 bg-primary/20 rounded-lg">
                                    <Users className="h-4 w-4 text-primary" />
                                  </div>
                                  <div>
                                    <p className="font-semibold">
                                      {post.attachedGroup.name}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                      {post.attachedGroup.memberCount ?? 0}{" "}
                                      members
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  disabled={
                                    !isLoggedIn || post.attachedGroup.isMember
                                  }
                                  onClick={() =>
                                    handleJoinGroup(post.attachedGroup!.id)
                                  }
                                >
                                  {post.attachedGroup.isMember
                                    ? "Joined"
                                    : "Join Group"}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        )}

                        {/* Actions */}
                        <div className="flex items-center gap-6 text-muted-foreground">
                          <button
                            className={clsx(
                              "flex items-center gap-2 transition-colors",
                              post.isLiked ? "text-red-500" : "hover:text-primary",
                              likingIds.has(post.id) &&
                                "opacity-60 cursor-not-allowed"
                            )}
                            disabled={likingIds.has(post.id)}
                            onClick={() => handleLike(post.id)}
                            title={isLoggedIn ? "Like" : "Sign in to like"}
                            aria-label={post.isLiked ? "Unlike" : "Like"}
                            aria-pressed={!!post.isLiked}
                          >
                            <Heart className="h-4 w-4" />
                            <span>{post.likes}</span>
                          </button>

                          {/* Comments dialog */}
                          <Dialog
                            onOpenChange={(open) => {
                              if (!open) {
                                setSelectedPost(null);
                                setComments([]);
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <button
                                className="flex items-center gap-2 hover:text-primary transition-colors"
                                title="Comments"
                                onClick={() => {
                                  setSelectedPost(post);
                                  void fetchComments(post.id);
                                }}
                                aria-label="Open comments"
                              >
                                <MessageSquare className="h-4 w-4" />
                                <span>{post.comments}</span>
                              </button>
                            </DialogTrigger>

                            <DialogContent className="sm:max-w-[780px] h-[85vh] p-0 flex flex-col">
                              {/* Header */}
                              <div className="p-5 border-b flex-shrink-0">
                                <DialogHeader>
                                  <DialogTitle className="text-lg">
                                    Post by {post.display_name}
                                  </DialogTitle>
                                </DialogHeader>
                                {authorTitle ? (
                                  <div className="mt-2">
                                    <TitleChip title={authorTitle} />
                                  </div>
                                ) : null}
                                {post.tags && post.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-2 mt-3">
                                    {post.tags.map((t, idx) => (
                                      <Badge
                                        key={`${post.id}-full-tag-${idx}-${t}`}
                                        variant="secondary"
                                        className="rounded-full cursor-pointer"
                                        onClick={() => toggleFilterTag(t)}
                                      >
                                        <Hash className="h-3.5 w-3.5 mr-1" />
                                        {t}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Body */}
                              <div className="px-5 py-4 overflow-y-auto flex-1">
                                <p className="whitespace-pre-wrap leading-relaxed mb-4">
                                  {post.content}
                                </p>

                                {post.pictures && post.pictures.length > 0 && (
                                  <div className="space-y-2 mb-4">
                                    {post.pictures.map((pic, idx) => (
                                      <img
                                        key={idx}
                                        src={pic}
                                        alt={`Full post image ${idx + 1}`}
                                        className="rounded-lg max-h-[480px] w-full object-contain cursor-pointer"
                                        loading="lazy"
                                        onClick={() => setImagePreview(pic)}
                                      />
                                    ))}
                                  </div>
                                )}

                                <h3 className="font-semibold mt-2 mb-3">
                                  Comments
                                </h3>
                                <div className="space-y-4">
                                  {comments.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                      No comments yet.
                                    </p>
                                  ) : (
                                    comments.map((c) => {
                                      const cTitle =
                                        titleCache.get(c.username) ?? null;
                                      return (
                                        <div key={c.id} className="border-b pb-3">
                                          <div className="flex items-center gap-3">
                                            <Link
                                              to={`/profile/${encodeURIComponent(
                                                c.username
                                              )}`}
                                              title={`View @${c.username}`}
                                              className="shrink-0 cursor-pointer hover:ring-2 ring-primary/40 rounded-full"
                                              aria-label={`View profile of ${c.display_name}`}
                                            >
                                              {c.avatarUrl ? (
                                                <img
                                                  src={c.avatarUrl}
                                                  alt={c.display_name}
                                                  className="h-8 w-8 rounded-full object-cover border"
                                                  loading="lazy"
                                                  onError={(e) =>
                                                    ((e.currentTarget as HTMLImageElement).style.display = "none")
                                                  }
                                                />
                                              ) : (
                                                <Initials
                                                  name={c.display_name}
                                                  username={c.username}
                                                  className="h-8 w-8"
                                                />
                                              )}
                                            </Link>
                                            <div className="min-w-0">
                                              <p className="font-semibold leading-tight">
                                                {c.display_name}
                                              </p>
                                              <p className="text-xs text-muted-foreground truncate">
                                                @{c.username} •{" "}
                                                <span title={fmtDate(c.created_at)}>
                                                  {timeAgo(c.created_at)}
                                                </span>
                                              </p>
                                              {cTitle ? (
                                                <div className="mt-0.5">
                                                  <TitleChip
                                                    title={cTitle}
                                                    className="text-[11px] px-1.5 py-0.5"
                                                  />
                                                </div>
                                              ) : null}
                                            </div>
                                          </div>
                                          <p className="mt-2">{c.content}</p>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </div>

                              {/* Composer */}
                              <div className="p-5 border-t flex-shrink-0">
                                <div className="flex gap-2">
                                  <Textarea
                                    value={newComment}
                                    onChange={(e) => setNewComment(e.target.value)}
                                    placeholder={
                                      isLoggedIn
                                        ? "Write a comment..."
                                        : "Sign in to comment"
                                    }
                                    rows={2}
                                    disabled={!isLoggedIn}
                                  />
                                  <Button
                                    onClick={() =>
                                      selectedPost && handleAddComment(selectedPost.id)
                                    }
                                    disabled={!isLoggedIn}
                                  >
                                    Post
                                  </Button>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
          </main>

          {/* RIGHT: Post Streak card */}
          <aside className="lg:col-span-3 space-y-6 lg:sticky lg:top-4">
            <Card className="bg-card border shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg md:text-xl flex items-center gap-2">
                  <Flame className="h-5 w-5 text-primary" />
                  Your Post Streak
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="rounded-xl border p-3 bg-card/60">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium text-white ${badgeGrad}`}
                    >
                      {postStreak?.flame?.label ?? "Spark"}
                    </span>
                    <div className="text-sm text-foreground/70">
                      {postDays} day{postDays === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[11px] text-foreground/60 mb-1">
                      <span>Progress to next</span>
                      <span className="tabular-nums">{pctToNext}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-[width] duration-500"
                        style={{ width: `${pctToNext}%` }}
                      />
                    </div>
                    {nextAt != null && (
                      <div className="mt-1 text-[12px] text-foreground/60">
                        Next at{" "}
                        <span className="tabular-nums font-medium">{nextAt}d</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 text-xs text-foreground/60">
                    Longest streak:{" "}
                    <span className="font-medium tabular-nums">{postLongest}d</span>
                  </div>
                  <div className="mt-3 flex">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => setCreateOpen(true)}
                    >
                      Write a post
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>

      {/* Create Post Modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>Create a Post</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreatePost} className="space-y-5">
            <ComposerBody
              groups={groups}
              newPost={newPost}
              setNewPost={setNewPost}
              imagePreview={imagePreview}
              setImagePreview={setImagePreview}
              customTagInput={customTagInput}
              setCustomTagInput={setCustomTagInput}
              toggleCreateTag={toggleCreateTag}
              addCustomCreateTag={addCustomCreateTag}
              remaining={remaining}
              loading={loading}
            />
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Posting...
                </>
              ) : (
                "Create Post"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mobile FAB */}
      <Button
        className="fixed bottom-6 right-6 rounded-full h-12 w-12 p-0 shadow-lg md:hidden"
        onClick={() => setCreateOpen(true)}
        title="Create post"
        aria-label="Create post"
      >
        <PlusCircle className="h-6 w-6" />
      </Button>

      {/* Fullscreen Image Preview */}
      <Dialog open={!!imagePreview} onOpenChange={() => setImagePreview(null)}>
        <DialogContent className="max-w-4xl">
          {imagePreview && (
            <img
              src={imagePreview}
              alt="Full size preview"
              className="w-full h-auto rounded-lg"
              loading="lazy"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

/* ---------- small composition helper for composer ---------- */
function ComposerBody(props: {
  groups: Group[];
  newPost: {
    content: string;
    attachedGroup: string;
    imageFile: File | null;
    tags: string[];
  };
  setNewPost: React.Dispatch<
    React.SetStateAction<{
      content: string;
      attachedGroup: string;
      imageFile: File | null;
      tags: string[];
    }>
  >;
  imagePreview: string | null;
  setImagePreview: React.Dispatch<React.SetStateAction<string | null>>;
  customTagInput: string;
  setCustomTagInput: React.Dispatch<React.SetStateAction<string>>;
  toggleCreateTag: (t: string) => void;
  addCustomCreateTag: () => void;
  remaining: number;
  loading: boolean;
}) {
  const {
    groups,
    newPost,
    setNewPost,
    imagePreview,
    setImagePreview,
    customTagInput,
    setCustomTagInput,
    toggleCreateTag,
    addCustomCreateTag,
    remaining,
  } = props;

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="content">Post Content</Label>
        <div className="relative">
          <Textarea
            id="content"
            placeholder="What are you studying? When? Where? What do you need?"
            rows={5}
            value={newPost.content}
            maxLength={1000}
            onChange={(e) => setNewPost({ ...newPost, content: e.target.value })}
            required
          />
          <div className="absolute bottom-2 right-3 text-xs text-muted-foreground">
            {remaining}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="group">Attach Group (Optional)</Label>
          <select
            id="group"
            className="w-full rounded-md border bg-card px-3 py-2"
            value={newPost.attachedGroup}
            onChange={(e) =>
              setNewPost({ ...newPost, attachedGroup: e.target.value })
            }
          >
            <option value="">— None —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id.toString()}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="image">Attach Image (Optional)</Label>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer hover:bg-accent transition">
              <ImageIcon className="h-4 w-4" />
              <span>Choose file</span>
              <input
                id="image"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setNewPost({ ...newPost, imageFile: file });
                  if (file) {
                    const reader = new FileReader();
                    reader.onload = () => setImagePreview(reader.result as string);
                    reader.readAsDataURL(file);
                  } else {
                    setImagePreview(null);
                  }
                }}
              />
            </label>
            {newPost.imageFile && (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setNewPost({ ...newPost, imageFile: null });
                  setImagePreview(null);
                }}
              >
                <X className="h-4 w-4 inline mr-1" />
                remove
              </button>
            )}
          </div>
          {imagePreview && (
            <img
              src={imagePreview}
              alt="preview"
              className="rounded-lg mt-2 max-h-44 w-full object-cover"
            />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Tags</Label>
        <div className="flex flex-wrap gap-2">
          {DEFAULT_TAGS.map((t) => {
            const active = newPost.tags.includes(t);
            return (
              <Badge
                key={t}
                variant={active ? "default" : "secondary"}
                className={clsx(
                  "cursor-pointer select-none px-3 py-1.5 text-sm rounded-full transition",
                  active && "ring-2 ring-primary"
                )}
                onClick={() => toggleCreateTag(t)}
              >
                <Hash className="h-3.5 w-3.5 mr-1" />
                {t}
              </Badge>
            );
          })}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Input
            placeholder="Add a custom tag (e.g., Calculus, IELTS)"
            value={customTagInput}
            onChange={(e) => setCustomTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomCreateTag();
              }
            }}
          />
          <Button type="button" variant="secondary" onClick={addCustomCreateTag}>
            Add
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {newPost.tags
            .filter((t) => !DEFAULT_TAGS.includes(t as DefaultTag))
            .map((t) => (
              <Badge
                key={t}
                variant="default"
                className="cursor-pointer select-none px-3 py-1.5 text-sm rounded-full"
                onClick={() => {
                  const next = newPost.tags.filter((x) => x !== t);
                  setNewPost({ ...newPost, tags: next });
                }}
              >
                <Hash className="h-3.5 w-3.5 mr-1" />
                {t}
                <X className="h-3.5 w-3.5 ml-1" />
              </Badge>
            ))}
        </div>
      </div>
    </>
  );
}

export default Posts;
