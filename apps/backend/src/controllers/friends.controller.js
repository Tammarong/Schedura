// src/controllers/friends.controller.js
import prisma from "../lib/prisma.js";
import { z } from "zod";

/* ---------- URL helpers (proxy-aware) ---------- */
function resolveBaseUrl(req) {
  if (process.env.BACKEND_URL) return process.env.BACKEND_URL.replace(/\/+$/, "");
  const proto =
    (req.headers["x-forwarded-proto"] && String(req.headers["x-forwarded-proto"]).split(",")[0]) ||
    (req.secure ? "https" : "http");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
const fullUrl = (req, p) => {
  if (!p) return null;
  // Preserve absolute/http(s) and data URLs
  if (/^(?:https?:)?\/\//i.test(p) || /^data:/i.test(p)) return p;
  const base = resolveBaseUrl(req);
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${base}${withSlash}`;
};

const mapUser = (req, u) =>
  u
    ? {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: fullUrl(req, u.avatar_url),
      }
    : null;

/* ---------- Validation ---------- */
const idParamsSchema = z.object({ userId: z.coerce.number().int().positive() });
const actionBodySchema = z.object({ userId: z.coerce.number().int().positive() });
const dirQuerySchema = z.object({ direction: z.enum(["in", "out"]) });

// For requestFriend we’ll normalize multiple input shapes
const requestIdSchema = z.coerce.number().int().positive();

/* ---------- Small helpers ---------- */
async function ensureUsersExist(userId) {
  const u = await prisma.users.findUnique({ where: { id: userId }, select: { id: true } });
  return !!u;
}

async function getBlockState(a, b) {
  // who blocked whom?
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

/* =========================================================
   GET /api/friends — list accepted friends for current user
   ========================================================= */
export async function listFriends(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;

    // accepted where I'm the requester
    const a = await prisma.friends.findMany({
      where: { user_id: me, status: "accepted" },
      include: {
        users_friends_friend_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    // accepted where I'm the receiver
    const b = await prisma.friends.findMany({
      where: { friend_id: me, status: "accepted" },
      include: {
        users_friends_user_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    const normalized = [
      ...a.map((row) => ({
        since: row.created_at,
        user: mapUser(req, row.users_friends_friend_idTousers),
      })),
      ...b.map((row) => ({
        since: row.created_at,
        user: mapUser(req, row.users_friends_user_idTousers),
      })),
    ];

    return res.json(normalized);
  } catch (e) {
    if (res.headersSent) return;
    console.error("Friends list failed:", e);
    return res.status(500).json({ error: "Failed to fetch friends" });
  }
}

/* =========================================================================
   GET /api/friends/requests?direction=in|out — list pending requests
   ========================================================================= */
export async function listRequests(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { direction } = dirQuerySchema.parse(req.query);

    if (direction === "in") {
      const rows = await prisma.friends.findMany({
        where: { friend_id: me, status: "pending" },
        include: {
          users_friends_user_idTousers: {
            select: { id: true, username: true, display_name: true, avatar_url: true },
          },
        },
        orderBy: { created_at: "desc" },
      });

      const normalized = rows.map((r) => ({
        since: r.created_at,
        status: r.status,
        from: mapUser(req, r.users_friends_user_idTousers),
      }));
      return res.json(normalized);
    }

    // out
    const rows = await prisma.friends.findMany({
      where: { user_id: me, status: "pending" },
      include: {
        users_friends_friend_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
      },
      orderBy: { created_at: "desc" },
    });

    const normalized = rows.map((r) => ({
      since: r.created_at,
      status: r.status,
      to: mapUser(req, r.users_friends_friend_idTousers),
    }));
    return res.json(normalized);
  } catch (e) {
    if (res.headersSent) return;
    console.error("Friends requests failed:", e);
    return res.status(500).json({ error: "Failed to fetch friend requests" });
  }
}

/* =======================================================================
   GET /api/friends/relationship?username=Foo  (or &userId=123)
   - robust: never 404; returns neutral { target:null, status:"none" } when unknown
   ======================================================================= */
export async function getRelationship(req, res) {
  try {
    const viewerId = req.user?.id ?? null;
    const rawUsername =
      typeof req.query.username === "string" ? req.query.username.trim() : "";
    const rawUserId =
      typeof req.query.userId === "string" && /^\d+$/.test(req.query.userId)
        ? Number(req.query.userId)
        : null;

    if (!rawUsername && !rawUserId) {
      return res.status(200).json({ target: null, status: "none" });
    }

    const target = await prisma.users.findFirst({
      where: rawUserId
        ? { id: rawUserId }
        : { username: { equals: rawUsername, mode: "insensitive" } }, // case-insensitive
      select: { id: true, username: true },
    });

    if (!target) {
      return res.status(200).json({ target: null, status: "none" });
    }

    if (!viewerId || viewerId === target.id) {
      return res.status(200).json({
        target,
        status: viewerId === target.id ? "self" : "none",
      });
    }

    const rel = await prisma.friends.findFirst({
      where: {
        OR: [
          { user_id: viewerId, friend_id: target.id },
          { user_id: target.id, friend_id: viewerId },
        ],
      },
      select: { user_id: true, friend_id: true, status: true },
    });

    if (!rel) return res.status(200).json({ target, status: "none" });

    if (rel.status === "accepted") return res.status(200).json({ target, status: "friends" });
    if (rel.status === "blocked") {
      return res.status(200).json({
        target,
        status: rel.user_id === viewerId ? "blocked_by_me" : "blocked_me",
      });
    }
    if (rel.status === "pending") {
      return res.status(200).json({
        target,
        status: rel.user_id === viewerId ? "pending_outgoing" : "pending_incoming",
      });
    }

    return res.status(200).json({ target, status: rel.status || "none" });
  } catch (e) {
    if (res.headersSent) return;
    console.error("❌ getRelationship error:", e);
    return res.status(500).json({ error: "Failed to fetch relationship" });
  }
}

/* =======================================================================
   GET /api/friends/status/:userId — relationship status & direction
   ======================================================================= */
export async function getStatus(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = idParamsSchema.parse(req.params);
    if (me === userId) return res.json({ status: null, direction: null });

    // Block state
    const { iBlocked, theyBlocked } = await getBlockState(me, userId);
    if (iBlocked && theyBlocked) return res.json({ status: "blocked", direction: "both" });
    if (iBlocked) return res.json({ status: "blocked", direction: "out" }); // I blocked them
    if (theyBlocked) return res.json({ status: "blocked", direction: "in" }); // They blocked me

    // accepted either direction
    const accepted = await prisma.friends.findFirst({
      where: {
        status: "accepted",
        OR: [
          { user_id: me, friend_id: userId },
          { user_id: userId, friend_id: me },
        ],
      },
      select: { id: true },
    });
    if (accepted) return res.json({ status: "accepted", direction: null });

    // pending: out (I sent)
    const outPending = await prisma.friends.findFirst({
      where: { user_id: me, friend_id: userId, status: "pending" },
      select: { id: true },
    });
    if (outPending) return res.json({ status: "pending", direction: "out" });

    // pending: in (they sent)
    const inPending = await prisma.friends.findFirst({
      where: { user_id: userId, friend_id: me, status: "pending" },
      select: { id: true },
    });
    if (inPending) return res.json({ status: "pending", direction: "in" });

    // rejected history?
    const rejected = await prisma.friends.findFirst({
      where: {
        status: "rejected",
        OR: [
          { user_id: me, friend_id: userId },
          { user_id: userId, friend_id: me },
        ],
      },
      select: { id: true },
    });
    if (rejected) return res.json({ status: "rejected", direction: null });

    return res.json({ status: null, direction: null });
  } catch (e) {
    if (res.headersSent) return;
    console.error("Friend status failed:", e);
    return res.status(500).json({ error: "Failed to get status" });
  }
}

/* =========================================================
   POST /api/friends/request  { toUserId | userId | friendId | friendUsername }
   - create pending request unless blocked / self / already friends
   ========================================================= */
export async function requestFriend(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;

    // 1) Prefer numeric ids if present
    const rawId =
      req.body?.toUserId ??
      req.body?.userId ??
      req.body?.friendId ??
      null;

    let toUserId = null;

    if (rawId != null) {
      const idParsed = requestIdSchema.safeParse(rawId);
      if (!idParsed.success) {
        return res.status(400).json({ error: "Invalid input: expected numeric user id" });
      }
      toUserId = idParsed.data;
    } else {
      // 2) Fall back to username (friendUsername) — CASE-INSENSITIVE
      const uname = typeof req.body?.friendUsername === "string" ? req.body.friendUsername.trim() : "";
      if (!uname) {
        return res.status(400).json({ error: "Missing toUserId or friendUsername" });
      }
      const u = await prisma.users.findFirst({
        where: { username: { equals: uname, mode: "insensitive" } },
        select: { id: true },
      });
      if (!u) return res.status(404).json({ error: "User not found" });
      toUserId = u.id;
    }

    if (toUserId === me) return res.status(400).json({ error: "Cannot friend yourself" });
    if (!(await ensureUsersExist(toUserId))) return res.status(404).json({ error: "User not found" });

    const { iBlocked, theyBlocked } = await getBlockState(me, toUserId);
    if (iBlocked || theyBlocked) return res.status(403).json({ error: "User is blocked" });

    const existing = await prisma.friends.findFirst({
      where: {
        OR: [
          { user_id: me, friend_id: toUserId },
          { user_id: toUserId, friend_id: me },
        ],
      },
    });

    if (existing) {
      if (existing.status === "accepted") return res.json({ action: "already-friends" });
      if (existing.status === "pending") {
        // If THEY sent me a request, auto-accept
        if (existing.user_id === toUserId && existing.friend_id === me) {
          const updated = await prisma.friends.update({
            where: { id: existing.id },
            data: { status: "accepted" },
          });
          return res.json({ action: "auto-accepted", id: updated.id });
        }
        return res.json({ action: "already-pending" });
      }
      // if rejected rows exist, allow creating a fresh pending from me
    }

    const created = await prisma.friends.create({
      data: {
        user_id: me,
        friend_id: toUserId,
        status: "pending",
      },
    });

    return res.status(201).json({ action: "created", id: created.id });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Request friend failed:", e);
    return res.status(500).json({ error: "Failed to request friend" });
  }
}

/* =========================================================
   POST /api/friends/accept  { userId } — accept their incoming request
   ========================================================= */
export async function acceptRequest(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = actionBodySchema.parse(req.body);

    const pending = await prisma.friends.findFirst({
      where: { user_id: userId, friend_id: me, status: "pending" },
    });
    if (!pending) return res.status(404).json({ error: "No pending request from this user" });

    const updated = await prisma.friends.update({
      where: { id: pending.id },
      data: { status: "accepted" },
    });

    return res.json({ ok: true, id: updated.id });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Accept friend failed:", e);
    return res.status(500).json({ error: "Failed to accept request" });
  }
}

/* =========================================================
   POST /api/friends/reject  { userId } — reject incoming request
   ========================================================= */
export async function rejectRequest(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = actionBodySchema.parse(req.body);

    const pending = await prisma.friends.findFirst({
      where: { user_id: userId, friend_id: me, status: "pending" },
    });
    if (!pending) return res.status(404).json({ error: "No pending request from this user" });

    const updated = await prisma.friends.update({
      where: { id: pending.id },
      data: { status: "rejected" },
    });

    return res.json({ ok: true, id: updated.id });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Reject friend failed:", e);
    return res.status(500).json({ error: "Failed to reject request" });
  }
}

/* =========================================================
   POST /api/friends/cancel  { userId } — cancel my outgoing request
   ========================================================= */
export async function cancelRequest(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = actionBodySchema.parse(req.body);

    const pending = await prisma.friends.findFirst({
      where: { user_id: me, friend_id: userId, status: "pending" },
    });
    if (!pending) return res.status(404).json({ error: "No pending request to this user" });

    await prisma.friends.delete({ where: { id: pending.id } });

    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Cancel friend request failed:", e);
    return res.status(500).json({ error: "Failed to cancel request" });
  }
}

/* =========================================================
   POST /api/friends/unfriend  { userId } — remove accepted friendship
   ========================================================= */
export async function unfriend(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = actionBodySchema.parse(req.body);

    await prisma.friends.deleteMany({
      where: {
        OR: [
          { user_id: me, friend_id: userId },
          { user_id: userId, friend_id: me },
        ],
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Unfriend failed:", e);
    return res.status(500).json({ error: "Failed to unfriend" });
  }
}

/* =========================================================
   POST /api/friends/block  { userId } — block user
   ========================================================= */
export async function blockUser(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = actionBodySchema.parse(req.body);

    // create block if not exists
    await prisma.user_blocks.upsert({
      where: {
        blocker_id_blockee_id: { blocker_id: me, blockee_id: userId },
      },
      update: {},
      create: { blocker_id: me, blockee_id: userId },
    });

    // remove any friendship/requests
    await prisma.friends.deleteMany({
      where: {
        OR: [
          { user_id: me, friend_id: userId },
          { user_id: userId, friend_id: me },
        ],
      },
    });

    return res.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Block user failed:", e);
    return res.status(500).json({ error: "Failed to block user" });
  }
}

/* =========================================================
   POST /api/friends/unblock  { userId } — unblock user
   ========================================================= */
export async function unblockUser(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Unauthorized" });
    const me = req.user.id;
    const { userId } = actionBodySchema.parse(req.body);

    const result = await prisma.user_blocks.deleteMany({
      where: { blocker_id: me, blockee_id: userId },
    });

    return res.json({ ok: true, removed: result.count });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: e.issues });
    }
    if (res.headersSent) return;
    console.error("Unblock user failed:", e);
    return res.status(500).json({ error: "Failed to unblock user" });
  }
}
