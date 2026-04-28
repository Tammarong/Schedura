// src/controllers/followers.controller.js
import prisma from "../lib/prisma.js";
import { z } from "zod";

/* ---------- URL helpers (proxy-aware) ---------- */
function resolveBaseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] &&
      String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
const fullUrl = (req, p) => {
  if (!p) return null;
  if (/^(?:https?:)?\/\//i.test(p) || /^data:/i.test(p)) return p;
  const base = resolveBaseUrl(req);
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base}${withSlash}`;
};

// legacy mapper (camelCase) — used by listMine()
const mapUser = (req, u) =>
  u
    ? {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: fullUrl(req, u.avatar_url),
      }
    : null;

// flat snake_case mapper — used by public lists seen by the Profile page
function mapUserFlat(req, u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: fullUrl(req, u.avatar_url) || null,
  };
}

/* ---------- Validation ---------- */
const dirQuerySchema = z.object({ direction: z.enum(["in", "out"]) });
const actionBodySchema = z.object({ userId: z.coerce.number().int().positive() });

/* ---------- Helpers ---------- */
async function ensureUsersExist(userId) {
  const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
  return !!u;
}
async function getUserIdByUsernameInsensitive(username) {
  const u = await prisma.users.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true },
  });
  return u?.id ?? null;
}
async function getBlockState(a, b) {
  const mine = await prisma.user_blocks.findFirst({
    where: { blocker_id: a, blockee_id: b },
    select: { id: true },
  });
  const theirs = await prisma.user_blocks.findFirst({
    where: { blocker_id: b, blockee_id: a },
    select: { id: true },
  });
  return { iBlocked: !!mine, theyBlocked: !!theirs };
}

// Read a target user from body, query, or params (username or id)
async function resolveTargetUserId(req) {
  const fromBodyId =
    typeof req.body?.userId !== "undefined" ? Number(req.body.userId) : null;
  const fromQueryId =
    typeof req.query?.userId === "string" && /^\d+$/.test(req.query.userId)
      ? Number(req.query.userId)
      : null;

  const username =
    (typeof req.body?.username === "string" && req.body.username.trim()) ||
    (typeof req.query?.username === "string" && req.query.username.trim()) ||
    (typeof req.params?.username === "string" && req.params.username.trim()) ||
    "";

  if (fromBodyId) return fromBodyId;
  if (fromQueryId) return fromQueryId;
  if (username) return await getUserIdByUsernameInsensitive(username);
  return null;
}

// Parse page/limit without mutating req.query
function parsePageLimit(q) {
  const rawPage = typeof q.page === "string" ? Number(q.page) : 1;
  const rawLimit = typeof q.limit === "string" ? Number(q.limit) : 20;
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 && rawLimit <= 100
      ? Math.floor(rawLimit)
      : 20;
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/* =========================================================
   GET /api/followers/counts?username=Foo  (or &userId=123)
   ========================================================= */
export async function counts(req, res) {
  try {
    const rawUsername = typeof req.query.username === "string" ? req.query.username.trim() : "";
    const rawUserId =
      typeof req.query.userId === "string" && /^\d+$/.test(req.query.userId)
        ? Number(req.query.userId)
        : null;

    let userId = rawUserId;
    if (!userId && rawUsername) userId = await getUserIdByUsernameInsensitive(rawUsername);
    if (!userId) return res.status(404).json({ error: "User not found" });

    const [followers, following] = await Promise.all([
      prisma.user_follows.count({ where: { followee_id: userId } }),
      prisma.user_follows.count({ where: { follower_id: userId } }),
    ]);

    return res.json({ userId, followers, following });
  } catch (e) {
    if (res.headersSent) return;
    console.error("Followers counts failed:", e);
    return res.status(500).json({ error: "Failed to fetch counts" });
  }
}

/* =======================================================================
   GET /api/followers/relationship?username=Foo  (or &userId=123)
   statuses (aligned to FE): "none" | "self" | "following" | "followed_by"
                             | "mutual" | "blocked"
   ======================================================================= */
export async function relationship(req, res) {
  try {
    const viewerId = req.user?.id ?? null;
    const rawUsername = typeof req.query.username === "string" ? req.query.username.trim() : "";
    const rawUserId =
      typeof req.query.userId === "string" && /^\d+$/.test(req.query.userId)
        ? Number(req.query.userId)
        : null;

    if (!rawUsername && !rawUserId) {
      return res.status(200).json({ target: null, status: "none" });
    }

    const target = await prisma.users.findFirst({
      where: rawUserId ? { id: rawUserId } : { username: { equals: rawUsername, mode: "insensitive" } },
      select: { id: true, username: true },
    });
    if (!target) return res.status(200).json({ target: null, status: "none" });

    if (!viewerId || viewerId === target.id) {
      return res.status(200).json({ target, status: viewerId === target.id ? "self" : "none" });
    }

    const { iBlocked, theyBlocked } = await getBlockState(viewerId, target.id);
    if (iBlocked || theyBlocked) return res.status(200).json({ target, status: "blocked" });

    const viewerFollowsTarget = await prisma.user_follows.findFirst({
      where: { follower_id: viewerId, followee_id: target.id },
      select: { follower_id: true },
    });
    const targetFollowsViewer = await prisma.user_follows.findFirst({
      where: { follower_id: target.id, followee_id: viewerId },
      select: { follower_id: true },
    });

    if (viewerFollowsTarget && targetFollowsViewer) return res.json({ target, status: "mutual" });
    if (viewerFollowsTarget) return res.json({ target, status: "following" });
    if (targetFollowsViewer) return res.json({ target, status: "followed_by" });

    return res.json({ target, status: "none" });
  } catch (e) {
    if (res.headersSent) return;
    console.error("Followers relationship failed:", e);
    return res.status(500).json({ error: "Failed to fetch relationship" });
  }
}

/* =========================================================
   GET /api/followers?direction=in|out — my followers/following
   (kept as array for internal views that already expect this)
   ========================================================= */
export async function listMine(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { direction } = dirQuerySchema.parse(req.query);

    if (direction === "in") {
      // people who follow ME
      const rows = await prisma.user_follows.findMany({
        where: { followee_id: me },
        include: {
          follower: {
            select: { id: true, username: true, display_name: true, avatar_url: true },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const normalized = rows.map((r) => ({
        since: r.created_at,
        user: mapUser(req, r.follower),
      }));
      return res.json(normalized);
    }

    // direction === "out" : people I follow
    const rows = await prisma.user_follows.findMany({
      where: { follower_id: me },
      include: {
        followee: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    const normalized = rows.map((r) => ({
      since: r.created_at,
      user: mapUser(req, r.followee),
    }));
    return res.json(normalized);
  } catch (e) {
    if (res.headersSent) return;
    console.error("Followers listMine failed:", e);
    return res.status(500).json({ error: "Failed to fetch followers" });
  }
}

/* ==============================================================================
   Public lists (Profile page uses these, expects pagination)
   Routes:
   - GET /api/followers/:username/followers?page=&limit=
   - GET /api/followers/:username/following?page=&limit=
   Return shape: { items: [...], page, limit, total }
   ============================================================================== */
export async function listFollowers(req, res) {
  try {
    const uname = String(req.params.username || "").trim();
    if (!uname) return res.status(400).json({ error: "Missing username" });

    const target = await prisma.users.findFirst({
      where: { username: { equals: uname, mode: "insensitive" } },
      select: { id: true },
    });
    if (!target) return res.status(404).json({ error: "User not found" });

    const { page, limit, skip } = parsePageLimit(req.query);

    const [total, rows] = await Promise.all([
      prisma.user_follows.count({ where: { followee_id: target.id } }),
      prisma.user_follows.findMany({
        where: { followee_id: target.id }, // followers OF target
        include: {
          follower: {
            select: { id: true, username: true, display_name: true, avatar_url: true },
          },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const items = rows
      .map((r) => {
        const u = mapUserFlat(req, r.follower);
        return u ? { ...u, followedAt: r.created_at?.toISOString?.() ?? null } : null;
      })
      .filter(Boolean);

    return res.json({ items, page, limit, total });
  } catch (e) {
    if (res.headersSent) return;
    console.error("Followers listFollowers failed:", e);
    return res.status(500).json({ error: "Failed to fetch followers" });
  }
}

export async function listFollowing(req, res) {
  try {
    const uname = String(req.params.username || "").trim();
    if (!uname) return res.status(400).json({ error: "Missing username" });

    const target = await prisma.users.findFirst({
      where: { username: { equals: uname, mode: "insensitive" } },
      select: { id: true },
    });
    if (!target) return res.status(404).json({ error: "User not found" });

    const { page, limit, skip } = parsePageLimit(req.query);

    const [total, rows] = await Promise.all([
      prisma.user_follows.count({ where: { follower_id: target.id } }),
      prisma.user_follows.findMany({
        where: { follower_id: target.id }, // people target FOLLOWS
        include: {
          followee: {
            select: { id: true, username: true, display_name: true, avatar_url: true },
          },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
    ]);

    const items = rows
      .map((r) => {
        const u = mapUserFlat(req, r.followee);
        return u ? { ...u, followedAt: r.created_at?.toISOString?.() ?? null } : null;
      })
      .filter(Boolean);

    return res.json({ items, page, limit, total });
  } catch (e) {
    if (res.headersSent) return;
    console.error("Followers listFollowing failed:", e);
    return res.status(500).json({ error: "Failed to fetch following" });
  }
}

/* =========================================================
   POST /api/followers/:username   OR  POST /api/followers (body/query)
   Body/query: { userId? | username? }
   Returns: { ok: true, status: "accepted" }
   ========================================================= */
export async function follow(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;

    const toUserId = await resolveTargetUserId(req);
    if (!toUserId) return res.status(400).json({ error: "Missing userId or username" });
    if (toUserId === me) return res.status(400).json({ error: "Cannot follow yourself" });
    if (!(await ensureUsersExist(toUserId))) return res.status(404).json({ error: "User not found" });

    const { iBlocked, theyBlocked } = await getBlockState(me, toUserId);
    if (iBlocked || theyBlocked) return res.status(403).json({ error: "User is blocked" });

    // Idempotent upsert — currently auto-accept (public accounts)
    await prisma.user_follows.upsert({
      where: { follower_id_followee_id: { follower_id: me, followee_id: toUserId } },
      update: {}, // already following → no-op
      create: { follower_id: me, followee_id: toUserId },
    });

    return res.status(201).json({ ok: true, status: "accepted" });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Follow failed:", e);
    return res.status(500).json({ error: "Failed to follow" });
  }
}

/* =========================================================
   DELETE /api/followers/:username   OR  POST /api/followers/unfollow (body)
   Body/query: { userId? | username? }
   ========================================================= */
export async function unfollow(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;

    // accept either explicit body.userId or any username param/query
    const toUserId =
      (req.method === "POST" && actionBodySchema.safeParse(req.body).success
        ? Number(req.body.userId)
        : await resolveTargetUserId(req));

    if (!toUserId) return res.status(400).json({ error: "Missing userId or username" });

    await prisma.user_follows.deleteMany({
      where: { follower_id: me, followee_id: toUserId },
    });

    return res.json({ ok: true, action: "unfollowed" });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Unfollow failed:", e);
    return res.status(500).json({ error: "Failed to unfollow" });
  }
}
