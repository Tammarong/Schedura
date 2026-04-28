// src/controllers/messages.controller.js
import prisma from "../lib/prisma.js";
import { z } from "zod";
import { getIO, dmRoom } from "../server/sockets.js";
import fs from "fs/promises";
import path from "path";

/* ---------- Validation ---------- */
const sendSchema = z
  .object({
    content: z.string().min(1), // FE should send \u200B when only images
    receiver_id: z.coerce.number().int().optional(),
    group_id: z.coerce.number().int().optional(),
  })
  .refine((v) => Boolean(v.receiver_id) || Boolean(v.group_id), {
    message: "receiver_id or group_id is required",
    path: ["receiver_id"],
  });

/* ---------- URL helpers ---------- */
const BASE_URL = process.env.BACKEND_URL || "http://localhost:4000";
const fullUrl = (p) => {
  if (!p) return null;
  const withSlash = p.startsWith("/") ? p : `/${p}`;
  return `${BASE_URL}${withSlash}`;
};

const mapUser = (u) =>
  u
    ? {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        displayName: u.display_name ?? u.username, // camelCase for FE tolerance
        avatarUrl: fullUrl(u.avatar_url),
      }
    : null;

/* ---------- Picture helpers ---------- */

// FE supports: { id, mime_type } → /pictures/:id
// and legacy:  { url } or "/uploads/.."
const toClientPictures = (rows = []) =>
  rows.map((p) => ({
    id: p.id,
    mime_type: p.mime_type || null,
    // Keep legacy url so older rows still render (FE has fallback)
    url: p.url ? fullUrl(p.url) : null,
  }));

/**
 * toClientMessage
 * - Robust against missing relations.
 * - Ensures sender.id/receiver.id via flat-id fallback.
 * - Emits picture metadata for DB streaming (id/mime_type) and keeps legacy url.
 */
const toClientMessage = (row) => {
  const flatSenderId = row.sender_id ?? 0;
  const flatReceiverId = row.receiver_id ?? null;

  const senderRel = mapUser(row.users_messages_sender_idTousers);
  const receiverRel = mapUser(row.users_messages_receiver_idTousers);

  const sender =
    senderRel ??
    (flatSenderId
      ? {
          id: flatSenderId,
          username: row.sender_username || "unknown",
          display_name: row.sender_display_name || "Unknown",
          displayName: row.sender_display_name || row.sender_username || "Unknown",
          avatarUrl: row.sender_avatar_url ? fullUrl(row.sender_avatar_url) : null,
        }
      : {
          id: 0,
          username: "unknown",
          display_name: "Unknown",
          displayName: "Unknown",
          avatarUrl: null,
        });

  const receiver =
    receiverRel ??
    (flatReceiverId
      ? {
          id: flatReceiverId,
          username: row.receiver_username || "unknown",
          display_name: row.receiver_display_name || "Unknown",
          displayName: row.receiver_display_name || row.receiver_username || "Unknown",
          avatarUrl: row.receiver_avatar_url ? fullUrl(row.receiver_avatar_url) : null,
        }
      : null);

  return {
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    sender,
    receiver,
    group: row.groups || null,
    pictures: toClientPictures(row.pictures || []),
  };
};

const toReader = (r) => ({
  userId: r.user_id,
  displayName: r.users?.display_name || r.users?.username || "Unknown",
  avatarUrl: r.users?.avatar_url ? fullUrl(r.users.avatar_url) : null,
});

/* =========================================================
   Send Message (DM or Group)  POST /api/messages
   - Stores images in DB (message_pictures.data + mime_type)
   - Still accepts legacy disk files (reads buffer, then can clean up)
   ========================================================= */
