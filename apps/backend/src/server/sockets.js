// src/server/sockets.js
import { Server } from "socket.io";

/** Single shared instance (created once via initSockets) */
let io = null;

/** Compute a deterministic DM room name (order-independent) */
export function dmRoom(a, b) {
  const x = Number(a);
  const y = Number(b);
  const lo = Math.min(x, y);
  const hi = Math.max(x, y);
  return `dm:${lo}:${hi}`;
}

/* ---------------- CORS helpers ---------------- */
function parseOrigins(envValue) {
  const list = (envValue ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length
    ? list
    : [
        "http://localhost:8080",
        "http://localhost:5173",
        "http://localhost:3000",
        "https://schedura-fe.vercel.app",
      ];
}

const ALLOWED_ORIGINS = parseOrigins(process.env.CORS_ORIGINS);

function isAllowedOrigin(origin) {
  if (!origin) return true; // server-to-server / curl / SSR without Origin
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && u.hostname.endsWith(".vercel.app")) return true;
  } catch {
    /* ignore parse errors */
  }
  return false;
}

/* ---------------- Init ---------------- */
/**
 * Initialize Socket.IO on an existing Node http.Server.
 * Safe to call multiple times — returns the existing instance after first init.
 */
export async function initSockets(httpServer) {
  if (io) return io;

  const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io";

  io = new Server(httpServer, {
    path: SOCKET_PATH,
    cors: {
      origin(origin, cb) {
        if (isAllowedOrigin(origin)) return cb(null, true);
        return cb(new Error(`Not allowed by CORS: ${origin || "(no origin)"}`));
      },
      credentials: true,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    },
    transports: ["websocket", "polling"], // allow fallback polling
    pingInterval: 25000,
    pingTimeout: 20000,
    connectTimeout: 45000,
  });

  // === OPTIONAL: Enable Redis adapter if REDIS_URL is provided and deps exist ===
  if (process.env.REDIS_URL) {
    try {
      // dynamic imports so deploys don’t fail when packages aren’t installed
      const [{ createClient }, { createAdapter }] = await Promise.all([
        import("redis").then((m) => ({ createClient: m.createClient })),
        import("@socket.io/redis-adapter").then((m) => ({ createAdapter: m.createAdapter })),
      ]);

      const pub = createClient({ url: process.env.REDIS_URL });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      io.adapter(createAdapter(pub, sub));
      console.log("[boot] Socket.IO Redis adapter enabled");
    } catch (err) {
      console.warn(
        "[boot] REDIS_URL set but failed to enable Redis adapter:",
        err?.message || err
      );
      console.warn("[boot] Proceeding WITHOUT adapter (realtime limited to single instance / sticky sessions).");
    }
  } else {
    console.warn("[boot] REDIS_URL not set — proceeding without Socket.IO adapter (single instance only).");
  }

  /* ---------- Connection lifecycle & rooms ---------- */
  io.on("connection", (socket) => {
    const ip = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address;
    const origin = socket.handshake.headers.origin || "(no origin)";
    console.log(`[io] conn ${socket.id} origin=${origin} ip=${ip}`);

    socket.on("disconnect", (reason) => {
      console.log(`[io] disc ${socket.id} reason=${reason}`);
    });

    // ---- Group rooms ----
    socket.on("group:join", async ({ groupId }) => {
      if (!groupId) return;
      const room = `group:${groupId}`;
      await socket.join(room);
      const size = (await io.in(room).allSockets()).size;
      console.log(`[join] ${socket.id} -> ${room} size=${size}`);
    });

    socket.on("group:leave", async ({ groupId }) => {
      if (!groupId) return;
      const room = `group:${groupId}`;
      await socket.leave(room);
      const size = (await io.in(room).allSockets()).size;
      console.log(`[leave] ${socket.id} <- ${room} size=${size}`);
    });

    // ---- DM rooms ----
    socket.on("dm:join", async ({ meId, friendId }) => {
      if (!meId || !friendId) {
        console.warn("[dm:join] missing ids", { meId, friendId });
        return;
      }
      const room = dmRoom(meId, friendId);
      await socket.join(room);
      const size = (await io.in(room).allSockets()).size;
      console.log(`[join] ${socket.id} -> ${room} size=${size} me=${meId} friend=${friendId}`);
    });

    socket.on("dm:leave", async ({ meId, friendId }) => {
      if (!meId || !friendId) return;
      const room = dmRoom(meId, friendId);
      await socket.leave(room);
      const size = (await io.in(room).allSockets()).size;
      console.log(`[leave] ${socket.id} <- ${room} size=${size}`);
    });
  });

  console.log(`[boot] Socket.IO initialized at path ${SOCKET_PATH}`);
  return io;
}

/** Retrieve the already-initialized Socket.IO instance */
export function getIO() {
  if (!io) throw new Error("Socket.IO not initialized yet. Call initSockets(server) first.");
  return io;
}
