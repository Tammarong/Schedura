// controllers/study.controller.js
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/* Helpers */
function now() {
  return new Date();
}
function parseIntOrNull(v) {
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/* ---------------------- Desk ---------------------- */

// GET /api/study/desk  – get (or create) the current user's desk
export const getOrCreateDesk = async (req, res) => {
  try {
    const userId = req.user.id;

    let desk = await prisma.study_desks.findUnique({
      where: { user_id: userId },
    });

    if (!desk) {
      desk = await prisma.study_desks.create({
        data: {
          user_id: userId,
          title: 'My Workbench',
          theme: 'minimal',
          layout: {},
          prefs: {},
        },
      });
    }

    return res.json(desk);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('getOrCreateDesk error:', err);
    return res.status(500).json({ error: 'Failed to load desk' });
  }
};

// PATCH /api/study/desk – update basic properties/layout
export const updateDesk = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, theme, layout, prefs } = req.body;

    const updated = await prisma.study_desks.update({
      where: { user_id: userId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(theme !== undefined ? { theme } : {}),
        ...(layout !== undefined ? { layout } : {}),
        ...(prefs !== undefined ? { prefs } : {}),
      },
    });

    return res.json(updated);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('updateDesk error:', err);
    return res.status(500).json({ error: 'Failed to update desk' });
  }
};

/* ---------------------- Tasks ---------------------- */

// GET /api/study/tasks
export const listTasks = async (req, res) => {
  try {
    const userId = req.user.id;

    const tasks = await prisma.study_tasks.findMany({
      where: { user_id: userId },
      orderBy: [{ done: 'asc' }, { created_at: 'desc' }],
    });

    return res.json(tasks);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('listTasks error:', err);
    return res.status(500).json({ error: 'Failed to load tasks' });
  }
};

// POST /api/study/tasks
export const createTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, priority = 'medium', due_at } = req.body;

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }

    const desk = await prisma.study_desks.findUnique({ where: { user_id: userId } });
    const task = await prisma.study_tasks.create({
      data: {
        user_id: userId,
        desk_id: desk?.id ?? null,
        title: title.trim(),
        priority,
        due_at: due_at ? new Date(due_at) : null,
      },
    });

    return res.status(201).json(task);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('createTask error:', err);
    return res.status(500).json({ error: 'Failed to create task' });
  }
};

// PATCH /api/study/tasks/:id
export const updateTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseIntOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const { title, done, priority, due_at } = req.body;

    // ensure ownership
    const existing = await prisma.study_tasks.findUnique({ where: { id } });
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updated = await prisma.study_tasks.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: String(title) } : {}),
        ...(done !== undefined ? { done: Boolean(done) } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(due_at !== undefined ? { due_at: due_at ? new Date(due_at) : null } : {}),
      },
    });

    return res.json(updated);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('updateTask error:', err);
    return res.status(500).json({ error: 'Failed to update task' });
  }
};

// DELETE /api/study/tasks/:id
export const deleteTask = async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseIntOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const existing = await prisma.study_tasks.findUnique({ where: { id } });
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await prisma.study_tasks.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('deleteTask error:', err);
    return res.status(500).json({ error: 'Failed to delete task' });
  }
};

/* ---------------------- Resources ---------------------- */

// GET /api/study/resources
export const listResources = async (req, res) => {
  try {
    const userId = req.user.id;
    const resources = await prisma.study_resources.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    return res.json(resources);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('listResources error:', err);
    return res.status(500).json({ error: 'Failed to load resources' });
  }
};

// POST /api/study/resources
export const createResource = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, url, note } = req.body;
    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title is required' });
    }
    const desk = await prisma.study_desks.findUnique({ where: { user_id: userId } });
    const created = await prisma.study_resources.create({
      data: {
        user_id: userId,
        desk_id: desk?.id ?? null,
        title: title.trim(),
        url: url || null,
        note: note || null,
      },
    });
    return res.status(201).json(created);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('createResource error:', err);
    return res.status(500).json({ error: 'Failed to create resource' });
  }
};

// PATCH /api/study/resources/:id
export const updateResource = async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseIntOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const existing = await prisma.study_resources.findUnique({ where: { id } });
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    const { title, url, note } = req.body;
    const updated = await prisma.study_resources.update({
      where: { id },
      data: {
        ...(title !== undefined ? { title: String(title) } : {}),
        ...(url !== undefined ? { url: url || null } : {}),
        ...(note !== undefined ? { note: note || null } : {}),
      },
    });

    return res.json(updated);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('updateResource error:', err);
    return res.status(500).json({ error: 'Failed to update resource' });
  }
};

