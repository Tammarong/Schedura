// src/controllers/schedules.controller.js
import prisma from "../lib/prisma.js";

/* ---------- helpers ---------- */
function toDateOnlyUTC(input) {
  const d = new Date(input);
  // store as UTC date-only
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Convert "HH:mm" -> Date for @db.Time(6) (stored in UTC) */
function toTimeOnlyUTC(hhmm) {
  if (typeof hhmm !== "string" || !hhmm.trim()) return null;
  return new Date(`1970-01-01T${hhmm.padStart(5, "0")}:00.000Z`);
}

/** Convert Prisma/PG TIME(Date) -> "HH:mm" */
function timeToHHMM(val) {
  if (!val) return null;
  const d = new Date(val);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

async function isGroupMember(userId, groupId) {
  if (!userId || !groupId) return false;
  const m = await prisma.group_members.findFirst({
    where: { user_id: Number(userId), group_id: Number(groupId) },
    select: { id: true },
  });
  return !!m;
}

/* =========================
   Personal Schedules
   ========================= */

/**
 * GET /api/schedules?includeGroup=1
 * - Personal events; if includeGroup=1 also returns group events for groups the user belongs to.
 */
export const getEvents = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

    const includeGroup =
      req.query.includeGroup === "1" || req.query.include_group === "1";

    const where = includeGroup
      ? {
          OR: [
            { type: "personal", user_id: authUserId },
            {
              type: "group",
              // relation-based filter for groups the user belongs to
              groups: { group_members: { some: { user_id: authUserId } } },
            },
          ],
        }
      : { type: "personal", user_id: authUserId };

    // NOTE: do NOT orderBy start_time in SQL
    const rows = await prisma.calendar_events.findMany({
      where,
      include: {
        users: { select: { id: true, username: true, display_name: true } },
        groups: { select: { id: true, name: true } },
      },
      orderBy: [{ date: "asc" }, { title: "asc" }],
    });

    // JS-side sort (date, start_time, title) + normalize TIME → "HH:mm"
    const events = rows
      .map((ev) => ({
        ...ev,
        start_time: timeToHHMM(ev.start_time),
        end_time: timeToHHMM(ev.end_time),
      }))
      .sort((a, b) => {
        const da = new Date(a.date).valueOf();
        const db = new Date(b.date).valueOf();
        if (da !== db) return da - db;
        const sa = a.start_time ?? "";
        const sb = b.start_time ?? "";
        if (sa !== sb) return sa.localeCompare(sb);
        return a.title.localeCompare(b.title);
      });

    res.json(events);
  } catch (err) {
    console.error("❌ getEvents error:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
};

/**
 * POST /api/schedules
 * Body: { date, title }
 * - Upserts a personal note for the signed-in user on that day.
 * - Uses the compound unique (user_id, date, type) if present; otherwise falls back cleanly.
 */
// REPLACE your createOrUpdateNote with this version
export const createOrUpdateNote = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

    const {
      date,
      title,
      location,       // optional
      start_time,     // optional "HH:mm"
      end_time,       // optional "HH:mm"
      description,    // optional
    } = req.body;

    if (!date || !title || !title.trim()) {
      return res.status(400).json({ error: "date and non-empty title are required" });
    }

    // Normalize
    const dateOnly = toDateOnlyUTC(date);
    const loc  = typeof location === "string" ? (location.trim() || null) : null;
    const desc = typeof description === "string" ? (description.trim() || null) : null;
    const startStr =
      typeof start_time === "string" && start_time.trim()
        ? `${start_time.padStart(5, "0")}:00`
        : null;
    const endStr =
      typeof end_time === "string" && end_time.trim()
        ? `${end_time.padStart(5, "0")}:00`
        : null;

    // Optional guard: if both present, enforce end >= start lexically (HH:mm)
    if (startStr && endStr && endStr < startStr) {
      return res.status(400).json({ error: "end_time must be after start_time" });
    }

    // Prefer upsert by compound unique; emulate if not available
    let eventId;
    try {
      const saved = await prisma.calendar_events.upsert({
        where: {
          calendar_events_user_id_date_type_unique: {
            user_id: authUserId,
            date: dateOnly,
            type: "personal",
          },
        },
        update: { title: title.trim() },           // only the safe field here
        create: {
          user_id: authUserId,
          date: dateOnly,
          title: title.trim(),
          type: "personal",
        },
        select: { id: true },
      });
      eventId = saved.id;
    } catch {
      // Fallback if older schema/client
      const existing = await prisma.calendar_events.findFirst({
        where: { user_id: authUserId, date: dateOnly, type: "personal" },
        select: { id: true },
      });
      if (existing) {
        const updated = await prisma.calendar_events.update({
          where: { id: existing.id },
          data: { title: title.trim() },
          select: { id: true },
        });
        eventId = updated.id;
      } else {
        const created = await prisma.calendar_events.create({
          data: {
            user_id: authUserId,
            date: dateOnly,
            title: title.trim(),
            type: "personal",
          },
          select: { id: true },
        });
        eventId = created.id;
      }
    }

    // Update the “newer” columns via SQL so it works across Prisma versions
    await prisma.$executeRaw`
      UPDATE "calendar_events"
      SET
        "location"    = ${loc},
        "description" = ${desc},
        "start_time"  = ${startStr}::time,
        "end_time"    = ${endStr}::time
      WHERE "id" = ${eventId};
    `;

    // Return the final row with normalized time strings
    const savedFull = await prisma.calendar_events.findUnique({
      where: { id: eventId },
      include: { users: { select: { id: true, username: true, display_name: true } } },
    });

    return res.json({
      ...savedFull,
      start_time: timeToHHMM(savedFull.start_time),
      end_time: timeToHHMM(savedFull.end_time),
    });
  } catch (err) {
    console.error("❌ createOrUpdateNote error:", err);
    res.status(500).json({ error: "Failed to create or update note" });
  }
};

