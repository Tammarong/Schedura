// controllers/groups.controller.js
import prisma from "../lib/prisma.js";
import { z } from "zod";
import crypto from "crypto";

/* ------------- helpers ------------- */
const BASE_URL = process.env.BACKEND_URL || "http://localhost:4000";
const fullUrl = (p) => (p ? `${BASE_URL}${p.startsWith("/") ? p : `/${p}`}` : null);

/* ===================== CREATE GROUP ===================== */
const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
});

export async function createGroup(req, res) {
  try {
    const { name, description, location } = createSchema.parse(req.body);

    // random 6-hex (12 chars) — short & unique enough for invite codes
    const code = crypto.randomBytes(3).toString("hex");

    const group = await prisma.groups.create({
      data: {
        name,
        description: description || null,
        location: location || null,
        owner_id: req.user.id,
        code,
        group_members: {
          create: { user_id: req.user.id, role: "owner" },
        },
      },
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

    res.status(201).json(group);
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    console.error("Create group failed:", e);
    res.status(500).json({ error: "Create group failed" });
  }
}

/* ===================== MY GROUPS ===================== */
export async function myGroups(req, res) {
  try {
    const memberships = await prisma.group_members.findMany({
      where: { user_id: req.user.id },
      include: {
        groups: {
          include: {
            _count: { select: { group_members: true } },
          },
        },
      },
      orderBy: { joined_at: "desc" },
    });

    const groups = memberships
      .filter((m) => m.groups !== null)
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
      }));

    res.json(groups);
  } catch (e) {
    console.error("Failed to fetch my groups:", e);
    res.status(500).json({ error: "Failed to fetch my groups" });
  }
}

/* ===================== JOIN BY ID ===================== */
const joinSchema = z.object({ group_id: z.number().int().positive() });

export async function joinGroup(req, res) {
  try {
    const { group_id } = joinSchema.parse(req.body);

    await prisma.group_members.upsert({
      where: { unique_group_member: { group_id, user_id: req.user.id } },
      update: {},
      create: { group_id, user_id: req.user.id, role: "member" },
    });

    res.json({ ok: true });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    console.error("Join group failed:", e);
    res.status(500).json({ error: "Join group failed" });
  }
}

/* ===================== JOIN BY CODE ===================== */
const joinCodeSchema = z.object({ code: z.string().min(4) });

export async function joinGroupByCode(req, res) {
  try {
    const { code } = joinCodeSchema.parse(req.body);

    const group = await prisma.groups.findUnique({ where: { code } });
    if (!group) return res.status(404).json({ error: "Group not found" });

    await prisma.group_members.upsert({
      where: { unique_group_member: { group_id: group.id, user_id: req.user.id } },
      update: {},
      create: { group_id: group.id, user_id: req.user.id, role: "member" },
    });

    res.json({ ok: true, group });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    console.error("Join group by code failed:", e);
    res.status(500).json({ error: "Join group by code failed" });
  }
}

/* ===================== LIST ALL GROUPS ===================== */
export async function listGroups(req, res) {
  try {
    const groups = await prisma.groups.findMany({
      include: {
        _count: { select: { group_members: true } },
      },
      orderBy: { created_at: "desc" },
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
      }))
    );
  } catch (e) {
    console.error("Failed to list groups:", e);
    res.status(500).json({ error: "Failed to fetch groups" });
  }
}

/* ===================== GET GROUP BY ID ===================== */
/* Adds avatar_url for each user and returns absolute avatarUrl */
export async function getGroupById(req, res) {
  try {
    const groupId = Number(req.params.id);
    if (isNaN(groupId)) return res.status(400).json({ error: "Invalid group ID" });

    const group = await prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        group_members: {
          select: {
            user_id: true,
            role: true,
            users: {
              select: {
                id: true,
                username: true,
                display_name: true,
                avatar_url: true, // <-- bring avatar file path
              },
            },
          },
        },
      },
    });

    if (!group) return res.status(404).json({ error: "Group not found" });

    // keep original shape but add absolute avatarUrl for convenience
    const withAvatars = {
      ...group,
      group_members: group.group_members.map((gm) => ({
        ...gm,
        users: {
          ...gm.users,
          avatarUrl: fullUrl(gm.users.avatar_url),
        },
      })),
    };

    res.json(withAvatars);
  } catch (e) {
    console.error("Failed to get group by ID:", e);
    res.status(500).json({ error: "Failed to get group" });
  }
}

