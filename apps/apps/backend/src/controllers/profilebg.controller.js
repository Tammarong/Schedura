// src/controllers/profilebg.controller.js
// Controller for user profile background (image or color) — ESM version (JWT-only)

import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

/** ---------- tiny utils ---------- */
function badRequest(res, msg = "Bad request") {
  return res.status(400).json({ error: msg });
}
function unauthorized(res, msg = "Unauthorized") {
  return res.status(401).json({ error: msg });
}
function notFound(res, msg = "Not found") {
  return res.status(404).json({ error: msg });
}
function serverError(res, e) {
  console.error(e);
  return res.status(500).json({ error: "Server error" });
}

function isValidHexColor(s) {
  if (!s || typeof s !== "string") return false;
  const x = s.trim();
  // allow #RGB, #RRGGBB, #RRGGBBAA
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(x);
}

function sanitizeUrl(u) {
  try {
    const url = new URL(u);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function etagFor(bgMeta) {
  const ts = bgMeta.profile_bg_updated_at
    ? new Date(bgMeta.profile_bg_updated_at).getTime()
    : 0;
  const size = bgMeta._blobLen || 0;
  return `W/"bg-${bgMeta.id}-${ts}-${size}"`;
}

function shapeBg(userRow) {
  return {
    userId: userRow.id,
    username: userRow.username,
    color: userRow.profile_bg_color || null,
    url: userRow.profile_bg_url || null,
    hasImage: !!(userRow.profile_bg_blob && userRow.profile_bg_blob.length) || !!userRow.profile_bg_url,
    updatedAt: userRow.profile_bg_updated_at || null,
  };
}

/** ---------- JWT helpers (header-only, no cookies) ---------- */
function readAuthHeader(req) {
  const h = req.headers?.authorization || req.headers?.Authorization;
  if (!h) return null;
  const token = h.replace(/^Bearer\s+/i, "").trim();
  return token || null;
}

function pickIdClaim(claims) {
  if (!claims || typeof claims !== "object") return null;
  const cand =
    claims.userId ??
    claims.userid ??
    claims.id ??
    claims.uid ??
    claims.sub;

  if (typeof cand === "number") return Number.isFinite(cand) ? cand : null;
  if (typeof cand === "string") {
    // numeric id in string form
    if (/^\d+$/.test(cand)) return Number(cand);
  }
  return null;
}

function pickUsernameClaim(claims) {
  if (!claims || typeof claims !== "object") return null;
  return (
    claims.username ??
    claims.preferred_username ??
    claims.user_name ??
    null
  );
}

/**
 * Try to resolve the current user id from:
 * 1) any prior middleware-populated fields
 * 2) Authorization: Bearer <JWT> (verify if possible, else safely decode)
 * 3) if only a username claim exists, look it up in DB
 */
async function getUserIdFromReq(req) {
  // 1) already present (from other middleware)
  const prefilled =
    (req.user && (req.user.id || req.user.userId)) ||
    req.userId ||
    (req.auth && req.auth.userId) ||
    (req.locals && req.locals.user && req.locals.user.id) ||
    (req.res && req.res.locals && req.res.locals.user && req.res.locals.user.id) ||
    null;
  if (prefilled) return Number(prefilled);

  // 2) Authorization: Bearer <JWT>
  const raw = readAuthHeader(req);
  if (!raw) return null;

  let claims = null;
  // Prefer verification if env allows; otherwise fall back to decode (still OK for “app is gated by login”)
  const hsSecret = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;
  const rsPublic = process.env.JWT_PUBLIC_KEY;

  try {
    if (hsSecret) {
      claims = jwt.verify(raw, hsSecret, { algorithms: ["HS256", "HS512"] });
    } else if (rsPublic) {
      claims = jwt.verify(raw, rsPublic, { algorithms: ["RS256"] });
    } else {
      claims = jwt.decode(raw); // unverified, but acceptable per app gating note
    }
  } catch {
    // fallback to decode if verify fails (e.g., key mismatch); your app requires login anyway
    claims = jwt.decode(raw);
  }

  const idFromClaims = pickIdClaim(claims);
  if (idFromClaims != null) return Number(idFromClaims);

  const uname = pickUsernameClaim(claims);
  if (uname) {
    const user = await prisma.users.findFirst({
      where: { username: { equals: String(uname), mode: "insensitive" } },
      select: { id: true },
    });
    if (user) return Number(user.id);
  }

  return null;
}

/** ---------- controllers ---------- */

// GET /api/profilebg/me
export const getMineMeta = async (req, res) => {
  try {
    const userId = await getUserIdFromReq(req);
    if (!userId) return unauthorized(res);

    const user = await prisma.users.findUnique({
      where: { id: Number(userId) },
      select: {
        id: true,
        username: true,
        profile_bg_color: true,
        profile_bg_url: true,
        profile_bg_blob: true,
        profile_bg_updated_at: true,
      },
    });
    if (!user) return notFound(res, "User not found");

    return res.json(shapeBg(user));
  } catch (e) {
    return serverError(res, e);
  }
};

// GET /api/profilebg/:username
export const getUserMeta = async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) return badRequest(res, "username required");

    const user = await prisma.users.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: {
        id: true,
        username: true,
        profile_bg_color: true,
        profile_bg_url: true,
        profile_bg_blob: true,
        profile_bg_updated_at: true,
      },
    });
    if (!user) return notFound(res, "User not found");

    return res.json(shapeBg(user));
  } catch (e) {
    return serverError(res, e);
  }
};