export async function sendMessage(req, res) {
  try {
    const { content, receiver_id, group_id } = sendSchema.parse(req.body);

    const created = await prisma.messages.create({
      data: {
        sender_id: req.user.id,
        receiver_id: receiver_id ?? null,
        group_id: group_id ?? null,
        content,
      },
      select: {
        id: true,
        sender_id: true,
        receiver_id: true,
        group_id: true,
        created_at: true,
        content: true,
      },
    });

    // Expecting multer memoryStorage to populate file.buffer
    // but we also support diskStorage fallback (file.path)
    const files = Array.isArray(req.files) ? req.files : [];
    for (const f of files) {
      try {
        let buffer = f.buffer;
        if (!buffer && f.path) {
          // read from disk (legacy), then optional cleanup
          const abs = path.isAbsolute(f.path) ? f.path : path.resolve(process.cwd(), f.path);
          buffer = await fs.readFile(abs);
          // optional: try to unlink, ignore errors
          try {
            await fs.unlink(abs);
          } catch {}
        }
        if (!buffer || !buffer.length) continue;

        await prisma.message_pictures.create({
          data: {
            message_id: created.id,
            data: buffer,                         // BLOB/BYTES
            mime_type: f.mimetype || "application/octet-stream",
            original_name: f.originalname || null,
            // url left null for DB-backed pictures
          },
          select: { id: true },
        });
      } catch (picErr) {
        console.warn("Failed to store picture:", picErr?.message);
      }
    }

    // Re-fetch with relations for client payload (no data blob selected)
    const msg = await prisma.messages.findUnique({
      where: { id: created.id },
      include: {
        users_messages_sender_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
        users_messages_receiver_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
        groups: { select: { id: true, name: true } },
        pictures: {
          select: { id: true, mime_type: true, url: true }, // DO NOT select .data here
        },
      },
    });

    const rowForClient = {
      ...msg,
      sender_id: created.sender_id,
      receiver_id: created.receiver_id,
    };

    const response = toClientMessage(rowForClient);

    // ---- Realtime emit with room-size sanity log
    try {
      const io = getIO();

      if (created.group_id) {
        const room = `group:${created.group_id}`;
        const size = (await io.in(room).allSockets()).size;
        console.log(`[emit] group:new_message -> ${room} sockets=${size} msg=${response.id}`);
        io.to(room).emit("group:new_message", response);
      } else if (created.receiver_id) {
        const room = dmRoom(created.sender_id, created.receiver_id);
        const size = (await io.in(room).allSockets()).size;
        console.log(
          `[emit] dm:new_message -> ${room} sockets=${size} sender=${created.sender_id} receiver=${created.receiver_id} msg=${response.id}`
        );
        io.to(room).emit("dm:new_message", response);
      } else {
        console.warn("[emit] neither group_id nor receiver_id present");
      }
    } catch (emitErr) {
      console.warn("Socket emit failed:", emitErr?.message);
    }

    return res.status(201).json(response);
  } catch (e) {
    console.error("Send message failed:", e);
    return res.status(500).json({ error: "Send message failed" });
  }
}

/* =========================================================
   Fetch DM  GET /api/messages/dm/:userId
   ========================================================= */
export async function listDM(req, res) {
  try {
    const otherId = Number(req.params.userId);
    if (Number.isNaN(otherId)) return res.status(400).json({ error: "Invalid userId" });

    const rows = await prisma.messages.findMany({
      where: {
        OR: [
          { sender_id: req.user.id, receiver_id: otherId },
          { sender_id: otherId, receiver_id: req.user.id },
        ],
      },
      orderBy: { created_at: "asc" },
      include: {
        users_messages_sender_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
        users_messages_receiver_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
        pictures: {
          select: { id: true, mime_type: true, url: true }, // no blob
        },
      },
    });

    const enriched = rows.map((r) => ({
      ...r,
      sender_id: r.sender_id,
      receiver_id: r.receiver_id,
    }));

    return res.json(enriched.map(toClientMessage));
  } catch (e) {
    console.error("Failed to fetch DM:", e);
    return res.status(500).json({ error: "Failed to fetch DM" });
  }
}

/* =========================================================
   Fetch Group Messages  GET /api/messages/group/:groupId
   ========================================================= */
export async function listGroupMessages(req, res) {
  try {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) return res.status(400).json({ error: "Invalid groupId" });

    const messages = await prisma.messages.findMany({
      where: { group_id: groupId },
      orderBy: { created_at: "asc" },
      include: {
        users_messages_sender_idTousers: {
          select: { id: true, username: true, display_name: true, avatar_url: true },
        },
        pictures: {
          select: { id: true, mime_type: true, url: true }, // no blob
        },
      },
    });

    const enriched = messages.map((msg) => ({
      ...msg,
      receiver_id: null, // groups don't have a receiver
    }));

    return res.json(
      enriched.map((row) =>
        toClientMessage({
          ...row,
          users_messages_receiver_idTousers: null,
          groups: null,
        })
      )
    );
  } catch (e) {
    console.error("Failed to fetch group messages:", e);
    return res.status(500).json({ error: "Failed to fetch group messages" });
  }
}

