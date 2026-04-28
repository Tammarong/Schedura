// src/pages/Profile.tsx
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  useState,
  useEffect,
  useMemo,
  useContext,
  useRef,
  useCallback,
  type ComponentType,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { motion } from "framer-motion";
import type { Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import {
  BookOpen,
  FileText,
  UserPlus,
  MessageCircle,
  Check,
  Settings as SettingsIcon,
  UserCheck,
  Camera,
  Share2,
  Copy,
  Users,
  Sparkles,
  ShieldCheck,
  Crown,
  Award,
  Plus,
  X,
  Bell, // NEW: follow icon for clear differentiation
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

import { ChatheadContext, ChatUser } from "@/providers/chathead-context";
import { api, getToken, apiUrl } from "@/lib/api";

/* NEW: cropper */
import Cropper, { Area } from "react-easy-crop";

/** ---------- Types ---------- */
type Group = { id: string | number; name: string; role: string; memberCount?: number };
type Post = { id: string | number; content: string; timestamp: string; likes: number; comments: number };
type Title = {
  id: number;
  key: string;
  label: string;
  description?: string | null;
  emoji?: string | null;
  color?: string | null;
  rarity?: "common" | "rare" | "epic" | "legendary";
};
type ProfileData = {
  id: number | string;
  username: string;
  displayName: string;
  joinedDate: string;
  groupsCount: number;
  postsCount: number;
  friendsCount: number;
  groups?: Group[];
  posts?: Post[];
  avatarUrl?: string | null;
  currentTitle?: Title | null;
};

type ProfileBgMeta = {
  userId: number;
  username: string;
  color: string | null;
  url: string | null;
  hasImage: boolean;
  updatedAt: string | null;
};

type ProfileBreakpoint = "desktop" | "tablet" | "mobile";

type ProfileCompKey =
  | "cover" | "avatar" | "displayName" | "title" | "bio"
  | "stats" | "streaks" | "friends" | "groups"
  | "schedule" | "studyDesk" | "featured" | "posts";

type ProfileCompRow = {
  id?: number;
  key: ProfileCompKey;
  breakpoint: ProfileBreakpoint;
  x: number; y: number; w?: number | null; h?: number | null;
  zIndex?: number;
  visible?: boolean;
  locked?: boolean;
  config?: Record<string, unknown> | null;
  updatedAt?: string;
};

type ProfilePageMeta = {
  theme: string | null;
  grid: unknown | null;
  is_locked: boolean;
  updated_at: string;
};

/** ---------- Friends relationship (existing) ---------- */
type RelationshipStatus =
  | "none"
  | "self"
  | "friends"
  | "pending_outgoing"
  | "pending_incoming"
  | "blocked"
  | "blocked_by_me"
  | "blocked_me"
  | "rejected"
  | null;

type RelationshipSuccess = {
  target: { id: number; username: string } | null;
  status: RelationshipStatus;
};
type RelationshipError = { error?: string };
type RelationshipResponse = RelationshipSuccess | RelationshipError;
function isRelationshipSuccess(r: RelationshipResponse): r is RelationshipSuccess {
  return r != null && typeof r === "object" && "status" in r;
}
type Relationship = { isFriend: boolean; isPending: boolean };

/** ---------- Followers relationship (NEW, separate) ---------- */
type FollowRelationshipStatus =
  | "none"
  | "self"
  | "blocked"
  | "mutual"
  | "following"         // I follow them
  | "followed_by"       // they follow me
  | "requested_outgoing"// my request → their private
  | "requested_incoming"; // their request → my private

type FollowersRelationshipSuccess = {
  target: { id: number; username: string };
  status: FollowRelationshipStatus;
};
type FollowersRelationshipError = { error?: string };
type FollowersRelationshipResponse = FollowersRelationshipSuccess | FollowersRelationshipError;

function isFollowersRelSuccess(
  r: FollowersRelationshipResponse
): r is FollowersRelationshipSuccess {
  return r != null && typeof r === "object" && "status" in r;
}

type FollowersListItem = {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatarMime?: string | null;
  followedAt?: string;
};

type FollowersListResponse = {
  items: FollowersListItem[];
  page: number;
  limit: number;
  total: number;
  private?: boolean;
};

type ChatUserWithExtras = ChatUser & {
  avatarUrl?: string | null;
  isOnline?: boolean;
};

type CooldownPayload = {
  error?: string;
  code?: string;
  cooldownDays?: number;
  changedAt?: string;
  nextAllowedAt?: string;
  nextAt?: string;
  until?: string;
  retryAfterMs?: number;
  remainingMs?: number;
};

/* ---------- Streaks ---------- */
type StreakType = "post" | "study" | "groupMessage";
type FlameInfo = {
  stage: number;
  label: string;
  nextCheckpoint: number;
  progressToNext: number; // 0..1
};
type Streak = {
  type: StreakType;
  group_id: number | null;
  current_count: number;
  longest_count: number;
  start_date?: string | null;
  last_date?: string | null;
  todayActive: boolean;
  flame?: FlameInfo | null;
};

/* ---------- Stories / Highlights ---------- */
type StoryBubble = {
  id: string | number;
  coverUrl?: string | null;
  hasUnseen?: boolean;
};
type Highlight = {
  id: string | number;
  title: string;
  coverUrl?: string | null;
};

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

/* ---------- tiny helpers ---------- */
function cn(...xs: Array<string | false | null | undefined>): string {
  return xs.filter(Boolean).join(" ");
}

/* ---------- date helpers (friendlier join date) ---------- */
function fmtJoinedCasual(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" }); // e.g., "Jan 2024"
}
function fmtJoinedFull(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }); // e.g., "January 5, 2024"
}

/* ---------- Glow helpers (used for TitleBadge only) ---------- */
function hexToRgba(hex: string, alpha = 1): string {
  try {
    const h = hex.replace("#", "").trim();
    const parse = (s: string) => parseInt(s, 16);
    const [r, g, b] =
      h.length === 3
        ? [parse(h[0] + h[0]), parse(h[1] + h[1]), parse(h[2] + h[2])]
        : [parse(h.slice(0, 2)), parse(h.slice(2, 4)), parse(h.slice(4, 6))];
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } catch {
    return `rgba(168, 85, 247, ${alpha})`; // fallback violet-500
  }
}
function glowStyleFromHex(hex: string): CSSProperties {
  return {
    textShadow: [
      `0 0 3px ${hexToRgba(hex, 0.85)}`,
      `0 0 9px ${hexToRgba(hex, 0.65)}`,
      `0 0 18px ${hexToRgba(hex, 0.5)}`,
    ].join(", "),
    boxShadow: [
      `0 0 6px ${hexToRgba(hex, 0.55)}`,
      `0 0 14px ${hexToRgba(hex, 0.45)}`
    ].join(", "),
    filter: `drop-shadow(0 0 6px ${hexToRgba(hex, 0.55)})`,
  };
}

function currentBreakpoint(): ProfileBreakpoint {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  if (w < 640) return "mobile";
  if (w < 1024) return "tablet";
  return "desktop";
}

// Map BE row -> react-grid-layout Layout
function rowToRgl(r: ProfileCompRow): Layout {
  return {
    i: r.key,
    x: Math.max(0, Math.floor(r.x)),
    y: Math.max(0, Math.floor(r.y)),
    w: Math.max(1, Math.floor(r.w ?? 3)),
    h: Math.max(1, Math.floor(r.h ?? 2)),
    isDraggable: !r.locked,
    isResizable: !r.locked,
    static: false,
  };
}

function rglToRows(rgl: Layout[], prev: ProfileCompRow[]): ProfileCompRow[] {
  const byKey = new Map(prev.map(p => [p.key, p]));
  return rgl.map(l => {
    const old = byKey.get(l.i as ProfileCompKey);
    return {
      ...(old ?? { key: l.i as ProfileCompKey, breakpoint: "desktop", x: 0, y: 0 }),
      x: l.x, y: l.y, w: l.w, h: l.h,
    };
  });
}

// Rarity-driven glow palette (for titles)
const rarityGlowHex: Record<NonNullable<Title["rarity"]>, string> = {
  common: "#94a3b8",     // slate-400
  rare: "#38bdf8",       // sky-400
  epic: "#a78bfa",       // violet-400
  legendary: "#fbbf24",  // amber-300
};

/* ---------- Cover component (updated: error-hide + responsive) ---------- */
function CoverHero({
  rawUrl,
  bgColor,
}: {
  rawUrl: string | null;
  bgColor?: string | null;
}) {
  const [fit, setFit] = useState<"cover" | "contain">("cover");
  const [imgErr, setImgErr] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 1024px)").matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);

    // initialize once
    setIsDesktop(m.matches);

    // Robust attach: modern (addEventListener) and legacy (addListener)
    const mAny = m as unknown as { addEventListener?: (t: string, cb: (e: MediaQueryListEvent) => void) => void; removeEventListener?: (t: string, cb: (e: MediaQueryListEvent) => void) => void; addListener?: (cb: (e: MediaQueryListEvent) => void) => void; removeListener?: (cb: (e: MediaQueryListEvent) => void) => void; };
    if (typeof mAny.addEventListener === "function") {
      mAny.addEventListener("change", onChange);
      return () => mAny.removeEventListener?.("change", onChange);
    }
    if (typeof mAny.addListener === "function") {
      mAny.addListener(onChange);
      return () => mAny.removeListener?.(onChange);
    }
  }, []);

  // Reset image error when URL changes
  useEffect(() => setImgErr(false), [rawUrl]);

  const onImgLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const host = wrapperRef.current;
    if (!host) return;

    const { width: hostW, height: hostH } = host.getBoundingClientRect();
    const natW = img.naturalWidth || 0;
    const natH = img.naturalHeight || 0;

    const upscaling = natW < hostW * 0.9 || natH < hostH * 0.9;
    const veryTall = natH / Math.max(natW, 1) > (hostH / Math.max(hostW, 1)) * 1.2;
    const veryWide = natW / Math.max(natH, 1) > (hostW / Math.max(hostH, 1)) * 1.2;

    setFit(isDesktop ? (upscaling || veryTall || veryWide ? "contain" : "cover")
                     : (upscaling ? "contain" : "cover"));
  }, [isDesktop]);

  const gradients =
    "radial-gradient(150% 190% at -10% 0%, rgba(168,85,247,.28), transparent 45%), radial-gradient(140% 130% at 110% 30%, rgba(59,130,246,.28), transparent 46%)";

  const bottomFade: CSSProperties = {
    WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, #000 70%)",
    maskImage: "linear-gradient(to bottom, rgba(0,0,0,0) 0%, #000 70%)",
    background:
      "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,.12) 85%, rgba(0,0,0,.18) 100%)",
  };

  const height = isDesktop ? "clamp(240px, 42vh, 520px)" : "clamp(160px, 48vw, 320px)";

  return (
    <div className="mx-auto w-full max-w-6xl px-0">
      <div
        ref={wrapperRef}
        className={cn(
          "relative z-0 isolate w-full overflow-hidden rounded-3xl ring-1 ring-border/60",
          "shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]"
        )}
        style={{ height, backgroundColor: bgColor || undefined }}
      >
        {rawUrl && !imgErr && (
          <img
            src={rawUrl}
            alt=""
            onLoad={onImgLoad}
            onError={() => setImgErr(true)}
            className="absolute inset-0 h-full w-full select-none will-change-transform"
            style={{ objectFit: fit, objectPosition: "center center", zIndex: 0 }}
            draggable={false}
            loading="eager"
          />
        )}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundImage: gradients, backgroundSize: "cover", backgroundPosition: "center" }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16" style={bottomFade} />
      </div>
    </div>
  );
}

