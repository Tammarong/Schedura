import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import prisma from "../lib/prisma.js";

/* ------------ URL helpers (proxy-aware) ------------ */
function resolveBaseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function toFullUrl(req, relPath) {
  if (!relPath) return null;
  const base = resolveBaseUrl(req);
  const withSlash = relPath.startsWith("/") ? relPath : `/${relPath}`;
  return `${base}${withSlash}`;
}

/* ------------ FS helpers (for cleaning old disk avatars) ------------ */
function normalizeStoredPath(p) {
  if (!p) return null;
  try {
    const u = new URL(p);
    return u.pathname || null;
  } catch {
    return p.startsWith("/") ? p : `/${p}`;
  }
}

function isLocalAvatar(rel) {
  const p = normalizeStoredPath(rel);
  return !!p && /^\/?uploads\/avatars\//i.test(p.replace(/^\/+/, ""));
}

function absFromRelative(rel) {
  const clean = (rel || "").replace(/^\/+/, "");
  return path.join(process.cwd(), clean);
}

/* ------------ Finder ------------ */
async function findUserByParam(param) {
  if (!param) return null;
  if (/^\d+$/.test(param)) {
    return prisma.users.findUnique({ where: { id: Number(param) } });
  }
  return prisma.users.findUnique({ where: { username: param } });
}

/* ------------ Small helpers ------------ */
async function readUploadedBytes(file) {
  // Prefer memoryStorage buffer
  if (file && file.buffer && Buffer.isBuffer(file.buffer)) {
    return file.buffer;
  }
  // Fallback: if multer wrote to disk, read it once, then you can delete it
  if (file && file.path) {
    const buf = await fs.readFile(file.path);
    // best-effort cleanup of temp file
    fs.unlink(file.path).catch(() => {});
    return buf;
  }
  return null;
}

function inferMime(file) {
  // Trust multer's detected mimetype if present
  if (file && typeof file.mimetype === "string" && file.mimetype) return file.mimetype;
  // Fallback: allow frontend to pass "image/*" only; default to octet-stream
  return "application/octet-stream";
}

function makeEtag(bytes, updatedAt) {
  const h = crypto.createHash("sha1");
  h.update(bytes);
  if (updatedAt) h.update(String(updatedAt.getTime()));
  return `"${h.digest("hex")}"`;
}

/**
 * POST /api/avatar
 * form-data: avatar=<file>
 * Requires auth middleware to populate req.user.id
 */
export async function uploadAvatar(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ error: "Avatar file is required" });

    const bytes = await readUploadedBytes(req.file);
    if (!bytes || !bytes.length) return res.status(400).json({ error: "Invalid file" });

    const mime = inferMime(req.file);

    // Clean up previous local avatar file if any, and clear avatar_url
    const me = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { avatar_url: true },
    });
    const prev = normalizeStoredPath(me?.avatar_url || null);
    if (isLocalAvatar(prev)) {
      fs.unlink(absFromRelative(prev)).catch(() => {});
    }

    // Persist to DB (also null out avatar_url to avoid stale file URLs)
    // updated_at is auto-managed by Prisma @updatedAt on write
    await prisma.users.update({
      where: { id: req.user.id },
      data: {
        avatarBlob: bytes,
        avatarMime: mime,
        avatar_url: null,
      },
      select: { id: true },
    });

    // Return a stable URL that streams from DB
    const url = toFullUrl(req, `/api/avatar/${req.user.id}/raw`);
    return res.status(201).json({ avatarUrl: url });
  } catch (err) {
    console.error("Upload avatar failed:", err);
    return res.status(500).json({ error: "Upload avatar failed" });
  }
}

/**
 * DELETE /api/avatar
 * Clears both DB blob and any legacy file.
 */
export async function deleteAvatar(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    const me = await prisma.users.findUnique({
      where: { id: req.user.id },
      select: { avatar_url: true },
    });

    await prisma.users.update({
      where: { id: req.user.id },
      data: { avatarBlob: null, avatarMime: null, avatar_url: null },
    });

    const prev = normalizeStoredPath(me?.avatar_url || null);
    if (isLocalAvatar(prev)) {
      fs.unlink(absFromRelative(prev)).catch(() => {});
    }

    return res.json({ ok: true, avatarUrl: null });
  } catch (err) {
    console.error("Delete avatar failed:", err);
    return res.status(500).json({ error: "Delete avatar failed" });
  }
}

/**
 * GET /api/avatar/me
 * Returns a JSON wrapper with a stable absolute URL that streams from DB.
 */
export async function getMyAvatar(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });

    // Always point to the DB-backed raw route; front-end consumes it like a file URL
    const url = toFullUrl(req, `/api/avatar/${req.user.id}/raw`);
    return res.json({ avatarUrl: url });
  } catch (err) {
    console.error("Get my avatar failed:", err);
    return res.status(500).json({ error: "Get my avatar failed" });
  }
}

/**
 * GET /api/avatar/:param
 * Returns JSON { avatarUrl } pointing to /api/avatar/:param/raw.
 * :param is username or numeric id.
 */
export async function getAvatarForParam(req, res) {
  try {
    const user = await findUserByParam(req.params.param);
    if (!user) return res.status(404).json({ error: "User not found" });

    const url = toFullUrl(req, `/api/avatar/${user.id}/raw`);
    return res.json({ avatarUrl: url });
  } catch (err) {
    console.error("Get avatar by param failed:", err);
    return res.status(500).json({ error: "Get avatar failed" });
  }
}

/**
 * GET /api/avatar/:param/raw
 * Streams the image bytes from DB with correct Content-Type + caching.
 * If DB blob is missing, 404. (Optional: fall back to legacy file if you want.)
 */
export async function getAvatarRaw(req, res) {
  try {
    const user = await findUserByParam(req.params.param);
    if (!user) return res.status(404).end();

    // Read DB-backed avatar
    const rec = await prisma.users.findUnique({
      where: { id: user.id },
      select: { avatarBlob: true, avatarMime: true, updated_at: true, avatar_url: true },
    });

    const bytes = rec?.avatarBlob;
    const mime = rec?.avatarMime || "application/octet-stream";

    if (bytes && bytes.length) {
      const etag = makeEtag(bytes, rec?.updated_at ?? null);

      // Conditional GET
      if (req.headers["if-none-match"] && req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }

      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("ETag", etag);
      // Cache avatar for a day; browser will revalidate via ETag
      res.setHeader("Cache-Control", "public, max-age=86400, must-revalidate");

      return res.status(200).end(Buffer.from(bytes));
    }

    // (Optional) Fallback to legacy on-disk file if present
    const rel = normalizeStoredPath(rec?.avatar_url || null);
    if (rel && isLocalAvatar(rel)) {
      // Serve file if it still exists (Render free may not)
      try {
        const abs = absFromRelative(rel);
        const buf = await fs.readFile(abs);
        const etag = makeEtag(buf, rec?.updated_at ?? null);

        if (req.headers["if-none-match"] && req.headers["if-none-match"] === etag) {
          return res.status(304).end();
        }
        res.setHeader("Content-Type", "image/*");
        res.setHeader("Content-Length", String(buf.length));
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "public, max-age=86400, must-revalidate");
        return res.status(200).end(buf);
      } catch {
        // ignore and 404 below
      }
    }

    return res.status(404).end();
  } catch (err) {
    console.error("Get avatar raw failed:", err);
    return res.status(500).end();
  }
}
