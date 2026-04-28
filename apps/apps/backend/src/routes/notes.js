// routes/notes.js
import { Router } from "express";
import {
  listBoards,
  createBoard,
  getBoard,
  updateBoard,
  deleteBoard,
  createNote,
  updateNote,
  deleteNote,
} from "../controllers/notes.controller.js";
import { authenticate, authenticateOptional } from "../middleware/auth.js";

const router = Router();

/**
 * Boards
 * (These rely on req.user for ownership & group membership checks,
 *  so we require authentication.)
 */
router.get("/boards", authenticate, listBoards);                 // GET /api/notes/boards?groupId=123
router.post("/boards", authenticate, createBoard);               // POST /api/notes/boards
router.get("/boards/:boardId", authenticate, getBoard);          // GET /api/notes/boards/:boardId
router.patch("/boards/:boardId", authenticate, updateBoard);     // PATCH /api/notes/boards/:boardId
router.delete("/boards/:boardId", authenticate, deleteBoard);    // DELETE /api/notes/boards/:boardId

/**
 * Notes
 */
router.post("/boards/:boardId/notes", authenticate, createNote); // POST /api/notes/boards/:boardId/notes
router.patch("/notes/:noteId", authenticate, updateNote);        // PATCH /api/notes/notes/:noteId
router.delete("/notes/:noteId", authenticate, deleteNote);       // DELETE /api/notes/notes/:noteId

export default router;
