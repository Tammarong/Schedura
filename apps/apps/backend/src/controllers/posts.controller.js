// controllers/posts.controller.js
import prisma from "../lib/prisma.js";
import { z } from "zod";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";

/* ---------------- HELPERS ---------------- */

// Build an absolute URL for things like "/api/..."
// Works in prod behind proxies (Vercel/Render/Nginx) and in local dev.
// Priority: BACKEND_PUBLIC_URL -> X-Forwarded headers -> req.protocol/host -> localhost.
const absoluteUrl = (p, req) => {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;

  const raw = p.startsWith("/") ? p : `/${p}`;
  const envBase = process.env.BACKEND_PUBLIC_URL && process.env.BACKEND_PUBLIC_URL.replace(/\/+$/, "");

  const xfProto = req?.get?.("x-forwarded-proto");
  const xfHost = req?.get?.("x-forwarded-host");
  const xfPort = req?.get?.("x-forwarded-port");
  const proto = xfProto || req?.protocol || "http";
  const host = xfHost || req?.get?.("host") || "localhost:4000";
  const portPart = xfPort && !/:(\d+)$/.test(host) ? `:${xfPort}` : "";

  const fallbackBase = `${proto}://${host}${portPart}`.replace(/\/+$/, "");
  const base = envBase || fallbackBase;

  return `${base}${raw}`;
};

// Turn a URL or "/uploads/xxx.jpg" into a safe local path "uploads/xxx.jpg"
const toLocalUploadPath = (urlish) => {
  try {
    const raw = /^https?:\/\//i.test(urlish) ? new URL(urlish).pathname : urlish;
    const rel = raw.startsWith("/") ? raw.slice(1) : raw;
    if (!rel.startsWith("uploads/")) return null;
    // normalize and strip any parent directory attempts
    const safe = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "");
    return safe;
  } catch {
    return null;
  }
};

const parseTagsFromBody = (raw) => {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    const cleaned = Array.from(
      new Set(
        parsed
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 12)
      )
    ).map((t) => (t.length > 40 ? t.slice(0, 40) : t));
    return cleaned;
  } catch {
    return [];
  }
};

// Basic file guard (multer should already enforce, this is defense-in-depth)
const isAllowedImage = (file) => {
  if (!file) return false;
  const mime = (file.mimetype || "").toLowerCase();
  const name = (file.originalname || "").toLowerCase();

  // accept any image/* (covers jpeg, png, webp, gif, heic in some setups, etc.)
  if (mime.startsWith("image/")) return true;

  // fall back to extension check in case mime is missing or octet-stream
  return /\.(jpe?g|png|webp|gif|heic|heif|bmp|tiff?)$/i.test(name);
};

// Read the uploaded bytes no matter which multer storage you use.
const readUploadedBytes = async (file) => {
  if (!file) return null;
  if (file.buffer && Buffer.isBuffer(file.buffer)) return file.buffer; // memoryStorage
  if (file.path) {
    const buf = await fsp.readFile(file.path); // diskStorage
    // best-effort cleanup of temp file
    fsp.unlink(file.path).catch(() => {});
    return buf;
  }
  return null;
};

/* ---------------- VALIDATION ---------------- */
const createSchema = z.object({
  content: z.string().min(1, "content is required"),
  group_id: z
    .union([z.string(), z.number()])
    .transform((v) => Number(v))
    .refine((n) => Number.isFinite(n), { message: "group_id must be a number" })
    .optional(),
  tags: z.any().optional(),
});

const commentSchema = z.object({
  content: z.string().min(1, "content is required"),
});

