// ChatheadProvider.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, PanInfo } from "framer-motion";
import { io, Socket } from "socket.io-client";
import { X, Trash2, Send, Check } from "lucide-react";
import {
  ChatheadContext,
  ChatheadContextValue,
  ChatUser,
} from "@/providers/chathead-context";
import { api, SOCKET_WS_URL, SOCKET_PATH } from "@/lib/api";

/** ---------- Layout + UX constants ---------- */
const BUBBLE_VISIBLE = 56;
const BUBBLE_HIT = 80;
const EDGE_MARGIN = 8;
const TOP_MARGIN = 80;
const BOTTOM_MARGIN = 160;

const PANEL_WIDTH_DESKTOP = 360;
const PANEL_MIN_WIDTH = 280;
const PANEL_SIDE_GAP = 8;
const PANEL_MAXH_DESKTOP = 0.7;
const PANEL_MAXH_MOBILE = 0.72;

const TRASH_SIZE = 110;
const TRASH_MAGNET = 72;
const DRAG_ELASTIC = 0.08;
const DRAG_MOMENTUM = false;

const Z_OVERLAY = 60;

/** ---------- DM data types ---------- */
type FriendLite = {
  id: number;
  username: string;
  displayName: string;
  isOnline: boolean;
  avatarUrl?: string | null;
};

type MessageUser = {
  id: number;
  username: string;
  display_name: string;
  avatarUrl?: string | null;
};

type DMMessage = {
  id: number;
  content: string;
  created_at: string;
  sender: MessageUser;
  receiver?: MessageUser | null;
  pictures?: string[];
};

type ReadReceipt = {
  userId: number;
  displayName: string;
  avatarUrl?: string | null;
};

/** ---------- Utils ---------- */
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const vw = () => (typeof window !== "undefined" ? window.innerWidth : 0);
const vh = () => (typeof window !== "undefined" ? window.innerHeight : 0);

function useIsMobile(breakpointPx = 640) {
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < breakpointPx : false
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < breakpointPx);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [breakpointPx]);
  return mobile;
}

function toFriendLite(u: ChatUser): FriendLite {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? null,
    isOnline: u.isOnline ?? false,
  };
}

/** clamp into viewport safe band (no snap) */
const clampIntoBounds = (x: number, y: number) => {
  const minX = EDGE_MARGIN + BUBBLE_VISIBLE / 2;
  const maxX = vw() - EDGE_MARGIN - BUBBLE_VISIBLE / 2;
  const minY = TOP_MARGIN;
  const maxY = vh() - BOTTOM_MARGIN;
  return { x: clamp(x, minX, maxX), y: clamp(y, minY, maxY) };
};

type Chathead = {
  user: ChatUser;
  x: number;
  y: number;
  open: boolean;
  expanded: boolean;
};

type ChatheadState = Record<number, Chathead>;

/* ---------- Avatar URL helpers ---------- */
function toAbsoluteUrl(u?: string | null): string | null {
  if (!u) return null;
  if (/^(https?:)?\/\//i.test(u) || u.startsWith("data:")) return u;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const withSlash = u.startsWith("/") ? u : `/${u}`;
  return `${base}${withSlash}`;
}

/** ---------- Tiny Avatar (kept for bubbles/messages) ---------- */
function Avatar({
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
  const src = toAbsoluteUrl(avatarUrl) ?? undefined;
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
        <div className="rounded-full border w-full h-full bg-secondary text-foreground flex items-center justify-center">
          <span className="text-[10px] font-semibold">{initials}</span>
        </div>
      )}
    </div>
  );
}

/** ---------- Read Receipts Row (no avatars) ---------- */
function ReadReceiptsRow({ readers }: { readers: ReadReceipt[] }) {
  if (readers.length === 0) return null;
  return (
    <div className="mt-1">
      <span className="text-[12px] text-muted-foreground">Seen by {readers.length}</span>
    </div>
  );
}