/* ===================== GET /api/groups/:id/members ===================== */
/* Returns members in the exact UI shape (with absolute avatarUrl) */
export async function getGroupMembers(req, res) {
  try {
    const groupId = Number(req.params.id);
    if (isNaN(groupId)) return res.status(400).json({ error: "Invalid group ID" });

    const rows = await prisma.group_members.findMany({
      where: { group_id: groupId },
      select: {
        role: true,
        users: {
          select: {
            id: true,
            username: true,
            display_name: true,
            avatar_url: true,
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const members = rows.map((r) => ({
      id: r.users.id,
      username: r.users.username,
      displayName: r.users.display_name,
      role: r.role === "owner" ? "owner" : r.role === "admin" ? "admin" : "member",
      isOnline: false, // placeholder unless you track presence
      avatarUrl: fullUrl(r.users.avatar_url),
    }));

    res.json(members);
  } catch (e) {
    console.error("Failed to get group members:", e);
    res.status(500).json({ error: "Failed to fetch members" });
  }
}

/* ===================== PATCH /api/groups/:id ===================== */
const editSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  location: z.string().optional(),
});

export async function editGroup(req, res) {
  try {
    const groupId = Number(req.params.id);
    const { name, description, location } = editSchema.parse(req.body);

    const group = await prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const updated = await prisma.groups.update({
      where: { id: groupId },
      data: { name, description, location },
    });

    res.json(updated);
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    console.error("Edit group failed:", e);
    res.status(500).json({ error: "Edit group failed" });
  }
}

/* ===================== DELETE /api/groups/:id ===================== */
/* Cleans up dependent rows to avoid FK violations (e.g., post_pictures) */
export async function destroyGroup(req, res) {
  try {
    const groupId = Number(req.params.id);

    const group = await prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    await prisma.$transaction(async (tx) => {
      // Posts & related
      const posts = await tx.posts.findMany({
        where: { group_id: groupId },
        select: { id: true },
      });
      const postIds = posts.map((p) => p.id);
      if (postIds.length) {
        await tx.post_pictures.deleteMany({ where: { post_id: { in: postIds } } });
        await tx.post_comments.deleteMany({ where: { post_id: { in: postIds } } });
        await tx.post_likes.deleteMany({ where: { post_id: { in: postIds } } });
      }
      await tx.posts.deleteMany({ where: { group_id: groupId } });

      // Messages & related
      const msgs = await tx.messages.findMany({
        where: { group_id: groupId },
        select: { id: true },
      });
      const msgIds = msgs.map((m) => m.id);
      if (msgIds.length) {
        await tx.message_pictures.deleteMany({ where: { message_id: { in: msgIds } } });
      }
      await tx.messages.deleteMany({ where: { group_id: groupId } });

      // Calendar/events
      await tx.calendar_events.deleteMany({ where: { group_id: groupId } });
      await tx.events.deleteMany({ where: { group_id: groupId } });

      // Memberships last
      await tx.group_members.deleteMany({ where: { group_id: groupId } });

      // Finally the group
      await tx.groups.delete({ where: { id: groupId } });
    });

    res.sendStatus(204);
  } catch (e) {
    console.error("Destroy group failed:", e);
    res.status(500).json({ error: "Destroy group failed" });
  }
}

/* ===================== POST /api/groups/:id/leave ===================== */
export async function leaveGroup(req, res) {
  try {
    const groupId = Number(req.params.id);

    const membership = await prisma.group_members.findUnique({
      where: { unique_group_member: { group_id: groupId, user_id: req.user.id } },
    });
    if (!membership) return res.status(404).json({ error: "Not a member" });
    if (membership.role === "owner") return res.status(400).json({ error: "Owner cannot leave" });

    await prisma.group_members.delete({
      where: { unique_group_member: { group_id: groupId, user_id: req.user.id } },
    });

    res.json({ ok: true });
  } catch (e) {
    console.error("Leave group failed:", e);
    res.status(500).json({ error: "Leave group failed" });
  }
}

/* ===================== POST /api/groups/:id/remove-member ===================== */
const removeSchema = z.object({ memberId: z.number() });

export async function removeMember(req, res) {
  try {
    const groupId = Number(req.params.id);
    const { memberId } = removeSchema.parse(req.body);

    const group = await prisma.groups.findUnique({ where: { id: groupId } });
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.owner_id !== req.user.id) return res.status(403).json({ error: "Forbidden" });

    const member = await prisma.group_members.findUnique({
      where: { unique_group_member: { group_id: groupId, user_id: memberId } },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    await prisma.group_members.delete({
      where: { unique_group_member: { group_id: groupId, user_id: memberId } },
    });

    res.json({ ok: true });
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    console.error("Remove member failed:", e);
    res.status(500).json({ error: "Remove member failed" });
  }
}
