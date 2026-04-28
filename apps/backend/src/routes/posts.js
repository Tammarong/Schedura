// routes/posts.js
import { Router } from "express";
import { authenticate, authenticateOptional } from "../middleware/auth.js";
import multer from "multer";
import {
  createPost,
  listPosts,
  likePost,
  commentPost,
  getPostComments,
  deletePost,
  getPostPictureRaw,
  getPostById,      // <-- added
  // trackShare,    // <-- optional (uncomment if you implement in controller)
} from "../controllers/posts.controller.js";

const router = Router();

/* ---------------- MULTER (memory, images only) ---------------- */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB per file
    files: 8,                   // up to 8 pictures
  },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP/GIF images are allowed"), ok);
  },
});

// Accept either the new "pictures" array or a legacy single "image"
const uploadPictures = upload.fields([
  { name: "pictures", maxCount: 8 },
  { name: "image", maxCount: 1 }, // legacy
]);

/* ---------------- ROUTES ---------------- */

// Create a new post (auth required)
router.post("/", authenticate, uploadPictures, createPost);

// List posts (PUBLIC; auth-optional so we can compute `isLiked` if a token is present)
router.get("/", authenticateOptional, listPosts);

// Get a single post (PUBLIC; auth-optional to compute `isLiked` when token present)
router.get("/:id", authenticateOptional, getPostById);

// Like/unlike a post (auth required)
router.post("/:id/like", authenticate, likePost);

// Add a comment to a post (auth required)
router.post("/:id/comment", authenticate, commentPost);

// Get comments for a post (PUBLIC; auth-optional)
router.get("/:id/comments", authenticateOptional, getPostComments);

// Delete own post (auth required)
router.delete("/:id", authenticate, deletePost);

// Serve a post picture from DB (PUBLIC)
router.get("/:postId/pictures/:picId/raw", getPostPictureRaw);

// (Optional) Track shares for basic analytics
// router.post("/:id/share", authenticateOptional, trackShare);

export default router;
