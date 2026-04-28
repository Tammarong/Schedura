// routes/avatar.js
import { Router } from "express";
import multer from "multer";
import {
  uploadAvatar,
  deleteAvatar,
  getMyAvatar,
  getAvatarForParam,
  getAvatarRaw, // <-- new raw streaming route
} from "../controllers/avatar.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

/* ---------- Multer (memory) ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
    ]);
    if (allowed.has(file.mimetype)) return cb(null, true);
    return cb(new Error("Only jpg, png, webp, gif, avif are allowed"));
  },
});

/* ---------- Multer error → JSON helper ---------- */
function multerWrap(mw) {
  return (req, res, next) => {
    mw(req, res, (err) => {
      if (!err) return next();
      const msg =
        (typeof err?.message === "string" && err.message) || "Upload failed";
      return res.status(400).json({ error: msg });
    });
  };
}

/* ----------
   Routes
   (mounted under /api/avatar)
   ---------- */

// Current user's avatar (returns JSON { avatarUrl })
router.get("/me", authenticate, getMyAvatar);

// Public JSON wrapper to someone’s avatar URL by username or numeric id
router.get("/:param", getAvatarForParam);

// NEW: raw bytes streaming from DB (username or numeric id)
router.get("/:param/raw", getAvatarRaw);

// Upload/replace avatar (form-data: avatar=<file>)
router.post("/", authenticate, multerWrap(upload.single("avatar")), uploadAvatar);
router.post("/upload", authenticate, multerWrap(upload.single("avatar")), uploadAvatar);

// Delete avatar (clears DB blob + legacy file ref, if any)
router.delete("/", authenticate, deleteAvatar);

export default router;
