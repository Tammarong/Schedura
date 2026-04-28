// routes/study.js
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getOrCreateDesk,
  updateDesk,

  listTasks,
  createTask,
  updateTask,
  deleteTask,

  listResources,
  createResource,
  updateResource,
  deleteResource,

  listSessions,
  startSession,
  stopSession,

  // ✅ whiteboard handlers
  getWhiteboard,
  patchWhiteboard,
} from '../controllers/study.controller.js';

const router = Router();

router.use(authenticate);

/* Desk */
router.get('/desk', getOrCreateDesk);
router.patch('/desk', updateDesk);

/* Whiteboard
   NOTE: router is typically mounted at /api/study,
   so the full paths become /api/study/whiteboard */
router.get('/whiteboard', getWhiteboard);
router.patch('/whiteboard', patchWhiteboard);

/* Tasks */
router.get('/tasks', listTasks);
router.post('/tasks', createTask);
router.patch('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);

/* Resources */
router.get('/resources', listResources);
router.post('/resources', createResource);
router.patch('/resources/:id', updateResource);
router.delete('/resources/:id', deleteResource);

/* Sessions */
router.get('/sessions', listSessions);
router.post('/sessions/start', startSession);
router.post('/sessions/stop', stopSession);

export default router;
