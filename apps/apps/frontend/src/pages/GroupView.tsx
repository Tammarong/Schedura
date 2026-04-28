// src/pages/GroupView.tsx
import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState, useContext } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Users,
  Settings,
  Send,
  Smile,
  Hash,
  Crown,
  Shield,
  MapPin,
  Copy,
  Trash2,
  Edit3,
  LogOut,
  UserMinus,
  Check,
  X,
  Image as ImageIcon,
  LogIn,
  Flame,
} from "lucide-react";
import { api, getToken, SOCKET_URL } from "@/lib/api";
import { AuthContext } from "@/context/AuthContext";

/* ---------------- Types ---------------- */
interface Group {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  owner_id: number;
  created_at: string;
  code?: string;
}
interface Member {
  id: number;
  username: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  isOnline: boolean;
  avatarUrl?: string | null;
}
interface Sender {
  id: number;
  username: string;
  display_name: string;
  avatarUrl?: string | null;
}
interface Message {
  id: number;
  content: string;
  created_at: string;
  sender: Sender;
  receiver?: Sender | null;
  pictures?: string[];
}
interface ReadReceipt {
  userId: number;
  displayName: string;
  avatarUrl?: string | null;
}

type Me = { id: number; username: string } | null;
type JwtMaybe = { id?: number; user_id?: number; userId?: number; username?: string };

/* ---------------- Small bits ---------------- */
function roleBadge(role: Member["role"]) {
  if (role === "owner")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 border border-yellow-200">
        <Crown className="h-3 w-3" /> Owner
      </span>
    );
  if (role === "admin")
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
        <Shield className="h-3 w-3" /> Admin
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
      Member
    </span>
  );
}
function timeShort(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function decodeJwtId(token: string | null): number | null {
  if (!token) return null;
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as JwtMaybe;
    const id =
      (typeof json.id === "number" && json.id) ||
      (typeof json.user_id === "number" && json.user_id) ||
      (typeof json.userId === "number" && json.userId) ||
      null;
    return typeof id === "number" ? id : null;
  } catch {
    return null;
  }
}

// id-based upsert for messages
function upsertMessageById(list: Message[], incoming: Message): Message[] {
  const i = list.findIndex(m => m.id === incoming.id);
  if (i === -1) return [...list, incoming];
  const merged: Message = { ...list[i], ...incoming, sender: { ...list[i].sender, ...incoming.sender } };
  const next = list.slice();
  next[i] = merged;
  return next;
}

// 🔽 helpers for avatar fetching/caching
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
const avatarCacheRefInit = () => new Map<number, string | null>();

/* ---------------- Reusable Avatar ---------------- */
function AvatarCircle({
  name,
  username,
  avatarUrl,
  size = 36,
  title,
  className,
}: {
  name?: string;
  username?: string;
  avatarUrl?: string | null;
  size?: number;
  title?: string;
  className?: string;
}) {
  const initials = (name?.trim() || username || "?").charAt(0).toUpperCase() || "?";
  const s = `${size}px`;
  const [err, setErr] = useState(false);
  const showImage = !!avatarUrl && !err;

  return (
    <div
      className={`relative rounded-full overflow-hidden ${className ?? ""}`}
      style={{ width: s, height: s }}
      title={title}
    >
      {showImage ? (
        <img
          src={avatarUrl as string}
          alt={name || username || "member"}
          className="rounded-full object-cover border w-full h-full"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="rounded-full border w-full h-full bg-secondary text-foreground flex items-center justify-center">
          <span className="text-xs font-semibold">{initials}</span>
        </div>
      )}
    </div>
  );
}

