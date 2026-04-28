// routes/streaks.js
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import {
  getMyStreaks,
  getStreakByType,
  getStreakHistory,
  pingStreak,
} from "../controllers/streaks.controller.js";

// Use mergeParams so groupId from parent routers (if any) is preserved.
const router = Router({ mergeParams: true });

/**
 * -------------------------------
 * Personal streaks (no groupId)
 * -------------------------------
 */

// Summary for the signed-in user (all four types; personal context).
router.get("/me", authenticate, getMyStreaks);

// History & Ping MUST come before the catch-all "/:type"
router.get("/:type/history", authenticate, getStreakHistory); // daily counts history
router.post("/:type/ping", authenticate, pingStreak);         // record activity for today (or a provided date)

// Detail for one type (current/longest, flame, etc.)
router.get("/:type", authenticate, getStreakByType);

/**
 * ---------------------------------------
 * Group-aware aliases (path-style groupId)
 * These routes simply forward :groupId into req.query.groupId
 * and reuse the same controllers.
 * ---------------------------------------
 */

const withGroupId = (req, _res, next) => {
  // prefer explicit query if provided; otherwise take from path
  if (req.params?.groupId && (req.query.groupId === undefined || req.query.groupId === null)) {
    req.query.groupId = req.params.groupId;
  }
  next();
};

// Summary for a specific group (returns all four types filtered by group_id;
// non-group types will be empty shells, which is fine for consistency)
router.get("/group/:groupId/me", authenticate, withGroupId, getMyStreaks);

// Group-scoped history/ping/detail for a single type (primarily "groupMessage")
router.get("/group/:groupId/:type/history", authenticate, withGroupId, getStreakHistory);
router.post("/group/:groupId/:type/ping", authenticate, withGroupId, pingStreak);
router.get("/group/:groupId/:type", authenticate, withGroupId, getStreakByType);

export default router;
