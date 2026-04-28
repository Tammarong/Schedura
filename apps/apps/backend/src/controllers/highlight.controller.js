// src/controllers/highlight.controller.js
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

/* ----------------------------- auth ----------------------------- */
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

/* --------------------------------- shapes --------------------------------- */
function pickHighlight(h, withItems = false) {
  const base = {
    id: h.id,
    userId: h.user_id,
    title: h.title,
    coverStoryId: h.cover_story_id,
    createdAt: h.created_at,
    updatedAt: h.updated_at,
  };
  if (!withItems) return base;
  return {
    ...base,
    items: (h.items || []).map((it) => ({
      storyId: it.story_id,
      position: it.position,
      addedAt: it.added_at,
    })),
  };
}

/* -------------------------------- handlers -------------------------------- */

// POST /api/highlights  { title, coverStoryId? }
export async function createHighlight(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const title = String(req.body.title || "").trim().slice(0, 100);
    if (!title) return res.status(400).json({ error: "Title required" });

    let cover_story_id = null;
    if (req.body.coverStoryId) {
      const story = await prisma.stories.findUnique({
        where: { id: Number(req.body.coverStoryId) },
        select: { id: true, user_id: true },
      });
      if (!story || story.user_id !== uid) {
        return res.status(400).json({ error: "Invalid coverStoryId" });
      }
      cover_story_id = story.id;
      await prisma.stories.update({
        where: { id: story.id },
        data: { keep_forever: true },
      });
    }

    const h = await prisma.highlights.create({
      data: { user_id: uid, title, cover_story_id },
    });

    return res.json({ highlight: pickHighlight(h) });
  } catch (err) {
    next(err);
  }
}

// GET /api/highlights/me
export async function listMine(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const rows = await prisma.highlights.findMany({
      where: { user_id: uid },
      orderBy: { created_at: "desc" },
      include: { items: true },
    });
    return res.json({ items: rows.map((h) => pickHighlight(h, true)) });
  } catch (err) {
    next(err);
  }
}

// GET /api/highlights/:username
export async function listByUsername(req, res, next) {
  try {
    const username = String(req.params.username);
    const u = await prisma.users.findUnique({ where: { username }, select: { id: true } });
    if (!u) return res.status(404).json({ error: "User not found" });

    const rows = await prisma.highlights.findMany({
      where: { user_id: u.id },
      orderBy: { created_at: "desc" },
      include: { items: true },
    });
    return res.json({ items: rows.map((h) => pickHighlight(h, true)) });
  } catch (err) {
    next(err);
  }
}

// POST /api/highlights/:id/add  { storyId, position? }
export async function addToHighlight(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const highlightId = Number(req.params.id);
    const storyId = Number(req.body.storyId);
    const position = Number.isFinite(Number(req.body.position)) ? Number(req.body.position) : 0;

    const h = await prisma.highlights.findUnique({
      where: { id: highlightId },
      select: { id: true, user_id: true },
    });
    if (!h || h.user_id !== uid) return res.status(404).json({ error: "Highlight not found" });

    const s = await prisma.stories.findUnique({
      where: { id: storyId },
      select: { id: true, user_id: true },
    });
    if (!s || s.user_id !== uid) return res.status(400).json({ error: "Invalid storyId" });

    await prisma.highlight_items.upsert({
      where: { highlight_id_story_id: { highlight_id: highlightId, story_id: storyId } },
      create: { highlight_id: highlightId, story_id: storyId, position },
      update: { position, added_at: new Date() },
    });

    await prisma.stories.update({ where: { id: storyId }, data: { keep_forever: true } });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/highlights/:id/remove  { storyId }
export async function removeFromHighlight(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const highlightId = Number(req.params.id);
    const storyId = Number(req.body.storyId);

    const h = await prisma.highlights.findUnique({
      where: { id: highlightId },
      select: { id: true, user_id: true },
    });
    if (!h || h.user_id !== uid) return res.status(404).json({ error: "Highlight not found" });

    await prisma.highlight_items.delete({
      where: { highlight_id_story_id: { highlight_id: highlightId, story_id: storyId } },
    });

    const stillLinked = await prisma.highlight_items.findFirst({
      where: { story_id: storyId },
      select: { highlight_id: true },
    });
    if (!stillLinked) {
      await prisma.stories.update({
        where: { id: storyId },
        data: { keep_forever: false },
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/highlights/:id  { title?, coverStoryId? }
export async function updateHighlight(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const id = Number(req.params.id);
    const h = await prisma.highlights.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!h || h.user_id !== uid) return res.status(404).json({ error: "Not found" });

    const data = {};
    if (typeof req.body.title === "string") {
      data.title = req.body.title.trim().slice(0, 100);
    }
    if (req.body.coverStoryId != null) {
      const story = await prisma.stories.findUnique({
        where: { id: Number(req.body.coverStoryId) },
        select: { id: true, user_id: true },
      });
      if (!story || story.user_id !== uid) {
        return res.status(400).json({ error: "Invalid coverStoryId" });
      }
      data.cover_story_id = story.id;
      await prisma.stories.update({ where: { id: story.id }, data: { keep_forever: true } });
    }

    const updated = await prisma.highlights.update({ where: { id }, data });
    return res.json({ highlight: pickHighlight(updated) });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/highlights/:id
export async function deleteHighlight(req, res, next) {
  try {
    const uid = await authedUserId(req);
    const id = Number(req.params.id);

    const h = await prisma.highlights.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!h || h.user_id !== uid) return res.status(404).json({ error: "Not found" });

    await prisma.highlights.delete({ where: { id } });

    for (const it of h.items) {
      const other = await prisma.highlight_items.findFirst({
        where: { story_id: it.story_id },
        select: { highlight_id: true },
      });
      if (!other) {
        await prisma.stories.updateMany({
          where: { id: it.story_id, archived_at: null },
          data: { keep_forever: false },
        });
      }
    }

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