/* =========================================================
   Readers  GET /api/messages/:id/readers
   ========================================================= */
export async function listMessageReaders(req, res) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid message id" });

    const msg = await prisma.messages.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });

    const reads = await prisma.message_reads.findMany({
      where: { message_id: id },
      orderBy: { created_at: "asc" },
      include: {
        users: { select: { id: true, username: true, display_name: true, avatar_url: true } },
      },
    });

    const seen = new Set();
    const out = [];
    for (const r of reads) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      out.push(toReader(r));
    }

    return res.json(out);
  } catch (e) {
    console.error("Failed to fetch message readers:", e);
    return res.status(500).json({ error: "Failed to fetch message readers" });
  }
}

/* =========================================================
   Mark as read  POST /api/messages/:id/read
   ========================================================= */
export async function markMessageRead(req, res) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid message id" });

    const msg = await prisma.messages.findUnique({
      where: { id },
      select: { id: true, group_id: true, sender_id: true, receiver_id: true },
    });
    if (!msg) return res.status(404).json({ error: "Message not found" });

    // Idempotent upsert with safe fallback
    try {
      await prisma.message_reads.upsert({
        where: {
          message_id_user_id: { message_id: id, user_id: req.user.id },
        },
        create: { message_id: id, user_id: req.user.id },
        update: {},
      });
    } catch {
      await prisma.message_reads.createMany({
        data: [{ message_id: id, user_id: req.user.id }],
        skipDuplicates: true,
      });
    }

    const reads = await prisma.message_reads.findMany({
      where: { message_id: id },
      orderBy: { created_at: "asc" },
      include: {
        users: { select: { id: true, username: true, display_name: true, avatar_url: true } },
      },
    });

    const seen = new Set();
    const readers = [];
    for (const r of reads) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      readers.push(toReader(r));
    }

    try {
      const io = getIO();
      if (msg.group_id) {
        const room = `group:${msg.group_id}`;
        io.to(room).emit("message:read", { messageId: id, readers });
      } else if (msg.sender_id && msg.receiver_id) {
        const room = dmRoom(msg.sender_id, msg.receiver_id);
        io.to(room).emit("dm:read", { messageId: id, readers });
      }
    } catch (emitErr) {
      console.warn("Socket emit failed:", emitErr?.message);
    }

    return res.status(204).end();
  } catch (e) {
    console.error("Failed to mark message read:", e);
    return res.status(500).json({ error: "Failed to mark message read" });
  }
}

/* =========================================================
   Stream a picture  GET /pictures/:id
   - If DB blob exists: stream it with mime_type
   - Else if legacy url exists: read from disk and stream
   ========================================================= */
export async function streamPicture(req, res) {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid picture id" });

    const pic = await prisma.message_pictures.findUnique({
      where: { id },
      select: { data: true, mime_type: true, url: true },
    });

    if (!pic) return res.status(404).json({ error: "Not found" });

    if (pic.data && pic.data.length) {
      res.setHeader("Content-Type", pic.mime_type || "application/octet-stream");
      return res.send(pic.data);
    }

    // Legacy fallback: read the file denoted by url (e.g. "/uploads/xyz.jpg")
    if (pic.url) {
      try {
        // Map "/uploads/..." → "./uploads/..." (adjust if your static path differs)
        const diskPath = path.resolve(process.cwd(), `.${pic.url}`);
        const buf = await fs.readFile(diskPath);
        // let Express determine content type from extension (best-effort)
        const ext = path.extname(diskPath);
        if (ext) res.type(ext);
        return res.send(buf);
      } catch (err) {
        // If file missing, return 404 rather than 500
        return res.status(404).json({ error: "File not found" });
      }
    }

    return res.status(404).json({ error: "Not found" });
  } catch (e) {
    console.error("Failed to stream picture:", e);
    return res.status(500).json({ error: "Failed to stream picture" });
  }
}
