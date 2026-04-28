// src/routes/story.js
import { Router } from "express";
import multer from "multer";
import {
  createStory,
  getFeed,
  getActiveByUsername,
  streamMedia,
  markView,
  archiveStory,
  deleteStory,
} from "../controllers/story.controller.js"; // <-- correct path & ESM named imports

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

/* Mounted as: app.use("/api/stories", router) */

// Create a story (multipart OR JSON)
router.post("/", upload.single("file"), createStory);

// Feed & per-user active
router.get("/feed", getFeed);
router.get("/:username/active", getActiveByUsername);

// Media streaming
router.get("/:id/media", streamMedia);

// View, archive, delete
router.post("/:id/view", markView);
router.post("/:id/archive", archiveStory);
router.delete("/:id", deleteStory);

export default router;
