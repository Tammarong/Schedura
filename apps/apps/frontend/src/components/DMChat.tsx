// src/chathead/DMChat.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { api, API_BASE, SOCKET_WS_URL, SOCKET_PATH } from "@/lib/api";

/* ---------- Backend DTOs (as returned by API/socket) ---------- */
type UserRefDTO = {
  id: number | string;
  username: string;
  display_name?: string | null;
  displayName?: string | null;
  avatar_url?: string | null;
  avatarUrl?: string | null;
};

type MessageDTO = {
  id: number;
  content: string;
  created_at: string;
  sender: UserRefDTO;
  receiver: UserRefDTO | null;
  pictures?: string[] | null;
};

type CurrentUserDTO = UserRefDTO;

type ReadReceipt = {
  userId: number;
  displayName: string;
  avatarUrl?: string | null;
};

/* ---------- UI Types (normalized) ---------- */
type FriendLite = {
  id: number;
  username: string;
  displayName: string;
  isOnline: boolean;
  avatarUrl?: string | null;
};

type UserRef = {
  id: number;
  username: string;
  display_name: string;
  avatarUrl: string | null;
};

type Message = {
  id: number;
  content: string;
  created_at: string;
  sender: UserRef;
  receiver: UserRef | null;
  pictures: string[];
};

type CurrentUser = {
  id: number;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

/* ---------- Normalizers (DTO -> UI) ---------- */
const toNumber = (v: number | string): number => {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
};

const normalizeUserRef = (u: UserRefDTO): UserRef => ({
  id: toNumber(u.id),
  username: u.username,
  display_name: (u.display_name ?? u.displayName ?? u.username) || u.username,
  avatarUrl: u.avatarUrl ?? u.avatar_url ?? null,
});

const normalizeMessage = (m: MessageDTO): Message => ({
  id: m.id,
  content: m.content,
  created_at: m.created_at,
  sender: normalizeUserRef(m.sender),
  receiver: m.receiver ? normalizeUserRef(m.receiver) : null,
  pictures: Array.isArray(m.pictures) ? m.pictures.filter((x): x is string => typeof x === "string") : [],
});

const normalizeCurrentUser = (u: CurrentUserDTO): CurrentUser => ({
  id: toNumber(u.id),
  username: u.username,
  displayName: (u.displayName ?? u.display_name ?? u.username) || u.username,
  avatarUrl: u.avatarUrl ?? u.avatar_url ?? null,
});

const currentToUserRef = (me: CurrentUser): UserRef => ({
  id: me.id,
  username: me.username,
  display_name: me.displayName,
  avatarUrl: me.avatarUrl,
});

/* ---------- Helpers ---------- */
const isSenderMe = (msg: Message, me: CurrentUser | null): boolean =>
  !!me && msg.sender.id === me.id;

const formatDay = (d: Date) =>
  d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });

const timeStr = (d: Date) =>
  d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function groupForRender(messages: Message[]) {
  const days: { day: string; items: { m: Message; isMine: boolean }[] }[] = [];
  for (const m of messages) {
    const dt = new Date(m.created_at);
    const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    let bucket = days[days.length - 1];
    if (!bucket || bucket.day !== key) {
      bucket = { day: key, items: [] };
      days.push(bucket);
    }
    bucket.items.push({ m, isMine: false });
  }
  return days;
}

/** Discord-like: show avatar only when the sender changes (start of a block) */
const isStartOfSenderBlock = (items: { m: Message }[], i: number) => {
  const prev = items[i - 1]?.m;
  return !prev || prev.sender.id !== items[i].m.sender.id;
};

