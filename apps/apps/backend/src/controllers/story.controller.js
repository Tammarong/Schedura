// src/controllers/story.controller.js
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

/* ------------------- auth helpers (same style as titles) ------------------- */
function readBearerToken(req) {
  const auth = req.headers.authorization || req.headers.Authorization || "";
  const m = String(auth).match(/^\s*Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function verifyJwtOrNull(token) {
  if (!token) return null;
  try {
    if (process.env.JWT_PUBLIC_KEY) {
      return jwt.verify(token, process.env.JWT_PUBLIC_KEY, { algorithms: ["RS256"] });
    }
    if (process.env.JWT_SECRET) {
      return jwt.verify(token, process.env.JWT_SECRET, { algorithms: ["HS256"] });
    }
    // DEV fallback decode (unsafe): only if no keys configured
    return JSON.parse(Buffer.from(token.split(".")[1] || "", "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function authedUserId(req) {
  if (req.user && req.user.id) return req.user.id;
  const token = readBearerToken(req);
  const payload = verifyJwtOrNull(token);
  if (!payload || !payload.id) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  return payload.id;
}

/* --------------------------- relationship helpers -------------------------- */
async function isBlocked(aId, bId) {
  // true if either has blocked the other
  const block = await prisma.user_blocks.findFirst({
    where: {
      OR: [
        { blocker_id: aId, blockee_id: bId },
        { blocker_id: bId, blockee_id: aId },
      ],
    },
    select: { id: true },
  });
  return !!block;
}

async function isFollowerAccepted(viewerId, ownerId) {
  if (viewerId === ownerId) return true;
  const edge = await prisma.user_follows.findUnique({
    where: { follower_id_followee_id: { follower_id: viewerId, followee_id: ownerId } },
    select: { status: true },
  });
  return edge?.status === "accepted";
}

/* ------------------------------- shape helpers ----------------------------- */
function pickStory(s, opts = {}) {
  const { includeHasSeen = false } = opts;
  return {
    id: s.id,
    userId: s.user_id,
    caption: s.caption || null,
    visibility: s.visibility,
    media: {
      url: s.media_url || (s.media_blob ? `/stories/${s.id}/media` : null),
      mime: s.media_mime || null,
      width: s.media_width || null,
      height: s.media_height || null,
      seconds: s.media_seconds || null,
    },
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    archivedAt: s.archived_at,
    ...(includeHasSeen ? { hasSeen: !!s._hasSeen } : {}),
  };
}

/* --------------------------------- actions --------------------------------- */

// POST /api/stories
// Accepts either multipart/form-data with field "file" OR JSON { media_url, caption, visibility }
export async function createStory(req, res, next) {
  try {
    const uid = await authedUserId(req);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let media_url = null,
      media_blob = null,
      media_mime = null,
      media_width = null,
      media_height = null,
      media_seconds = null;

    if (req.file) {
      media_blob = req.file.buffer;
      media_mime = req.file.mimetype || null;
      if (req.body.media_width) media_width = parseInt(req.body.media_width, 10) || null;
      if (req.body.media_height) media_height = parseInt(req.body.media_height, 10) || null;
      if (req.body.media_seconds) media_seconds = parseInt(req.body.media_seconds, 10) || null;
    } else if (req.body && req.body.media_url) {
      media_url = String(req.body.media_url);
      media_mime = req.body.media_mime || null;
      media_width = req.body.media_width ? parseInt(req.body.media_width, 10) : null;
      media_height = req.body.media_height ? parseInt(req.body.media_height, 10) : null;
      media_seconds = req.body.media_seconds ? parseInt(req.body.media_seconds, 10) : null;
    } else {
      return res.status(400).json({ error: "No media provided" });
    }

    const visibility = req.body.visibility || "auto";
    const caption = req.body.caption ? String(req.body.caption).slice(0, 500) : null;

    const story = await prisma.stories.create({
      data: {
        user_id: uid,
        caption,
        visibility,
        media_url,
        media_blob,
        media_mime,
        media_width,
        media_height,
        media_seconds,
        created_at: now,
        expires_at: expiresAt,
        keep_forever: false,
      },
    });

    return res.json({ story: pickStory(story) });
  } catch (err) {
    next(err);
  }
}

// GET /api/stories/feed
// Returns active stories (expires_at > now) from people you can view (respect privacy/blocks)
export async function getFeed(req, res, next) {
  try {
    const viewerId = await authedUserId(req);
    const now = new Date();

    const rows = await prisma.stories.findMany({
      where: { expires_at: { gt: now }, archived_at: null },
      orderBy: [{ user_id: "asc" }, { created_at: "desc" }],
    });

    const ownerIds = [...new Set(rows.map((r) => r.user_id))];
    const owners = await prisma.users.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, is_private: true },
    });
    const ownerMap = new Map(owners.map((u) => [u.id, u]));

    const views = await prisma.story_views.findMany({
      where: { viewer_id: viewerId, story_id: { in: rows.map((r) => r.id) } },
      select: { story_id: true },
    });
    const seenSet = new Set(views.map((v) => v.story_id));

    const result = [];
    for (const s of rows) {
      const owner = ownerMap.get(s.user_id);
      if (!owner) continue;
      if (await isBlocked(viewerId, s.user_id)) continue;

      let allowed = true;
      if (s.visibility === "public") {
        allowed = true;
      } else if (s.visibility === "followers" || (s.visibility === "auto" && owner.is_private)) {
        allowed = await isFollowerAccepted(viewerId, s.user_id);
      }
      if (!allowed && viewerId !== s.user_id) continue;

      result.push(pickStory({ ...s, _hasSeen: seenSet.has(s.id) }, { includeHasSeen: true }));
    }

    return res.json({ items: result });
  } catch (err) {
    next(err);
  }
}

// GET /api/stories/:username/active
export async function getActiveByUsername(req, res, next) {
  try {
    const viewerId = await authedUserId(req);
    const username = String(req.params.username);

    const user = await prisma.users.findUnique({
      where: { username },
      select: { id: true, is_private: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    if (await isBlocked(viewerId, user.id)) return res.json({ items: [] });

    const allowed =
      viewerId === user.id ||
      !user.is_private ||
      (await isFollowerAccepted(viewerId, user.id));
    if (!allowed) return res.json({ items: [] });

    const now = new Date();
    const items = await prisma.stories.findMany({
      where: { user_id: user.id, expires_at: { gt: now }, archived_at: null },
      orderBy: { created_at: "desc" },
    });

    const views = await prisma.story_views.findMany({
      where: { viewer_id: viewerId, story_id: { in: items.map((r) => r.id) } },
      select: { story_id: true },
    });
    const seenSet = new Set(views.map((v) => v.story_id));

    return res.json({
      items: items.map((s) =>
        pickStory({ ...s, _hasSeen: seenSet.has(s.id) }, { includeHasSeen: true })
      ),
    });
  } catch (err) {
    next(err);
  }
}

// GET /api/stories/:id/media  (streams blob or 302 to media_url)
export async function streamMedia(req, res, next) {
  try {
    const storyId = parseInt(req.params.id, 10);
    if (!Number.isFinite(storyId)) return res.status(400).end();

    const s = await prisma.stories.findUnique({
      where: { id: storyId },
      select: { media_blob: true, media_mime: true, media_url: true },
    });
    if (!s) return res.status(404).end();

    if (s.media_url) {
      return res.redirect(s.media_url);
    }
    if (s.media_blob) {
      if (s.media_mime) res.setHeader("Content-Type", s.media_mime);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // blob is immutable by id
      return res.end(Buffer.from(s.media_blob));
    }
    return res.status(404).end();
  } catch (err) {
    next(err);
  }
}

// POST /api/stories/:id/view
export async function markView(req, res, next) {
  try {
    const viewerId = await authedUserId(req);
    const id = parseInt(req.params.id, 10);
    const s = await prisma.stories.findUnique({
      where: { id },
      select: { id: true, user_id: true, expires_at: true, archived_at: true },
    });
    if (!s) return res.status(404).json({ error: "Story not found" });
    if (s.expires_at <= new Date() && !s.archived_at) return res.status(410).json({ error: "Expired" });
    if (await isBlocked(viewerId, s.user_id)) return res.status(403).json({ error: "Blocked" });

    await prisma.story_views.upsert({
      where: { story_id_viewer_id: { story_id: id, viewer_id: viewerId } },
      create: { story_id: id, viewer_id: viewerId },
      update: { viewed_at: new Date() },
    });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// POST /api/stories/:id/archive
export async function archiveStory(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const id = parseInt(req.params.id, 10);

    const s = await prisma.stories.findUnique({ where: { id }, select: { user_id: true } });
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.user_id !== uid) return res.status(403).json({ error: "Forbidden" });

    const updated = await prisma.stories.update({
      where: { id },
      data: { archived_at: new Date(), keep_forever: true },
    });

    return res.json({ story: pickStory(updated) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/stories/:id  (owner hard delete)
export async function deleteStory(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const id = parseInt(req.params.id, 10);

    const s = await prisma.stories.findUnique({ where: { id }, select: { user_id: true } });
    if (!s) return res.status(404).json({ error: "Not found" });
    if (s.user_id !== uid) return res.status(403).json({ error: "Forbidden" });

    await prisma.stories.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/* --------------------------- background clean-up --------------------------- */
/**
 * Soft "cron" inside the app: every N minutes, delete stories past 24h
 * that are NOT keep_forever (i.e., not archived or highlighted).
 * For true cron, also schedule a Render/Neon job to call a tiny endpoint.
 */
const CLEAN_INTERVAL_MIN = Number(process.env.STORY_CLEANUP_INTERVAL_MIN || 15);
setInterval(async () => {
  try {
    const deleted = await prisma.stories.deleteMany({
      where: {
        expires_at: { lt: new Date() },
        keep_forever: false,
      },
    });
    if (deleted.count > 0) {
      // optional: console.log(`[stories] cleanup removed ${deleted.count}`);
    }
  } catch {
    // optional: console.error("stories cleanup error", e);
  }
}, CLEAN_INTERVAL_MIN * 60 * 1000);
