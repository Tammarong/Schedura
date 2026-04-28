// src/routes/highlight.js
import { Router } from "express";
import {
  createHighlight,
  listMine,
  listByUsername,
  addToHighlight,
  removeFromHighlight,
  updateHighlight,
  deleteHighlight,
} from "../controllers/highlight.controller.js"; // <-- ESM, .js, named imports

const router = Router();

/* Mounted with: app.use("/api/highlights", router) */

// Create + mine
router.post("/", createHighlight);
router.get("/me", listMine);

// ID-specific routes FIRST
router.post("/:id/add", addToHighlight);
router.delete("/:id/remove", removeFromHighlight);
router.patch("/:id", updateHighlight);
router.delete("/:id", deleteHighlight);

// Username route LAST
router.get("/:username", listByUsername);

export default router;
