// src/routes/messages.js
import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import multer from "multer";

import {
  sendMessage,
  listDM,
  listGroupMessages,
  listMessageReaders,
  markMessageRead,
  streamPicture,
} from "../controllers/messages.controller.js";

const router = Router();

/* ---------- Multer (images to DB via memory buffer) ---------- */
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ok =
      /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype) ||
      /\.(png|jpe?g|webp|gif)$/i.test(file.originalname || "");
    cb(null, ok);
  },
  limits: {
    files: 8,
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

/* ---------- Message routes ---------- */
// Send message (DM or Group) + multiple images via field "images"
router.post("/", authenticate, upload.array("images", 8), sendMessage);

// Fetch DM history
router.get("/dm/:userId", authenticate, listDM);

// Fetch group messages
router.get("/group/:groupId", authenticate, listGroupMessages);

// Read receipts
router.get("/:id/readers", authenticate, listMessageReaders);
router.post("/:id/read", authenticate, markMessageRead);

/* ---------- Public pictures route (so <img src> works) ---------- */
export const picturesRouter = Router();
// Do NOT add `authenticate` here unless your images are cookie-auth’d.
// <img> can’t send your Authorization header.
picturesRouter.get("/pictures/:id", streamPicture);

export default router;
