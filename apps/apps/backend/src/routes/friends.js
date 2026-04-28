// routes/friends.js
import { Router } from "express";
import { authenticate, authenticateOptional } from "../middleware/auth.js";
import {
  listFriends,
  listRequests,
  getStatus,
  requestFriend,
  acceptRequest,
  rejectRequest,
  cancelRequest,
  unfriend,
  blockUser,
  unblockUser,
  getRelationship, // controller returns { status, direction } for authed users
} from "../controllers/friends.controller.js";

const router = Router();

/* -------- cache safety so proxies/CDNs don't collapse auth variants -------- */
router.use((_, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Vary", "Authorization, Cookie");
  next();
});

/* -------- small helper to short-circuit with guest defaults -------- */
function guestsOk(defaultBody, handler) {
  return (req, res, next) => {
    if (!req.user) {
      // always 200 for guest-safe reads
      return res.json(typeof defaultBody === "function" ? defaultBody(req) : defaultBody);
    }
    return handler(req, res, next);
  };
}

/* ---------- Read-only (auth optional; guest-safe) ---------- */
// Feed only needs an array; guests get [] so UI can keep going.
router.get("/", authenticateOptional, guestsOk([], listFriends));

// Requests page: safe neutral shape for guests.
router.get(
  "/requests",
  authenticateOptional,
  guestsOk({ inbound: [], outbound: [] }, listRequests)
);

// Status probe for a specific user: neutral relationship for guests.
router.get(
  "/status/:userId",
  authenticateOptional,
  guestsOk({ status: null, direction: null }, getStatus)
);

/* ---------- Public probe (auth optional; guest-safe) ---------- */
// Relationship probe used by feed/profile; neutral for guests.
router.get(
  "/relationship",
  authenticateOptional,
  guestsOk({ status: null, direction: null }, getRelationship)
);

/* ---------- Mutations (must be logged in) ---------- */
router.post("/request", authenticate, requestFriend);
router.post("/accept", authenticate, acceptRequest);
router.post("/reject", authenticate, rejectRequest);
router.post("/cancel", authenticate, cancelRequest);
router.post("/unfriend", authenticate, unfriend);
router.post("/block", authenticate, blockUser);
router.post("/unblock", authenticate, unblockUser);

export default router;