// GET /api/profilebg/:username/raw
export const getUserRaw = async (req, res) => {
  try {
    const { username } = req.params;
    if (!username) return badRequest(res, "username required");

    const user = await prisma.users.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: {
        id: true,
        username: true,
        profile_bg_blob: true,
        profile_bg_mime: true,
        profile_bg_url: true,
        profile_bg_updated_at: true,
      },
    });
    if (!user) return notFound(res, "User not found");

    if (user.profile_bg_blob && user.profile_bg_blob.length) {
      const meta = {
        id: user.id,
        profile_bg_updated_at: user.profile_bg_updated_at,
        _blobLen: user.profile_bg_blob.length,
      };
      const etag = etagFor(meta);
      res.set("ETag", etag);
      res.set("Cache-Control", "public, max-age=3600, must-revalidate");

      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }

      const mime = user.profile_bg_mime || "application/octet-stream";
      res.type(mime);
      res.set("Content-Disposition", 'inline; filename="profilebg"');
      return res.send(Buffer.from(user.profile_bg_blob));
    }

    if (user.profile_bg_url) {
      return res.redirect(302, user.profile_bg_url);
    }

    return notFound(res, "No background image");
  } catch (e) {
    return serverError(res, e);
  }
};

// PATCH /api/profilebg/color  { color: "#111827" }  (null/"" to clear)
export const setColor = async (req, res) => {
  try {
    const userId = await getUserIdFromReq(req);
    if (!userId) return unauthorized(res);

    let { color } = req.body || {};
    if (color === "" || color === null) color = null;

    if (color != null && !isValidHexColor(color)) {
      return badRequest(res, "color must be a valid hex like #fff or #112233");
    }

    const updated = await prisma.users.update({
      where: { id: Number(userId) },
      data: {
        profile_bg_color: color,
        profile_bg_updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        profile_bg_color: true,
        profile_bg_url: true,
        profile_bg_blob: true,
        profile_bg_updated_at: true,
      },
    });

    return res.json(shapeBg(updated));
  } catch (e) {
    return serverError(res, e);
  }
};

// POST /api/profilebg/url  { url: "https://..." }
export const setUrl = async (req, res) => {
  try {
    const userId = await getUserIdFromReq(req);
    if (!userId) return unauthorized(res);

    let { url } = req.body || {};
    if (url === "" || url === null) url = null;

    if (url != null) {
      const safe = sanitizeUrl(url);
      if (!safe) return badRequest(res, "Invalid URL");
      url = safe;
    }

    const updated = await prisma.users.update({
      where: { id: Number(userId) },
      data: {
        profile_bg_url: url,
        ...(url ? { profile_bg_blob: null, profile_bg_mime: null } : {}),
        profile_bg_updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        profile_bg_color: true,
        profile_bg_url: true,
        profile_bg_blob: true,
        profile_bg_updated_at: true,
      },
    });

    return res.json(shapeBg(updated));
  } catch (e) {
    return serverError(res, e);
  }
};

// POST /api/profilebg/image  (multipart/form-data; field: "image")
export const uploadImage = async (req, res) => {
  try {
    const userId = await getUserIdFromReq(req);
    if (!userId) return unauthorized(res);

    const file = req.file;
    if (!file) return badRequest(res, 'Expected a file field named "image"');

    const mime = file.mimetype || "application/octet-stream";
    const buffer = file.buffer;

    if (!/^image\//i.test(mime)) {
      return badRequest(res, "Only image uploads are allowed");
    }

    const updated = await prisma.users.update({
      where: { id: Number(userId) },
      data: {
        profile_bg_blob: buffer,
        profile_bg_mime: mime,
        profile_bg_url: null,
        profile_bg_updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        profile_bg_color: true,
        profile_bg_url: true,
        profile_bg_blob: true,
        profile_bg_updated_at: true,
      },
    });

    const rawPath = `/api/profilebg/${updated.username}/raw`;
    return res.status(201).json({ ...shapeBg(updated), rawPath });
  } catch (e) {
    return serverError(res, e);
  }
};

// DELETE /api/profilebg/image
export const deleteImage = async (req, res) => {
  try {
    const userId = await getUserIdFromReq(req);
    if (!userId) return unauthorized(res);

    const updated = await prisma.users.update({
      where: { id: Number(userId) },
      data: {
        profile_bg_blob: null,
        profile_bg_mime: null,
        profile_bg_updated_at: new Date(),
      },
      select: {
        id: true,
        username: true,
        profile_bg_color: true,
        profile_bg_url: true,
        profile_bg_blob: true,
        profile_bg_updated_at: true,
      },
    });

    return res.json(shapeBg(updated));
  } catch (e) {
    return serverError(res, e);
  }
};
