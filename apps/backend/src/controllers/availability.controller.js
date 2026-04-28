import prisma from "../lib/prisma.js";
import { z } from "zod";

const setSchema = z.object({
  day: z.string().min(1),
  start_time: z.string().min(1), // "09:00"
  end_time: z.string().min(1)    // "18:00"
});

export async function setAvailability(req, res) {
  try {
    const { day, start_time, end_time } = setSchema.parse(req.body);
    const row = await prisma.availability.create({
      data: {
        user_id: req.user.id,
        day,
        start_time: new Date(`1970-01-01T${start_time}:00Z`),
        end_time: new Date(`1970-01-01T${end_time}:00Z`)
      }
    });
    res.status(201).json(row);
  } catch (e) {
    if (e?.issues) return res.status(400).json({ error: e.issues });
    res.status(500).json({ error: "Set availability failed" });
  }
}

export async function listAvailability(req, res) {
  const rows = await prisma.availability.findMany({
    where: { user_id: req.user.id },
    orderBy: { created_at: "desc" }
  });
  res.json(rows);
}