/** ---------- Normalizers (ensure sender/receiver ids & names/avatars) ---------- */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isDate = (v: unknown): v is Date => v instanceof Date;

const coerceNum = (v: unknown): number => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return 0;
};

const pickAvatar = (u: Record<string, unknown>) =>
  (typeof u["avatarUrl"] === "string" ? (u["avatarUrl"] as string) : undefined) ??
  (typeof u["avatar_url"] === "string" ? (u["avatar_url"] as string) : undefined) ??
  undefined;

const pickDisplay = (u: Record<string, unknown>, fallbackUsername: string) =>
  (typeof u["display_name"] === "string" ? (u["display_name"] as string) : undefined) ??
  (typeof u["displayName"] === "string" ? (u["displayName"] as string) : undefined) ??
  fallbackUsername;

function normalizeMessage(raw: unknown): DMMessage {
  const r = isObj(raw) ? raw : {};

  const sRaw = isObj(r.sender) ? (r.sender as Record<string, unknown>) : {};
  const tRaw = isObj(r.receiver) ? (r.receiver as Record<string, unknown>) : undefined;

  const senderIdFallback = coerceNum(r["sender_id"]);
  const receiverIdFallback = coerceNum(r["receiver_id"]);

  const senderId = coerceNum(sRaw["id"]) || senderIdFallback || 0;
  const receiverId = tRaw ? (coerceNum(tRaw["id"]) || receiverIdFallback || 0) : receiverIdFallback || 0;

  const senderUsername =
    typeof sRaw["username"] === "string"
      ? (sRaw["username"] as string)
      : typeof r["sender_username"] === "string"
      ? (r["sender_username"] as string)
      : "";
  const receiverUsername =
    tRaw && typeof tRaw["username"] === "string"
      ? (tRaw["username"] as string)
      : typeof r["receiver_username"] === "string"
      ? (r["receiver_username"] as string)
      : "";

  const sDisplay = pickDisplay(sRaw, senderUsername);
  const tDisplay = tRaw ? pickDisplay(tRaw, receiverUsername) : receiverUsername || "";

  const pictures = Array.isArray(r["pictures"])
    ? (r["pictures"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];

  const rawCreatedAt = r["created_at"];
  let created_at: string;
  if (typeof rawCreatedAt === "string" || typeof rawCreatedAt === "number") {
    created_at = new Date(rawCreatedAt).toISOString();
  } else if (isDate(rawCreatedAt)) {
    created_at = rawCreatedAt.toISOString();
  } else {
    created_at = new Date().toISOString();
  }

  return {
    id: coerceNum(r["id"]),
    content: typeof r["content"] === "string" ? (r["content"] as string) : "",
    created_at,
    sender: {
      id: senderId,
      username: senderUsername,
      display_name: sDisplay,
      avatarUrl: pickAvatar(sRaw),
    },
    receiver:
      tRaw || receiverId
        ? {
            id: receiverId,
            username: receiverUsername,
            display_name: tDisplay,
            avatarUrl: tRaw ? pickAvatar(tRaw) : undefined,
          }
        : null,
    pictures,
  };
}

function normalizeList(list: unknown): DMMessage[] {
  if (!Array.isArray(list)) return [];
  const out = list.map(normalizeMessage);
  out.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return out;
}

/** ---------- Discord-like helper: avatar at start of sender block ---------- */
function isStartOfSenderBlock(items: DMMessage[], index: number) {
  const prev = items[index - 1];
  return !prev || (prev.sender?.id ?? 0) !== (items[index].sender?.id ?? -1);
}

/** ---------- DM Panel (inline, real-time) ---------- */
function DMPanel({
  me,
  friend,
  socket,
  onClose,
}: {
  me: { id: number; username: string; displayName: string; avatarUrl?: string | null };
  friend: FriendLite;
  socket: Socket | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [input, setInput] = useState("");
  const [latestReaders, setLatestReaders] = useState<ReadReceipt[]>([]);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const lastMessageRef = useRef<DMMessage | null>(null);
  useEffect(() => {
    lastMessageRef.current = messages[messages.length - 1] ?? null;
  }, [messages]);

  const isMine = useCallback(
    (m: DMMessage): boolean => (m.sender?.id ?? 0) === (me.id ?? 0),
    [me.id]
  );

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const rowsRaw = await api<unknown>(`/messages/dm/${friend.id}`);
        if (!mounted) return;
        const rows = normalizeList(rowsRaw);
        setMessages(rows);

        const last = rows[rows.length - 1];
        if (last && !isMine(last)) {
          try {
            await api(`/messages/${last.id}/read`, { method: "POST" });
            const readers = await api<ReadReceipt[]>(`/messages/${last.id}/readers`);
            setLatestReaders(readers);
          } catch { /* ignore */ }
        }
      } catch {
        if (mounted) setToast("Failed to load DM.");
      }
    })();
    return () => {
      mounted = false;
    };
  }, [friend.id, isMine]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!socket) return;
    const payload = { meId: me.id, friendId: friend.id };
    socket.emit("dm:join", payload);

    const onIncoming = (raw: unknown) => {
      const msg = normalizeMessage(raw);
      const sid = msg.sender?.id ?? null;
      const rid = msg.receiver?.id ?? null;
      const ours = sid === me.id || sid === friend.id || rid === me.id || rid === friend.id;
      if (!ours) return;
      setMessages((p) => (p.some((m) => m.id === msg.id) ? p : [...p, msg]));
    };

    const onRead = (data: { messageId: number; readers: ReadReceipt[] }) => {
      const last = lastMessageRef.current;
      if (last && data.messageId === last.id) setLatestReaders(data.readers);
    };

    socket.on("dm:new_message", onIncoming);
    socket.on("dm:read", onRead);

    return () => {
      socket.emit("dm:leave", payload);
      socket.off("dm:new_message", onIncoming);
      socket.off("dm:read", onRead);
    };
  }, [socket, friend.id, me.id]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;

    if (isMine(last)) {
      (async () => {
        try {
          const readers = await api<ReadReceipt[]>(`/messages/${last.id}/readers`);
          setLatestReaders(readers);
        } catch { /* ignore */ }
      })();
      return;
    }

    let timer: number | undefined;
    (async () => {
      try {
        await api(`/messages/${last.id}/read`, { method: "POST" });
        let count = 0;
        timer = window.setInterval(async () => {
          count += 1;
          try {
            const readers = await api<ReadReceipt[]>(`/messages/${last.id}/readers`);
            setLatestReaders(readers);
          } catch { /* ignore */ }
          if (count >= 2 && timer) window.clearInterval(timer);
        }, 1500) as unknown as number;
      } catch { /* ignore */ }
    })();

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [messages, isMine]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (document.hidden) return;
      try {
        const rowsRaw = await api<unknown>(`/messages/dm/${friend.id}`);
        if (cancelled) return;

        const rows = normalizeList(rowsRaw);

        const lastA = messages[messages.length - 1];
        const lastB = rows[rows.length - 1];
        const keyA = lastA ? `${lastA.id}:${new Date(lastA.created_at).getTime()}` : "none";
        const keyB = lastB ? `${lastB.id}:${new Date(lastB.created_at).getTime()}` : "none";

        if (keyA !== keyB || rows.length !== messages.length) {
          setMessages(rows);
          const last = rows[rows.length - 1];
          if (last && !isMine(last)) {
            try {
              await api(`/messages/${last.id}/read`, { method: "POST" });
              const readers = await api<ReadReceipt[]>(`/messages/${last.id}/readers`);
              setLatestReaders(readers);
            } catch { /* ignore */ }
          }
        }
      } catch {
        /* ignore */
      }
    };

    const timer = window.setInterval(() => { void tick(); }, 2000) as unknown as number;
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [friend.id, messages, isMine]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    const content = input.trim();
    setSending(true);

    const pending: DMMessage = {
      id: Math.floor(Math.random() * 1_000_000_000),
      content,
      created_at: new Date().toISOString(),
      sender: {
        id: me.id,
        username: me.username,
        display_name: me.displayName || me.username,
        avatarUrl: me.avatarUrl ?? undefined,
      },
      receiver: {
        id: friend.id,
        username: friend.username,
        display_name: friend.displayName,
        avatarUrl: friend.avatarUrl ?? undefined,
      },
      pictures: [],
    };
    setMessages((p) => [...p, pending]);
    setInput("");
    setLatestReaders([]);

    try {
      const realRaw = await api<unknown>("/messages", {
        method: "POST",
        body: { content, receiver_id: friend.id },
      });
      const real = normalizeMessage(realRaw);
      setMessages((p) => p.map((m) => (m.id === pending.id ? real : m)));

      setTimeout(async () => {
        try {
          const readers = await api<ReadReceipt[]>(`/messages/${real.id}/readers`);
          setLatestReaders(readers);
        } catch { /* ignore */ }
      }, 0);
    } catch {
      setToast("Failed to send message.");
      setMessages((p) => p.filter((m) => m.id !== pending.id));
    } finally {
      setSending(false);
    }
  }

  const latest = messages[messages.length - 1];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Avatar name={friend.displayName} username={friend.username} avatarUrl={friend.avatarUrl} size={28} />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{friend.displayName}</div>
            <div className="text-[11px] text-muted-foreground truncate">@{friend.username}</div>
          </div>
        </div>
        <button className="p-1 rounded hover:bg-accent" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>

      {/* Messages — DISCORD STYLE */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-3 space-y-4 touch-pan-y"
        style={{ WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"] }}
      >
        {messages.map((m, i) => {
          const mine = isMine(m);
          const showAvatar = isStartOfSenderBlock(messages, i);
          const bubbleBase = "inline-block px-3 py-2 text-sm whitespace-pre-wrap break-words rounded-2xl";
          const bubbleClass = mine ? "bg-primary text-primary-foreground" : "bg-muted";

          return (
            <div key={m.id} className="flex items-start gap-2">
              {showAvatar ? (
                <Avatar
                  name={m.sender?.display_name}
                  username={m.sender?.username}
                  avatarUrl={m.sender?.avatarUrl}
                  size={32}
                  title={m.sender?.display_name}
                />
              ) : (
                <div style={{ width: 32, height: 32 }} className="shrink-0" />
              )}

              <div className="flex-1 min-w-0">
                {showAvatar && (
                  <div className="text-xs text-muted-foreground mb-1">
                    <span className="font-medium">{mine ? "You" : (m.sender?.display_name || m.sender?.username)}</span>
                    <span className="mx-1">•</span>
                    <span>{new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                )}

                <div className={`${bubbleBase} ${bubbleClass}`} title={new Date(m.created_at).toLocaleString()}>
                  {m.content}

                  {!!m.pictures?.length && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {m.pictures.map((url, idx) => (
                        <img
                          key={`${m.id}-img-${idx}`}
                          src={url}
                          className="rounded-md w-full h-auto object-cover"
                          alt="attachment"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {/* Read receipts (count only) */}
      {latest && (
        <div className="px-3 -mt-1 mb-1">
          <ReadReceiptsRow readers={latestReaders} />
        </div>
      )}

      {/* Composer */}
      <form onSubmit={onSend} className="flex gap-2 p-2 border-t">
        <input
          className="flex-1 rounded-md border px-3 py-2 text-sm bg-background"
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm bg-foreground text-background disabled:opacity-50"
        >
          <Send size={16} />
          <span>Send</span>
        </button>
      </form>

      {/* Toast */}
      {toast && (
        <div className="absolute bottom-2 right-2 bg-foreground text-background px-3 py-2 rounded shadow-lg flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span className="text-sm">{toast}</span>
          <button className="ml-2 text-sm opacity-80 hover:opacity-100" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** ---------- Provider ---------- */
const ChatheadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [heads, setHeads] = useState<ChatheadState>({});
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [nearTrash, setNearTrash] = useState(false);
  useIsMobile();

  // me (store displayName too so pending/outgoing shows correct name)
  const [me, setMe] = useState<{ id: number; username: string; displayName: string; avatarUrl?: string | null } | null>(null);
  const [meLoading, setMeLoading] = useState(true);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setMeLoading(true);
        const meJson = await api<{
          id: number | string;
          username: string;
          displayName?: string | null;
          display_name?: string | null;
          avatarUrl?: string | null;
          avatar_url?: string | null;
        }>("/users/current_user");
        if (!mounted) return;
        const idValue = typeof meJson.id === "string" ? Number(meJson.id) : meJson.id;
        const displayName = (meJson.displayName ?? meJson.display_name ?? meJson.username) || meJson.username;
        const avatarUrl = (meJson.avatarUrl ?? meJson.avatar_url) ?? null;
        setMe({ id: Number.isFinite(idValue) ? (idValue as number) : 0, username: meJson.username, displayName, avatarUrl });
      } catch {
        if (mounted) setMe(null);
      } finally {
        if (mounted) setMeLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const socket = io(SOCKET_WS_URL, {
      withCredentials: true,
      transports: ["websocket", "polling"],
      path: SOCKET_PATH,
      autoConnect: true,
    });
    socketRef.current = socket;
    socket.on("connect_error", () => {
      // silent; DMPanel falls back to polling
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const initialPos = () => {
    const targetX = vw() * 0.82;
    const targetY = vh() * 0.75;
    const jitterX = (Math.random() - 0.5) * 24;
    const jitterY = (Math.random() - 0.5) * 16;
    return clampIntoBounds(targetX + jitterX, targetY + jitterY);
  };

  const openChat = useCallback<ChatheadContextValue["openChat"]>((user) => {
    setHeads((prev) => {
      const id = user.id;
      const exist = prev[id];
      if (exist) return { ...prev, [id]: { ...exist, open: true, expanded: true } };
      const start = initialPos();
      return {
        ...prev,
        [id]: { user, x: start.x, y: start.y, open: true, expanded: true },
      };
    });
  }, []);

  const closeChat = useCallback<ChatheadContextValue["closeChat"]>((userId) => {
    setHeads((prev) => {
      const clone = { ...prev };
      delete clone[userId];
      return clone;
    });
  }, []);

  const hideChat = useCallback<ChatheadContextValue["hideChat"]>((userId) => {
    setHeads((prev) => {
      const clone = { ...prev };
      delete clone[userId];
      return clone;
    });
  }, []);

  const toggleWindow = useCallback<ChatheadContextValue["toggleWindow"]>((userId) => {
    setHeads((prev) => {
      const h = prev[userId];
      if (!h) return prev;
      return { ...prev, [userId]: { ...h, expanded: !h.expanded } };
    });
  }, []);

  const isOpen = useCallback<ChatheadContextValue["isOpen"]>((userId) => !!heads[userId]?.open, [heads]);

  const centerDist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
  const trashCenter = useCallback(() => ({ x: vw() / 2, y: vh() - TRASH_SIZE / 2 - 8 }), []);

  const onDragStart = useCallback((userId: number) => {
    setDraggingId(userId);
    setNearTrash(false);
  }, []);

  const onDrag = useCallback(
    (_userId: number, _e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { point } = info;
      const tc = trashCenter();
      const near = centerDist(point.x, point.y, tc.x, tc.y) <= TRASH_SIZE / 2 + TRASH_MAGNET;
      setNearTrash(near);
    },
    [trashCenter]
  );

  const onDragEnd = useCallback(
    (userId: number, _e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const { point } = info;
      const next = clampIntoBounds(point.x, point.y);

      setHeads((prev) => {
        const h = prev[userId];
        if (!h) return prev;
        return { ...prev, [userId]: { ...h, x: next.x, y: next.y } };
      });

      const tc = trashCenter();
      const overTrash = Math.hypot(point.x - tc.x, point.y - tc.y) <= TRASH_SIZE / 2;
      if (overTrash) {
        setHeads((prev) => {
          const clone = { ...prev };
          delete clone[userId];
          return clone;
        });
      }

      setDraggingId(null);
      setNearTrash(false);
    },
    [trashCenter]
  );

  useEffect(() => {
    const onResize = () => {
      setHeads((prev) => {
        const clone: ChatheadState = {};
        for (const [id, h] of Object.entries(prev)) {
          const clamped = clampIntoBounds(h.x, h.y);
          clone[Number(id)] = { ...h, ...clamped };
        }
        return clone;
      });
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);

  const desktopPanelStyle = (h: Chathead): React.CSSProperties => {
    const heightPx = Math.round(vh() * PANEL_MAXH_DESKTOP);

    const availableLeft = Math.max(0, h.x - PANEL_SIDE_GAP);
    const availableRight = Math.max(0, vw() - (h.x + PANEL_SIDE_GAP));
    const sideLeft = h.x < vw() / 2;

    const sideAvail = sideLeft ? availableRight : availableLeft;
    const maxUsable = Math.max(0, sideAvail - BUBBLE_VISIBLE / 2);
    const widthPx = clamp(Math.min(PANEL_WIDTH_DESKTOP, maxUsable), PANEL_MIN_WIDTH, PANEL_WIDTH_DESKTOP);

    const left = sideLeft
      ? clamp(h.x + PANEL_SIDE_GAP, EDGE_MARGIN, vw() - widthPx - EDGE_MARGIN)
      : clamp(h.x - (widthPx + PANEL_SIDE_GAP), EDGE_MARGIN, vw() - widthPx - EDGE_MARGIN);

    let top = Math.round(h.y - heightPx - BUBBLE_VISIBLE / 2 - 12);
    top = clamp(top, 8, vh() - heightPx - 8);

    return {
      position: "fixed",
      left,
      top,
      width: widthPx,
      height: heightPx,
      overflow: "hidden",
      pointerEvents: "auto",
      display: "flex",
      flexDirection: "column",
    };
  };

  const value = useMemo<ChatheadContextValue>(
    () => ({ openChat, closeChat, toggleWindow, hideChat, isOpen }),
    [openChat, closeChat, toggleWindow, hideChat, isOpen]
  );

  return (
    <ChatheadContext.Provider value={value}>
      {children}

      {/* BUBBLES LAYER */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: Z_OVERLAY }}>
        {Object.values(heads).map((h) => (
          <motion.div
            key={h.user.id}
            className="pointer-events-auto fixed"
            initial={{ x: h.x, y: h.y, opacity: 0 }}
            animate={{ x: h.x, y: h.y, opacity: 1 }}
            drag
            dragElastic={DRAG_ELASTIC}
            dragMomentum={DRAG_MOMENTUM}
            onDragStart={() => onDragStart(h.user.id)}
            onDrag={(e, info) => onDrag(h.user.id, e as unknown as MouseEvent, info)}
            onDragEnd={(e, info) => onDragEnd(h.user.id, e as unknown as MouseEvent, info)}
            style={{ transform: "translate(-50%, -50%)" }}
          >
            <div className="relative flex items-center justify-center select-none" style={{ width: BUBBLE_HIT, height: BUBBLE_HIT }}>
              {/* Bubble */}
              <button
                onClick={() => toggleWindow(h.user.id)}
                className="relative rounded-full border bg-background shadow-md overflow-hidden cursor-pointer grid place-items-center"
                title={h.user.displayName}
                style={{ width: BUBBLE_VISIBLE, height: BUBBLE_VISIBLE }}
              >
                {h.user.avatarUrl ? (
                  <img
                    className="w-full h-full object-cover"
                    src={toAbsoluteUrl(h.user.avatarUrl) ?? undefined}
                    alt={h.user.displayName}
                    draggable={false}
                  />
                ) : (
                  <span className="text-sm font-semibold">
                    {(h.user.displayName || h.user.username || "?").charAt(0).toUpperCase()}
                  </span>
                )}

                {/* Close bubble */}
                <span className="absolute -top-1 -right-1 bg-foreground text-background rounded-full p-1 shadow">
                  <X
                    size={12}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeChat(h.user.id);
                    }}
                  />
                </span>
              </button>
            </div>
          </motion.div>
        ))}

        {/* DESKTOP/TABLET PANELS */}
        <div className="hidden sm:block fixed inset-0 pointer-events-none" style={{ zIndex: Z_OVERLAY + 1 }}>
          {Object.values(heads).map(
            (h) =>
              h.expanded && (
                <div
                  key={`desk-${h.user.id}`}
                  className="rounded-xl border bg-background shadow-xl pointer-events-auto"
                  style={desktopPanelStyle(h)}
                >
                  <div className="flex-1 min-h-0 flex flex-col">
                    {me ? (
                      <DMPanel
                        me={me}
                        friend={toFriendLite(h.user)}
                        socket={socketRef.current}
                        onClose={() => toggleWindow(h.user.id)}
                      />
                    ) : (
                      <div className="flex-1 flex flex-col">
                        <div className="flex items-center justify-between px-3 py-2 border-b">
                          <div className="h-6 w-32 bg-muted rounded" />
                          <button className="p-1 rounded hover:bg-accent" onClick={() => toggleWindow(h.user.id)} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                          {meLoading ? "Connecting…" : "Not authenticated"}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
          )}
        </div>

        {/* MOBILE PANEL */}
        <div className="sm:hidden fixed inset-0" style={{ zIndex: Z_OVERLAY + 2, pointerEvents: "none" }}>
          {Object.values(heads).map(
            (h) =>
              h.expanded && (
                <div key={`m-${h.user.id}`} className="absolute inset-0 pointer-events-auto">
                  <div className="absolute inset-0 bg-black/30" onClick={() => toggleWindow(h.user.id)} />
                  <div
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-[520px] rounded-2xl border bg-background shadow-2xl flex flex-col overflow-hidden"
                    style={{ height: `${Math.round(vh() * PANEL_MAXH_MOBILE)}px` }}
                  >
                    {me ? (
                      <DMPanel
                        me={me}
                        friend={toFriendLite(h.user)}
                        socket={socketRef.current}
                        onClose={() => toggleWindow(h.user.id)}
                      />
                    ) : (
                      <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                        {meLoading ? "Connecting…" : "Not authenticated"}
                      </div>
                    )}
                  </div>
                </div>
              )
          )}
        </div>

        {/* Trash zone */}
        <div
          className={[
            "fixed left-1/2 -translate-x-1/2 bottom-4 rounded-full border-2 flex items-center justify-center transition-all duration-150",
            draggingId !== null ? "opacity-100 scale-100" : "opacity-0 scale-75",
            nearTrash
              ? "bg-destructive/15 border-destructive text-destructive"
              : "bg-muted/50 border-muted-foreground/50 text-muted-foreground/70",
          ].join(" ")}
          style={{ width: TRASH_SIZE, height: TRASH_SIZE, zIndex: Z_OVERLAY + 3, pointerEvents: "none" }}
          aria-hidden
        >
          <Trash2 className={nearTrash ? "scale-110 transition-transform" : ""} />
        </div>
      </div>
    </ChatheadContext.Provider>
  );
};

export default ChatheadProvider;
