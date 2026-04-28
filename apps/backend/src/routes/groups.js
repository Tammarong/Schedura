// routes/groups.js
import { Router } from "express";
import { authenticate, authenticateOptional } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
import { createGroup } from "../controllers/groups.controller.js";
import crypto from "crypto";

const router = Router();

/* -------- helpers -------- */
const BASE_URL = process.env.BACKEND_URL || "http://localhost:4000";
const fullUrl = (p) => (p ? `${BASE_URL}${p.startsWith("/") ? p : `/${p}`}` : null);

// --------------------- MY GROUPS (auth) ---------------------
router.get("/mine", authenticate, async (req, res) => {
  try {
    const memberships = await prisma.group_members.findMany({
      where: { user_id: req.user.id },
      include: {
        groups: { include: { _count: { select: { group_members: true } } } },
      },
      orderBy: { joined_at: "desc" },
    });

    const groups = memberships
      .filter((m) => m.groups)
      .map((m) => ({
        id: m.groups.id,
        name: m.groups.name,
        description: m.groups.description,
        location: m.groups.location,
        owner_id: m.groups.owner_id,
        code: m.groups.code,
        created_at: m.groups.created_at,
        memberCount: m.groups._count.group_members,
        role: m.role,
        isMember: true,
      }));

    res.json(groups);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch my groups" });
  }
});

// --------------------- LIST ALL GROUPS (auth-optional) ---------------------
router.get("/", authenticateOptional, async (req, res) => {
  try {
    // personalize if logged in
    let mySet = null;
    if (req.user?.id) {
      const mine = await prisma.group_members.findMany({
        where: { user_id: req.user.id },
        select: { group_id: true },
      });
      mySet = new Set(mine.map((m) => m.group_id));
    }

    const groups = await prisma.groups.findMany({
      include: { _count: { select: { group_members: true } } },
      orderBy: { created_at: "asc" }, // or "desc"
    });

    res.json(
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        location: g.location,
        owner_id: g.owner_id,
        code: g.code,
        created_at: g.created_at,
        memberCount: g._count.group_members,
        // only true if user is logged in and belongs to this group
        isMember: mySet ? mySet.has(g.id) : false,
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
});

// --------------------- GET GROUP BY ID (auth-optional) ---------------------
router.get("/:id", authenticateOptional, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });

    const group = await prisma.groups.findUnique({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        description: true,
        location: true,
        owner_id: true,
        code: true,
        created_at: true,
      },
    });
    if (!group) return res.status(404).json({ error: "Group not found" });

    let isMember = false;
    if (req.user?.id) {
      const mem = await prisma.group_members.findUnique({
        where: { group_id_user_id: { group_id: groupId, user_id: req.user.id } },
        select: { user_id: true },
      });
      isMember = !!mem;
    }

    res.json({ ...group, isMember });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to get group" });
  }
});

// --------------------- CREATE GROUP (auth) ---------------------
router.post("/", authenticate, createGroup);

// --------------------- JOIN GROUP (auth) ---------------------
router.post("/join", authenticate, async (req, res) => {
  try {
    const { group_id, code } = req.body;
    let group = null;

    if (group_id) {
      group = await prisma.groups.findUnique({ where: { id: Number(group_id) } });
    } else if (code) {
      group = await prisma.groups.findFirst({
        where: { code: { equals: String(code).trim(), mode: "insensitive" } },
      });
    }
    if (!group) return res.status(404).json({ error: "Group not found" });

    await prisma.group_members.upsert({
      where: { group_id_user_id: { group_id: group.id, user_id: req.user.id } },
      update: {},
      create: { group_id: group.id, user_id: req.user.id, role: "member" },
    });

    res.json({ ok: true, groupId: group.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Join group failed" });
  }
});

// --------------------- GET MEMBERS (auth-optional) ---------------------
// If you prefer keeping member list private, switch this back to `authenticate`.
router.get("/:id/members", authenticateOptional, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });

    const members = await prisma.group_members.findMany({
      where: { group_id: groupId },
      select: {
        role: true,
        users: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
      },
      orderBy: { id: "asc" },
    });

    res.json(
      members.map((m) => ({
        id: m.users.id,
        username: m.users.username,
        displayName: m.users.display_name,
        role: m.role === "owner" || m.role === "admin" ? m.role : "member",
        isOnline: false,
        avatarUrl: fullUrl(m.users.avatar_url),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch group members" });
  }
});

// --------------------- GENERATE INVITE CODE (auth) ---------------------
router.get("/:id/invite", authenticate, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });

    let group = await prisma.groups.findUnique({ where: { id: groupId }, select: { code: true } });
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (!group.code) {
      const newCode = crypto.randomBytes(3).toString("hex").toUpperCase(); // 6 hex chars
      group = await prisma.groups.update({
        where: { id: groupId },
        data: { code: newCode },
        select: { code: true },
      });
    }

    res.json({ code: group.code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate invite code" });
  }
});

// --------------------- UPDATE GROUP (auth) ---------------------
router.put("/:id", authenticate, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });
    const { name, description, location } = req.body;

    const group = await prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const updated = await prisma.groups.update({
      where: { id: groupId },
      data: { name, description, location },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update group" });
  }
});

// --------------------- DESTROY GROUP (auth) ---------------------
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });

    const group = await prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    await prisma.groups.delete({ where: { id: groupId } });
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to destroy group" });
  }
});

// --------------------- LEAVE GROUP (auth) ---------------------
router.post("/:id/leave", authenticate, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });

    const membership = await prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: req.user.id } },
    });
    if (!membership) return res.status(404).json({ error: "Not a member" });
    if (membership.role === "owner") return res.status(400).json({ error: "Owner cannot leave" });

    await prisma.group_members.delete({
      where: { group_id_user_id: { group_id: groupId, user_id: req.user.id } },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to leave group" });
  }
});

// --------------------- REMOVE MEMBER (auth) ---------------------
router.post("/:id/remove-member", authenticate, async (req, res) => {
  try {
    const groupId = Number(req.params.id);
    const { memberId } = req.body;
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid group id" });
    if (!memberId) return res.status(400).json({ error: "memberId is required" });

    const group = await prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const member = await prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: Number(memberId) } },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    await prisma.group_members.delete({
      where: { group_id_user_id: { group_id: groupId, user_id: Number(memberId) } },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to remove member" });
  }
});

export default router;