/* ---------------- MAPPER ---------------- */
// Always return stable /raw URLs (they stream from DB; fall back to file if needed)
const mapPost = (p, currentUserId, req) => ({
  id: p.id,
  content: p.content,
  user_id: p.user_id,
  group_id: p.group_id,
  created_at: p.created_at,
  username: p.users.username,
  display_name: p.users.display_name,
  avatarUrl: absoluteUrl(p.users.avatar_url, req),
  likes: p._count?.likes ?? p.likes?.length ?? 0,
  comments: p._count?.comments ?? p.comments?.length ?? 0,
  isLiked: currentUserId ? (p.likes || []).some((l) => l.user_id === currentUserId) : false,
  pictures:
    (p.pictures || []).map((pic) =>
      absoluteUrl(`/api/posts/${p.id}/pictures/${pic.id}/raw`, req)
    ),
  tags: p.tags ?? [],
  attachedGroup: p.groups
    ? {
        id: p.groups.id,
        name: p.groups.name,
        memberCount: p.groups._count?.group_members ?? p.groups.group_members?.length ?? 0,
      }
    : undefined,
});

/* ---------------- CREATE POST ---------------- */
export async function createPost(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const parsed = createSchema.parse({
      ...req.body,
      group_id: req.body.group_id,
      tags: req.body.tags,
    });

    const tags = parseTagsFromBody(parsed.tags);

    // ✅ collect images for .fields() (pictures[], image[])
    //    and still support .single() / .array() fallbacks.
    let files = [];
    if (req.files && typeof req.files === "object" && !Array.isArray(req.files)) {
      const buckets = /** @type {{[k:string]: import('multer').File[]}} */ (req.files);
      const pics = Array.isArray(buckets.pictures) ? buckets.pictures : [];
      const legacy = Array.isArray(buckets.image) ? buckets.image : [];
      files = [...pics, ...legacy];
    } else if (req.file) {
      files = [req.file];
    }
    const safeFiles = files.filter(isAllowedImage).slice(0, 8); // cap to 8

    // one transaction: create post, then pictures
    const created = await prisma.$transaction(async (tx) => {
      const post = await tx.posts.create({
        data: {
          user_id: req.user.id,
          group_id: Number.isFinite(parsed.group_id) ? parsed.group_id : null,
          content: parsed.content,
          tags,
        },
      });

      // Persist images to DB (blob/mime). Keep url = null for new rows.
      for (const f of safeFiles) {
        const bytes = await readUploadedBytes(f);
        if (!bytes || !bytes.length) continue;
        await tx.post_pictures.create({
          data: {
            post_id: post.id,
            blob: bytes,
            mime: f.mimetype || "application/octet-stream",
            url: null,
          },
        });
      }

      return tx.posts.findUnique({
        where: { id: post.id },
        include: {
          users: { select: { username: true, display_name: true, avatar_url: true } },
          groups: { include: { _count: { select: { group_members: true } } } },
          _count: { select: { likes: true, comments: true } },
          likes: true,
          comments: true,
          pictures: true,
        },
      });
    });

    return res.status(201).json(mapPost(created, req.user?.id, req));
  } catch (e) {
    console.error("Error in createPost:", e);
    if (e?.issues) return res.status(400).json({ error: e.issues });
    res.status(500).json({ error: "Create post failed" });
  }
}

