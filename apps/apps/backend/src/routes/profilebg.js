// src/routes/profilebg.js
import express from "express";
import multer from "multer";
import jwt from "jsonwebtoken"; // npm i jsonwebtoken
import * as ctrl from "../controllers/profilebg.controller.js";

const router = express.Router();

/** --- lightweight auth guard (accepts req.user, session, or Bearer JWT) --- */
function requireAuth(req, res, next) {
  let uid =
    (req.user && (req.user.id || req.user.userId)) ||
    req.userId ||
    (req.auth && req.auth.userId) ||
    (res.locals && res.locals.user && (res.locals.user.id || res.locals.user.userId)) ||
    (req.session && (req.session.userId || (req.session.user && req.session.user.id)));

  // Try Bearer JWT if nothing above was set
  if (!uid && req.headers && typeof req.headers.authorization === "string") {
    const h = req.headers.authorization;
    if (h.startsWith("Bearer ")) {
      const token = h.slice(7);
      try {
        const secret = process.env.JWT_SECRET || process.env.JWT_PUBLIC || process.env.JWT_KEY;
        // Accept common algs; adjust to your stack if you only use one:
        const payload = jwt.verify(token, secret, { algorithms: ["HS256", "RS256"] });
        uid = payload.userId || payload.sub || payload.id;
        // populate some common props so downstream code can rely on them
        req.user = req.user || { id: uid, username: payload.username };
        req.auth = { userId: uid };
      } catch {
        // ignore; will fall through to 401
      }
    }
  }

  if (!uid) return res.status(401).json({ error: "Unauthorized" });
  return next();
}

/** --- upload (in-memory; DB blob write) --- */
const MAX_MB = Number(process.env.MAX_PROFILE_BG_MB || 8);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});

/**
 * ---------- Routes ----------
 * NOTE: Put "/:username/raw" BEFORE "/:username" so it isn't captured by the param route.
 */

// Public-ish reads
router.get("/me", requireAuth, ctrl.getMineMeta);
router.get("/:username/raw", ctrl.getUserRaw);
router.get("/:username", ctrl.getUserMeta);

// Mutations (auth required)
router.patch("/color", requireAuth, express.json(), ctrl.setColor);
router.post("/url", requireAuth, express.json(), ctrl.setUrl);
router.post("/image", requireAuth, upload.single("image"), ctrl.uploadImage);
router.delete("/image", requireAuth, ctrl.deleteImage);

export default router;