/**
 * DELETE /api/schedules/:id
 * - Only the owner can delete a personal note.
 */
export const deleteNote = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

    const id = Number(req.params.id ?? req.body?.id);
    if (!id) return res.status(400).json({ error: "id is required" });

    const existing = await prisma.calendar_events.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: "Note not found" });

    if (existing.type !== "personal" || existing.user_id !== authUserId) {
      return res.status(403).json({ error: "Not authorized to delete this note" });
    }

    await prisma.calendar_events.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ deleteNote error:", err);
    res.status(500).json({ error: "Failed to delete note" });
  }
};

/* =========================
   Group Schedules
   ========================= */

/**
 * GET /api/groups/:id/schedule
 * Optional query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Member-only access.
 */
export const getGroupEvents = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

    const groupId = Number(req.params.id);
    if (!Number.isFinite(groupId)) {
      return res.status(400).json({ error: "Invalid group ID" });
    }

    const member = await isGroupMember(authUserId, groupId);
    if (!member) return res.status(403).json({ error: "Not a group member" });

    const { from, to } = req.query;

    const dateFilter =
      from || to
        ? {
            date: {
              ...(from ? { gte: toDateOnlyUTC(from) } : {}),
              ...(to ? { lte: toDateOnlyUTC(to) } : {}),
            },
          }
        : {};

    // Relation filter (NOT scalar group_id) to be compatible across client versions
    const [group, rows] = await Promise.all([
      prisma.groups.findUnique({
        where: { id: groupId },
        select: { id: true, name: true },
      }),
      prisma.calendar_events.findMany({
        where: {
          type: "group",
          groups: { is: { id: groupId } },
          ...dateFilter,
        },
        include: {
          groups: { select: { id: true, name: true } },
          users: { select: { id: true, username: true, display_name: true } },
        },
        orderBy: [{ date: "asc" }, { title: "asc" }],
      }),
    ]);

    if (!group) return res.status(404).json({ error: "Group not found" });

    // Normalize + JS-side sort (date, start_time, title)
    const events = rows
      .map((ev) => ({
        ...ev,
        start_time: timeToHHMM(ev.start_time),
        end_time: timeToHHMM(ev.end_time),
      }))
      .sort((a, b) => {
        const da = new Date(a.date).valueOf();
        const db = new Date(b.date).valueOf();
        if (da !== db) return da - db;
        const sa = a.start_time ?? "";
        const sb = b.start_time ?? "";
        if (sa !== sb) return sa.localeCompare(sb);
        return a.title.localeCompare(b.title);
      });

    res.json({ group, events });
  } catch (err) {
    console.error("❌ getGroupEvents error:", err);
    res.status(500).json({ error: "Failed to fetch group events" });
  }
};