/* ---------------- LIST POSTS (supports array OR paged) ---------------- */
export async function listPosts(req, res) {
  try {
    const currentUserId = req.user?.id;
    const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;

    const tagsParam = typeof req.query.tags === "string" ? req.query.tags : "";
    const tags = tagsParam
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // cursor & limit
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    const cursorId = req.query.cursorId ? Number(req.query.cursorId) : undefined;

    const where = {
      ...(Number.isFinite(groupId) ? { group_id: groupId } : {}),
      ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    };

    const rows = await prisma.posts.findMany({
      where,
      take: limit + 1,
      ...(Number.isFinite(cursorId) ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: "desc" }, // stable unique order
      include: {
        users: { select: { username: true, display_name: true, avatar_url: true } },
        groups: { include: { _count: { select: { group_members: true } } } },
        _count: { select: { likes: true, comments: true } },
        likes: currentUserId ? { where: { user_id: currentUserId } } : true,
        comments: true,
        pictures: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const mapped = items.map((p) => mapPost(p, currentUserId, req));
    const nextCursorId = hasMore ? items[items.length - 1].id : null;

    // Backward-compatible shape
    const wantsPaged =
      String(req.query.paged || "").trim() === "1" ||
      Number.isFinite(cursorId) ||
      (req.query.limit && req.query.limit !== undefined);

    if (wantsPaged) {
      return res.json({ items: mapped, nextCursorId, hasMore });
    }
    return res.json(mapped);
  } catch (err) {
    console.error("Error in listPosts:", err);
    res.status(500).json({ error: "Failed to list posts" });
  }
}

/* ---------------- LIKE / UNLIKE POST ---------------- */
export async function likePost(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "Invalid post id" });

    const userId = req.user.id;

    const existing = await prisma.post_likes.findFirst({
      where: { post_id: postId, user_id: userId },
    });

    let liked;
    if (existing) {
      await prisma.post_likes.delete({ where: { id: existing.id } });
      liked = false;
    } else {
      const exists = await prisma.posts.findUnique({ where: { id: postId }, select: { id: true } });
      if (!exists) return res.status(404).json({ error: "Post not found" });

      await prisma.post_likes.create({
        data: { post_id: postId, user_id: userId },
      });
      liked = true;
    }

    const likeCount = await prisma.post_likes.count({ where: { post_id: postId } });

    return res.json({ liked, likeCount });
  } catch (err) {
    console.error("Error in likePost:", err);
    res.status(500).json({ error: "Failed to like/unlike post" });
  }
}

/* ---------------- ADD COMMENT ---------------- */
export async function commentPost(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const { content } = commentSchema.parse(req.body);
    const postId = Number(req.params.id);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "Invalid post id" });

    const exists = await prisma.posts.findUnique({ where: { id: postId }, select: { id: true } });
    if (!exists) return res.status(404).json({ error: "Post not found" });

    const comment = await prisma.post_comments.create({
      data: {
        content,
        post_id: postId,
        user_id: req.user.id,
      },
      include: {
        users: { select: { username: true, display_name: true, avatar_url: true } },
      },
    });

    return res.status(201).json({
      id: comment.id,
      content: comment.content,
      user_id: comment.user_id,
      username: comment.users.username,
      display_name: comment.users.display_name,
      avatarUrl: absoluteUrl(comment.users.avatar_url, req),
      created_at: comment.created_at,
    });
  } catch (err) {
    console.error("Error in commentPost:", err);
    if (err?.issues) return res.status(400).json({ error: err.issues });
    res.status(500).json({ error: "Failed to add comment" });
  }
}

/* ---------------- GET COMMENTS (paged) ---------------- */
export async function getPostComments(req, res) {
  try {
    const postId = Number(req.params.id);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "Invalid post id" });

    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const cursorId = req.query.cursorId ? Number(req.query.cursorId) : undefined;

    const comments = await prisma.post_comments.findMany({
      where: { post_id: postId },
      take: limit + 1,
      ...(Number.isFinite(cursorId) ? { cursor: { id: cursorId }, skip: 1 } : {}),
      orderBy: { id: "asc" },
      include: {
        users: { select: { username: true, display_name: true, avatar_url: true } },
      },
    });

    const hasMore = comments.length > limit;
    const items = hasMore ? comments.slice(0, limit) : comments;
    const nextCursorId = hasMore ? items[items.length - 1].id : null;

    return res.json({
      items: items.map((c) => ({
        id: c.id,
        content: c.content,
        user_id: c.user_id,
        username: c.users.username,
        display_name: c.users.display_name,
        avatarUrl: absoluteUrl(c.users.avatar_url, req),
        created_at: c.created_at,
      })),
      nextCursorId,
      hasMore,
    });
  } catch (err) {
    console.error("Error in getPostComments:", err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
}

/* ---------------- DELETE POST (OWNER-ONLY) ---------------- */
export async function deletePost(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const postId = Number(req.params.id);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "Invalid post id" });

    const post = await prisma.posts.findUnique({
      where: { id: postId },
      select: {
        user_id: true,
        pictures: { select: { url: true } }, // legacy cleanup only; DB blobs are removed via deleteMany below
      },
    });

    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.user_id !== req.user.id) return res.status(403).json({ error: "Not allowed" });

    const filePaths =
      (post.pictures || [])
        .map((p) => toLocalUploadPath(p.url))
        .filter(Boolean);

    await prisma.$transaction(async (tx) => {
      await tx.post_pictures.deleteMany({ where: { post_id: postId } });
      await tx.post_likes.deleteMany({ where: { post_id: postId } });
      await tx.post_comments.deleteMany({ where: { post_id: postId } });
      await tx.posts.delete({ where: { id: postId } });
    });

    // best-effort disk cleanup for legacy files
    for (const relPath of filePaths) {
      const abs = path.resolve(process.cwd(), relPath);
      fs.promises.unlink(abs).catch(() => {});
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("Error in deletePost:", err);
    res.status(500).json({ error: "Failed to delete post" });
  }
}

