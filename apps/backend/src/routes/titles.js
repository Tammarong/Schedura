// routes/titles.js
import { Router } from "express";
import {
  listMyTitles,
  setMyCurrentTitle,
  getCurrentTitleByUsername,
} from "../controllers/titles.controller.js";

const router = Router();

/** Owned + current (self) */
router.get("/titles/me", listMyTitles);
router.get("/users/me/titles", listMyTitles);
router.get("/me/titles", listMyTitles);
router.get("/titles/owned", listMyTitles);

/** Equip/unequip (self) */
router.patch("/users/me/current-title", setMyCurrentTitle);
router.patch("/titles/equip", setMyCurrentTitle);
router.post("/titles/equip", setMyCurrentTitle);

/** Public read: current title for a username */
router.get("/users/:username/current-title", getCurrentTitleByUsername);
router.get("/titles/current/:username", getCurrentTitleByUsername);
router.get("/titles/of/:username/current", getCurrentTitleByUsername);

export default router;