/* ---------------- Message bubble ---------------- */
const GroupChatMessage = ({
  message,
  currentUserId,
  showAvatar,
  onImageClick,
}: {
  message: Message;
  currentUserId?: number;
  showAvatar: boolean;
  onImageClick: (src: string) => void;
}) => {
  const sender = message.sender ?? { id: 0, username: "?", display_name: "Unknown", avatarUrl: null };
  const mine = !!currentUserId && sender.id === currentUserId;
  const profileHref = sender?.username ? `/profile/${encodeURIComponent(sender.username)}` : undefined;

  return (
    <div className={`flex items-start gap-2 ${mine ? "justify-end" : "justify-start"}`}>
      {!mine && showAvatar && (
        <div className="self-start mt-0.5">
          {profileHref ? (
            <Link to={profileHref} title={`View @${sender.username}`} className="inline-block">
              <AvatarCircle
                name={sender.display_name}
                username={sender.username}
                avatarUrl={sender.avatarUrl ?? null}
                size={32}
                title={sender.display_name}
                className="cursor-pointer hover:ring-2 ring-primary/40 transition"
              />
            </Link>
          ) : (
            <AvatarCircle
              name={sender.display_name}
              username={sender.username}
              avatarUrl={sender.avatarUrl ?? null}
              size={32}
              title={sender.display_name}
            />
          )}
        </div>
      )}

      <div className={`max-w-[80%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
        {!mine && (
          <div className="text-xs mb-1 text-muted-foreground font-medium">
            {sender.display_name}
          </div>
        )}
        <div
          className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
            mine
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-secondary text-foreground rounded-bl-md"
          }`}
        >
          {message.content}

          {Array.isArray(message.pictures) && message.pictures.length > 0 && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {message.pictures.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`attachment-${i}`}
                  className="rounded-lg max-h-48 w-full object-cover cursor-pointer"
                  onClick={() => onImageClick(src)}
                />
              ))}
            </div>
          )}
        </div>
        <div className={`text-[11px] mt-1 ${mine ? "text-primary/80 text-right" : "text-muted-foreground"}`}>
          {timeShort(message.created_at)}
        </div>
      </div>

      {mine && showAvatar && (
        <div className="self-start mt-0.5">
          {profileHref ? (
            <Link to={profileHref} title={`View @${sender.username}`} className="inline-block">
              <AvatarCircle
                name={sender.display_name}
                username={sender.username}
                avatarUrl={sender.avatarUrl ?? null}
                size={32}
                title={sender.display_name}
                className="cursor-pointer hover:ring-2 ring-primary/40 transition"
              />
            </Link>
          ) : (
            <AvatarCircle
              name={sender.display_name}
              username={sender.username}
              avatarUrl={sender.avatarUrl ?? null}
              size={32}
              title={sender.display_name}
            />
          )}
        </div>
      )}
    </div>
  );
};

/* ---------------- Read receipts row (count only, includes sender) ---------------- */
function ReadReceiptsRow({
  readers,
  senderId,
  alignRight = false,
}: {
  readers: ReadReceipt[];
  senderId?: number | null;
  alignRight?: boolean;
}) {
  const ids = new Set<number>();
  if (Array.isArray(readers)) {
    for (const r of readers) {
      if (typeof r.userId === "number") ids.add(r.userId);
    }
  }
  if (typeof senderId === "number") ids.add(senderId);
  const count = ids.size;

  if (count === 0) {
    return (
      <div className={`mt-1 flex items-center gap-2 ${alignRight ? "justify-end" : "justify-start"}`}>
        <span className="text-[12px] text-muted-foreground">Nobody has seen it yet.</span>
      </div>
    );
  }

  return (
    <div className={`mt-1 flex items-center gap-2 ${alignRight ? "justify-end" : "justify-start"}`}>
      <span className="text-[12px] text-muted-foreground">Seen by {count}</span>
    </div>
  );
}

/* ---------------- Emoji panel ---------------- */
const COMMON_EMOJI = [
  "😀","😄","😁","😆","😊","🙂","😉","😍","😘","😎",
  "🤩","🥳","🤔","🤗","😴","😪","😇","😭","😅","🤝",
  "👍","👎","🙏","👏","🔥","💯","✨","🎉","❤️","🫶",
  "😤","😮‍💨","🤤","😋","😜","🤪","😏","😬","🥹","😤",
];