export default function Profile() {
  const { username } = useParams();
  const navigate = useNavigate();
  const chat = useContext(ChatheadContext);
  
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | "unknown">("unknown");

  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const [rel, setRel] = useState<Relationship>({ isFriend: false, isPending: false });

  const [bg, setBg] = useState<ProfileBgMeta | null>(null);
  const [bgVersion, setBgVersion] = useState(0);

  // visitor preview
  const [viewAsVisitor, setViewAsVisitor] = useState(false);
  const isOwnProfile =
    !!profileData &&
    !!currentUsername &&
    profileData.username.toLowerCase() === currentUsername.toLowerCase();
  const isOwnerActive = isOwnProfile && !viewAsVisitor;

  /** --------- Followers state (NEW) --------- */
  const [followRel, setFollowRel] = useState<FollowRelationshipStatus | null>(null);
  const [followerCount, setFollowerCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);

  const [followersOpen, setFollowersOpen] = useState(false);
  const [followersItems, setFollowersItems] = useState<FollowersListItem[]>([]);
  const [followersPage, setFollowersPage] = useState(1);
  const [followersTotal, setFollowersTotal] = useState(0);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [followersHasMore, setFollowersHasMore] = useState(false);
  const FOLLOWERS_PAGE_SIZE = 20;

  /** --------- Avatar dialog --------- */
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  /* NEW: avatar cropper state */
  const [avatarCropping, setAvatarCropping] = useState(false);
  const [avatarCrop, setAvatarCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarCroppedAreaPixels, setAvatarCroppedAreaPixels] = useState<Area | null>(null);
  const AVATAR_ASPECT = 1 / 1;

  /** --------- Cover dialog --------- */
  const [coverOpen, setCoverOpen] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [bgColorInput, setBgColorInput] = useState<string>("#111827");
  const [bgUrlInput, setBgUrlInput] = useState<string>("");
  const [bgImageFile, setBgImageFile] = useState<File | null>(null);
  const [bgImagePreview, setBgImagePreview] = useState<string | null>(null);

  /* NEW: cover cropper state */
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const COVER_ASPECT = 3 / 1;

  /** --------- Settings dialog --------- */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [displayNameInput, setDisplayNameInput] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [saveHint, setSaveHint] = useState<string>("");

  // --- Password cooldown ---
  const [cooldownOpen, setCooldownOpen] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<Date | null>(null);
  const COOLDOWN_DAYS_DEFAULT = 7;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // --- Titles ---
  const [currentTitle, setCurrentTitle] = useState<Title | null>(null);
  const [ownedTitles, setOwnedTitles] = useState<Title[]>([]);
  const [titleOpen, setTitleOpen] = useState(false);
  const [titleBusy, setTitleBusy] = useState(false);
  const [selectedTitleId, setSelectedTitleId] = useState<number | null>(null);
  const [titlesLoading, setTitlesLoading] = useState(false);

  // --- Streaks ---
  const [streaks, setStreaks] = useState<Streak[] | null>(null);
  const [streaksLoading, setStreaksLoading] = useState(false);
  const [streaksError, setStreaksError] = useState<string | null>(null);

  // --- Stories / Highlights ---
  const [story, setStory] = useState<StoryBubble | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  function parseDate(s?: string | null): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function computeCooldownUntil(body: CooldownPayload): Date | null {
    const byIso =
      parseDate(body.nextAllowedAt) ||
      parseDate(body.nextAt) ||
      parseDate(body.until);
    if (byIso) return byIso;
    const now = Date.now();
    if (typeof body.retryAfterMs === "number" && body.retryAfterMs >= 0) return new Date(now + body.retryAfterMs);
    if (typeof body.remainingMs === "number" && body.remainingMs >= 0) return new Date(now + body.remainingMs);
    const changedAt = parseDate(body.changedAt);
    if (changedAt) {
      const days =
        typeof body.cooldownDays === "number"
          ? Math.max(0, body.cooldownDays)
          : COOLDOWN_DAYS_DEFAULT;
      return new Date(changedAt.getTime() + days * ONE_DAY_MS);
    }
    return null;
  }

  const initials = useMemo(() => {
    const base = (profileData?.displayName?.trim() || profileData?.username || "").trim();
    if (!base) return "";
    const parts = base.split(/\s+/);
    return (
      (parts.length === 1 ? parts[0].slice(0, 2) : (parts[0][0] ?? "") + (parts[1][0] ?? "")).toUpperCase()
    );
  }, [profileData?.displayName, profileData?.username]);

  /** Helper: fetch avatarUrl via the new endpoints */
  async function fetchAvatarUrl(targetUsername?: string): Promise<string | null> {
    try {
      if (!targetUsername) {
        const a = await api<{ avatarUrl?: string | null }>("/avatar/me", { method: "GET" });
        return a?.avatarUrl ?? null;
      }
      const a = await api<{ avatarUrl?: string | null }>(
        `/avatar/${encodeURIComponent(targetUsername)}`,
        { method: "GET" }
      );
      return a?.avatarUrl ?? null;
    } catch {
      return null;
    }
  }

  /** ---------- Titles: fetch helpers ---------- */
  async function fetchOwnedAndCurrentForMe(): Promise<void> {
    setTitlesLoading(true);
    const paths = [
      "/titles/me",
      "/users/me/titles",
      "/me/titles",
      "/titles/owned",
    ];

    for (const p of paths) {
      try {
        const data = await api<unknown>(p, { method: "GET" });

        let titles: Title[] = [];
        let cur: Title | null = null;

        if (Array.isArray(data)) {
          titles = data as Title[];
        } else if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          const maybeTitles = (obj.titles ?? obj.owned) as unknown;
          if (Array.isArray(maybeTitles)) titles = maybeTitles as Title[];
          const maybeCur = (obj.currentTitle ?? obj.current) as unknown;
          cur = (maybeCur && typeof maybeCur === "object") ? (maybeCur as Title) : null;
          if (maybeCur === null) cur = null;
        }

        setOwnedTitles(titles);
        setCurrentTitle(cur ?? currentTitle ?? null);
        setTitlesLoading(false);
        return;
      } catch {
        // try next
      }
    }
    setTitlesLoading(false);
  }

  async function fetchCurrentTitleForUser(targetUsername: string): Promise<void> {
    const enc = encodeURIComponent(targetUsername);
    const attempts = [
      `/titles/current/${enc}`,
      `/users/${enc}/current-title`,
      `/titles/of/${enc}/current`,
    ];
    for (const p of attempts) {
      try {
        const data = await api<unknown>(p, { method: "GET" });
        let cur: Title | null = null;
        if (data && typeof data === "object") {
          const obj = data as Record<string, unknown>;
          const maybeCur = (obj.currentTitle ?? obj.current) as unknown;
          if (maybeCur && typeof maybeCur === "object") cur = maybeCur as Title;
          if (maybeCur === null) cur = null;
        } else if (data === null) {
          cur = null;
        }
        if (cur || cur === null) setCurrentTitle(cur);
        return;
      } catch {
        // continue
      }
    }
    if (profileData?.currentTitle !== undefined) {
      setCurrentTitle((profileData.currentTitle as Title) ?? null);
    }
  }

  async function equipTitle(newTitleId: number | null): Promise<void> {
    if (!isOwnProfile) throw new Error("You can only change your own title.");

    const attempts = [
      { path: "/titles/equip", method: "PATCH" as const, body: { titleId: newTitleId } },
      { path: "/titles/equip", method: "POST"  as const, body: { titleId: newTitleId } },
      { path: "/users/me/current-title", method: "PATCH" as const, body: { titleId: newTitleId } },
      { path: "/users/me/title",        method: "PATCH" as const, body: { titleId: newTitleId } },
    ];

    let lastErr = "";
    for (const a of attempts) {
      try {
        const resp = await api<{ currentTitle?: Title | null }>(a.path, { method: a.method, body: a.body });
        const next: Title | null =
          (typeof resp?.currentTitle !== "undefined" ? resp.currentTitle : null) ?? 
          (newTitleId ? ownedTitles.find((t) => t.id === newTitleId) ?? null : null);

        setCurrentTitle(next ?? null);
        setSelectedTitleId(newTitleId);
        setProfileData((prev) => (prev ? { ...prev, currentTitle: next ?? null } : prev));
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(lastErr || "Failed to update title");
  }

  /** ---------- Streaks loader ---------- */
  async function loadStreaksForProfile(): Promise<void> {
    if (!profileData?.username) return;
    setStreaksLoading(true);
    setStreaksError(null);

    try {
      let payload: { streaks?: Streak[] } | Streak[] | null = null;

      if (isOwnProfile) {
        payload = await api<{ streaks?: Streak[] } | Streak[] | null>("/streaks/me", { method: "GET" });
      } else {
        const enc = encodeURIComponent(profileData.username);
        const tries = [
          `/streaks/of/${enc}`,
          `/users/${enc}/streaks`,
          `/streaks/user/${enc}`,
        ];
        for (const p of tries) {
          try {
            payload = await api<{ streaks?: Streak[] } | Streak[] | null>(p, { method: "GET" });
            break;
          } catch { /* try next */ }
        }
      }

      const arr: Streak[] =
        Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.streaks)
          ? (payload!.streaks as Streak[])
          : [];

      const want: StreakType[] = ["post", "study", "groupMessage"];
      const map = new Map(arr.map((s) => [s.type as StreakType, s]));
      const normalized: Streak[] = want.map((t) => {
        const s = map.get(t);
        return s ?? {
          type: t,
          group_id: null,
          current_count: 0,
          longest_count: 0,
          start_date: null,
          last_date: null,
          todayActive: false,
          flame: {
            stage: 0,
            label: t === "study" ? "Initiate" : t === "groupMessage" ? "Scout" : "Spark",
            nextCheckpoint: 50,
            progressToNext: 0,
          },
        };
      });

      setStreaks(normalized);
    } catch {
      setStreaks(null);
      setStreaksError(isOwnProfile ? "Failed to load your streaks." : "Streaks unavailable.");
    } finally {
      setStreaksLoading(false);
    }
  }

  /** ---------- Local auth probe ---------- */
  useEffect(() => {
    const t = getToken();
    if (t) {
      const payload = decodeJwtPayload(t);
      if (payload?.username) setCurrentUsername(payload.username);
    }
    setAuthed("unknown");

    (async () => {
      try {
        const me = await api<{ username?: string; authenticated?: boolean }>("/users/current_user");
        if (me?.username) {
          setCurrentUsername(me.username);
          setAuthed(true);
        } else {
          setAuthed(false);
        }
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  /** Load profile */
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);

        let data: ProfileData;
        if (username) {
          data = await api<ProfileData>(`/users/${encodeURIComponent(username)}`);
          const ensured = await fetchAvatarUrl(username);
          if (ensured !== null) data.avatarUrl = ensured;
        } else {
          try {
            data = await api<ProfileData>("/users/current_user");
            const ensured = await fetchAvatarUrl();
            if (ensured !== null) data.avatarUrl = ensured;
          } catch {
            setProfileData(null);
            setLoading(false);
            return;
          }
        }

        if (!data.groupsCount && Array.isArray(data.groups)) data.groupsCount = data.groups.length;
        if (!data.postsCount && Array.isArray(data.posts)) data.postsCount = data.posts.length;

        setProfileData(data);
        setDisplayNameInput(data.displayName);
        if (typeof data.currentTitle !== "undefined") setCurrentTitle(data.currentTitle ?? null);
      } catch (err) {
        console.error("Error loading profile:", err);
        setProfileData(null);
      } finally {
        setLoading(false);
      }
    };

    void fetchProfile();
  }, [username]);

  /** Titles bootstrap */
  useEffect(() => {
    (async () => {
      if (!profileData?.username) return;
      if (isOwnProfile && authed === true) {
        await fetchOwnedAndCurrentForMe();
      } else if (!isOwnProfile) {
        await fetchCurrentTitleForUser(profileData.username);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData?.username, isOwnProfile, authed]);

  /** Relationship for another user's profile (friends) */
  useEffect(() => {
    const loadRelationship = async () => {
      if (!username || isOwnProfile) {
        setRel({ isFriend: false, isPending: false });
        return;
      }
      try {
        const r = await api<RelationshipResponse>(
          `/friends/relationship?username=${encodeURIComponent(username)}`
        );

        if (!isRelationshipSuccess(r)) {
          setRel({ isFriend: false, isPending: false });
          return;
        }

        const isFriend = r.status === "friends";
        const isPending =
          r.status === "pending_outgoing" || r.status === "pending_incoming";
        setRel({ isFriend, isPending });
      } catch {
        setRel({ isFriend: false, isPending: false });
      }
    };

    void loadRelationship();
  }, [username, isOwnProfile]);

  /** ---------- Followers: relationship + counts ---------- */
  const profileUsername = useMemo(() => profileData?.username ?? null, [profileData?.username]);

  const loadFollowersRelationship = useCallback(async () => {
    if (!profileUsername || isOwnProfile) {
      setFollowRel(isOwnProfile ? "self" : null);
      return;
    }
    try {
      const r = await api<FollowersRelationshipResponse>(
        `/followers/relationship?username=${encodeURIComponent(profileUsername)}`
      );
      if (isFollowersRelSuccess(r)) {
        setFollowRel(r.status);
      } else {
        setFollowRel("none");
      }
    } catch {
      setFollowRel("none");
    }
  }, [profileUsername, isOwnProfile]);

  const loadFollowerCounts = useCallback(async () => {
    if (!profileUsername) return;
    try {
      const [followersRes, followingRes] = await Promise.allSettled([
        api<FollowersListResponse>(
          `/followers/${encodeURIComponent(profileUsername)}/followers?page=1&limit=1`,
          { method: "GET" }
        ),
        api<FollowersListResponse>(
          `/followers/${encodeURIComponent(profileUsername)}/following?page=1&limit=1`,
          { method: "GET" }
        ),
      ]);

      if (followersRes.status === "fulfilled" && typeof followersRes.value?.total === "number") {
        setFollowerCount(followersRes.value.total);
      } else {
        setFollowerCount(0);
      }

      if (followingRes.status === "fulfilled" && typeof followingRes.value?.total === "number") {
        setFollowingCount(followingRes.value.total);
      } else {
        setFollowingCount(0);
      }
    } catch {
      setFollowerCount(0);
      setFollowingCount(0);
    }
  }, [profileUsername]);

  useEffect(() => {
    void loadFollowersRelationship();
    void loadFollowerCounts();
  }, [loadFollowersRelationship, loadFollowerCounts]);

  /** Followers list loader */
  const fetchFollowersPage = useCallback(
    async (page: number): Promise<void> => {
      if (!profileUsername) return;
      setFollowersLoading(true);
      try {
        const res = await api<FollowersListResponse>(
          `/followers/${encodeURIComponent(profileUsername)}/followers?page=${page}&limit=${FOLLOWERS_PAGE_SIZE}`,
          { method: "GET" }
        );
        if (page === 1) {
          setFollowersItems(res.items ?? []);
        } else {
          setFollowersItems((prev) => [...prev, ...(res.items ?? [])]);
        }
        setFollowersTotal(res.total ?? 0);
        const hasMore = page * FOLLOWERS_PAGE_SIZE < (res.total ?? 0);
        setFollowersHasMore(hasMore);
        setFollowersPage(page);
      } catch {
        if (page === 1) {
          setFollowersItems([]);
          setFollowersTotal(0);
          setFollowersHasMore(false);
        }
      } finally {
        setFollowersLoading(false);
      }
    },
    [profileUsername]
  );

  const openFollowersDialog = useCallback(() => {
    setFollowersOpen(true);
    void fetchFollowersPage(1);
  }, [fetchFollowersPage]);

  const loadMoreFollowers = useCallback(() => {
    if (followersHasMore && !followersLoading) {
      void fetchFollowersPage(followersPage + 1);
    }
  }, [followersHasMore, followersLoading, fetchFollowersPage, followersPage]);

  /** Follow / Unfollow actions */
  const onFollow = useCallback(async () => {
    if (!profileUsername || authed === false || isOwnProfile) return;
    try {
      const res = await api<{ ok?: boolean; status?: "requested" | "accepted" }>(
        `/followers/${encodeURIComponent(profileUsername)}`,
        { method: "POST" }
      );
      // Update relationship UI
      if (res?.status === "accepted") {
        setFollowRel(prev => (prev === "followed_by" ? "mutual" : "following"));
        setFollowerCount((c) => c + 1);
      } else if (res?.status === "requested") {
        setFollowRel("requested_outgoing");
      } else {
        await loadFollowersRelationship();
        await loadFollowerCounts();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, [profileUsername, authed, isOwnProfile, loadFollowersRelationship, loadFollowerCounts]);

  const onUnfollow = useCallback(async () => {
    if (!profileUsername || authed === false || isOwnProfile) return;
    try {
      await api(`/followers/${encodeURIComponent(profileUsername)}`, { method: "DELETE" });
      if (followRel === "following" || followRel === "mutual") {
        setFollowerCount((c) => Math.max(0, c - 1));
      }
      await loadFollowersRelationship();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }, [profileUsername, authed, isOwnProfile, followRel, loadFollowersRelationship]);

  /** Streaks bootstrap */
  useEffect(() => {
    (async () => {
      if (!profileData?.username) return;
      await loadStreaksForProfile();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileData?.username, isOwnProfile]);

  /** Stories/Highlights bootstrap (stubbed) */
  useEffect(() => {
    if (!profileData?.username) return;
    setStory(profileData.avatarUrl ? { id: profileData.id, coverUrl: profileData.avatarUrl, hasUnseen: false } : null);
    setHighlights((hs) => hs ?? []);
  }, [profileData?.username, profileData?.avatarUrl, profileData?.id]);

  /** --------- Avatar handlers --------- */
  function openAvatarDialog(): void { setAvatarOpen(true); }
  function closeAvatarDialog(): void {
    setAvatarOpen(false);
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarBusy(false);
    setAvatarCropping(false);
    setAvatarCroppedAreaPixels(null);
    setAvatarZoom(1);
    setAvatarCrop({ x: 0, y: 0 });
  }
  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    setAvatarFile(f || null);
    setAvatarPreview(f ? URL.createObjectURL(f) : null);
    setAvatarCropping(false);
    setAvatarCroppedAreaPixels(null);
    setAvatarZoom(1);
    setAvatarCrop({ x: 0, y: 0 });
  }

  async function uploadAvatarFile(file: File): Promise<void> {
    const MAX_MB = 5;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`Image too large. Max ${MAX_MB}MB`);
      return;
    }

    setAvatarBusy(true);
    try {
      const attempts: Array<{ path: string; field: "avatar" | "file" }> = [
        { path: "/avatar", field: "avatar" },
        { path: "/avatar", field: "file" },
        { path: "/users/me/avatar", field: "avatar" },
        { path: "/users/me/avatar", field: "file" },
      ];

      let lastErr = "";
      for (const { path, field } of attempts) {
        try {
          const form = new FormData();
          form.append(field, file, file.name);

          const data = await api<{ avatarUrl?: string }>(path, { method: "POST", body: form });

          if (typeof data?.avatarUrl === "string") {
            setProfileData((p) => (p ? { ...p, avatarUrl: data.avatarUrl! } : p));
          } else {
            const cacheBust = Date.now();
            const raw = apiUrl(`/avatar/${encodeURIComponent(profileData?.username ?? "")}/raw?cb=${cacheBust}`);
            setProfileData((p) => (p ? { ...p, avatarUrl: p.avatarUrl || raw } : p));
          }
          closeAvatarDialog();
          // Force cache-bust of <img> if needed:
          window.location.reload();
          setAvatarBusy(false);
          return;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
        }
      }

      console.error("Avatar upload failed:", lastErr);
      alert(`Failed to upload avatar.\n${lastErr}`);
    } finally {
      setAvatarBusy(false);
    }
  }

  async function saveAvatar(): Promise<void> {
    if (!avatarFile) return;
    await uploadAvatarFile(avatarFile);
  }

  async function removeAvatar(): Promise<void> {
    if (!confirm("Remove your profile picture?")) return;
    try {
      setAvatarBusy(true);
      await api("/avatar", { method: "DELETE" });
      setProfileData((p) => (p ? { ...p, avatarUrl: null } : p));
      closeAvatarDialog();
    } catch (e) {
      console.error(e);
      setAvatarBusy(false);
      alert("Failed to remove avatar.");
    }
  }

  /** --------- Cover (profile background): helpers --------- */
  async function fetchProfileBgMetaForMe(): Promise<ProfileBgMeta | null> {
    const attempts = [
      { method: "GET" as const, path: "/profilebg/me" },
      { method: "GET" as const, path: "/users/me/profilebg" },
      { method: "GET" as const, path: "/profilebg" },
      { method: "GET" as const, path: "/users/me/profile-background" },
    ];
    let lastErr = "";
    for (const a of attempts) {
      try {
        return await api<ProfileBgMeta>(a.path, { method: a.method });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    console.warn("fetchProfileBgMetaForMe failed:", lastErr);
    return null;
  }

  async function setProfileBgColor(color: string | null): Promise<ProfileBgMeta> {
    const body = { color };
    const attempts = [
      { method: "PATCH" as const, path: "/profilebg/color", body },
      { method: "PATCH" as const, path: "/profilebg",        body },
      { method: "POST"  as const, path: "/profilebg/color",  body },
      { method: "PATCH" as const, path: "/users/me/profilebg", body },
    ];
    let lastErr = "";
    for (const a of attempts) {
      try {
        return await api<ProfileBgMeta>(a.path, { method: a.method, body: a.body });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(lastErr || "Failed to update cover color");
  }

  async function setProfileBgUrl(url: string | null): Promise<ProfileBgMeta> {
    const body = { url };
    const attempts = [
      { method: "POST"  as const, path: "/profilebg/url",      body },
      { method: "PATCH" as const, path: "/profilebg",          body },
      { method: "PATCH" as const, path: "/users/me/profilebg", body },
    ];
    let lastErr = "";
    for (const a of attempts) {
      try {
        return await api<ProfileBgMeta>(a.path, { method: a.method, body: a.body });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(lastErr || "Failed to set cover URL");
  }

  async function uploadProfileBgImageFile(file: File): Promise<void> {
    const attempts = [
      { method: "POST" as const, path: "/profilebg/image",           field: "image" },
      { method: "POST" as const, path: "/profilebg/image",           field: "file"  },
      { method: "POST" as const, path: "/users/me/profilebg/image",  field: "image" },
    ];
    let lastErr = "";
    for (const a of attempts) {
      try {
        const form = new FormData();
        form.append(a.field, file, file.name);
        await api(a.path, { method: a.method, body: form });
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(lastErr || "Failed to upload cover image");
  }

  async function deleteProfileBgImage(): Promise<ProfileBgMeta> {
    const attempts = [
      { method: "DELETE" as const, path: "/profilebg/image" },
      { method: "DELETE" as const, path: "/users/me/profilebg/image" },
      { method: "POST"   as const, path: "/profilebg/image/delete" },
    ];
    let lastErr = "";
    for (const a of attempts) {
      try {
        return await api<ProfileBgMeta>(a.path, { method: a.method });
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(lastErr || "Failed to remove cover image");
  }

  /* --------- NEW: Clear helpers (color, URL, all) --------- */
  async function clearBgColor(): Promise<void> {
    try {
      setCoverBusy(true);
      const next = await setProfileBgColor(null);
      setBg(next);
      setBgVersion((v) => v + 1);
      setBgColorInput("#111827");
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  async function clearBgUrl(): Promise<void> {
    try {
      setCoverBusy(true);
      const next = await setProfileBgUrl(null);
      setBg(next);
      setBgVersion((v) => v + 1);
      setBgUrlInput("");
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  /** Remove *everything*: URL, DB image, and color */
  async function clearAllBackground(): Promise<void> {
    if (!confirm("Reset your cover to the default (remove color, URL, and image)?")) return;
    try {
      setCoverBusy(true);
      try { await setProfileBgUrl(null); } catch {}
      try { await deleteProfileBgImage(); } catch {}
      try { await setProfileBgColor(null); } catch {}

      const meta = await fetchProfileBgMetaForMe();
      setBg(meta ?? {
        userId: Number(profileData?.id ?? 0),
        username: profileData?.username ?? "",
        color: null, url: null, hasImage: false, updatedAt: null
      });
      setBgColorInput("#111827");
      setBgUrlInput("");
      setBgImageFile(null);
      setBgImagePreview(null);
      setCropping(false);
      setBgVersion((v) => v + 1);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  /** --------- Cover handlers --------- */
  async function openCoverDialog(): Promise<void> {
    if (isOwnerActive && authed === true) {
      try {
        const data = await fetchProfileBgMetaForMe();
        setBg(data ?? null);
        setBgColorInput(data?.color || "#111827");
        setBgUrlInput(data?.url || "");
      } catch {
        setBgColorInput("#111827");
        setBgUrlInput("");
      }
    } else {
      setBgColorInput("#111827");
      setBgUrlInput("");
    }
    setBgImageFile(null);
    setBgImagePreview(null);
    setCropping(false);
    setCoverOpen(true);
  }
  function closeCoverDialog(): void {
    if (coverBusy) return;
    setCoverOpen(false);
  }
  function onPickBgImage(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0] ?? null;
    setBgImageFile(f);
    setBgImagePreview(f ? URL.createObjectURL(f) : null);
    setCropping(false);
  }

  async function saveBgColor(): Promise<void> {
    try {
      setCoverBusy(true);
      const next = await setProfileBgColor((bgColorInput || "").trim() || null);
      setBg(next);
      setBgVersion((v) => v + 1);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  async function saveBgUrl(): Promise<void> {
    try {
      setCoverBusy(true);
      const next = await setProfileBgUrl((bgUrlInput || "").trim() || null);
      setBg(next);
      setBgVersion((v) => v + 1);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  /** ---------- Crop utilities (shared) ---------- */
  const onCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setCroppedAreaPixels(areaPixels);
  }, []);
  const onAvatarCropComplete = useCallback((_area: Area, areaPixels: Area) => {
    setAvatarCroppedAreaPixels(areaPixels);
  }, []);

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function getCroppedFile(imageSrc: string, pixelCrop: Area, filename = "image.jpg"): Promise<File> {
    const image = await loadImage(imageSrc);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    canvas.width = Math.max(1, Math.floor(pixelCrop.width));
    canvas.height = Math.max(1, Math.floor(pixelCrop.height));
    ctx.drawImage(
      image,
      pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height,
      0, 0, canvas.width, canvas.height
    );
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b as Blob), "image/jpeg", 0.92)
    );
    return new File([blob], filename, { type: "image/jpeg" });
  }

  async function onSaveCropped(): Promise<void> {
    if (!bgImagePreview || !croppedAreaPixels) return;
    try {
      setCoverBusy(true);
      const file = await getCroppedFile(bgImagePreview, croppedAreaPixels, "cover.jpg");
      await uploadProfileBgImageFile(file);
      setBgVersion((v) => v + 1);
      setCropping(false);
      setBgImageFile(null);
      setBgImagePreview(null);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  async function onSaveAvatarCropped(): Promise<void> {
    if (!avatarPreview || !avatarCroppedAreaPixels) return;
    try {
      setAvatarBusy(true);
      const file = await getCroppedFile(avatarPreview, avatarCroppedAreaPixels, "avatar.jpg");
      await uploadAvatarFile(file);
      // uploadAvatarFile closes the dialog and reloads
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
      setAvatarBusy(false);
    }
  }

  async function uploadBgImage(): Promise<void> {
    if (!bgImageFile) return;
    const MAX_MB = 8;
    if (bgImageFile.size > MAX_MB * 1024 * 1024) {
      alert(`Image too large. Max ${MAX_MB}MB`);
      return;
    }
    try {
      setCoverBusy(true);
      await uploadProfileBgImageFile(bgImageFile);
      setBgImageFile(null);
      setBgImagePreview(null);
      setCropping(false);
      setBgVersion((v) => v + 1);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  async function removeBgImage(): Promise<void> {
    if (!confirm("Remove your cover image (keeps color/URL if set)?")) return;
    try {
      setCoverBusy(true);
      const next = await deleteProfileBgImage();
      setBg(next);
      setBgVersion((v) => v + 1);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    } finally {
      setCoverBusy(false);
    }
  }

  const rawBgUrl = useMemo(() => {
    if (!profileData?.username) return null;
    return apiUrl(`/profilebg/${encodeURIComponent(profileData.username)}/raw${bgVersion ? `?v=${bgVersion}` : ""}`);
  }, [profileData?.username, bgVersion]);

  /** --------- Settings handlers --------- */
  function openSettings(): void {
    if (profileData) setDisplayNameInput(profileData.displayName);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSaveHint("");
    setSettingsOpen(true);
  }
  function closeSettings(): void {
    if (settingsBusy) return;
    setSettingsOpen(false);
  }

  const nameOk = useMemo(() => displayNameInput.trim().length >= 1, [displayNameInput]);
  const pwdFieldsPresent = useMemo(
    () => [currentPassword, newPassword, confirmPassword].some((v) => v.length > 0),
    [currentPassword, newPassword, confirmPassword]
  );
  const pwdOk = useMemo(
    () => !pwdFieldsPresent || (newPassword.length >= 6 && newPassword === confirmPassword),
    [pwdFieldsPresent, newPassword, confirmPassword]
  );
  const canSaveAccount = nameOk && pwdOk && !settingsBusy;

  const onSaveSettings = async (): Promise<void> => {
    if (!profileData) return;

    setSettingsBusy(true);
    setSaveHint("Saving…");

    try {
      const nextName = displayNameInput.trim();
      if (nextName && nextName !== profileData.displayName) {
        await api("/users/me/display-name", {
          method: "PATCH",
          body: { displayName: nextName },
        });
        setProfileData((p) => (p ? { ...p, displayName: nextName } : p));
      }

      if (pwdFieldsPresent) {
        if (!pwdOk) throw new Error("Password fields invalid.");

        try {
          await api("/users/me/password", {
            method: "PATCH",
            body: { currentPassword, newPassword },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const payloadText = msg.replace(/^API \d+:\s*/, "");
          try {
            const body = JSON.parse(payloadText) as CooldownPayload;
            if (body.code === "PASSWORD_CHANGE_COOLDOWN") {
              const until = computeCooldownUntil(body);
              setCooldownUntil(until ?? null);
              setCooldownOpen(true);
              setSaveHint("");
              setSettingsBusy(false);
              return;
            }
          } catch {}
          throw e;
        }
      }

      setSaveHint("Saved!");
      setTimeout(() => {
        setSettingsOpen(false);
        setSaveHint("");
      }, 450);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      setSaveHint(String(e instanceof Error ? e.message : e));
    } finally {
      setSettingsBusy(false);
    }
  };

  /** --------- Friends --------- */
  const onAddFriend = async (): Promise<void> => {
    if (!profileData) return;

    const targetId = Number(profileData.id);
    const attempts: Array<{
      path: string;
      method?: "POST";
      body?: Record<string, unknown>;
    }> = [
      { path: "/friends/request", method: "POST", body: { userId: targetId } },
      { path: "/friends/request", method: "POST", body: { friendUsername: profileData.username } },
      { path: `/friends/${encodeURIComponent(String(profileData.username))}/request`, method: "POST" },
      { path: "/friends", method: "POST", body: { userId: targetId, action: "request" } },
    ];

    let lastErrText = "";
    for (const a of attempts) {
      try {
        await api(a.path, { method: a.method || "POST", body: a.body });
        setRel({ isFriend: false, isPending: true });
        return;
      } catch (e) {
        lastErrText = e instanceof Error ? e.message : String(e);
      }
    }

    console.error("Add Friend failed:", lastErrText);
    alert("Unable to send friend request.\n" + lastErrText);
  };

  /** --------- DM open with avatar --------- */
  const onMessage = (): void => {
    if (!profileData || !chat?.openChat) return;
    const chatUser: ChatUserWithExtras = {
      id: Number(profileData.id),
      username: profileData.username,
      displayName: profileData.displayName,
      avatarUrl: profileData.avatarUrl ?? null,
      isOnline: false,
    };
    chat.openChat(chatUser);
  };

  /** --------- Post deep links --------- */
  const postLink = (postId: string | number) => `/posts/${encodeURIComponent(String(postId))}`;
  const onViewPost = (postId: string | number) => navigate(postLink(postId));
  const onSharePost = async (postId: string | number) => {
    const url = `${window.location.origin}${postLink(postId)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Schedura", text: "Check out this post", url });
        return;
      }
    } catch {}
    try {
      await navigator.clipboard.writeText(url);
      alert("Post link copied to clipboard!");
    } catch {
      alert(url);
    }
  };

  const onCopyHandle = async (): Promise<void> => {
    if (!profileData) return;
    try {
      await navigator.clipboard.writeText(`@${profileData.username}`);
    } catch {}
  };

  const joinedCasual = useMemo(
    () => fmtJoinedCasual(profileData?.joinedDate),
    [profileData?.joinedDate]
  );
  const joinedFull = useMemo(
    () => fmtJoinedFull(profileData?.joinedDate) ?? undefined,
    [profileData?.joinedDate]
  );

  /** --------- Title dialog handlers --------- */
  async function openTitleDialog(): Promise<void> {
    if (isOwnerActive && authed === true && !titlesLoading) {
      try {
        await fetchOwnedAndCurrentForMe();
      } catch (e) {
        console.warn("Title fetch on open failed:", e);
      }
    }
    setSelectedTitleId(currentTitle?.id ?? null);
    setTitleOpen(true);
  }
  function closeTitleDialog(): void {
    if (titleBusy) return;
    setTitleOpen(false);
  }
  async function onSaveTitle(): Promise<void> {
    try {
      setTitleBusy(true);
      await equipTitle(selectedTitleId);
      setTitleOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      alert(`Failed to update title.\n${msg}`);
    } finally {
      setTitleBusy(false);
    }
  }

  // --------- Stories/Highlights handlers (stubs) ----------
  function onOpenStory(): void {
    if (!story) return;
    alert("Open story viewer (stub)");
  }
  function onOpenHighlight(h: Highlight): void {
    alert(`Open highlight ${h.title} (stub)`);
  }
  function onCreateHighlight(): void {
    if (!isOwnerActive) return;
    alert("Create new highlight (stub)");
  }

  /** --------- Loading / Not found --------- */
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="space-y-3 text-center">
          <div className="animate-pulse w-24 h-24 rounded-full bg-muted mx-auto" />
          <div className="animate-pulse h-4 w-48 bg-muted mx-auto rounded" />
          <div className="animate-pulse h-3 w-64 bg-muted/70 mx-auto rounded" />
          <p className="text-sm text-muted-foreground mt-6">Loading profile…</p>
        </div>
      </div>
    );
  }

  if (!username && authed === false) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center">
          <p className="text-lg">You’re not signed in.</p>
          <p className="text-sm text-muted-foreground mt-1">
            Please log in to view your profile.
          </p>
          <Button className="mt-4" onClick={() => navigate("/")}>Go Home</Button>
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center">
          <p className="text-lg text-red-500">Profile not found</p>
          <Button className="mt-4" onClick={() => navigate("/")}>Go Home</Button>
        </div>
      </div>
    );
  }

  /** --------- Page --------- */
  const profilePath = `/profile/${encodeURIComponent(profileData.username)}`;

  return (
    <div className="min-h-screen">
      {/* HERO / COVER */}
      <CoverHero
        rawUrl={rawBgUrl}
        bgColor={bg?.color ?? null}
      />

      {/* Floating "Exit visitor view" pill */}
      {isOwnProfile && viewAsVisitor && (
        <button
          type="button"
          onClick={() => setViewAsVisitor(false)}
          className="fixed bottom-4 right-4 z-40 rounded-full bg-black/70 px-4 py-2 text-xs text-white shadow-lg backdrop-blur hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-primary"
          title="Exit visitor view"
        >
          Exit visitor view
        </button>
      )}

      {/* ================= MOBILE (IG-style) ================= */}
      <div className="lg:hidden">
        <div className="px-3 -mt-12">
          {/* Row 1: Avatar (only) */}
          <div className="flex items-center gap-4">
            <StoryAvatar
              src={profileData.avatarUrl}
              initials={initials}
              hasUnseen={story?.hasUnseen}
              onClick={story ? onOpenStory : undefined}
              onChangePhoto={isOwnerActive ? openAvatarDialog : undefined}
              showChangeBtn={isOwnerActive}
            />
          </div>

          {/* Row 2: Name + Title + handle + (moved) Share */}
          <div className="mt-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h1 className="text-[18px] font-semibold">
                  {profileData.displayName}
                </h1>
                <Sparkles className="h-4 w-4" aria-hidden />
              </div>

              {!isOwnProfile && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={async () => {
                    const url = `${window.location.origin}${profilePath}`;
                    try { if (navigator.share) { await navigator.share({ title: profileData.displayName, url }); return; } } catch {}
                    try { await navigator.clipboard.writeText(url); alert("Profile link copied!"); } catch { alert(url); }
                  }}
                  title="Share profile"
                  aria-label="Share profile"
                >
                  <Share2 className="h-5 w-5" />
                </Button>
              )}
            </div>

            <div className="mt-1 flex items-center gap-2">
              {currentTitle ? <TitleBadge title={currentTitle} /> : null}
            </div>
            <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
              <button
                onClick={onCopyHandle}
                className="inline-flex items-center gap-1 hover:text-foreground"
                title="Copy handle"
              >
                @{profileData.username}
                <Copy className="h-3.5 w-3.5" />
              </button>
              <span className="inline-flex items-center gap-1 text-xs">
                <ShieldCheck className="h-3.5 w-3.5" /> Trusted
              </span>
            </div>
          </div>

          {/* Row 3: Actions (friend vs follow clearly distinct; Share moved out) */}
          {!isOwnProfile ? (
            <div className="mt-3 grid grid-cols-3 gap-2">
              {/* Friend: solid rectangular */}
              {rel.isFriend ? (
                <Button
                  disabled
                  className="w-full font-semibold bg-emerald-600 hover:bg-emerald-600 text-white"
                  title="You are friends"
                >
                  <Check className="h-4 w-4 mr-1" /> Friends
                </Button>
              ) : rel.isPending ? (
                <Button
                  disabled
                  className="w-full font-semibold bg-emerald-600/80 text-white"
                  title="Friend request sent"
                >
                  <Check className="h-4 w-4 mr-1" /> Requested
                </Button>
              ) : (
                <Button className="w-full font-semibold" onClick={onAddFriend} title="Send friend request">
                  <UserPlus className="h-4 w-4 mr-1" /> Add Friend
                </Button>
              )}

              {/* Follow: outline, rounded-full, dashed border */}
              {followRel === "following" || followRel === "mutual" ? (
                <Button
                  variant="outline"
                  className="w-full rounded-full border-dashed"
                  onClick={onUnfollow}
                  disabled={authed !== true}
                  title="Unfollow"
                >
                  <UserCheck className="h-4 w-4 mr-1" /> Following
                </Button>
              ) : followRel === "requested_outgoing" ? (
                <Button
                  disabled
                  variant="outline"
                  className="w-full rounded-full border-dashed opacity-70"
                  title="Follow request sent"
                >
                  <Users className="h-4 w-4 mr-1" /> Requested
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full rounded-full border-dashed"
                  onClick={onFollow}
                  disabled={authed !== true}
                  title="Follow"
                >
                  <Users className="h-4 w-4 mr-1" /> Follow
                </Button>
              )}

              {/* Message */}
              <Button variant="secondary" className="w-full" onClick={onMessage} title="Message">
                <MessageCircle className="h-4 w-4 mr-1" /> Message
              </Button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" className="w-full" onClick={openSettings}>
                Edit Profile
              </Button>
              <Button variant="secondary" className="w-full" onClick={openCoverDialog} aria-label="Edit cover">
                Cover
              </Button>
            </div>
          )}

          {/* Row 4: Stats (followers clickable) */}
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold">{profileData.postsCount ?? 0}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                Posts
              </div>
            </div>
            <button
              type="button"
              onClick={openFollowersDialog}
              className="rounded-lg hover:bg-muted/50 transition focus:outline-none focus:ring-2 focus:ring-primary/30"
              title="View followers"
            >
              <div className="text-lg font-bold">{followerCount ?? 0}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                Followers
              </div>
            </button>
            <div>
              <div className="text-lg font-bold">{profileData.friendsCount ?? 0}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground/80">
                Friends
              </div>
            </div>
          </div>
        </div>

        {/* Highlights rail (mobile) */}
        <HighlightsRail
          highlights={highlights}
          isOwner={isOwnerActive}
          onOpen={onOpenHighlight}
          onCreate={onCreateHighlight}
        />

        {/* Streaks (mobile) */}
        <div className="px-3 mt-3">
          <StreaksCard
            compact
            streaks={streaks}
            loading={streaksLoading}
            error={streaksError}
            onRetry={() => void loadStreaksForProfile()}
            isSelf={isOwnProfile}
          />
        </div>

        {/* Posts only (mobile) */}
        <div className="px-3 mt-3">
          <Card className="border-border/60 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]">
            <CardContent className="p-0 rounded-b-xl overflow-hidden">
              <Tabs defaultValue="posts" className="w-full">
                <div className="px-3 sm:px-4 pt-3 sm:pt-4 sticky top-0 z-10 bg-card">
                  <TabsList className="grid w-full grid-cols-1 rounded-none border-b">
                    <TabsTrigger value="posts" className="flex items-center gap-2 h-10 sm:h-9">
                      <FileText className="h-4 w-4" /> Posts
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Posts */}
                <TabsContent value="posts">
                  <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
                    {profileData.posts?.length ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                        {profileData.posts.map((post) => (
                          <motion.div
                            key={post.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.25 }}
                          >
                            <Card className="border-border/60 hover:shadow-lg transition group">
                              <CardContent className="p-4 space-y-3">
                                <p className="leading-relaxed line-clamp-5 whitespace-pre-wrap">
                                  {post.content}
                                </p>

                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span>{post.timestamp}</span>
                                  <div className="flex items-center gap-4">
                                    <span className="inline-flex items-center gap-1" />
                                    <span className="inline-flex items-center gap-1" />
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                  <Button size="sm" onClick={() => onViewPost(post.id)}>
                                    View Post
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => onSharePost(post.id)}
                                    className="gap-2"
                                    title="Share link"
                                  >
                                    <Share2 className="h-4 w-4" />
                                    Share
                                  </Button>
                                  <Button asChild size="sm" variant="ghost" className="ml-auto hidden md:inline-flex">
                                    <Link to={postLink(post.id)} target="_blank" rel="noopener noreferrer">
                                      Open in new tab
                                    </Link>
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          </motion.div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-2">
                        <EmptyState
                          title="No posts yet"
                          subtitle={isOwnProfile ? "Create your first post from the Posts page." : "Posts will show up here when available."}
                        />
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ================= DESKTOP ================= */}
      <div className="hidden lg:block">
        {/* HEADER: avatar + name + actions (desktop) */}
        <div className="relative z-10 max-w-6xl mx-auto px-3 sm:px-4">
          <div
            className="
              -mt-10 sm:-mt-16 md:-mt-20 lg:-mt-24
              flex flex-col sm:flex-row sm:items-end gap-3 sm:gap-4
            "
          >
            {/* Avatar (now circular) */}
            <div className="relative self-start">
              <button
                type="button"
                onClick={isOwnerActive ? openAvatarDialog : undefined}
                title={isOwnerActive ? "Change profile picture" : undefined}
                className="
                  group
                  w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32
                  rounded-full overflow-hidden border bg-background grid place-items-center
                  shadow-xl
                "
              >
                {profileData.avatarUrl ? (
                  <>
                    <img
                      src={profileData.avatarUrl}
                      alt={`${profileData.displayName}'s avatar`}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    {isOwnerActive && (
                      <div className="absolute inset-0 bg-black/40 text-white text-xs opacity-0 group-hover:opacity-100 grid place-items-center">
                        <span className="flex items-center gap-1"><Camera size={14}/> Change</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="w-full h-full bg-primary/10 text-primary font-bold text-xl grid place-items-center">
                    {initials}
                  </div>
                )}
              </button>
            </div>

            {/* Name + actions */}
            <div className="flex-1 pb-1 sm:pb-2">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-3">
                <div>
                  <h1
                    className="text-[22px] sm:text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-2"
                  >
                    {profileData.displayName}
                    <Sparkles className="h-5 w-5" aria-hidden />
                  </h1>

                  {/* current title badge */}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {currentTitle ? (
                      <TitleBadge title={currentTitle} />
                    ) : (
                      <span className="text-xs text-muted-foreground">No title equipped</span>
                    )}
                    {isOwnerActive && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-6 px-2"
                        onClick={openTitleDialog}
                        disabled={authed === false}
                        title={authed === false ? "Sign in to change your title" : undefined}
                      >
                        <Crown className="h-3.5 w-3.5 mr-1" /> Change title
                      </Button>
                    )}
                  </div>

                  {/* handle + trust */}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                    <button
                      className="inline-flex items-center gap-1 hover:text-foreground transition"
                      onClick={onCopyHandle}
                      title="Copy handle"
                    >
                      @{profileData.username}
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <span className="inline-flex items-center gap-1 text-xs md:text-sm">
                      <ShieldCheck className="h-3.5 w-3.5" /> Trusted Member
                    </span>
                  </div>
                </div>

                {/* actions */}
                <div className="flex flex-wrap gap-2">
                  {!isOwnProfile ? (
                    <>
                      {/* Friend: solid rectangular */}
                      {rel.isFriend ? (
                        <Button disabled className="gap-2 font-semibold bg-emerald-600 hover:bg-emerald-600 text-white">
                          <Check className="h-4 w-4" /> Friends
                        </Button>
                      ) : rel.isPending ? (
                        <Button disabled className="gap-2 font-semibold bg-emerald-600/80 text-white">
                          <Check className="h-4 w-4" /> Requested
                        </Button>
                      ) : (
                        <Button onClick={onAddFriend} className="gap-2 font-semibold">
                          <UserPlus className="h-4 w-4" /> Add Friend
                        </Button>
                      )}

                      {/* Follow: outline rounded-full dashed */}
                      {followRel === "following" || followRel === "mutual" ? (
                        <Button variant="outline" className="gap-2 rounded-full border-dashed" onClick={onUnfollow} disabled={authed !== true}>
                          <UserCheck className="h-4 w-4" /> Following
                        </Button>
                      ) : followRel === "requested_outgoing" ? (
                        <Button disabled variant="outline" className="gap-2 rounded-full border-dashed opacity-70">
                          <Users className="h-4 w-4" /> Requested
                        </Button>
                      ) : (
                        <Button variant="outline" className="gap-2 rounded-full border-dashed" onClick={onFollow} disabled={authed !== true}>
                          <Users className="h-4 w-4" /> Follow
                        </Button>
                      )}

                      <Button variant="secondary" className="gap-2" onClick={onMessage}>
                        <MessageCircle className="h-4 w-4" /> Message
                      </Button>
                    </>
                  ) : isOwnerActive ? (
                    <>
                      <Button className="gap-2" onClick={openSettings}>
                        <SettingsIcon className="h-4 w-4" /> Edit Profile
                      </Button>
                      <Button variant="secondary" className="gap-2" onClick={openCoverDialog} aria-label="Edit cover">
                        <Camera className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Highlights rail (desktop) */}
        <div className="max-w-6xl mx-auto px-3 sm:px-4 mt-3">
          <HighlightsRail
            highlights={highlights}
            isOwner={isOwnerActive}
            onOpen={onOpenHighlight}
            onCreate={onCreateHighlight}
          />
        </div>

        {/* BODY */}
        <div
          className="
            max-w-6xl mx-auto
            px-3 sm:px-4
            pt-2 sm:pt-4
            pb-[max(2.5rem,env(safe-area-inset-bottom))]
            grid grid-cols-1 lg:grid-cols-12
            gap-4 sm:gap-6
          "
        >
          {/* LEFT: Summary / Stats */}
          <div className="lg:col-span-4">
            <Card className="border-border/60 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)] lg:sticky lg:top-4">
              <CardContent className="p-4 sm:p-5">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <PillStat number={profileData.postsCount} label="Posts" />
                  <button
                    type="button"
                    onClick={openFollowersDialog}
                    className="rounded-2xl border bg-card p-3 sm:p-4 text-center shadow-sm hover:shadow-md transition focus:outline-none focus:ring-2 focus:ring-primary/30"
                    title="View followers"
                  >
                    <div className="text-xl sm:text-2xl font-extrabold tracking-tight">
                      {followerCount}
                    </div>
                    <div className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground mt-1">
                      Followers
                    </div>
                  </button>
                  <PillStat number={profileData.friendsCount} label="Friends" />
                </div>

                <Separator className="my-5" />

                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Display name</span>
                    <span className="font-medium">{profileData.displayName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Username</span>
                    <span className="font-mono">@{profileData.username}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Joined</span>
                    <span className="font-medium" title={joinedFull}>
                      {joinedCasual}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Title</span>
                    <span className="flex items-center gap-2">
                      {currentTitle ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-muted">
                          <Award className="h-3.5 w-3.5" />
                          {currentTitle.label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">None</span>
                      )}
                      {isOwnerActive && (
                        <Button size="sm" variant="ghost" onClick={openTitleDialog}>
                          Change
                        </Button>
                      )}
                    </span>
                  </div>
                </div>

                <Separator className="my-5" />

                <div className="flex items-center justify-between gap-2">
                  {isOwnProfile ? (
                    <>
                      <Button
                        variant={viewAsVisitor ? "default" : "secondary"}
                        className="w-1/2"
                        onClick={() => setViewAsVisitor((v) => !v)}
                        title={viewAsVisitor ? "Return to your normal view" : "Preview how others see your profile"}
                      >
                        {viewAsVisitor ? "Exit visitor view" : "View as visitor"}
                      </Button>
                      <Button
                        variant="secondary"
                        className="w-1/2 gap-2"
                        onClick={async () => {
                          const url = `${window.location.origin}${profilePath}`;
                          try {
                            if (navigator.share) {
                              await navigator.share({ title: profileData.displayName, url });
                              return;
                            }
                          } catch {}
                          try {
                            await navigator.clipboard.writeText(url);
                            alert("Profile link copied!");
                          } catch {
                            alert(url);
                          }
                        }}
                      >
                        <Share2 className="h-4 w-4" /> Share
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      className="w-full gap-2"
                      onClick={async () => {
                        const url = `${window.location.origin}${profilePath}`;
                        try {
                          if (navigator.share) {
                            await navigator.share({ title: profileData.displayName, url });
                            return;
                          }
                        } catch {}
                        try {
                          await navigator.clipboard.writeText(url);
                          alert("Profile link copied!");
                        } catch {
                          alert(url);
                        }
                      }}
                    >
                      <Share2 className="h-4 w-4" /> Share
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="h-4" />

            {/* Streaks */}
            <StreaksCard
              streaks={streaks}
              loading={streaksLoading}
              error={streaksError}
              onRetry={() => void loadStreaksForProfile()}
              isSelf={isOwnProfile}
            />
          </div>

          {/* RIGHT: Content */}
          <div className="lg:col-span-8">
            <Card className="border-border/60 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]">
              <CardContent className="p-0 rounded-b-xl overflow-hidden">
                <Tabs defaultValue="posts" className="w-full">
                  <div className="px-3 sm:px-4 pt-3 sm:pt-4 sticky top-0 z-10 bg-card">
                    <TabsList className="grid w-full grid-cols-1 rounded-none border-b">
                      <TabsTrigger value="posts" className="flex items-center gap-2 h-10 sm:h-9">
                        <FileText className="h-4 w-4" /> Posts
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  {/* Posts */}
                  <TabsContent value="posts">
                    <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
                      {profileData.posts?.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                          {profileData.posts.map((post) => (
                            <motion.div
                              key={post.id}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.25 }}
                            >
                              <Card className="border-border/60 hover:shadow-lg transition group">
                                <CardContent className="p-4 space-y-3">
                                  <p className="leading-relaxed line-clamp-5 whitespace-pre-wrap">
                                    {post.content}
                                  </p>

                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{post.timestamp}</span>
                                    <div className="flex items-center gap-4">
                                      <span className="inline-flex items-center gap-1" />
                                      <span className="inline-flex items-center gap-1" />
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 pt-1">
                                    <Button size="sm" onClick={() => onViewPost(post.id)}>
                                      View Post
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => onSharePost(post.id)}
                                      className="gap-2"
                                      title="Share link"
                                    >
                                      <Share2 className="h-4 w-4" />
                                      Share
                                    </Button>
                                    <Button asChild size="sm" variant="ghost" className="ml-auto hidden md:inline-flex">
                                      <Link to={postLink(post.id)} target="_blank" rel="noopener noreferrer">
                                        Open in new tab
                                      </Link>
                                    </Button>
                                  </div>
                                </CardContent>
                              </Card>
                            </motion.div>
                          ))}
                        </div>
                      ) : (
                        <div className="p-2">
                          <EmptyState
                            title="No posts yet"
                            subtitle={isOwnProfile ? "Create your first post from the Posts page." : "Posts will show up here when available."}
                          />
                        </div>
                      )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Avatar Dialog (with cropping) */}
      <Dialog open={avatarOpen} onOpenChange={(o) => (avatarBusy ? null : setAvatarOpen(o))}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader className="relative">
            <DialogTitle>Change Profile Picture</DialogTitle>
            <DialogClose
              className="absolute right-3 top-3 rounded-full p-1 hover:bg-muted"
              aria-label="Close"
              disabled={avatarBusy}
            >
              <X className="w-4 h-4" />
            </DialogClose>
          </DialogHeader>

          <div className="space-y-4">
            {/* Preview row */}
            {!avatarCropping && (
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-full overflow-hidden border flex items-center justify-center bg-muted">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="preview" className="w-full h-full object-cover" />
                  ) : profileData?.avatarUrl ? (
                    <img src={profileData.avatarUrl} alt="current avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl font-semibold text-muted-foreground">{initials}</span>
                  )}
                </div>

                <div className="flex-1">
                  <Input type="file" accept="image/*" onChange={onPickAvatar} disabled={avatarBusy} />
                  <p className="text-xs text-muted-foreground mt-1">JPG/PNG/WebP/GIF up to ~5MB.</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button onClick={saveAvatar} disabled={!avatarFile || avatarBusy}>
                      {avatarBusy ? "Saving…" : "Upload (no crop)"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setAvatarCropping(true)}
                      disabled={avatarBusy || !avatarPreview}
                    >
                      Crop to square
                    </Button>
                    {profileData?.avatarUrl && (
                      <Button variant="destructive" onClick={removeAvatar} disabled={avatarBusy}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Cropping UI */}
            {avatarCropping && avatarPreview && (
              <div className="rounded-xl border overflow-hidden">
                <div className="relative w-full h-[320px] bg-black/60">
                  <Cropper
                    image={avatarPreview}
                    crop={avatarCrop}
                    zoom={avatarZoom}
                    aspect={AVATAR_ASPECT}
                    onCropChange={setAvatarCrop}
                    onZoomChange={setAvatarZoom}
                    onCropComplete={onAvatarCropComplete}
                    cropShape="round"
                    showGrid={false}
                  />
                </div>

                <div className="p-3 flex items-center gap-3">
                  <Label className="whitespace-nowrap">Zoom</Label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={avatarZoom}
                    onChange={(e) => setAvatarZoom(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="ml-auto flex gap-2">
                    <Button variant="secondary" onClick={() => setAvatarCropping(false)} disabled={avatarBusy}>
                      Cancel
                    </Button>
                    <Button onClick={onSaveAvatarCropped} disabled={avatarBusy}>
                      {avatarBusy ? "Saving…" : "Save crop"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={closeAvatarDialog} disabled={avatarBusy}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cover Dialog (now scrollable on mobile + top-right close) */}
      <Dialog open={coverOpen} onOpenChange={(o) => (coverBusy ? null : setCoverOpen(o))}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader className="relative">
            <DialogTitle>Customize Cover</DialogTitle>
            <DialogClose
              className="absolute right-3 top-3 rounded-full p-1 hover:bg-muted"
              aria-label="Close"
              disabled={coverBusy}
            >
              <X className="w-4 h-4" />
            </DialogClose>
          </DialogHeader>

          <div className="space-y-6">
            {/* Color */}
            <section className="space-y-2">
              <Label>Background color</Label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="color"
                  value={bgColorInput}
                  onChange={(e) => setBgColorInput(e.target.value)}
                  className="h-10 w-14 rounded border"
                  aria-label="Pick background color"
                />
                <Input
                  value={bgColorInput}
                  onChange={(e) => setBgColorInput(e.target.value)}
                  placeholder="#111827"
                />
                <Button onClick={saveBgColor} disabled={coverBusy}>Save color</Button>
                <Button variant="ghost" onClick={clearBgColor} disabled={coverBusy}>Clear color</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Accepts hex like <code>#111827</code>, <code>#fff</code>. Use <b>Clear color</b> to remove.
              </p>
            </section>

            <Separator />

            {/* External URL */}
            <section className="space-y-2">
              <Label>Image URL (optional)</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  value={bgUrlInput}
                  onChange={(e) => setBgUrlInput(e.target.value)}
                  placeholder="https://example.com/cover.jpg"
                />
                <Button onClick={saveBgUrl} disabled={coverBusy}>Save URL</Button>
                <Button variant="ghost" onClick={clearBgUrl} disabled={coverBusy}>Clear URL</Button>
              </div>
              <p className="text-xs text-muted-foreground">
                When a URL is set, the DB image (if any) is cleared and the cover will load from that URL.
              </p>
            </section>

            <Separator />

            {/* Upload + Cropper */}
            <section className="space-y-2">
              <Label>Upload image</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Input type="file" accept="image/*" onChange={onPickBgImage} disabled={coverBusy} />
                <Button onClick={uploadBgImage} disabled={coverBusy || !bgImageFile || cropping}>
                  Upload (no crop)
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setCropping(true)}
                  disabled={coverBusy || !bgImagePreview}
                >
                  Crop to fit
                </Button>
              </div>

              {bgImagePreview && !cropping && (
                <div className="mt-2">
                  <img src={bgImagePreview} alt="cover preview" className="h-28 w-full max-w-md object-cover rounded-md border" />
                </div>
              )}

              {cropping && bgImagePreview && (
                <div className="mt-3 rounded-xl border overflow-hidden">
                  <div className="relative w-full h-[280px] sm:h-[340px] bg-black/60">
                    <Cropper
                      image={bgImagePreview}
                      crop={crop}
                      zoom={zoom}
                      aspect={COVER_ASPECT}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={onCropComplete}
                      cropShape="rect"
                      showGrid={false}
                    />
                  </div>

                  <div className="p-3 flex items-center gap-3">
                    <Label className="whitespace-nowrap">Zoom</Label>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="w-full"
                    />
                    <div className="ml-auto flex gap-2">
                      <Button variant="secondary" onClick={() => setCropping(false)} disabled={coverBusy}>
                        Cancel
                      </Button>
                      <Button onClick={onSaveCropped} disabled={coverBusy}>
                        {coverBusy ? "Saving…" : "Save crop"}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Tip: use <b>Crop to fit</b> so the cover matches the frame and never letterboxes.
              </p>
            </section>

            <Separator />

            {/* Danger zone */}
            <section className="space-y-2">
              <Label>Danger zone</Label>
              <div className="flex flex-wrap items-center gap-3">
                {bg?.hasImage && (
                  <Button variant="destructive" onClick={removeBgImage} disabled={coverBusy}>
                    Remove image only
                  </Button>
                )}
                <Button variant="destructive" onClick={clearAllBackground} disabled={coverBusy}>
                  Reset to default (remove color, URL & image)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                This fully resets your cover to the app’s default background.
              </p>
            </section>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={closeCoverDialog} disabled={coverBusy}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>User Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Display Name */}
            <section className="space-y-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayNameInput}
                onChange={(e) => setDisplayNameInput(e.target.value)}
                placeholder="Your display name"
              />
              <p className="text-xs text-muted-foreground">
                Minimum 1 characters. This is how others will see you.
              </p>
            </section>

            <Separator />

            {/* Password */}
            <section className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-2 md:col-span-1">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 8 characters"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat new password"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                You can only change your password once every 7 days.
              </p>
            </section>
          </div>

          <DialogFooter className="gap-3 flex-col sm:flex-row sm:items-center sm:justify-end">
            <div className="text-xs text-muted-foreground mr-auto h-4">
              {saveHint}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={closeSettings} disabled={settingsBusy}>
                Cancel
              </Button>
              <Button onClick={onSaveSettings} disabled={!canSaveAccount}>
                {settingsBusy ? "Saving…" : "Save Changes"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Cooldown Dialog */}
      <Dialog open={cooldownOpen} onOpenChange={setCooldownOpen}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Password change is on cooldown</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You can only change your password once every <span className="font-medium">7 days</span>.
            {cooldownUntil && (
              <>
                {" "}You can change it again on{" "}
                <span className="font-medium">
                  {cooldownUntil.toLocaleString()}
                </span>.
              </>
            )}
          </p>
          <DialogFooter>
            <Button onClick={() => setCooldownOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Title Change Dialog */}
      <Dialog open={titleOpen} onOpenChange={(o) => (titleBusy ? null : setTitleOpen(o))}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Choose your title</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {titlesLoading && !ownedTitles.length && (
              <p className="text-sm text-muted-foreground">Loading your titles…</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectableTitleCard
                title={null}
                selected={selectedTitleId === null}
                onSelect={() => setSelectedTitleId(null)}
              />

              {ownedTitles.map((t) => (
                <SelectableTitleCard
                  key={t.id}
                  title={t}
                  selected={selectedTitleId === t.id}
                  onSelect={() => setSelectedTitleId(t.id)}
                />
              ))}
            </div>

            {!ownedTitles.length && isOwnProfile && authed === true && !titlesLoading && (
              <p className="text-sm text-muted-foreground">
                You don’t have any titles yet. Earn titles by keeping streaks going!
              </p>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="secondary" onClick={closeTitleDialog} disabled={titleBusy}>
              Cancel
            </Button>
            <Button
              onClick={onSaveTitle}
              disabled={titleBusy || titlesLoading || authed !== true || !isOwnerActive}
            >
              {titleBusy ? "Saving…" : "Save Title"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Followers Dialog (NEW) */}
      <Dialog open={followersOpen} onOpenChange={setFollowersOpen}>
        <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-hidden">
          <DialogHeader className="relative">
            <DialogTitle>Followers ({followersTotal})</DialogTitle>
            <DialogClose className="absolute right-3 top-3 rounded-full p-1 hover:bg-muted" aria-label="Close">
              <X className="w-4 h-4" />
            </DialogClose>
          </DialogHeader>

          <div className="border rounded-xl overflow-hidden">
            <div className="max-h-[54vh] overflow-y-auto">
              {followersItems.length === 0 && !followersLoading ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  {isOwnProfile
                    ? "No one is following you yet."
                    : "No followers to show."}
                </div>
              ) : (
                <ul className="divide-y">
                  {followersItems.map((u) => (
                    <li key={u.id} className="flex items-center gap-3 p-3">
                      <Link
                        to={`/profile/${encodeURIComponent(u.username)}`}
                        className="shrink-0"
                        onClick={() => setFollowersOpen(false)}
                        title={u.display_name}
                      >
                        <div className="w-10 h-10 rounded-full border overflow-hidden bg-muted grid place-items-center">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-xs font-semibold">
                              {(u.display_name || u.username).slice(0,2).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </Link>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-tight truncate">{u.display_name || u.username}</div>
                        <div className="text-xs text-muted-foreground truncate">@{u.username}</div>
                      </div>
                      <div className="ml-auto">
                        <Link
                          to={`/profile/${encodeURIComponent(u.username)}`}
                          className="text-xs underline underline-offset-2"
                          onClick={() => setFollowersOpen(false)}
                        >
                          View
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-3 border-t flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {followersItems.length} / {followersTotal}
              </div>
              {followersHasMore ? (
                <Button size="sm" onClick={loadMoreFollowers} disabled={followersLoading}>
                  {followersLoading ? "Loading…" : "Load more"}
                </Button>
              ) : (
                <div className="text-xs text-muted-foreground">End of list</div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** ---------- Small presentational bits ---------- */
function StoryAvatar({
  src,
  initials,
  hasUnseen,
  onClick,
  onChangePhoto,
  showChangeBtn,
}: {
  src?: string | null;
  initials: string;
  hasUnseen?: boolean;
  onClick?: () => void;
  onChangePhoto?: () => void;
  showChangeBtn?: boolean;
}) {
  return (
    <div className="relative w-20 h-20">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "relative w-20 h-20 rounded-full p-[2px]",
          hasUnseen
            ? "bg-gradient-to-tr from-pink-500 via-fuchsia-500 to-amber-400"
            : "bg-transparent"
        )}
        aria-label="Open story"
      >
        <div className="w-full h-full rounded-full bg-background grid place-items-center overflow-hidden">
          {src ? (
            <img src={src} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-primary/10 text-primary font-bold text-xl grid place-items-center">
              {initials}
            </div>
          )}
        </div>
      </button>

      {showChangeBtn && (
        <button
          type="button"
          onClick={onChangePhoto}
          aria-label="Change profile picture"
          className="absolute -bottom-1 -right-1 rounded-full p-1.5 bg-black text-white shadow ring-1 ring-white/10"
          title="Change profile picture"
        >
          <Camera className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function HighlightsRail({
  highlights,
  isOwner,
  onOpen,
  onCreate,
}: {
  highlights: Highlight[];
  isOwner: boolean;
  onOpen: (h: Highlight) => void;
  onCreate: () => void;
}) {
  if (!isOwner && !highlights.length) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-3 overflow-x-auto py-2">
        {isOwner && (
          <button
            type="button"
            onClick={onCreate}
            className="flex flex-col items-center gap-1"
          >
            <span className="w-[58px] h-[58px] rounded-full border grid place-items-center">
              <Plus className="w-5 h-5" />
            </span>
            <span className="text-[11px] text-muted-foreground">New</span>
          </button>
        )}

        {highlights.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => onOpen(h)}
            className="flex flex-col items-center gap-1"
            title={h.title}
          >
            <span className="w-[58px] h-[58px] rounded-full border overflow-hidden bg-muted">
              {h.coverUrl ? (
                <img src={h.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : null}
            </span>
            <span className="max-w-[68px] truncate text-[11px]">{h.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PillStat({ number, label }: { number: number; label: string }) {
  return (
    <div className="rounded-2xl border bg-card p-3 sm:p-4 text-center shadow-sm hover:shadow-md transition">
      <div className="text-xl sm:text-2xl font-extrabold tracking-tight">{number}</div>
      <div className="text-[11px] sm:text-xs uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="p-8 text-center">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}

function TitleBadge({ title }: { title: Title }) {
  // keep the rarity ring like before
  const rarityRing: Record<NonNullable<Title["rarity"]>, string> = {
    common: "ring-muted",
    rare: "ring-blue-400/50",
    epic: "ring-purple-400/50",
    legendary: "ring-amber-400/60",
  };
  const rarity = title.rarity ?? "common";
  const ringCls = rarityRing[rarity];

  // glow color comes from rarity (not title.color)
  const glowHex = rarityGlowHex[rarity];
  const baseBg = title.color ? { backgroundColor: title.color } : undefined;

  const badgeStyle: CSSProperties = {
    ...baseBg,
    color: "#fff",
    ...glowStyleFromHex(glowHex),
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold",
        "bg-muted ring-1",
        ringCls
      )}
      style={badgeStyle}
      title={title.description || undefined}
    >
      <Award className="h-3.5 w-3.5" />
      {title.label}
    </span>
  );
}

function SelectableTitleCard({
  title,
  selected,
  onSelect,
}: {
  title: Title | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = title ? title.label : "None";
  const description = title?.description || (title ? "" : "Show no title on your profile");
  const rarity = title?.rarity || "common";

  const rarityAccent: Record<string, string> = {
    common: "border-muted",
    rare: "border-blue-400/50",
    epic: "border-purple-400/50",
    legendary: "border-amber-400/60",
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-left rounded-xl border p-3 hover:shadow-md transition bg-card",
        selected ? "ring-2 ring-primary" : "ring-0",
        rarityAccent[rarity] ?? "border-muted"
      )}
    >
      <div className="flex items-center gap-2">
        <Crown className="h-4 w-4" />
        <div className="font-medium">{label}</div>
      </div>
      {description ? (
        <div className="text-xs text-muted-foreground mt-1">{description}</div>
      ) : null}
    </button>
  );
}

/* ---------- Streaks Card (compact-aware) ---------- */
function StreaksCard({
  streaks,
  loading,
  error,
  onRetry,
  isSelf,
  compact = false,
}: {
  streaks: Streak[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  isSelf: boolean;
  /** when true, show a very small row (mobile) */
  compact?: boolean;
}) {
  const order: StreakType[] = ["post", "study", "groupMessage"];
  const iconBy: Record<StreakType, ComponentType<{ className?: string }>> = {
    post: FileText,
    study: BookOpen,
    groupMessage: MessageCircle,
  };
  const titleBy: Record<StreakType, string> = {
    post: "Post",
    study: "Study",
    groupMessage: "Group",
  };
  const fmtDays = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

  if (compact) {
    return (
      <Card className="border-border/60 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]">
        <CardContent className="p-3">
          {loading ? (
            <div className="flex items-center gap-3">
              {[0,1,2].map(i => (
                <div key={i} className="h-4 w-14 bg-muted rounded animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{error}</span>
              <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
            </div>
          ) : !streaks?.length ? (
            <p className="text-xs text-muted-foreground">
              {isSelf ? "No streaks yet." : "No public streaks."}
            </p>
          ) : (
            <div className="flex items-center justify-between">
              {order.map((t) => {
                const s = streaks.find((x) => x.type === t)!;
                const Icon = iconBy[t];
                return (
                  <div key={t} className="inline-flex items-center gap-1 text-sm">
                    <Icon className="h-4 w-4" />
                    <span className="font-semibold">{s.current_count}</span>
                    <span className="text-xs text-muted-foreground">d</span>
                    <span className="sr-only">{titleBy[t]} streak</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full (desktop / non-compact)
  return (
    <Card className="border-border/60 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]">
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Streaks</div>
          {error && (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[0,1,2].map((i) => (
              <div key={i} className="rounded-xl border p-4">
                <div className="h-4 w-24 bg-muted rounded mb-2 animate-pulse" />
                <div className="h-3 w-28 bg-muted rounded animate-pulse" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : !streaks?.length ? (
          <p className="text-sm text-muted-foreground">
            {isSelf ? "No streaks yet — do one action today to start a streak." : "No public streaks to show."}
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {order.map((t) => {
              const s = streaks.find((x) => x.type === t)!;
              const Icon = iconBy[t];
              return (
                <div key={t} className="rounded-xl border p-4 text-center">
                  <div className="inline-flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4" />
                    {titleBy[t]}
                  </div>
                  <div className="mt-1 text-2xl font-extrabold tracking-tight">
                    {s.current_count}
                    <span className="ml-1 text-sm font-medium">days</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Best: {fmtDays(s.longest_count)}{s.todayActive ? " • Today ✓" : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
