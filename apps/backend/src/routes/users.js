// routes/users.js
import { Router } from "express";
import { authenticate, authenticateOptional } from "../middleware/auth.js";
import {
  listUsers,
  getUserProfile,
  searchUsers,
  updateDisplayName,
  changePassword,
  randomUsers, // ⬅️ add this
} from "../controllers/users.controller.js";

const router = Router();

/**
 * /current_user
 * ...
 */
router.get("/current_user", authenticateOptional, async (req, res) => {
  try {
    if (!req.user) return res.json({ authenticated: false, username: null });
    return res.json({ authenticated: true, username: req.user.username ?? null });
  } catch (err) {
    console.error("current_user error:", err);
    return res.json({ authenticated: false, username: null });
  }
});

/* ---------- Authenticated lists/updates ---------- */
router.get("/", authenticate, listUsers);
router.patch("/me/display-name", authenticate, updateDisplayName);
router.patch("/me/password", authenticate, changePassword);

/* ---------- Public search (place BEFORE /:username) ---------- */
router.get("/search", /* authenticate, */ searchUsers);

/* ---------- NEW: Random users (auth-optional) ---------- */
router.get("/random", authenticateOptional, randomUsers);

/* ---------- Profile by username (PUBLIC, auth-optional) ---------- */
router.get("/:username", authenticateOptional, getUserProfile);

export default router;
