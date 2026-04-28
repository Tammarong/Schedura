import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { setAvailability, listAvailability } from "../controllers/availability.controller.js";

const router = Router();
router.post("/", authenticate, setAvailability);
router.get("/", authenticate, listAvailability);

export default router;
