// src/controllers/users.controller.js
import prisma from "../lib/prisma.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

/* ---------------------------------------------
   URL helpers
---------------------------------------------- */
// Prefer BACKEND_URL; otherwise derive from proxy headers.
function resolveBaseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

// Preserve absolute urls (http/https/data) and join relative paths.
function toFullUrl(relPath, req = null) {
  if (!relPath) return null;
  if (/^(?:https?:)?\/\//i.test(relPath) || /^data:/i.test(relPath)) return relPath;
  const base =
    req
      ? resolveBaseUrl(req)
      : (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 4000}`);
  const withSlash = relPath.startsWith("/") ? relPath : `/${relPath}`;
  return `${base}${withSlash}`;
}

/* ---------------------------------------------
   Auth helpers (cookie or bearer)
---------------------------------------------- */
function readBearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  let s = String(h).trim();
  // strip any number of leading schemes (Bearer/JWT/Token), tolerant of "Bearer Bearer ..."
  while (/^(Bearer|JWT|Token)\s+/i.test(s)) {
    s = s.replace(/^(Bearer|JWT|Token)\s+/i, "");
  }
  return s || null;
}

function verifyJwtOrNull(token) {
  if (!token) return null;
  const pub = process.env.JWT_PUBLIC_KEY?.trim();
  const sec = process.env.JWT_SECRET?.trim();
  try {
    if (pub) return jwt.verify(token, pub, { algorithms: ["RS256"] });
    if (sec) return jwt.verify(token, sec, { algorithms: ["HS256"] });
    // dev fallback: allow decode if no keys configured (NOT for prod)
    if (process.env.NODE_ENV !== "production") return jwt.decode(token) || null;
  } catch {
    // ignore
  }
  return null;
}

function maybeUserId(req) {
  let id = req.user?.id ?? req.user?.sub ?? null;
  if (!id) {
    const payload = verifyJwtOrNull(readBearerToken(req));
    id = payload?.sub ?? payload?.id ?? payload?.userId ?? null;
  }
  return id != null ? Number(id) : null;
}

function requireUserId(req) {
  const id = maybeUserId(req);
  if (!id) {
    const err = new Error("Unauthorized");
    err.status = 401;
    throw err;
  }
  return id;
}

/* ---------------------------------------------
   Cooldown config (MS-based)
---------------------------------------------- */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_COOLDOWN_MS = 7 * ONE_DAY_MS;

function resolveCooldownMs() {
  if (process.env.PWD_CHANGE_COOLDOWN_MS) {
    const ms = Number(process.env.PWD_CHANGE_COOLDOWN_MS);
    if (!Number.isNaN(ms) && ms >= 0) return ms;
  }
  if (process.env.PWD_CHANGE_COOLDOWN_DAYS) {
    const d = Number(process.env.PWD_CHANGE_COOLDOWN_DAYS);
    if (!Number.isNaN(d) && d >= 0) return d * ONE_DAY_MS;
  }
  return DEFAULT_COOLDOWN_MS;
}
const PWD_CHANGE_COOLDOWN_MS = resolveCooldownMs();

function fmtRemaining(ms) {
  if (ms < 2000) return "1s";
  const sec = Math.ceil(ms / 1000);
  if (sec < 120) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  if (min < 120) return `${min}m`;
  const hrs = Math.ceil(min / 60);
  if (hrs < 48) return `${hrs}h`;
  const days = Math.ceil(hrs / 24);
  return `${days} day(s)`;
}

/* ---------------------------------------------
   Small mappers
---------------------------------------------- */
function mapTitle(t) {
  if (!t) return null;
  return {
    id: t.id,
    key: t.key,
    label: t.label,
    emoji: t.emoji,
    color: t.color,
    rarity: t.rarity,
  };
}

/* =========================================================
   PATCH /api/users/me/display-name  (auth: cookie or bearer)
   body: { displayName: string }
========================================================= */
export async function updateDisplayName(req, res) {
  try {
    const userId = requireUserId(req);
    const displayNameRaw = String(req.body?.displayName ?? "").trim();

    if (!displayNameRaw || displayNameRaw.length < 1) {
      return res.status(422).json({ error: "Display name must be at least 1 character." });
    }
    if (displayNameRaw.length > 15) {
      return res.status(422).json({ error: "Display name must be less than 15 characters." });
    }

    const updated = await prisma.users.update({
      where: { id: userId },
      data: { display_name: displayNameRaw },
      select: { id: true, username: true, display_name: true, updated_at: true },
    });

    return res.json({
      id: updated.id,
      username: updated.username,
      displayName: updated.display_name,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    if (res.headersSent) return;
    const code = err.status || 500;
    console.error("❌ updateDisplayName error", err);
    return res.status(code).json({ error: "Failed to update display name" });
  }
}

/* =========================================================
   PATCH /api/users/me/password  (auth: cookie or bearer)
   body: { currentPassword: string, newPassword: string }
========================================================= */
export async function changePassword(req, res) {
  try {
    const userId = requireUserId(req);
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    if (!currentPassword || !newPassword) {
      return res.status(422).json({ error: "Both currentPassword and newPassword are required." });
    }
    if (newPassword.length < 6) {
      return res.status(422).json({ error: "New password must be at least 6 characters." });
    }
    if (newPassword === currentPassword) {
      return res
        .status(422)
        .json({ error: "New password must be different from current password." });
    }

    const me = await prisma.users.findUnique({
      where: { id: userId },
      select: { id: true, password_hash: true, last_password_change: true },
    });
    if (!me) return res.status(404).json({ error: "User not found" });

    const ok = await bcrypt.compare(currentPassword, me.password_hash || "");
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    // Cooldown check
    const nowMs = Date.now();
    const lastMs = me.last_password_change ? new Date(me.last_password_change).getTime() : 0;

    if (lastMs && nowMs - lastMs < PWD_CHANGE_COOLDOWN_MS) {
      const remainingMs = PWD_CHANGE_COOLDOWN_MS - (nowMs - lastMs);
      return res.status(409).json({
        error: `Password was changed recently. Try again in ~${fmtRemaining(remainingMs)}.`,
        code: "PASSWORD_CHANGE_COOLDOWN",
        cooldownMs: PWD_CHANGE_COOLDOWN_MS,
        changedAt: new Date(lastMs).toISOString(),
      });
    }

    const SALT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 12);
    const nextHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    const changedAt = new Date();
    await prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: nextHash,
        last_password_change: changedAt,
      },
    });

    return res.json({
      ok: true,
      changedAt: changedAt.toISOString(),
      cooldownMs: PWD_CHANGE_COOLDOWN_MS,
    });
  } catch (err) {
    if (res.headersSent) return;
    const code = err.status || 500;
    console.error("❌ changePassword error", err);
    return res.status(code).json({ error: "Failed to change password" });
  }
}

/* =========================================================
   GET /api/users/current_user   (auth: cookie or bearer)
   (Note: for cookie-or-bearer auth, this now self-handles)
========================================================= */
export async function currentUser(req, res) {
  try {
    const userId = requireUserId(req);

    const u = await prisma.users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        display_name: true,
        theme_preference: true,
        lang_preference: true,
        created_at: true,
        avatar_url: true,

        // 🔥 include equipped title
        current_title: {
          select: { id: true, key: true, label: true, emoji: true, color: true, rarity: true },
        },

        posts: { select: { id: true, content: true, created_at: true } },
        group_members: {
          select: {
            role: true,
            groups: { select: { id: true, name: true } },
          },
        },
        friends_friends_user_idTousers: { where: { status: "accepted" }, select: { id: true } },
        friends_friends_friend_idTousers: { where: { status: "accepted" }, select: { id: true } },
      },
    });

    if (!u) return res.status(404).json({ error: "Not found" });

    const friendsCount =
      (u.friends_friends_user_idTousers?.length || 0) +
      (u.friends_friends_friend_idTousers?.length || 0);

    const groups = u.group_members.map((gm) => ({
      id: gm.groups.id,
      name: gm.groups.name,
      role: gm.role || "member",
    }));

    return res.json({
      id: u.id,
      username: u.username,
      email: u.email,
      displayName: u.display_name,
      theme: u.theme_preference,
      lang: u.lang_preference,
      joinedDate: u.created_at,
      avatarUrl: toFullUrl(u.avatar_url, req),

      // 🔥 expose equipped title to FE
      currentTitle: mapTitle(u.current_title),

      postsCount: u.posts.length,
      groupsCount: groups.length,
      friendsCount,
      posts: u.posts.map((p) => ({
        id: p.id,
        content: p.content,
        timestamp: p.created_at,
        likes: 0,
        comments: 0,
      })),
      groups,
    });
  } catch (err) {
    if (res.headersSent) return;
    const code = err.status || 500;
    console.error("❌ currentUser error", err);
    return res.status(code).json({ error: "Internal server error" });
  }
}

/* =========================================================
   GET /api/users   (auth as you prefer)
========================================================= */
export async function listUsers(_req, res) {
  try {
    const list = await prisma.users.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        display_name: true,
        created_at: true,
        avatar_url: true,
      },
      orderBy: { id: "desc" },
    });

    return res.json(
      list.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        displayName: u.display_name,
        joinedDate: u.created_at,
        avatarUrl: toFullUrl(u.avatar_url), // falls back to BACKEND_URL/local
      }))
    );
  } catch (err) {
    if (res.headersSent) return;
    console.error("❌ listUsers error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/* =========================================================
   GET /api/users/:username   (public / auth-optional)
========================================================= */
export async function getUserProfile(req, res) {
  try {
    const raw = typeof req.params.username === "string" ? req.params.username.trim() : "";
    if (!raw) {
      return res.status(400).json({ error: "Missing username" });
    }

    const maybeId = /^\d+$/.test(raw) ? Number(raw) : null;

    const u = await prisma.users.findFirst({
      where: maybeId
        ? { id: maybeId }
        : { username: { equals: raw, mode: "insensitive" } }, // case-insensitive
      select: {
        id: true,
        username: true,
        display_name: true,
        created_at: true,
        avatar_url: true,

        // 🔥 include equipped title on public profile too
        current_title: {
          select: { id: true, key: true, label: true, emoji: true, color: true, rarity: true },
        },

        posts: { select: { id: true, content: true, created_at: true } },
        group_members: {
          select: {
            role: true,
            groups: { select: { id: true, name: true } },
          },
        },
        friends_friends_user_idTousers: { where: { status: "accepted" }, select: { id: true } },
        friends_friends_friend_idTousers: { where: { status: "accepted" }, select: { id: true } },
      },
    });

    if (!u) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const friendsCount =
      (u.friends_friends_user_idTousers?.length || 0) +
      (u.friends_friends_friend_idTousers?.length || 0);

    const groups = u.group_members.map((gm) => ({
      id: gm.groups.id,
      name: gm.groups.name,
      role: gm.role || "member",
    }));

    return res.json({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      joinedDate: u.created_at,
      avatarUrl: toFullUrl(u.avatar_url, req),

      // 🔥 expose equipped title for viewing
      currentTitle: mapTitle(u.current_title),

      postsCount: u.posts.length,
      groupsCount: groups.length,
      friendsCount,
      posts: u.posts.map((p) => ({
        id: p.id,
        content: p.content,
        timestamp: p.created_at,
        likes: 0,
        comments: 0,
      })),
      groups,
    });
  } catch (err) {
    if (res.headersSent) {
      console.error("❌ getUserProfile (post-send) error:", err);
      return;
    }
    console.error("❌ getUserProfile error", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/* =========================================================
   GET /api/users/search?query=...  (public or soft-auth)
   (will ignore self in results if we can identify via cookie or bearer)
========================================================= */
export async function searchUsers(req, res) {
  try {
    const q = String(req.query?.query ?? "").trim();
    if (!q) return res.json([]);

    const meId = maybeUserId(req); // soft auth
    const maybeId = /^\d+$/.test(q) ? Number(q) : null;

    const users = await prisma.users.findMany({
      where: {
        AND: [
          meId ? { id: { not: meId } } : {},
          {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { display_name: { contains: q, mode: "insensitive" } },
              ...(maybeId ? [{ id: maybeId }] : []),
            ],
          },
        ],
      },
      select: { id: true, username: true, display_name: true, avatar_url: true },
      take: 20,
      orderBy: { id: "asc" },
    });

    return res.json(
      users.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: toFullUrl(u.avatar_url, req),
      }))
    );
  } catch (err) {
    if (res.headersSent) return;
    console.error("❌ searchUsers error", err);
    return res.status(500).json({ error: "Failed to search users" });
  }
}

export async function randomUsers(req, res) {
  try {
    // Clamp limit to a sensible range (default 12, max 50)
    const limitRaw = parseInt(String(req.query?.limit ?? ""), 10);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 12;

    const meId = maybeUserId(req); // cookie or bearer if present

    // Works on Postgres and SQLite: ORDER BY RANDOM()
    // (If you switch to MySQL, change RANDOM() -> RAND().)
    const rows = await prisma.$queryRaw`
      SELECT
        id,
        username,
        display_name AS "displayName",
        avatar_url AS "avatarUrl"
      FROM users
      WHERE ${meId} IS NULL OR id <> ${meId}
      ORDER BY RANDOM()
      LIMIT ${limit};
    `;

    const normalized = rows.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName ?? u.username,
      avatarUrl: toFullUrl(u.avatarUrl, req),
    }));

    return res.json(normalized);
  } catch (err) {
    if (res.headersSent) return;
    console.error("❌ randomUsers error", err);
    return res.status(500).json({ error: "Failed to load random users" });
  }
}

export { toFullUrl };