/* ---------- Avatar URL resolution (receipts) ---------- */
function toAbsoluteUrl(u: string): string {
  if (/^(https?:)?\/\//i.test(u) || u.startsWith("data:")) return u;
  const base = typeof window !== "undefined" ? window.location.origin : "";
  const withSlash = u.startsWith("/") ? u : `/${u}`;
  return `${base}${withSlash}`;
}

// Local in-memory cache for receipt avatars
const receiptAvatarCache: Map<number, string | null> = new Map();

function useEnsuredReceiptAvatars(readers: ReadReceipt[]): ReadReceipt[] {
  const [resolved, setResolved] = useState<ReadReceipt[]>(readers);

  // Stable signature to re-run effect when the list actually changes
  const sig = useMemo(
    () => readers.map((r) => `${r.userId}:${r.avatarUrl ?? ""}`).join("|"),
    [readers]
  );

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Start with what we have + cache + absolute when needed
      const initial: ReadReceipt[] = readers.map((r) => {
        const cached = receiptAvatarCache.get(r.userId);
        const given = r.avatarUrl ?? null;
        const chosen = cached ?? given;
        const absoluted =
          chosen && !/^data:/.test(chosen) ? toAbsoluteUrl(chosen) : chosen;
        return { ...r, avatarUrl: absoluted };
      });

      setResolved(initial);

      // Which ones need fetching (no cache + missing/relative)
      const toFetchIds = readers
        .filter((r) => {
          const cached = receiptAvatarCache.get(r.userId);
          const given = r.avatarUrl ?? null;
          const isRelative = typeof given === "string" && /^\/(?!\/)/.test(given);
          return cached === undefined && (given === null || given === "" || isRelative);
        })
        .map((r) => r.userId);

      if (toFetchIds.length === 0) return;

      const uniqueIds = Array.from(new Set(toFetchIds));

      const results = await Promise.all(
        uniqueIds.map(async (id) => {
          try {
            const resp = await api<{ avatarUrl?: string | null }>(`/avatar/${id}`, { method: "GET" });
            const url = resp.avatarUrl ?? null;
            return [id, url] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );

      if (cancelled) return;

      for (const [id, url] of results) {
        receiptAvatarCache.set(id, url);
      }

      setResolved((prev) =>
        prev.map((r) => {
          const cached = receiptAvatarCache.get(r.userId);
          const chosen = cached ?? r.avatarUrl ?? null;
          const absoluted =
            chosen && !/^data:/.test(chosen) ? toAbsoluteUrl(chosen) : chosen;
          return { ...r, avatarUrl: absoluted };
        })
      );
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [sig, readers]);

  return resolved;
}

/* ---------- Small bits ---------- */
function AvatarCircle({
  name,
  username,
  avatarUrl,
  size = 32,
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
  const showImage = !!avatarUrl && !err;

  return (
    <div className="relative shrink-0" style={{ width: s, height: s }} title={title}>
      {showImage ? (
        <img
          src={avatarUrl as string}
          alt={name || username || "user"}
          className="rounded-full object-cover border w-full h-full"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="rounded-full border w-full h-full bg-secondary text-foreground grid place-items-center">
          <span className="text-[12px] font-semibold">{initials}</span>
        </div>
      )}
    </div>
  );
}

function ReadReceiptsRow({
  readers,
}: {
  readers: ReadReceipt[];
}) {
  // Call hook unconditionally to satisfy react-hooks rules
  const resolved = useEnsuredReceiptAvatars(readers);
  if (resolved.length === 0) return null;

  const MAX = 6;
  const show = resolved.slice(0, MAX);
  const extra = resolved.length - show.length;

  return (
    <div className="mt-2 flex items-center gap-2 justify-start">
      <div className="flex -space-x-2">
        {show.map((r) => (
          <div key={r.userId} className="inline-block">
            <AvatarCircle
              name={r.displayName}
              username={r.displayName}
              avatarUrl={r.avatarUrl ?? undefined}
              size={18}
              title={r.displayName}
            />
          </div>
        ))}
        {extra > 0 && (
          <div
            className="inline-flex items-center justify-center h-5 w-5 rounded-full border bg-card text-[10px] font-medium"
            title={`${extra} more`}
          >
            +{extra}
          </div>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground">Seen by {resolved.length}</span>
    </div>
  );
}

/* ---------- Component ---------- */
export function DMChat({
  friend,
  isOpen,
  onClose,
}: {
  friend: FriendLite;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<string[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const socketRef = useRef<Socket | null>(null);
  const [latestReaders, setLatestReaders] = useState<ReadReceipt[]>([]);
  const previewUrlsRef = useRef<string[]>([]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  /* Load me + DM history */
  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();

    (async () => {
      try {
        setLoading(true);
        const [meDto, listDto] = await Promise.all([
          api<CurrentUserDTO>("/users/current_user", { signal: abort.signal }),
          api<MessageDTO[]>(`/messages/dm/${friend.id}`, { signal: abort.signal }),
        ]);
        if (cancelled) return;

        setMe(normalizeCurrentUser(meDto));
        setMessages(listDto.map(normalizeMessage));
        scrollToBottom();
      } catch {
        if (!cancelled) setError("Failed to load messages");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [friend.id, scrollToBottom]);

  /* Socket: connect once per mount */
  useEffect(() => {
    const s = io(SOCKET_WS_URL, {
      path: SOCKET_PATH,
      withCredentials: true,
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    socketRef.current = s;

    s.on("connect_error", () => void 0);

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  /* Join DM room and wire listeners */
  const lastMessageRef = useRef<Message | null>(null);
  useEffect(() => {
    lastMessageRef.current = messages[messages.length - 1] ?? null;
  }, [messages]);

  useEffect(() => {
    const meId = me?.id;
    if (!meId || !friend?.id || !socketRef.current) return;
    const s = socketRef.current;

    const a = Math.min(meId, friend.id);
    const b = Math.max(meId, friend.id);
    const roomKey = `dm:${a}-${b}`;
    s.emit("dm:join", { roomKey, meId, friendId: friend.id });

    const onIncoming = (dto: MessageDTO) => {
      const msg = normalizeMessage(dto);
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (msg.sender.id === friend.id && isOpen) {
        fetch(`${API_BASE}/messages/${msg.id}/read`, {
          method: "POST",
          credentials: "include",
        }).catch(() => void 0);
      }
    };

    const onRead = (payload: { messageId: number; readers: ReadReceipt[] }) => {
      const last = lastMessageRef.current;
      if (last && payload.messageId === last.id) {
        setLatestReaders(payload.readers);
      }
    };

    s.on("dm:new_message", onIncoming);
    s.on("dm:read", onRead);

    return () => {
      s.emit("dm:leave", { roomKey, meId, friendId: friend.id });
      s.off("dm:new_message", onIncoming);
      s.off("dm:read", onRead);
    };
  }, [me?.id, friend.id, isOpen]);

  /* Auto scroll */
  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /* Read receipts on latest message */
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last) return;

    if (isSenderMe(last, me)) {
      (async () => {
        try {
          const r = await fetch(`${API_BASE}/messages/${last.id}/readers`, {
            credentials: "include",
          });
          if (r.ok) setLatestReaders(await (r.json() as Promise<ReadReceipt[]>));
        } catch {
          void 0;
        }
      })();
      return;
    }

    let timer: number | undefined;
    (async () => {
      try {
        await fetch(`${API_BASE}/messages/${last.id}/read`, {
          method: "POST",
          credentials: "include",
        });
        let count = 0;
        timer = window.setInterval(async () => {
          count += 1;
          try {
            const r = await fetch(`${API_BASE}/messages/${last.id}/readers`, {
              credentials: "include",
            });
            if (r.ok) setLatestReaders(await (r.json() as Promise<ReadReceipt[]>));
          } catch {
            void 0;
          }
          if (count >= 2 && timer) window.clearInterval(timer);
        }, 1500) as unknown as number;
      } catch {
        void 0;
      }
    })();

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [messages, me]);

  /* Send message (text + optional images) */
  const onSend = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (sending) return;
      if (!me) return;

      const trimmed = text.trim();
      if (!trimmed && files.length === 0) return;

      const contentForSend = trimmed.length > 0 ? trimmed : "\u200B";

      const pending: Message = {
        id: Math.round(Math.random() * 1_000_000_000),
        content: contentForSend,
        created_at: new Date().toISOString(),
        sender: currentToUserRef(me),
        receiver: {
          id: friend.id,
          username: friend.username,
          display_name: friend.displayName,
          avatarUrl: friend.avatarUrl ?? null,
        },
        pictures: files.length ? files.map((f) => URL.createObjectURL(f)) : [],
      };

      try {
        setSending(true);
        setMessages((m) => [...m, pending]);
        setText("");

        if (pending.pictures.length) previewUrlsRef.current.push(...pending.pictures);

        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";

        let createdDTO: MessageDTO;
        if (files.length) {
          const fd = new FormData();
          fd.append("content", contentForSend);
          fd.append("receiver_id", String(friend.id));
          files.forEach((f) => fd.append("images", f));
          createdDTO = await api<MessageDTO>("/messages", { method: "POST", body: fd });
        } else {
          createdDTO = await api<MessageDTO>("/messages", {
            method: "POST",
            body: { content: contentForSend, receiver_id: friend.id },
          });
        }

        const created = normalizeMessage(createdDTO);
        setMessages((prev) => prev.map((m) => (m.id === pending.id ? created : m)));

        try {
          const r = await fetch(`${API_BASE}/messages/${created.id}/readers`, {
            credentials: "include",
          });
          if (r.ok) setLatestReaders(await (r.json() as Promise<ReadReceipt[]>));
        } catch {
          void 0;
        }
      } catch {
        setError("Failed to send");
        setMessages((p) => p.filter((m) => m.id !== pending.id));
      } finally {
        setSending(false);
      }
    },
    [sending, text, files, friend.id, friend.username, friend.displayName, friend.avatarUrl, me]
  );

  /* Attachments */
  const onPickFiles = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const list = Array.from(e.target.files);
    const allowed = list.filter((f) => /^image\/(jpeg|png|webp|gif|jpg)$/i.test(f.type));
    setFiles((prev) => [...prev, ...allowed].slice(0, 8));
  }, []);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  /* Keyboard: Enter to send, Shift+Enter newline */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend]
  );

  /* Lightbox */
  const openLightbox = useCallback((images: string[], index: number) => {
    setLightboxImages(images);
    setLightboxIndex(index);
    setLightboxOpen(true);
  }, []);
  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  const nextImage = useCallback(
    () => setLightboxIndex((i) => (i + 1) % lightboxImages.length),
    [lightboxImages.length]
  );
  const prevImage = useCallback(
    () => setLightboxIndex((i) => (i - 1 + lightboxImages.length) % lightboxImages.length),
    [lightboxImages.length]
  );

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") nextImage();
      else if (e.key === "ArrowLeft") prevImage();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen, closeLightbox, nextImage, prevImage]);

  /* Derived render groups */
  const dayGroups = useMemo(() => {
    const days = groupForRender(messages);
    for (const day of days) {
      for (const item of day.items) {
        item.isMine = isSenderMe(item.m, me);
      }
    }
    return days;
  }, [messages, me]);

  /* Cleanup object URLs */
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current = [];
    };
  }, []);

  /* Header */
  const header = (
    <div className="sticky top-0 z-10 flex items-center gap-3 px-3 py-2 border-b bg-background/90 backdrop-blur">
      <div className="relative w-8 h-8 rounded-full overflow-hidden border">
        {friend.avatarUrl ? (
          <img src={friend.avatarUrl} className="w-full h-full object-cover" alt={friend.displayName} />
        ) : (
          <div className="w-full h-full grid place-items-center text-sm font-semibold">
            {(friend.displayName || friend.username)[0]?.toUpperCase() || "?"}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{friend.displayName}</div>
      </div>
      <button onClick={onClose} className="text-xs rounded-md border px-2 py-1">
        Close
      </button>
    </div>
  );

  /* Messages list — DISCORD-STYLE (single column, avatar + bubble; color indicates mine/theirs) */
  const list = (
    <div ref={scrollRef} className="flex-1 overflow-auto p-3">
      {loading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
      {error && !loading && <div className="p-3 text-sm text-destructive">{error}</div>}
      {!loading && !error && messages.length === 0 && (
        <div className="p-3 text-sm text-muted-foreground">No messages yet.</div>
      )}

      {!loading &&
        !error &&
        dayGroups.map((day, di) => {
          const firstMsgDate = new Date(day.items[0].m.created_at);
          return (
            <div key={di} className="mb-6">
              {/* Day divider */}
              <div className="sticky top-2 z-0 flex justify-center my-2">
                <span className="px-2 py-0.5 text-[11px] rounded-full bg-muted text-muted-foreground">
                  {formatDay(firstMsgDate)}
                </span>
              </div>

              {/* Messages */}
              <div className="space-y-1">
                {day.items.map((it, i) => {
                  const m = it.m;
                  const mine = it.isMine;
                  const showAvatar = isStartOfSenderBlock(day.items, i);

                  const bubbleBase = "inline-block px-3 py-2 text-sm whitespace-pre-wrap break-words rounded-2xl";
                  const bubbleClass = mine ? "bg-primary text-primary-foreground" : "bg-muted";

                  return (
                    <div key={m.id} className="flex items-start gap-2">
                      {/* Avatar (only at start of sender block like Discord) */}
                      {showAvatar ? (
                        <AvatarCircle
                          name={m.sender.display_name}
                          username={m.sender.username}
                          avatarUrl={m.sender.avatarUrl}
                          size={32}
                          title={m.sender.display_name}
                        />
                      ) : (
                        <div style={{ width: 32, height: 32 }} className="shrink-0" />
                      )}

                      {/* Message column */}
                      <div className="flex-1 min-w-0">
                        {/* Header line (name • time) only at start of block */}
                        {showAvatar && (
                          <div className="text-xs text-muted-foreground mb-1">
                            <span className="font-medium">{mine ? "You" : m.sender.display_name}</span>
                            <span className="mx-1">•</span>
                            <span>{timeStr(new Date(m.created_at))}</span>
                          </div>
                        )}

                        {/* Bubble */}
                        <div className={`${bubbleBase} ${bubbleClass}`} title={new Date(m.created_at).toLocaleString()}>
                          {m.content && <div>{m.content}</div>}

                          {m.pictures.length > 0 && (
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              {m.pictures.map((url, idx) => (
                                <img
                                  key={`${m.id}-img-${idx}`}
                                  src={url}
                                  className="rounded-md w-full h-auto object-cover cursor-zoom-in"
                                  onLoad={scrollToBottom}
                                  onClick={() => openLightbox(m.pictures, idx)}
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
              </div>
            </div>
          );
        })}

      {/* Read receipts (optional, left-aligned to match single-column layout) */}
      {messages.length > 0 && <ReadReceiptsRow readers={latestReaders} />}
    </div>
  );

  /* Composer */
  const composer = (
    <form onSubmit={onSend} className="border-t p-1 sm:p-2">
      {files.length > 0 && (
        <div className="px-1 pb-1 sm:pb-2 flex gap-2 overflow-x-auto flex-nowrap">
          {files.map((f, i) => {
            const url = URL.createObjectURL(f);
            previewUrlsRef.current.push(url);
            return (
              <div key={`${f.name}-${i}`} className="relative shrink-0">
                <img
                  src={url}
                  className="w-14 h-14 sm:w-20 sm:h-20 object-cover rounded-md border"
                  onLoad={scrollToBottom}
                  alt="preview"
                />
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(url);
                    previewUrlsRef.current = previewUrlsRef.current.filter((u) => u !== url);
                    removeFile(i);
                  }}
                  className="absolute -top-1 -right-1 bg-foreground text-background rounded-full h-5 w-5 grid place-items-center text-[10px]"
                  aria-label="remove"
                  title="Remove"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-1 sm:gap-2">
        <button
          type="button"
          className="shrink-0 rounded-md border px-2 py-1 text-xs sm:text-sm"
          onClick={() => fileInputRef.current?.click()}
          title="Attach images"
          disabled={!me}
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={onPickFiles}
        />

        <textarea
          className="min-h-[36px] sm:min-h-[40px] max-h-[96px] sm:max-h-[160px] flex-1 resize-none bg-background border rounded-md px-2 py-1 sm:px-3 sm:py-2 text-sm leading-5 focus:outline-none"
          placeholder={me ? `Message ${friend.displayName}` : "Loading…"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!me}
        />

        <button
          type="submit"
          disabled={!me || sending || (!text.trim() && files.length === 0)}
          className="shrink-0 px-2 py-1 sm:px-3 sm:py-2 text-xs sm:text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>

      <div className="px-2 pt-1 text-[10px] sm:text-[11px] text-muted-foreground">
        Press <kbd className="px-1 border rounded">Enter</kbd> to send,{" "}
        <kbd className="px-1 border rounded">Shift</kbd>+<kbd className="px-1 border rounded">Enter</kbd> for a new line
      </div>
    </form>
  );

  return (
    <div className="flex flex-col h-[60vh] sm:h-[70vh]">
      {header}
      {list}
      {composer}

      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={lightboxImages[lightboxIndex]}
            alt="image"
            className="max-w-[92vw] max-h-[86vh] object-contain rounded-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxImages.length > 1 && (
            <>
              <button
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full border bg-background/80 px-3 py-2 text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  prevImage();
                }}
              >
                ‹
              </button>
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full border bg-background/80 px-3 py-2 text-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  nextImage();
                }}
              >
                ›
              </button>
            </>
          )}
          <button
            className="absolute top-3 right-3 rounded-full border bg-background/80 px-3 py-1 text-sm"
            onClick={(e) => {
              e.stopPropagation();
              closeLightbox();
            }}
            aria-label="Close image"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default DMChat;
