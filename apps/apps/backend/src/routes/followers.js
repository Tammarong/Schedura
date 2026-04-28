// src/routes/followers.js
import express from "express";
import * as FollowersController from "../controllers/followers.controller.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

/* ---------------------- auth shims ---------------------- */
function decodeJwtPayload(rawToken) {
  try {
    const raw = rawToken.startsWith("Bearer ") ? rawToken.slice(7) : rawToken;
    const [, b64] = raw.split(".");
    if (!b64) return null;
    const json = Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

function attachUserFromHeaders(req, _res, next) {
  if (req.user?.id || req.user?.userId || req.auth?.id || req.auth?.userId || req.session?.user?.id || req.userId) {
    return next();
  }
  const hdr = (req.headers.authorization || req.headers["x-access-token"]);
  if (typeof hdr === "string" && hdr.trim()) {
    const payload = decodeJwtPayload(hdr.trim());
    const id =
      (typeof payload?.id === "number" ? payload.id : null) ??
      (typeof payload?.userId === "number" ? payload.userId : null) ??
      (typeof payload?.sub === "string" && /^\d+$/.test(payload.sub) ? Number(payload.sub) : null);
    if (id) req.user = { ...(req.user || {}), id };
  }
  next();
}

function requireAuth(req, res, next) {
  const id =
    req.user?.id ??
    req.user?.userId ??
    req.auth?.id ??
    req.auth?.userId ??
    req.session?.user?.id ??
    req.userId;
  if (id == null) return res.status(401).json({ error: "Not authenticated" });
  next();
}

router.use(attachUserFromHeaders);

/* ------------ helpers to call controllers without mutating req ----------- */
const has = (fn) => typeof fn === "function";

/** create a shadow req whose own props override the original */
function withOverrides(req, overrides) {
  const r2 = Object.create(req);
  if (overrides.query) r2.query = overrides.query;
  if (overrides.body) r2.body = overrides.body;
  if (overrides.params) r2.params = overrides.params;
  return r2;
}

async function handleMe(req, res, next) {
  try {
    if (has(FollowersController.me)) return FollowersController.me(req, res, next);
    if (!has(FollowersController.counts)) return res.status(501).json({ error: "Followers self endpoint not available" });
    const me =
      req.user?.id ??
      req.user?.userId ??
      req.auth?.id ??
      req.auth?.userId ??
      req.session?.user?.id ??
      req.userId;
    const r2 = withOverrides(req, { query: { ...(req.query || {}), userId: String(me) } });
    return FollowersController.counts(r2, res, next);
  } catch (e) { next(e); }
}

function handleRelationship(req, res, next) {
  if (!has(FollowersController.relationship)) {
    return res.status(501).json({ error: "Relationship endpoint not available" });
  }
  return FollowersController.relationship(req, res, next);
}

function handleFollow(req, res, next) {
  if (!has(FollowersController.follow)) {
    return res.status(501).json({ error: "Follow endpoint not available" });
  }
  // supply body.username for controllers that expect it (but keep params too)
  const r2 = withOverrides(req, { body: { ...(req.body || {}), username: req.params.username } });
  return FollowersController.follow(r2, res, next);
}

async function handleUnfollow(req, res, next) {
  try {
    if (!has(FollowersController.unfollow)) {
      return res.status(501).json({ error: "Unfollow endpoint not available" });
    }
    let r2 = req;
    if (!req.body?.userId) {
      const uname = String(req.params.username || "").trim();
      if (uname) {
        const u = await prisma.users.findFirst({
          where: { username: { equals: uname, mode: "insensitive" } },
          select: { id: true },
        });
        if (!u) return res.status(404).json({ error: "User not found" });
        r2 = withOverrides(req, { body: { ...(req.body || {}), userId: u.id } });
      }
    }
    return FollowersController.unfollow(r2, res, next);
  } catch (e) { next(e); }
}

function handleFollowersOfUser(req, res, next) {
  if (has(FollowersController.listFollowers)) {
    return FollowersController.listFollowers(req, res, next);
  }
  if (has(FollowersController.listOfUser)) {
    const r2 = withOverrides(req, { query: { ...(req.query || {}), direction: "in" } });
    return FollowersController.listOfUser(r2, res, next);
  }
  return res.status(501).json({ error: "Followers list endpoint not available" });
}

function handleFollowingOfUser(req, res, next) {
  if (has(FollowersController.listFollowing)) {
    return FollowersController.listFollowing(req, res, next);
  }
  if (has(FollowersController.listOfUser)) {
    const r2 = withOverrides(req, { query: { ...(req.query || {}), direction: "out" } });
    return FollowersController.listOfUser(r2, res, next);
  }
  return res.status(501).json({ error: "Following list endpoint not available" });
}

function handleListMine(req, res, next) {
  if (!has(FollowersController.listMine)) {
    return res.status(501).json({ error: "Own followers/following endpoint not available" });
  }
  return FollowersController.listMine(req, res, next);
}

function handleCounts(req, res, next) {
  if (!has(FollowersController.counts)) {
    return res.status(501).json({ error: "Counts endpoint not available" });
  }
  return FollowersController.counts(req, res, next);
}

/* ------------------------ ROUTES ------------------------ */

// self counts (auth) OR fallback to counts with userId
router.get("/me", requireAuth, handleMe);

// counts by username/userId (public convenience)
router.get("/counts", handleCounts);

// public relationship probe
router.get("/relationship", handleRelationship);

// simple follow model (no requests)
router.post("/:username", requireAuth, handleFollow);
router.delete("/:username", requireAuth, handleUnfollow);

// public lists
router.get("/:username/followers", handleFollowersOfUser);
router.get("/:username/following", handleFollowingOfUser);

// optional: my followers/following with ?direction=in|out
router.get("/", requireAuth, handleListMine);

export default router;
