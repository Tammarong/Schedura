import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Award, Hash, Heart, MessageSquare, Share2, Users, X } from "lucide-react";
import { api, getToken } from "@/lib/api";

/* ---------- minimal JWT decode ---------- */
function decodeJwtPayload(token: string): null | { username?: string } {
  try {
    const raw = token.startsWith("Bearer ") ? token.slice(7) : token;
    const [, payload] = raw.split(".");
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/* ---------- types (match feed) ---------- */
type Group = { id: number; name: string; memberCount: number; isMember?: boolean };
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

/* ---------- Title types & helpers (flat, no neon) ---------- */
type Title = {
  id: number;
  key: string;
  label: string;
  description: string | null;
  emoji: string | null;
  color: string | null;
  rarity?: number | "common" | "rare" | "epic" | "legendary" | null;
};

type RarityKey = "common" | "rare" | "epic" | "legendary";
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
  const id = typeof obj.id === "number" ? obj.id : 0;
  const key = typeof obj.key === "string" ? obj.key : "";
  const label = typeof obj.label === "string" ? obj.label : "";
  const description = typeof obj.description === "string" ? obj.description : null;
  const emoji = typeof obj.emoji === "string" ? obj.emoji : null;
  const color = typeof obj.color === "string" ? obj.color : null;

  const rarityRaw = (obj as any).rarity;
  let rarity: Title["rarity"] = null;
  if (typeof rarityRaw === "number" && Number.isFinite(rarityRaw)) rarity = rarityRaw;
  else if (typeof rarityRaw === "string") {
    const s = rarityRaw.toLowerCase();
    if (s === "common" || s === "rare" || s === "epic" || s === "legendary") rarity = s;
    else {
      const n = Number(s);
      if (Number.isFinite(n)) rarity = n as number;
    }
  }
  if (!label && id <= 0) return null;
  return { id: id <= 0 ? 0 : id, key, label, description, emoji, color, rarity };
}
function extractTitleFromResponse(raw: unknown): Title | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.currentTitle && typeof r.currentTitle === "object") {
    return normalizeTitleFromApiObject(r.currentTitle as Record<string, unknown>);
  }
  if ("id" in r || "label" in r) {
    return normalizeTitleFromApiObject(r);
  }
  return null;
}
function TitleChip({ title, className }: { title: Title; className?: string }) {
  const rarityKey = rarityKeyFrom(title.rarity);
  const style = title.color ? { backgroundColor: title.color } : undefined;

  return (
    <span
      className={
        [
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
          "bg-muted text-foreground ring-1",
          rarityRing[rarityKey],
          className || ""
        ].join(" ")
      }
      style={style}
      title={title.description ?? title.label}
    >
      <Award className="h-3.5 w-3.5" />
      <span className="truncate max-w-[200px]">{title.label}</span>
    </span>
  );
}

/* ---------- helpers ---------- */
function clsx(...arr: Array<string | false | undefined>) {
  return arr.filter(Boolean).join(" ");
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
    const min = 60_000, hr = 60 * min, day = 24 * hr;
    if (abs < hr) return rtf.format(Math.round(diffMs / min), "minute");
    if (abs < day) return rtf.format(Math.round(diffMs / hr), "hour");
    return rtf.format(Math.round(diffMs / day), "day");
  } catch {
    return fmtDate(iso);
  }
}
function Initials({ name, username, className = "" }: { name?: string; username?: string; className?: string }) {
  const base = (name?.trim() || username || "?").trim();
  const parts = base.split(/\s+/);
  const initials =
    parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : ((parts[0][0] || "") + (parts[1][0] || "")).toUpperCase();
  return (
    <div className={clsx("flex items-center justify-center rounded-full bg-primary/15 text-primary font-semibold", className)}>
      <span className="text-sm">{initials}</span>
    </div>
  );
}

/* ---------- normalize backend comments (paged or array) ---------- */
function normalizeCommentsResponse(raw: unknown): Comment[] {
  if (Array.isArray(raw)) return raw as Comment[];
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.items)) return r.items as Comment[];
  }
  return [];
}

