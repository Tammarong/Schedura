// src/routes/schedules.js
import { Router } from "express";
import {
  getEvents,
  createOrUpdateNote,
  deleteNote,
  getGroupEvents,
  upsertGroupEvent,
  deleteGroupEvent,
} from "../controllers/schedules.controller.js";
import { authenticate } from "../middleware/auth.js"; // your cookie-JWT middleware

/* ===================== Personal schedules (/api/schedules) ===================== */
const router = Router();

// all schedules routes require a logged-in user
router.use(authenticate);

// GET /api/schedules?includeGroup=1
router.get("/", getEvents);

// POST /api/schedules  { date, title }
router.post("/", createOrUpdateNote);

// DELETE /api/schedules/:id
router.delete("/:id", deleteNote);

export default router;

/* ===================== Group schedules (/api/groups/:id/schedule) ===================== */
/* Mount this in your server as: app.use("/api/groups", groupScheduleRouter) */
export const groupScheduleRouter = Router({ mergeParams: true });

// all group schedule routes require a logged-in user
groupScheduleRouter.use(authenticate);

// GET /api/groups/:id/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
groupScheduleRouter.get("/:id/schedule", getGroupEvents);

// POST /api/groups/:id/schedule
groupScheduleRouter.post("/:id/schedule", upsertGroupEvent);

// DELETE /api/groups/:id/schedule/:eventId
groupScheduleRouter.delete("/:id/schedule/:eventId", deleteGroupEvent);