// DELETE /api/study/resources/:id
export const deleteResource = async (req, res) => {
  try {
    const userId = req.user.id;
    const id = parseIntOrNull(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid id' });

    const existing = await prisma.study_resources.findUnique({ where: { id } });
    if (!existing || existing.user_id !== userId) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    await prisma.study_resources.delete({ where: { id } });
    return res.json({ success: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('deleteResource error:', err);
    return res.status(500).json({ error: 'Failed to delete resource' });
  }
};

/* ---------------------- Sessions (timer/pomodoro) ---------------------- */

// GET /api/study/sessions?range=7d|30d|all
export const listSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const range = String(req.query.range || '7d');

    let timeMin = null;
    if (range !== 'all') {
      const nowDt = now();
      const ms =
        range === '30d' ? 1000 * 60 * 60 * 24 * 30 :
        range === '7d'  ? 1000 * 60 * 60 * 24 * 7 :
        1000 * 60 * 60 * 24 * 7;
      timeMin = new Date(nowDt.getTime() - ms);
    }

    const sessions = await prisma.study_sessions.findMany({
      where: {
        user_id: userId,
        ...(timeMin ? { started_at: { gte: timeMin } } : {}),
      },
      orderBy: { started_at: 'desc' },
    });

    return res.json(sessions);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('listSessions error:', err);
    return res.status(500).json({ error: 'Failed to load sessions' });
  }
};

// POST /api/study/sessions/start  { mode?: 'focus'|'break'|'longBreak' }
export const startSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const mode = ['focus', 'break', 'longBreak'].includes(req.body?.mode)
      ? req.body.mode
      : 'focus';

    const desk = await prisma.study_desks.findUnique({ where: { user_id: userId } });

    // Optionally auto-end any dangling session
    await prisma.study_sessions.updateMany({
      where: { user_id: userId, ended_at: null },
      data: { ended_at: now() },
    });

    const created = await prisma.study_sessions.create({
      data: {
        user_id: userId,
        desk_id: desk?.id ?? null,
        mode,
        started_at: now(),
      },
    });

    return res.status(201).json(created);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('startSession error:', err);
    return res.status(500).json({ error: 'Failed to start session' });
  }
};

// POST /api/study/sessions/stop
export const stopSession = async (req, res) => {
  try {
    const userId = req.user.id;

    const open = await prisma.study_sessions.findFirst({
      where: { user_id: userId, ended_at: null },
      orderBy: { started_at: 'desc' },
    });

    if (!open) {
      return res.status(404).json({ error: 'No active session' });
    }

    const endedAt = now();
    const dur = Math.max(0, Math.floor((endedAt.getTime() - open.started_at.getTime()) / 1000));

    const updated = await prisma.study_sessions.update({
      where: { id: open.id },
      data: { ended_at: endedAt, duration_seconds: dur },
    });

    return res.json(updated);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('stopSession error:', err);
    return res.status(500).json({ error: 'Failed to stop session' });
  }
};

/* ---------------------- Whiteboard (state in study_desks.layout) ---------------------- */

// GET /api/study/whiteboard
export const getWhiteboard = async (req, res) => {
  try {
    const userId = req.user.id;

    // get or create a desk for this user
    let desk = await prisma.study_desks.findUnique({ where: { user_id: userId } });
    if (!desk) {
      desk = await prisma.study_desks.create({
        data: {
          user_id: userId,
          title: 'My Study Desk',
          theme: 'minimal',
          layout: {},
          prefs: {},
        },
      });
    }

    const layout = (desk.layout ?? {});
    const state = layout.whiteboard ?? null;

    return res.json({ state });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('getWhiteboard error:', err);
    return res.status(500).json({ error: 'Failed to load whiteboard' });
  }
};

// PATCH /api/study/whiteboard  { state: WBState }
export const patchWhiteboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const { state } = req.body;

    // basic shape check (optional; avoids storing nonsense)
    const isObj = state && typeof state === 'object' && !Array.isArray(state);
    if (!isObj) {
      return res.status(400).json({ error: 'state must be an object' });
    }

    // ensure desk exists
    let desk = await prisma.study_desks.findUnique({ where: { user_id: userId } });
    if (!desk) {
      desk = await prisma.study_desks.create({
        data: {
          user_id: userId,
          title: 'My Study Desk',
          theme: 'minimal',
          layout: {},
          prefs: {},
        },
      });
    }

    const currentLayout = (desk.layout ?? {});
    const updated = await prisma.study_desks.update({
      where: { user_id: userId },
      data: {
        layout: {
          ...currentLayout,
          whiteboard: state,
        },
      },
    });

    return res.json({ ok: true, savedAt: updated.updated_at });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('patchWhiteboard error:', err);
    return res.status(500).json({ error: 'Failed to save whiteboard' });
  }
};

