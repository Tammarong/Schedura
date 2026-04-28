// controllers/notes.controller.js
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// --- helpers ---
function boardRoom(boardId) {
  return `whiteboard:${boardId}`;
}
function groupRoom(groupId) {
  return `group:${groupId}`;
}

async function isGroupMember(userId, groupId) {
  if (!groupId) return false;
  const m = await prisma.group_members.findFirst({
    where: { user_id: userId, group_id: groupId },
    select: { id: true },
  });
  return !!m;
}

function sanitizeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------- ACCESS RULES -----------
// Read: owner or (is_shared && member of group)
// Write: owner only (simple to start; we can expand later)
async function canReadBoard(userId, board) {
  if (!board) return false;
  if (board.owner_id === userId) return true;
  if (board.group_id && board.is_shared) {
    return isGroupMember(userId, board.group_id);
  }
  return false;
}
function canWriteBoard(userId, board) {
  if (!board) return false;
  return board.owner_id === userId;
}

// ---------- CONTROLLERS ----------
export async function listBoards(req, res) {
  try {
    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId)) return res.status(401).json({ error: "Unauthorized" });

    const groupId = sanitizeNumber(req.query.groupId);

    // Boards user owns
    const owned = await prisma.whiteboards.findMany({
      where: { owner_id: userId, ...(groupId ? { group_id: groupId } : {}) },
      orderBy: { updated_at: "desc" },
      select: {
        id: true,
        title: true,
        is_shared: true,
        group_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    // Boards shared to a group the user is in (not owned by them)
    let shared = [];
    {
      // Find groups user is a member of
      const memberships = await prisma.group_members.findMany({
        where: { user_id: userId },
        select: { group_id: true },
      });
      const groupIds = memberships.map((m) => m.group_id);
      if (groupIds.length > 0) {
        shared = await prisma.whiteboards.findMany({
          where: {
            is_shared: true,
            group_id: groupId ? groupId : { in: groupIds },
            NOT: { owner_id: userId },
          },
          orderBy: { updated_at: "desc" },
          select: {
            id: true,
            title: true,
            is_shared: true,
            group_id: true,
            created_at: true,
            updated_at: true,
          },
        });
      }
    }

    res.json({ owned, shared });
  } catch (e) {
    console.error("[notes] listBoards error", e);
    res.status(500).json({ error: "Failed to list boards" });
  }
}

export async function createBoard(req, res) {
  try {
    // must be authenticated
    const userIdNum = Number(req.user?.id);
    if (!Number.isFinite(userIdNum)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const title = String(req.body.title || "").trim();
    const groupId = sanitizeNumber(req.body.groupId);
    const isShared = Boolean(req.body.isShared);

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (groupId) {
      const member = await isGroupMember(userIdNum, groupId);
      if (!member) return res.status(403).json({ error: "Not a member of this group" });
    }

    const board = await prisma.whiteboards.create({
      data: {
        title,
        owner_id: userIdNum,
        group_id: groupId || null,
        is_shared: !!groupId && isShared,
      },
      select: {
        id: true,
        title: true,
        is_shared: true,
        group_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    // socket broadcast (optional)
    const io = req.app?.locals?.io;
    if (io && board.group_id) {
      io.to(groupRoom(board.group_id)).emit("whiteboard:created", board);
    }

    res.status(201).json(board);
  } catch (e) {
    console.error("[notes] createBoard error", e);
    res.status(500).json({ error: "Failed to create board" });
  }
}

export async function getBoard(req, res) {
  try {
    const userId = Number(req.user?.id);
    const boardId = sanitizeNumber(req.params.boardId);

    if (!Number.isFinite(boardId)) return res.status(400).json({ error: "Invalid board id" });

    const board = await prisma.whiteboards.findUnique({
      where: { id: boardId },
      include: {
        notes: {
          where: { is_archived: false },
          orderBy: [{ z_index: "asc" }, { id: "asc" }],
          select: {
            id: true,
            user_id: true,
            content: true,
            color: true,
            x: true,
            y: true,
            width: true,
            height: true,
            rotation: true,
            z_index: true,
            is_archived: true,
            created_at: true,
            updated_at: true,
          },
        },
      },
    });
    if (!board) return res.status(404).json({ error: "Board not found" });

    const allowed = await canReadBoard(userId, board);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    res.json({
      id: board.id,
      title: board.title,
      is_shared: board.is_shared,
      group_id: board.group_id,
      created_at: board.created_at,
      updated_at: board.updated_at,
      notes: board.notes,
    });
  } catch (e) {
    console.error("[notes] getBoard error", e);
    res.status(500).json({ error: "Failed to load board" });
  }
}

export async function updateBoard(req, res) {
  try {
    const userId = Number(req.user?.id);
    const boardId = sanitizeNumber(req.params.boardId);
    if (!Number.isFinite(boardId)) return res.status(400).json({ error: "Invalid board id" });

    const existing = await prisma.whiteboards.findUnique({ where: { id: boardId } });
    if (!existing) return res.status(404).json({ error: "Board not found" });
    if (!canWriteBoard(userId, existing)) return res.status(403).json({ error: "Forbidden" });

    const next = {};
    if (typeof req.body.title === "string") {
      const t = req.body.title.trim();
      if (t.length === 0) return res.status(400).json({ error: "Title cannot be empty" });
      next.title = t;
    }
    if (typeof req.body.isShared === "boolean") {
      // Only meaningful if board belongs to a group
      next.is_shared = existing.group_id ? Boolean(req.body.isShared) : false;
    }

    const updated = await prisma.whiteboards.update({
      where: { id: boardId },
      data: next,
      select: {
        id: true,
        title: true,
        is_shared: true,
        group_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    const io = req.app?.locals?.io;
    if (io) {
      io.to(boardRoom(boardId)).emit("whiteboard:updated", updated);
      if (updated.group_id) io.to(groupRoom(updated.group_id)).emit("whiteboard:updated", updated);
    }

    res.json(updated);
  } catch (e) {
    console.error("[notes] updateBoard error", e);
    res.status(500).json({ error: "Failed to update board" });
  }
}

export async function deleteBoard(req, res) {
  try {
    const userId = Number(req.user?.id);
    const boardId = sanitizeNumber(req.params.boardId);
    if (!Number.isFinite(boardId)) return res.status(400).json({ error: "Invalid board id" });

    const existing = await prisma.whiteboards.findUnique({ where: { id: boardId } });
    if (!existing) return res.status(404).json({ error: "Board not found" });
    if (!canWriteBoard(userId, existing)) return res.status(403).json({ error: "Forbidden" });

    const deleted = await prisma.whiteboards.delete({
      where: { id: boardId },
      select: { id: true, group_id: true },
    });

    const io = req.app?.locals?.io;
    if (io) {
      io.to(boardRoom(boardId)).emit("whiteboard:deleted", { id: boardId });
      if (deleted.group_id) io.to(groupRoom(deleted.group_id)).emit("whiteboard:deleted", { id: boardId });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[notes] deleteBoard error", e);
    res.status(500).json({ error: "Failed to delete board" });
  }
}

export async function createNote(req, res) {
  try {
    const userId = Number(req.user?.id);
    const boardId = sanitizeNumber(req.params.boardId);
    if (!Number.isFinite(boardId)) return res.status(400).json({ error: "Invalid board id" });

    const board = await prisma.whiteboards.findUnique({ where: { id: boardId } });
    if (!board) return res.status(404).json({ error: "Board not found" });

    const allowed = await canReadBoard(userId, board);
    if (!allowed) return res.status(403).json({ error: "Forbidden" });

    const content = typeof req.body.content === "string" ? req.body.content : "";
    const color = typeof req.body.color === "string" ? req.body.color : null;

    const x = sanitizeNumber(req.body.x, 0);
    const y = sanitizeNumber(req.body.y, 0);
    const width = sanitizeNumber(req.body.width, null);
    const height = sanitizeNumber(req.body.height, null);
    const rotation = sanitizeNumber(req.body.rotation, 0);

    // accept FE sending either zIndex or z_index
    const zIndexRaw = req.body.zIndex ?? req.body.z_index;
    const zIndex = Number.isFinite(Number(zIndexRaw)) ? Number(zIndexRaw) : 0;

    const note = await prisma.sticky_notes.create({
      data: {
        board_id: boardId,
        user_id: userId,
        content,
        color,
        x,
        y,
        width,
        height,
        rotation,
        z_index: zIndex,
      },
      select: {
        id: true,
        board_id: true,
        user_id: true,
        content: true,
        color: true,
        x: true,
        y: true,
        width: true,
        height: true,
        rotation: true,
        z_index: true,
        is_archived: true,
        created_at: true,
        updated_at: true,
      },
    });

    const io = req.app?.locals?.io;
    if (io) {
      io.to(boardRoom(boardId)).emit("note:created", note);
      if (board.group_id) io.to(groupRoom(board.group_id)).emit("note:created", note);
    }

    res.status(201).json(note);
  } catch (e) {
    console.error("[notes] createNote error", e);
    res.status(500).json({ error: "Failed to create note" });
  }
}

export async function updateNote(req, res) {
  try {
    const userId = Number(req.user?.id);
    const noteId = sanitizeNumber(req.params.noteId);
    if (!Number.isFinite(noteId)) return res.status(400).json({ error: "Invalid note id" });

    const existing = await prisma.sticky_notes.findUnique({
      where: { id: noteId },
      include: { whiteboards: true },
    });
    if (!existing) return res.status(404).json({ error: "Note not found" });

    const board = existing.whiteboards;
    const canWrite = await canReadBoard(userId, board); // allow editors to move/edit if they can read (shared scenario)
    if (!canWrite) return res.status(403).json({ error: "Forbidden" });

    const next = {};
    if (typeof req.body.content === "string") next.content = req.body.content;
    if (typeof req.body.color === "string") next.color = req.body.color;

    if (req.body.x !== undefined) next.x = sanitizeNumber(req.body.x, existing.x);
    if (req.body.y !== undefined) next.y = sanitizeNumber(req.body.y, existing.y);
    if (req.body.width !== undefined) next.width = sanitizeNumber(req.body.width, existing.width);
    if (req.body.height !== undefined) next.height = sanitizeNumber(req.body.height, existing.height);
    if (req.body.rotation !== undefined) next.rotation = sanitizeNumber(req.body.rotation, existing.rotation);

    if (req.body.zIndex !== undefined || req.body.z_index !== undefined) {
      const z = req.body.zIndex ?? req.body.z_index;
      next.z_index = sanitizeNumber(z, existing.z_index);
    }

    if (req.body.isArchived !== undefined) next.is_archived = Boolean(req.body.isArchived);

    const updated = await prisma.sticky_notes.update({
      where: { id: noteId },
      data: next,
      select: {
        id: true,
        board_id: true,
        user_id: true,
        content: true,
        color: true,
        x: true,
        y: true,
        width: true,
        height: true,
        rotation: true,
        z_index: true,
        is_archived: true,
        created_at: true,
        updated_at: true,
      },
    });

    const io = req.app?.locals?.io;
    if (io) {
      io.to(boardRoom(updated.board_id)).emit("note:updated", updated);
      if (board.group_id) io.to(groupRoom(board.group_id)).emit("note:updated", updated);
    }

    res.json(updated);
  } catch (e) {
    console.error("[notes] updateNote error", e);
    res.status(500).json({ error: "Failed to update note" });
  }
}

export async function deleteNote(req, res) {
  try {
    const userId = Number(req.user?.id);
    const noteId = sanitizeNumber(req.params.noteId);
    if (!Number.isFinite(noteId)) return res.status(400).json({ error: "Invalid note id" });

    const existing = await prisma.sticky_notes.findUnique({
      where: { id: noteId },
      include: { whiteboards: true },
    });
    if (!existing) return res.status(404).json({ error: "Note not found" });

    const board = existing.whiteboards;
    const canWrite = await canReadBoard(userId, board); // same rule as update
    if (!canWrite) return res.status(403).json({ error: "Forbidden" });

    await prisma.sticky_notes.delete({ where: { id: noteId } });

    const io = req.app?.locals?.io;
    if (io) {
      io.to(boardRoom(board.id)).emit("note:deleted", { id: noteId, board_id: board.id });
      if (board.group_id) io.to(groupRoom(board.group_id)).emit("note:deleted", { id: noteId, board_id: board.id });
    }

    res.json({ success: true });
  } catch (e) {
    console.error("[notes] deleteNote error", e);
    res.status(500).json({ error: "Failed to delete note" });
  }
}