/**
 * POST /api/groups/:id/schedule
 * Body:
 * { date, title, location?, start_time?, end_time?, description? }
 *
 * Two-step upsert to support older Prisma Clients:
 * 1) Minimal Prisma create/update (only safe fields).
 * 2) `$executeRaw` to set location/description/start_time/end_time.
 */
export const upsertGroupEvent = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

    const groupId = Number(req.params.id);
    if (!Number.isFinite(groupId)) {
      return res.status(400).json({ error: "Invalid group ID" });
    }

    const member = await isGroupMember(authUserId, groupId);
    if (!member) return res.status(403).json({ error: "Not a group member" });

    const { date, title, location, start_time, end_time, description } = req.body;
    if (!date || !title?.trim()) {
      return res.status(400).json({ error: "date and non-empty title are required" });
    }

    const dateOnly = toDateOnlyUTC(date);

    // Build normalized values (SQL path expects strings/null)
    const loc = typeof location === "string" ? (location.trim() || null) : null;
    const desc = typeof description === "string" ? (description.trim() || null) : null;
    const startStr =
      typeof start_time === "string" && start_time.trim()
        ? `${start_time.padStart(5, "0")}:00`
        : null;
    const endStr =
      typeof end_time === "string" && end_time.trim()
        ? `${end_time.padStart(5, "0")}:00`
        : null;

    // 1) Minimal upsert via Prisma (only fields old clients always accept)
    const existing = await prisma.calendar_events.findFirst({
      where: { type: "group", date: dateOnly, groups: { is: { id: groupId } } },
      select: { id: true },
    });

    let eventId;
    if (existing) {
      const updated = await prisma.calendar_events.update({
        where: { id: existing.id },
        data: { title: title.trim() }, // only safe field here
        select: { id: true },
      });
      eventId = updated.id;
    } else {
      const created = await prisma.calendar_events.create({
        data: {
          // nested write instead of scalar group_id
          groups: { connect: { id: groupId } },
          date: dateOnly,
          type: "group",
          title: title.trim(),
        },
        select: { id: true },
      });
      eventId = created.id;
    }

    // 2) Set the “newer” columns via SQL (works regardless of Prisma Client version)
    await prisma.$executeRaw`
      UPDATE "calendar_events"
      SET
        "location"    = ${loc},
        "description" = ${desc},
        "start_time"  = ${startStr}::time,
        "end_time"    = ${endStr}::time
      WHERE "id" = ${eventId};
    `;

    // Return the final row with normalized times
    const saved = await prisma.calendar_events.findUnique({
      where: { id: eventId },
      include: { groups: { select: { id: true, name: true } } },
    });

    return res.json({
      ...saved,
      start_time: timeToHHMM(saved.start_time),
      end_time: timeToHHMM(saved.end_time),
    });
  } catch (err) {
    console.error("❌ upsertGroupEvent error:", err);
    res.status(500).json({ error: "Failed to upsert group event" });
  }
};

/**
 * DELETE /api/groups/:id/schedule/:eventId
 * Any member can delete a group event.
 */
export const deleteGroupEvent = async (req, res) => {
  try {
    const authUserId = Number(req.user?.id);
    if (!authUserId) return res.status(401).json({ error: "Unauthorized" });

    const groupId = Number(req.params.id);
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(groupId) || !Number.isFinite(eventId)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const member = await isGroupMember(authUserId, groupId);
    if (!member) return res.status(403).json({ error: "Not a group member" });

    // Validate event belongs to this group via relation filter
    const existing = await prisma.calendar_events.findFirst({
      where: { id: eventId, type: "group", groups: { is: { id: groupId } } },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "Event not found for this group" });
    }

    await prisma.calendar_events.delete({ where: { id: eventId } });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ deleteGroupEvent error:", err);
    res.status(500).json({ error: "Failed to delete group event" });
  }
};
