import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { createEvent, listEvents } from "../controllers/events.controller.js";

const router = Router();
router.post("/", authenticate, createEvent);
router.get("/", authenticate, listEvents);

export default router;
