// controllers/titles.controller.js
import pkg from "@prisma/client";
import jwt from "jsonwebtoken";
const { PrismaClient } = pkg;

let _prisma = null;
function prisma() {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

/** ---------------- small helpers ---------------- */

function readBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  // allow weird inputs like "Bearer Bearer token"
  let s = String(h).trim();
  // strip *all* leading schemes, not just one
  while (/^(Bearer|JWT|Token)\s+/i.test(s)) {
    s = s.replace(/^(Bearer|JWT|Token)\s+/i, "");
  }
  return s || null;
}

function verifyJwtOrNull(token) {
  if (!token) return null;
  // Prefer RS256 public key if present; otherwise HS256 with shared secret
  const pub = process.env.JWT_PUBLIC_KEY?.trim();
  const sec = process.env.JWT_SECRET?.trim();
  try {
    if (pub) return jwt.verify(token, pub, { algorithms: ["RS256"] });
    if (sec) return jwt.verify(token, sec, { algorithms: ["HS256"] });
    // If no keys are configured, accept unsigned payload in dev only (NOT for prod)
    if (process.env.NODE_ENV !== "production") {
      return jwt.decode(token) || null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function authedUserId(req) {
  // 1) cookie/session or upstream middleware
  let id = req.user?.id || req.user?.sub;

  // 2) fallback to Bearer JWT in Authorization header
  if (!id) {
    const token = readBearerToken(req);
    const payload = verifyJwtOrNull(token);
    id = payload?.sub || payload?.id || payload?.userId;
  }

  if (!id) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  return Number(id);
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** Shape normalizer for Title records (keep only public bits) */
function pickTitle(t) {
  if (!t) return null;
  return {
    id: t.id,
    key: t.key,
    label: t.label,
    description: t.description ?? null,
    emoji: t.emoji ?? null,
    color: t.color ?? null,
    rarity: t.rarity ?? null,
  };
}

/**
 * GET /titles/me
 * GET /users/me/titles
 * GET /me/titles
 * GET /titles/owned
 * Return owned titles + currently equipped title for the authed user.
 */
export async function listMyTitles(req, res) {
  try {
    const userId = authedUserId(req);

    const [owned, me] = await Promise.all([
      prisma().titles.findMany({
        where: { owned_by: { some: { user_id: userId } } },
        orderBy: [{ rarity: "asc" }, { label: "asc" }],
      }),
      prisma().users.findUnique({
        where: { id: userId },
        include: { current_title: true },
      }),
    ]);

    const titles = owned.map(pickTitle);
    const currentTitle = pickTitle(me?.current_title ?? null);

    return res.json({ titles, currentTitle });
  } catch (err) {
    const code = err.status || 500;
    return res.status(code).json({ error: err.message || "Failed to load titles" });
  }
}

/**
 * PATCH /users/me/current-title
 * PATCH /titles/equip
 * POST  /titles/equip
 * Body: { titleId: number | null }
 * Equip a title (must be owned) or unequip with null.
 */
export async function setMyCurrentTitle(req, res) {
  try {
    const userId = authedUserId(req);
    const raw = req.body?.titleId ?? req.body?.id ?? req.body?.title_id ?? null;
    const titleId = raw === null ? null : toIntOrNull(raw);

    if (titleId !== null && (!Number.isInteger(titleId) || titleId <= 0)) {
      return res.status(400).json({ error: "Invalid titleId" });
    }

    if (titleId === null) {
      // unequip
      const user = await prisma().users.update({
        where: { id: userId },
        data: { current_title_id: null },
        include: { current_title: true },
      });
      return res.json({ ok: true, currentTitle: pickTitle(user.current_title) });
    }

    // verify ownership
    const owned = await prisma().user_titles.findUnique({
      where: { user_id_title_id: { user_id: userId, title_id: titleId } },
      select: { user_id: true, title_id: true },
    });
    if (!owned) {
      return res.status(403).json({ error: "You do not own this title" });
    }

    // set as current
    const user = await prisma().users.update({
      where: { id: userId },
      data: { current_title_id: titleId },
      include: { current_title: true },
    });

    return res.json({ ok: true, currentTitle: pickTitle(user.current_title) });
  } catch (err) {
    const code = err.status || 500;
    return res.status(code).json({ error: err.message || "Failed to set title" });
  }
}

/**
 * GET /users/:username/current-title
 * GET /titles/current/:username
 * GET /titles/of/:username/current
 * Public: return current title for a username.
 */
export async function getCurrentTitleByUsername(req, res) {
  try {
    const username = String(req.params.username || "").trim();
    if (!username) return res.status(400).json({ error: "username is required" });

    const user = await prisma().users.findUnique({
      where: { username },
      include: { current_title: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({ currentTitle: pickTitle(user.current_title) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch current title" });
  }
}