function EmojiPopover({
  open,
  onPick,
  onClose,
  anchorRight = 0,
}: {
  open: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
  anchorRight?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!open) return;
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="absolute z-50 bottom-12 right-0 bg-popover border rounded-xl shadow-lg p-2 w-64"
      style={{ right: anchorRight }}
    >
      <div className="grid grid-cols-8 gap-1">
        {COMMON_EMOJI.map((e) => (
          <button
            key={e}
            className="h-8 w-8 rounded hover:bg-accent"
            onClick={() => {
              onPick(e);
              onClose();
            }}
            type="button"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------ Read-receipts normalizer (snake_case → camelCase) ------------ */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toNumberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function normalizeReaders(raw: unknown): ReadReceipt[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item: unknown): ReadReceipt | null => {
      if (!isRecord(item)) return null;

      const userId =
        toNumberOrNull(item.userId) ??
        toNumberOrNull(item.user_id) ??
        null;
      if (userId == null) return null;

      const displayName =
        toStringOrNull(item.displayName) ??
        toStringOrNull(item.display_name) ??
        toStringOrNull(item.username) ??
        "Unknown";

      const avatarUrl =
        toStringOrNull(item.avatarUrl) ??
        toStringOrNull(item.avatar_url) ??
        null;

      return { userId, displayName, avatarUrl };
    })
    .filter((x): x is ReadReceipt => x !== null);
}

/* ---------------- Page ---------------- */
export default function GroupView() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();

  const { user, loading: authLoading } = useContext(AuthContext);
  const optimisticId = useMemo<number | null>(() => decodeJwtId(getToken() ?? null), []);
  const [me, setMe] = useState<Me>(null);
  const [meLoading, setMeLoading] = useState<boolean>(true);

  // current user + avatar (derived)
  const [currentUserAvatar, setCurrentUserAvatar] = useState<string | null>(null);

  // effective auth view
  const effectiveUserId = useMemo<number | null>(() => {
    if (user && typeof user.id === "number") return user.id;
    if (me && typeof me.id === "number") return me.id;
    return optimisticId;
  }, [user, me, optimisticId]);
  const authed = effectiveUserId != null;

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [filter, setFilter] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Read receipts (latest only)
  const [latestReaders, setLatestReaders] = useState<ReadReceipt[]>([]);

  // Group-wide streak state (TikTok-like, one per day)
  const [streakCount, setStreakCount] = useState<number>(0);
  const [streakActiveToday, setStreakActiveToday] = useState<boolean>(false);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  function computeGroupStreakFromMessages(msgs: Message[]) {
    const daysWithMsgs = new Set<string>();
    for (const m of msgs) {
      const d = new Date(m.created_at);
      if (!Number.isNaN(d.getTime())) {
        daysWithMsgs.add(d.toISOString().slice(0, 10)); // YYYY-MM-DD (UTC)
      }
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    let count = 0;
    for (let i = 0; ; i++) {
      const dayStr = new Date(Date.now() - i * MS_PER_DAY).toISOString().slice(0, 10);
      if (daysWithMsgs.has(dayStr)) count++;
      else break;
    }
    return { count, activeToday: daysWithMsgs.has(todayStr) };
  }

  // --- NEW: once-per-day ping to DB for this group's user streak
  const lastGroupStreakPingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!groupId) return;
    try {
      lastGroupStreakPingRef.current = localStorage.getItem(`streakPing:${groupId}`) ?? null;
    } catch {
      lastGroupStreakPingRef.current = null;
    }
  }, [groupId]);

  const pingGroupMessageStreak = useCallback(async () => {
    if (!groupId || !authed) return;
    const todayUTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    if (lastGroupStreakPingRef.current === todayUTC) return; // already pinged today
    try {
      await api(`/streaks/groupMessage/ping`, {
        method: "POST",
        body: { groupId: Number(groupId) },
      });
      lastGroupStreakPingRef.current = todayUTC;
      try { localStorage.setItem(`streakPing:${groupId}`, todayUTC); } catch {}
    } catch {
      // swallow (we'll retry on next send)
    }
  }, [groupId, authed]);

  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const isOwner = !!(group && effectiveUserId && group.owner_id === effectiveUserId);
  const currentUserId = useMemo<number | null>(() => effectiveUserId, [effectiveUserId]);

  const filteredMembers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.username.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [filter, members]);

  // 🔽 avatar cache (per page instance)
  const avatarCacheRef = useRef<Map<number, string | null>>(avatarCacheRefInit());

  // 🔽 fetch avatar by userId with cache + graceful fallbacks
  const fetchAvatarByUserId = useCallback(async (userId: number): Promise<string | null> => {
    if (!Number.isFinite(userId)) return null;

    if (avatarCacheRef.current.has(userId)) {
      return avatarCacheRef.current.get(userId) ?? null;
    }

    let url: string | null = null;
    try {
      const a = await api<unknown>(`/avatar/${userId}`, { method: "GET" });
      if (isRecord(a) && isNonEmptyString(a.avatarUrl)) url = a.avatarUrl as string;
    } catch {
      // ignore and try fallback
    }

    if (!url) {
      try {
        const u = await api<unknown>(`/users/${userId}`, { method: "GET" });
        if (isRecord(u) && isNonEmptyString(u.avatarUrl)) url = u.avatarUrl as string;
        else if (isRecord(u) && isRecord(u.user) && isNonEmptyString(u.user.avatarUrl)) {
          url = u.user.avatarUrl as string;
        }
      } catch {
        // ignore
      }
    }

    avatarCacheRef.current.set(userId, url ?? null);
    return url ?? null;
  }, []);

  // 🔽 ensure a single message has sender avatar
  const ensureSenderAvatarOnMessage = useCallback(async (msg: Message): Promise<Message> => {
    const sid = msg?.sender?.id;
    if (!Number.isFinite(sid)) return msg;

    const existing =
      msg.sender.avatarUrl ??
      avatarCacheRef.current.get(sid!);

    if (isNonEmptyString(existing)) {
      return { ...msg, sender: { ...msg.sender, avatarUrl: existing } };
    }

    const fetched = await fetchAvatarByUserId(sid!);
    return { ...msg, sender: { ...msg.sender, avatarUrl: fetched ?? null } };
  }, [fetchAvatarByUserId]);

  // 🔽 ensure batch of messages have avatars
  const ensureAvatarsOnMessages = useCallback(async (msgs: Message[]) => {
    const next = await Promise.all(msgs.map(ensureSenderAvatarOnMessage));
    setMessages(next);
  }, [ensureSenderAvatarOnMessage]);

  // 🔽 ensure readers have avatars
  const ensureReadersAvatars = useCallback(async (readers: ReadReceipt[]) => {
    const enriched = await Promise.all(
      readers.map(async (r) => {
        if (!Number.isFinite(r.userId)) return r;
        if (isNonEmptyString(r.avatarUrl)) return r;

        const cached = avatarCacheRef.current.get(r.userId);
        if (cached !== undefined) return { ...r, avatarUrl: cached };

        const fetched = await fetchAvatarByUserId(r.userId);
        return { ...r, avatarUrl: fetched ?? null };
      })
    );
    setLatestReaders(enriched);
  }, [fetchAvatarByUserId]);

  /* ---------- auth probe (server canonical) ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setMeLoading(true);
        const m = await api<Me>("/users/current_user", { method: "GET" });
        if (!cancelled) setMe(m ?? null);
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- avatar (self) ---------- */
  useEffect(() => {
    (async () => {
      try {
        const a = await api<{ avatarUrl?: string | null }>("/avatar/me", { method: "GET" });
        setCurrentUserAvatar(a?.avatarUrl ?? null);
      } catch {
        setCurrentUserAvatar(null);
      }
    })();
  }, []);

  /* ---------- helpers: UI state ---------- */
  const isAtBottom = useCallback((): boolean => {
    const el = viewportRef.current;
    if (!el) return false;
    const threshold = 24;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
  }, []);

  /* ---------- helpers: receipts ---------- */
  const fetchReaders = useCallback(async (messageId: number) => {
    try {
      const data = await api<unknown>(`/messages/${messageId}/readers`, { method: "GET" });
      const normalized = normalizeReaders(data);
      setLatestReaders(normalized);
      // upgrade with avatars (async)
      ensureReadersAvatars(normalized);
    } catch {
      // ignore
    }
  }, [ensureReadersAvatars]);

  const markRead = useCallback(async (messageId: number) => {
    try {
      await api(`/messages/${messageId}/read`, { method: "POST" });
    } catch {
      // ignore
    }
  }, []);

  const markGroupEntered = useCallback(async (gid: number) => {
    try {
      await api(`/messages/group/${gid}/enter`, { method: "POST" });
    } catch {
      // ok if endpoint not present
    }
  }, []);

  /* ---------- data: page load ---------- */
  useEffect(() => {
    if (!groupId) return;
    (async () => {
      try {
        const [g, ms, msgs] = await Promise.all([
          api<Group>(`/groups/${groupId}`, { method: "GET" }),
          api<Member[]>(`/groups/${groupId}/members`, { method: "GET" }),
          api<Message[]>(`/messages/group/${groupId}`, { method: "GET" }),
        ]);

        const groupSafe = g ?? null;
        const membersSafe = Array.isArray(ms) ? ms : [];
        const messagesSafe = Array.isArray(msgs) ? msgs : [];

        // Seed cache with any sender avatars already present
        const avatarByUserId = new Map<number, string | null>();
        messagesSafe.forEach((m) => {
          if (m?.sender?.id) {
            avatarByUserId.set(m.sender.id, m.sender.avatarUrl ?? null);
          }
        });
        avatarByUserId.forEach((v, k) => avatarCacheRef.current.set(k, v));

        // Members from cache if missing
        const membersWithAvatar: Member[] = membersSafe.map((m) => ({
          ...m,
          avatarUrl: isNonEmptyString(m.avatarUrl) ? m.avatarUrl : (avatarCacheRef.current.get(m.id) ?? null),
        }));

        setGroup(groupSafe);
        setMembers(membersWithAvatar);

        // Ensure messages have avatars (fetches any missing)
        await ensureAvatarsOnMessages(messagesSafe);

        setLatestReaders([]);

        await markGroupEntered(Number(groupId));
      } catch (e) {
        console.error(e);
        setToast("Failed to load group.");
      } finally {
        setLoading(false);
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 0);
      }
    })();
  }, [groupId, markGroupEntered, ensureAvatarsOnMessages]);

  // Keep scrolled to bottom on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Manage local previews
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  const latestMessage = messages[messages.length - 1] as Message | undefined;
  const latestMine =
    latestMessage && currentUserId ? latestMessage.sender?.id === currentUserId : false;

  // Fetch & mark read for latest message
  useEffect(() => {
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    async function doWork() {
      if (!latestMessage?.id) return;

      await fetchReaders(latestMessage.id);
      if (!latestMine) {
        await markRead(latestMessage.id);
        let count = 0;
        pollTimer = setInterval(async () => {
          count += 1;
          await fetchReaders(latestMessage.id!);
          if (count >= 3 && pollTimer) {
            clearInterval(pollTimer);
          }
        }, 1500);
      }
    }

    void doWork();
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [latestMessage?.id, latestMine, currentUserId, fetchReaders, markRead]);

  /* ---------- recompute group streak whenever messages change ---------- */
  useEffect(() => {
    const { count, activeToday } = computeGroupStreakFromMessages(messages);
    setStreakCount(count);
    setStreakActiveToday(activeToday);
  }, [messages]);

  /* ---------- Socket.IO: connect + room ---------- */
  useEffect(() => {
    if (!groupId) return;

    const socket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.emit("group:join", { groupId: Number(groupId) });

    const onNewMessage = (msg: Message) => {
      // 1) upsert by server id so we never append duplicates
      setMessages(prev => upsertMessageById(prev, msg));

      // 2) ensure sender avatar (async) and re-upsert once fetched
      ensureSenderAvatarOnMessage(msg)
        .then((fixed) => {
          setMessages(prev => upsertMessageById(prev, fixed));

          // --- NEW: if this is *my* message, ensure we ping today's streak in DB
          if (currentUserId && fixed.sender?.id === currentUserId) {
            pingGroupMessageStreak();
          }

          const onScreen = document.visibilityState === "visible";
          if (onScreen && isAtBottom() && currentUserId && fixed.sender?.id !== currentUserId) {
            markRead(fixed.id)
              .then(() => fetchReaders(fixed.id).catch(() => void 0))
              .catch(() => void 0);
          }
        })
        .catch(() => void 0);
    };

    const onRead = (payload: { messageId: number; readers: unknown }) => {
      if (!latestMessage?.id) return;
      if (payload.messageId === latestMessage.id) {
        const normalized = normalizeReaders(payload.readers);
        // enrich avatars for readers
        ensureReadersAvatars(normalized);
      }
    };

    socket.on("group:new_message", onNewMessage);
    socket.on("message:read", onRead);

    return () => {
      socket.emit("group:leave", { groupId: Number(groupId) });
      socket.off("group:new_message", onNewMessage);
      socket.off("message:read", onRead);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [
    groupId,
    latestMessage?.id,
    currentUserId,
    isAtBottom,
    fetchReaders,
    markRead,
    ensureSenderAvatarOnMessage,
    ensureReadersAvatars,
    pingGroupMessageStreak, // NEW dep
  ]);

  /* ---------- UI events ---------- */
  function openFileDialog() {
    fileRef.current?.click();
  }

  function onFilesPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    if (picked.length === 0) return;
    setFiles((prev) => [...prev, ...picked].slice(0, 6));
    e.currentTarget.value = "";
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  function insertAtCursor(emoji: string) {
    const el = inputRef.current;
    if (!el) {
      setNewMessage((v) => v + emoji);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const updated = el.value.slice(0, start) + emoji + el.value.slice(end);
    setNewMessage(updated);
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + emoji.length;
      el.setSelectionRange(caret, caret);
    });
  }

  /* ---------- chat ---------- */
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId || !authed) return;
    if (!newMessage.trim() && files.length === 0) return;

    const contentToSend = newMessage.trim() || "📷";

    const pending: Message = {
      id: Math.random(),
      content: contentToSend,
      created_at: new Date().toISOString(),
      sender: {
        id: currentUserId ?? 0,
        username: me?.username ?? "me",
        display_name: me?.username ?? "Me",
        avatarUrl: currentUserAvatar ?? undefined,
      },
      pictures: previews.length ? [...previews] : undefined,
    };
    setMessages((p) => [...p, pending]);
    setNewMessage("");
    setEmojiOpen(false);
    setLatestReaders([]);
    try {
      const form = new FormData();
      form.append("content", contentToSend);
      form.append("group_id", String(groupId));
      files.forEach((file) => form.append("images", file));

      const real = await api<Message>("/messages", { method: "POST", body: form });
      if (real && typeof real.id === "number") {
        setMessages(prev => {
          const hasSocketReal = prev.some(m => m.id === real.id);
          if (hasSocketReal) {
            // socket already delivered the real message; drop our pending
            return prev.filter(m => m.id !== pending.id);
          }
          // socket hasn't delivered; replace the pending with the server copy
          return prev.map(m => (m.id === pending.id ? real : m));
        });

        // make sure our copy has avatar even if backend didn't include it
        ensureSenderAvatarOnMessage(real).then((fixed) => {
          setMessages(prev => upsertMessageById(prev, fixed));
        }).catch(() => void 0);

        // --- NEW: record today's groupMessage streak in DB
        await pingGroupMessageStreak();

        fetchReaders(real.id)
          .then(() => setLatestReaders(curr => { ensureReadersAvatars(curr); return curr; }))
          .catch(() => void 0);
      } else {
        throw new Error("send failed");
      }
    } catch {
      setToast("Failed to send message.");
      setMessages((p) => p.filter((m) => m.id !== pending.id));
    } finally {
      setFiles([]);
    }
  }

  /* ---------- management ---------- */
  async function saveGroupBasics(next: { name: string; description: string }) {
    if (!groupId || !authed) return;
    setSavingSettings(true);
    try {
      const updated = await api<Group>(`/groups/${groupId}`, {
        method: "PUT",
        body: next,
      });
      if (updated) {
        setGroup((g) => (g ? { ...g, ...next } : g));
        setToast("Group updated.");
      } else {
        throw new Error();
      }
    } catch {
      setToast("Failed to update group.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function removeMember(memberId: number) {
    if (!groupId || !authed) return;
    try {
      const ok = await api<{ success?: boolean; error?: string }>(`/groups/${groupId}/remove-member`, {
        method: "POST",
        body: { memberId },
      });
      if (!ok?.error) {
        setMembers((p) => p.filter((m) => m.id !== memberId));
        setToast("Member removed.");
      } else {
        throw new Error(ok.error);
      }
    } catch {
      setToast("Failed to remove member.");
    }
  }

  async function leaveGroup() {
    if (!groupId || !authed) return;
    try {
      const ok = await api<{ success?: boolean; error?: string }>(`/groups/${groupId}/leave`, {
        method: "POST",
      });
      if (!ok?.error) {
        setToast("You left the group.");
        setManageOpen(false);
        navigate("/groups");
      } else {
        throw new Error(ok.error);
      }
    } catch {
      setToast("Failed to leave group.");
    }
  }

  async function destroyGroup() {
    if (!groupId || !authed) return;
    if (!confirm("Really destroy this group? This cannot be undone.")) return;
    try {
      const ok = await api<{ success?: boolean; error?: string }>(`/groups/${groupId}`, {
        method: "DELETE",
      });
      if (!ok?.error) {
        setToast("Group destroyed.");
        setManageOpen(false);
        navigate("/groups");
      } else {
        throw new Error(ok.error);
      }
    } catch {
      setToast("Failed to destroy group.");
    }
  }

  /* ---------- auth gates ---------- */
  if (authLoading || meLoading || loading) {
    return <p className="p-6 text-muted-foreground">Loading group…</p>;
  }

  return (
    <div className="h-screen p-4 md:p-6 box-border">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
        className="max-w-7xl mx-auto h-full flex flex-col min-h-0"
      >
        {/* Header */}
        <div className="flex-none">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-4">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <Link to="/groups">
                <Button variant="secondary" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
              </Link>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold truncate">{group?.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {members.length} members
                  </span>
                  {group?.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {group.location}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="secondary"
                  className="gap-2 w-full sm:w-auto"
                  disabled={!authed}
                  title={!authed ? "Please log in" : undefined}
                >
                  <Settings className="h-4 w-4" />
                  Manage Group
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Manage Group</DialogTitle>
                </DialogHeader>

                <Tabs defaultValue="overview" className="mt-2">
                  <TabsList className={`w-full ${isOwner ? "grid grid-cols-4" : "grid grid-cols-1"}`}>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    {isOwner && <TabsTrigger value="members">Members</TabsTrigger>}
                    {isOwner && <TabsTrigger value="settings">Settings</TabsTrigger>}
                    {isOwner && <TabsTrigger value="danger">Danger Zone</TabsTrigger>}
                  </TabsList>

                  {/* Overview */}
                  <TabsContent value="overview" className="space-y-4 pt-4">
                    {isOwner ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Share / Join</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-3 text-sm">
                            <div className="space-y-1">
                              <div className="text-muted-foreground">Group Code</div>
                              <div className="flex items-center gap-2">
                                <Input readOnly value={group?.code || "—"} />
                                <Button
                                  variant="outline"
                                  className="gap-1"
                                  onClick={() => {
                                    if (group?.code) {
                                      navigator.clipboard.writeText(group.code);
                                      setToast("Copied group code.");
                                    }
                                  }}
                                >
                                  <Copy className="h-4 w-4" />
                                  Copy
                                </Button>
                              </div>
                            </div>
                            <Separator />
                            <div>
                              <div className="text-muted-foreground mb-1">Description</div>
                              <p className="text-sm">{group?.description || "No description yet."}</p>
                            </div>
                          </CardContent>
                        </Card>

                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Quick Actions</CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">
                              Settings and destructive actions are available in the tabs above.
                            </p>
                          </CardContent>
                        </Card>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-base">Do you wish to leave this group?</CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-col gap-2">
                            <Button
                              variant="destructive"
                              className="gap-2"
                              onClick={leaveGroup}
                              disabled={!authed}
                            >
                              <LogOut className="h-4 w-4" />
                              Leave Group
                            </Button>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </TabsContent>

                  {/* Members (Owner only) */}
                  {isOwner && (
                    <TabsContent value="members" className="space-y-4 pt-4">
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Filter by name, @handle, or role…"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </div>
                      <Card>
                        <CardContent className="pt-4">
                          <ScrollArea className="h-[320px] pr-2">
                            <div className="space-y-1">
                              {filteredMembers.map((m) => {
                                const isSelf = currentUserId === m.id;
                                return (
                                  <div
                                    key={m.id}
                                    className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                                  >
                                    <div className="flex items-center gap-3 min-w-0">
                                      <Link
                                        to={`/profile/${encodeURIComponent(m.username)}`}
                                        title={`View @${m.username}`}
                                        className="shrink-0"
                                      >
                                        <AvatarCircle
                                          name={m.displayName}
                                          username={m.username}
                                          avatarUrl={m.avatarUrl ?? undefined}
                                          size={36}
                                          title={m.displayName}
                                          className="cursor-pointer hover:ring-2 ring-primary/40 transition"
                                        />
                                      </Link>
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-sm font-medium truncate">{m.displayName}</span>
                                          {roleBadge(m.role)}
                                        </div>
                                        <div className="text-xs text-muted-foreground truncate">@{m.username}</div>
                                      </div>
                                    </div>
                                    {isOwner && !isSelf && (
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-8 w-8 p-0"
                                        onClick={() => removeMember(m.id)}
                                        title="Remove member"
                                      >
                                        <UserMinus className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                );
                              })}
                              {filteredMembers.length === 0 && (
                                <div className="text-sm text-muted-foreground py-6 text-center">
                                  No members match your filter.
                                </div>
                              )}
                            </div>
                          </ScrollArea>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  )}

                  {/* Settings (Owner only) */}
                  {isOwner && (
                    <TabsContent value="settings" className="space-y-4 pt-4">
                      <Card>
                        <CardContent className="pt-6 space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <div className="text-sm font-medium mb-1">Group Name</div>
                              <Input
                                value={group?.name ?? ""}
                                onChange={(e) => setGroup((g) => (g ? { ...g, name: e.target.value } : g))}
                                placeholder="Your group name"
                              />
                            </div>
                            <div>
                              <div className="text-sm font-medium mb-1">Location (optional)</div>
                              <Input
                                value={group?.location ?? ""}
                                onChange={(e) => setGroup((g) => (g ? { ...g, location: e.target.value } : g))}
                                placeholder="e.g., Campus Library"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="text-sm font-medium mb-1">Description</div>
                            <Textarea
                              rows={4}
                              value={group?.description ?? ""}
                              onChange={(e) => setGroup((g) => (g ? { ...g, description: e.target.value } : g))}
                              placeholder="Tell people what this group is for…"
                            />
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              className="gap-2"
                              disabled={savingSettings || !authed}
                              onClick={() =>
                                group &&
                                saveGroupBasics({
                                  name: group.name,
                                  description: group.description || "",
                                })
                              }
                            >
                              {savingSettings ? (
                                <>Saving…</>
                              ) : (
                                <>
                                  <Edit3 className="h-4 w-4" /> Save Changes
                                </>
                              )}
                            </Button>
                            <span className="text-xs text-muted-foreground">
                              Changes apply immediately for all members.
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  )}

                  {/* Danger Zone (Owner only) */}
                  {isOwner && (
                    <TabsContent value="danger" className="space-y-4 pt-4">
                      <Card className="border-destructive/30">
                        <CardHeader>
                          <CardTitle className="text-base text-destructive">Danger Zone</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            Permanently delete this group and all of its messages. This action cannot be undone.
                          </p>
                          <Button variant="destructive" className="gap-2" onClick={destroyGroup} disabled={!authed}>
                            <Trash2 className="h-4 w-4" /> Destroy Group
                          </Button>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  )}
                </Tabs>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Not signed in hint */}
        {!authed && (
          <div className="mb-4 -mt-2 inline-flex items-center gap-2 text-sm text-amber-600">
            <LogIn className="h-4 w-4" />
            You’re not signed in. Log in to chat and manage this group.
          </div>
        )}

        {/* Main content */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 flex-1 min-h-0">
          {/* SIDEBAR */}
          <div className="hidden md:flex md:col-span-4 flex-col space-y-4 order-2 md:order-1 min-h-0">
            <Card className="bg-card/80">
              <CardHeader>
                <CardTitle className="text-base">About</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground space-y-3">
                <p>{group?.description || "No description yet."}</p>
                {group?.code && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">Invite Code</span>
                    <div className="flex-1 flex items-center gap-2">
                      <Input readOnly value={group.code} className="font-mono text-sm" />
                      <Button
                        variant="outline"
                        className="gap-1"
                        onClick={() => {
                          navigator.clipboard.writeText(group.code!);
                          setToast("Copied group code.");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        Copy
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/80 flex-1 min-h-0">
              <CardHeader>
                <CardTitle className="text-base">Members</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 h-full min-h-0 flex flex-col">
                <Input
                  placeholder="Search members…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <ScrollArea className="flex-1 pr-2">
                  <div className="space-y-1">
                    {filteredMembers.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-accent"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Link
                            to={`/profile/${encodeURIComponent(m.username)}`}
                            title={`View @${m.username}`}
                            className="shrink-0"
                          >
                            <AvatarCircle
                              name={m.displayName}
                              username={m.username}
                              avatarUrl={m.avatarUrl ?? undefined}
                              size={32}
                              title={m.displayName}
                              className="cursor-pointer hover:ring-2 ring-primary/40 transition"
                            />
                          </Link>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium truncate">
                                {m.displayName}
                              </span>
                              {roleBadge(m.role)}
                            </div>
                            <div className="text-xs text-muted-foreground truncate">@{m.username}</div>
                          </div>
                        </div>
                        {isOwner && currentUserId !== m.id && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-8 w-8 p-0"
                            onClick={() => removeMember(m.id)}
                            title="Remove member"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {filteredMembers.length === 0 && (
                      <div className="text-sm text-muted-foreground py-6 text-center">
                        No members found.
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>

          {/* CHAT */}
          <div className="md:col-span-8 order-1 md:order-2 min-h-0 flex flex-col">
            <Card className="flex-1 min-h-0 bg-card/80 flex flex-col">
              <CardHeader className="border-b flex-none">
                <div className="flex items-center gap-2">
                  <Hash className="h-5 w-5 text-primary" />
                  <CardTitle className="text-lg md:text-xl">General Chat</CardTitle>

                  {/* Group streak badge */}
                  <div className="ml-auto inline-flex items-center gap-2 text-sm rounded-full border px-2 py-1 bg-background/70">
                    <Flame className={`h-4 w-4 ${streakActiveToday ? "text-orange-500" : "text-muted-foreground"}`} />
                    <span className="font-medium">{streakCount} day{streakCount === 1 ? "" : "s"}</span>
                    <span className={`text-xs ${streakActiveToday ? "text-green-600" : "text-muted-foreground"}`}>
                      {streakActiveToday ? "active today" : "send a message to continue"}
                    </span>
                  </div>
                </div>
              </CardHeader>

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 p-4 overflow-y-auto overscroll-contain">
                  <div
                    ref={viewportRef}
                    className="overflow-y-auto max-h[calc(100vh-280px)]"
                  >
                    {messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No messages yet.</p>
                    ) : (
                      <div className="space-y-3">
                        {messages.map((m, idx) => {
                          const next = messages[idx + 1];
                          const isLastInStreak =
                            !next || next.sender?.id !== m.sender?.id;
                          const isLatest = idx === messages.length - 1;

                          return (
                            <div key={m.id}>
                              <GroupChatMessage
                                message={m}
                                currentUserId={currentUserId ?? undefined}
                                showAvatar={isLastInStreak}
                                onImageClick={(src) => setLightboxSrc(src)}
                              />
                              {isLatest && (
                                <ReadReceiptsRow
                                  readers={latestReaders}
                                  senderId={m.sender?.id}
                                  alignRight={!!currentUserId && m.sender?.id === currentUserId}
                                />
                              )}
                            </div>
                          );
                        })}
                        <div ref={endRef} />
                      </div>
                    )}
                  </div>
                </ScrollArea>

                {previews.length > 0 && (
                  <div className="px-3 pb-2 pt-2 border-t bg-background/50">
                    <div className="flex gap-2 flex-wrap">
                      {previews.map((src, i) => (
                        <div key={i} className="relative">
                          <img
                            src={src}
                            alt={`preview-${i}`}
                            className="h-20 w-20 object-cover rounded-md border cursor-pointer"
                            onClick={() => setLightboxSrc(src)}
                          />
                          <button
                            type="button"
                            className="absolute -top-2 -right-2 bg-foreground text-background rounded-full p-1 shadow"
                            onClick={() => removeFile(i)}
                            title="Remove"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="p-3 border-t flex-none bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/50">
                  <form onSubmit={sendMessage} className="flex items-center gap-2 relative">
                    <input
                      ref={fileRef}
                      type="file"
                      className="hidden"
                      accept="image/*"
                      multiple
                      onChange={onFilesPicked}
                      disabled={!authed}
                    />
                    <div className="relative flex-1">
                      <Input
                        ref={inputRef}
                        placeholder={authed ? "Type a message…" : "Please log in to chat"}
                        value={newMessage}
                        onChange={(e) => setNewMessage(e.target.value)}
                        className="pr-24"
                        onFocus={() => setEmojiOpen(false)}
                        disabled={!authed}
                      />
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-0.5">
                        <div className="relative">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => authed && setEmojiOpen((o) => !o)}
                            aria-label="Emoji"
                            disabled={!authed}
                          >
                            <Smile className="h-4 w-4" />
                          </Button>
                          <EmojiPopover
                            open={emojiOpen && authed}
                            onPick={insertAtCursor}
                            onClose={() => setEmojiOpen(false)}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={openFileDialog}
                          aria-label="Attach images"
                          title="Attach images"
                          disabled={!authed}
                        >
                          <ImageIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      disabled={!authed || (!newMessage.trim() && files.length === 0)}
                      className="gap-2"
                    >
                      <Send className="h-4 w-4" />
                      <span className="hidden sm:inline">Send</span>
                    </Button>
                  </form>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Lightbox for images */}
        <Dialog open={!!lightboxSrc} onOpenChange={(o) => !o && setLightboxSrc(null)}>
          <DialogContent className="max-w-4xl">
            {lightboxSrc && (
              <img
                src={lightboxSrc}
                alt="attachment"
                className="w-full h-auto rounded-lg"
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 right-4 bg-foreground text-background px-3 py-2 rounded shadow-lg flex items-center gap-2">
            <Check className="h-4 w-4" />
            <span className="text-sm">{toast}</span>
            <button
              className="ml-2 text-sm opacity-80 hover:opacity-100"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