/* ---------- page ---------- */
export default function PostView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [liking, setLiking] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<{ username: string } | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  // Title cache for this page (author + commenters)
  const [titleCache, setTitleCache] = useState<Map<string, Title | null>>(new Map());
  const fetchingTitlesRef = useRef<Set<string>>(new Set());
  const ensureTitle = async (username: string) => {
    if (!username) return;
    if (titleCache.has(username) || fetchingTitlesRef.current.has(username)) return;
    fetchingTitlesRef.current.add(username);
    try {
      const resp = await api<unknown>(`/users/${encodeURIComponent(username)}/current-title`);
      const t = extractTitleFromResponse(resp);
      setTitleCache((prev) => {
        const next = new Map(prev);
        next.set(username, t ?? null);
        return next;
      });
    } catch {
      setTitleCache((prev) => {
        const next = new Map(prev);
        next.set(username, null);
        return next;
      });
    } finally {
      fetchingTitlesRef.current.delete(username);
    }
  };

  useEffect(() => {
    const token = getToken();
    if (token) {
      const payload = decodeJwtPayload(token);
      if (payload?.username) setCurrentUser({ username: payload.username });
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await api<Post>(`/posts/${id}`);
        setPost(data);
        // eager load comments (handle paged shape)
        const csRaw = await api<unknown>(`/posts/${id}/comments`);
        const normalized = normalizeCommentsResponse(csRaw);
        setComments(normalized);

        // titles for author + commenters
        if (data?.username) ensureTitle(data.username);
        const uniqUsers = Array.from(new Set(normalized.map((c) => c.username))).filter(Boolean);
        uniqUsers.forEach((u) => void ensureTitle(u));
      } catch {
        setPost(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // If comments change later (e.g., after adding), ensure titles for new usernames
  useEffect(() => {
    const uniqUsers = Array.from(new Set(comments.map((c) => c.username))).filter(Boolean);
    uniqUsers.forEach((u) => void ensureTitle(u));
  }, [comments]);

  const isOwner = useMemo(() => !!(currentUser && post && currentUser.username === post.username), [currentUser, post]);

  const handleLike = async () => {
    if (!post || liking) return;
    setLiking(true);
    const optimistic = { ...post, isLiked: !post.isLiked, likes: (post.isLiked ? post.likes - 1 : post.likes + 1) };
    setPost(optimistic);
    try {
      const res = await api<{ likeCount: number; liked: boolean }>(`/posts/${post.id}/like`, { method: "POST" });
      setPost((p) => (p ? { ...p, likes: res.likeCount, isLiked: res.liked } : p));
    } catch {
      // revert
      setPost(post);
      alert("Error liking post");
    } finally {
      setLiking(false);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Schedura", text: "Check out this post", url });
        return;
      }
    } catch {
      // ignore
    }
    try {
      await navigator.clipboard.writeText(url);
      alert("Post link copied to clipboard!");
    } catch {
      alert(url);
    }
    // Optional analytics: POST /posts/:id/share
    // void api(`/posts/${post?.id}/share`, { method: "POST" }).catch(() => {});
  };

  const addComment = async () => {
    if (!post || !newComment.trim() || commentBusy) return;
    setCommentBusy(true);
    try {
      const created = await api<Comment>(`/posts/${post.id}/comment`, {
        method: "POST",
        body: { content: newComment.trim() },
      });
      setComments((c) => [...c, created]);
      setPost((p) => (p ? { ...p, comments: p.comments + 1 } : p));
      setNewComment("");
      // ensure title for self/new commenter
      if (created?.username) void ensureTitle(created.username);
    } catch {
      alert("Error adding comment");
    } finally {
      setCommentBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card><CardContent className="p-6"><p>Loading post…</p></CardContent></Card>
      </div>
    );
  }
  if (!post) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardContent className="p-6 text-center">
            <p className="mb-4">Post not found.</p>
            <Button onClick={() => navigate("/posts")}>Back to Feed</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const authorTitle = titleCache.get(post.username) ?? null;

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-6">
      <Card className="border">
        <CardContent className="p-5 sm:p-6">
          {/* header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 min-w-0">
              {post.avatarUrl ? (
                <img
                  src={post.avatarUrl}
                  alt={post.display_name}
                  className="h-10 w-10 rounded-full object-cover border"
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              ) : (
                <Initials name={post.display_name} username={post.username} className="h-10 w-10" />
              )}
              <div className="min-w-0">
                <p className="font-semibold truncate">{post.display_name}</p>
                <p className="text-sm text-muted-foreground truncate">
                  @{post.username} • <span title={fmtDate(post.created_at)}>{timeAgo(post.created_at)}</span>
                </p>
                {authorTitle ? (
                  <div className="mt-1">
                    <TitleChip title={authorTitle} />
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={handleShare}>
                <Share2 className="h-4 w-4 mr-1" /> Share
              </Button>
            </div>
          </div>

          {/* tags */}
          {post.tags && post.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {post.tags.map((t, i) => (
                <Badge key={`${post.id}-tag-${i}-${t}`} variant="secondary" className="rounded-full">
                  <Hash className="h-3.5 w-3.5 mr-1" /> {t}
                </Badge>
              ))}
            </div>
          )}

          {/* content */}
          <p className="mb-4 whitespace-pre-wrap leading-relaxed">{post.content}</p>

          {/* images */}
          {post.pictures && post.pictures.length > 0 && (
            <div className={clsx("gap-2 mb-4", post.pictures.length === 1 ? "grid grid-cols-1" : "grid grid-cols-2")}>
              {post.pictures.slice(0, 4).map((pic, idx) => (
                <img
                  key={idx}
                  src={pic}
                  alt={`Post image ${idx}`}
                  className={clsx(
                    "rounded-lg w-full object-cover cursor-pointer",
                    post.pictures.length === 1 ? "max-h-96" : "max-h-60"
                  )}
                  onClick={() => setImagePreview(pic)}
                />
              ))}
            </div>
          )}

          {/* group */}
          {post.attachedGroup && (
            <Card className="mb-4 bg-primary/5 border-primary/20">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/20 rounded-lg">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{post.attachedGroup.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {post.attachedGroup.memberCount ?? 0} members
                      </p>
                    </div>
                  </div>
                  {/* optional: join button can be wired like feed page */}
                </div>
              </CardContent>
            </Card>
          )}

          {/* actions */}
          <div className="flex items-center gap-6 text-muted-foreground">
            <button
              className={clsx("flex items-center gap-2 transition-colors", post.isLiked ? "text-red-500" : "hover:text-primary")}
              disabled={liking}
              onClick={handleLike}
              title="Like"
            >
              <Heart className="h-4 w-4" />
              <span>{post.likes}</span>
            </button>
            <span className="inline-flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span>{comments.length}</span>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* comments */}
      <Card className="border">
        <CardContent className="p-5 sm:p-6">
          <h3 className="font-semibold mb-4">Comments</h3>
          <div className="space-y-4 mb-4">
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            ) : (
              comments.map((c) => {
                const cTitle = titleCache.get(c.username) ?? null;
                return (
                  <div key={c.id} className="border-b pb-3">
                    <div className="flex items-center gap-3">
                      {c.avatarUrl ? (
                        <img
                          src={c.avatarUrl}
                          alt={c.display_name}
                          className="h-8 w-8 rounded-full object-cover border"
                          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                        />
                      ) : (
                        <Initials name={c.display_name} username={c.username} className="h-8 w-8" />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold leading-tight">{c.display_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          @{c.username} • <span title={fmtDate(c.created_at)}>{timeAgo(c.created_at)}</span>
                        </p>
                        {cTitle ? (
                          <div className="mt-0.5">
                            <TitleChip title={cTitle} className="text-[11px] px-1.5 py-0.5" />
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

          <div className="flex gap-2">
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment…"
              rows={2}
            />
            <Button onClick={addComment} disabled={commentBusy}>Post</Button>
          </div>
        </CardContent>
      </Card>

      {/* image preview */}
      <Dialog open={!!imagePreview} onOpenChange={() => setImagePreview(null)}>
        <DialogContent className="max-w-4xl">
          {imagePreview && (
            <img src={imagePreview} alt="Full size preview" className="w-full h-auto rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
