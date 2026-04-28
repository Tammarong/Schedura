import prisma from "../lib/prisma.js";
import { z } from "zod";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  group_id: z.number().int().optional(),
  date: z.coerce.date()
});

export async function createEvent(req, res) {
  try {
    const { title, description, group_id, date } = createSchema.parse(req.body);
    const ev = await prisma.event.create({
      data: {
        title,
        description: description ?? null,
        group_id: group_id ?? null,
        created_by: req.user.id,
        date
      }
    });
    res.status(201).json(ev);
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    res.status(500).json({ error: "Create event failed" });
  }
}

export async function listEvents(req, res) {
  const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
  const events = await prisma.event.findMany({
    where: groupId ? { group_id: groupId } : undefined,
    include: { creator: { select: { username: true } } },
    orderBy: { date: "desc" }
  });
  res.json(events.map((e) => ({ ...e, creator_username: e.creator.username })));
}