/* ---------------- GET PICTURE RAW (DB-BACKED) ---------------- */
// GET /api/posts/:postId/pictures/:picId/raw
export async function getPostPictureRaw(req, res) {
  try {
    const postId = Number(req.params.postId);
    const picId = Number(req.params.picId);
    if (!Number.isFinite(postId) || !Number.isFinite(picId)) return res.status(400).end();

    const pic = await prisma.post_pictures.findFirst({
      where: { id: picId, post_id: postId },
      select: { blob: true, mime: true, url: true },
    });
    if (!pic) return res.status(404).end();

    // Prefer DB blob
    if (pic.blob && pic.blob.length) {
      res.setHeader("Content-Type", pic.mime || "application/octet-stream");
      res.setHeader("Content-Length", String(pic.blob.length));
      res.setHeader("Cache-Control", "public, max-age=604800, must-revalidate"); // 7 days
      return res.status(200).end(Buffer.from(pic.blob));
    }

    // Legacy fallback to file on disk (if still present)
    if (pic.url && pic.url.startsWith("/uploads/")) {
      try {
        const abs = path.join(process.cwd(), pic.url.replace(/^\/+/, ""));
        const buf = await fsp.readFile(abs);
        res.setHeader("Content-Type", pic.mime || "image/*");
        res.setHeader("Content-Length", String(buf.length));
        res.setHeader("Cache-Control", "public, max-age=604800, must-revalidate");
        return res.status(200).end(buf);
      } catch {
        // fall through to 404
      }
    }

    return res.status(404).end();
  } catch (err) {
    console.error("Error in getPostPictureRaw:", err);
    return res.status(500).end();
  }
}

/* ---------------- GET SINGLE POST (PUBLIC; auth-optional) ---------------- */
// GET /api/posts/:id
export async function getPostById(req, res) {
  try {
    const postId = Number(req.params.id);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "Invalid post id" });

    const currentUserId = req.user?.id ?? undefined;

    const row = await prisma.posts.findUnique({
      where: { id: postId },
      include: {
        users: { select: { username: true, display_name: true, avatar_url: true } },
        groups: { include: { _count: { select: { group_members: true } } } },
        _count: { select: { likes: true, comments: true } },
        likes: currentUserId ? { where: { user_id: currentUserId } } : true,
        comments: true,
        pictures: true,
      },
    });

    if (!row) return res.status(404).json({ error: "Not found" });

    const payload = mapPost(row, currentUserId, req);
    return res.json(payload);
  } catch (err) {
    console.error("Error in getPostById:", err);
    return res.status(500).json({ error: "Failed to fetch post" });
  }
}

/* ---------------- OPTIONAL: SHARE ANALYTICS ---------------- */
// POST /api/posts/:id/share
// Add `share_count Int @default(0)` to your Prisma `posts` model if you want.
// Safe no-op if the field doesn't exist (we still return { ok: true }).
export async function trackShare(req, res) {
  try {
    const postId = Number(req.params.id);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "Invalid post id" });

    try {
      await prisma.posts.update({
        where: { id: postId },
        data: { share_count: { increment: 1 } },
      });
    } catch (_e) {
      // Field might not exist yet; ignore to keep endpoint harmless
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error in trackShare:", err);
    return res.status(500).json({ error: "Failed to track share" });
  }
}

