// src/app.js
import http from "http";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

// ✅ shared Socket.IO initializer (accepts options; extra args are ignored if not used)
import { initSockets } from "./server/sockets.js";

/* ---------------- helpers ---------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse CORS_ORIGINS as a comma-separated whitelist
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

// allow explicit list + any https://*.vercel.app (preview URLs)
function isAllowedOrigin(origin) {
  if (!origin) return true; // server-to-server / SSR w/o Origin
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "https:" && u.hostname.endsWith(".vercel.app")) return true;
  } catch {}
  return false;
}

/* ========= DEBUG/SAFETY GUARDS TO FIND BAD ROUTE PATHS ========= */
if (!globalThis.__ROUTE_GUARDS_INSTALLED__) {
  globalThis.__ROUTE_GUARDS_INSTALLED__ = true;

  function stackNote() {
    const e = new Error();
    return (e.stack || "").split("\n").slice(3).join("\n");
  }

  function validateOne(label, p) {
    // allow handler-only calls: app.use(fn) / router.use(fn)
    if (typeof p === "function" || p == null) return;

    // allow RegExp paths
    if (p instanceof RegExp) return;

    // allow arrays (each item must be valid)
    if (Array.isArray(p)) {
      p.forEach((item) => validateOne(label, item));
      return;
    }

    // only strings past this point
    if (typeof p !== "string") {
      throw new Error(
        `[ROUTE PATH ERROR] ${label} expects string/RegExp/array/function. Got: ${typeof p}\n\nStack:\n${stackNote()}`
      );
    }

    if (/^https?:\/\//i.test(p)) {
      throw new Error(
        `[ROUTE PATH ERROR] ${label} received a FULL URL instead of a path: "${p}". Use "/api/xyz".\n\nStack:\n${stackNote()}`
      );
    }
    if (!p.startsWith("/")) {
      throw new Error(
        `[ROUTE PATH ERROR] ${label} must start with "/". Received: "${p}"\n\nStack:\n${stackNote()}`
      );
    }
  }

  function guardMethod(orig, label, methodName) {
    return function guarded(...args) {
      // allow settings getter: app.get('env')
      if (this && methodName === "get" && args.length === 1 && typeof args[0] === "string") {
        return orig.apply(this, args);
      }
      // allow middleware-only mount: app.use(fn)
      if (methodName === "use" && (args.length === 0 || typeof args[0] !== "string")) {
        return orig.apply(this, args);
      }
      validateOne(label, args[0]);
      return orig.apply(this, args);
    };
  }

  // Guard router.*
  {
    const RealRouter = express.Router;
    const METHODS = ["use", "get", "post", "put", "patch", "delete", "all", "options", "head"];
    METHODS.forEach((m) => {
      const orig = RealRouter.prototype[m];
      RealRouter.prototype[m] = guardMethod(orig, `router.${m}()`, m);
    });
  }

  // Guard app.*
  {
    const proto = express.application;
    const METHODS = ["use", "get", "post", "put", "patch", "delete", "all", "options", "head"];
    METHODS.forEach((m) => {
      const orig = proto[m];
      proto[m] = guardMethod(orig, `app.${m}()`, m);
    });
  }

  // expose helper for guarded mount
  globalThis.__safeUse = function safeUse(app, label, mountPath, ...handlers) {
    if (typeof mountPath === "string" || mountPath instanceof RegExp || Array.isArray(mountPath)) {
      validateOne(label, mountPath);
      try {
        app.use(mountPath, ...handlers);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        e.message = `[MOUNT FAIL] ${label} @ "${mountPath}": ${e.message}`;
        throw e;
      }
    } else {
      app.use(mountPath, ...handlers);
    }
  };
}
const safeUse = globalThis.__safeUse;

/* =========================================================
   EXPRESS APP
   ========================================================= */
const app = express();

// Trust proxy so req.secure is true behind Render (secure cookies, etc.)
app.set("trust proxy", 1);

/* ---------------- CORS (whitelist + vercel wildcard) ---------------- */
const corsOptions = {
  origin(origin, cb) {
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`Not allowed by CORS: ${origin || "(no origin)"}`));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  // ✅ allow FE fallback header
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Access-Token"],
  // (optional) if you ever send refreshed tokens back
  exposedHeaders: ["Authorization"],
};

app.use(cors(corsOptions));
// Explicit preflight (use RegExp, not "*")
app.options(/.*/, cors(corsOptions));

// Helpful headers on all responses
app.use((_, res, next) => {
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Vary", "Origin");
  next();
});

/* ---------------- MIDDLEWARE ---------------- */
app.use(morgan("dev"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser()); // MUST be before routes for cookie-based auth

/* ---------------- DEBUG PROBES (keep above routes) ---------------- */
app.get("/api/_debug/auth", (req, res) => {
  res.json({
    origin: req.headers.origin || null,
    cookies: req.cookies || null,
    hasSid: Boolean(req.cookies?.sid),
    authHeader: req.headers.authorization || null,
    xAccessToken:
      typeof req.headers["x-access-token"] === "string"
        ? req.headers["x-access-token"]
        : null,
  });
});

/* ---------------- STATIC UPLOADS ---------------- */
// (kept for legacy uploads; DB-backed images are served under /pictures/:id)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ---------------- HEALTH CHECK ---------------- */
app.get("/api/health", (_req, res) => res.json({ ok: true }));

/* ---------------- API CACHE GUARD (prevents guest caching) -------- */
// ✅ add no-store and vary on auth for all API routes
app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  const existing = res.getHeader("Vary");
  const extra = "Authorization, Cookie";
  res.setHeader("Vary", existing ? `${existing}, ${extra}` : extra);
  next();
});

/* ---------------- ROUTES (load AFTER installing guards) ---------------- */
const [
  { default: authRoutes },
  { default: usersRoutes },
  { default: friendsRoutes },
  { default: groupsRoutes },
  { default: postsRoutes },
  // ⬇️ import the whole messages module so we can pull named exports
  messagesModule,
  { default: eventsRoutes },
  { default: availabilityRoutes },
  schedulesModule, // ⬅️ grab module for default + named export
  { default: avatarRoutes },
  { default: notesRoutes },
  { default: studyRoutes },
  { default: streaksRoutes },
  { default: titlesRoutes },        // 👈 NEW
  { default: profileBgRoutes },     // 👈 /api/profilebg
  profileBgCtrl,                    // 👈 controller for public raw endpoint (module namespace)
  { default: followersRoutes },     // 👈 followers graph
  // ===== Stories & Highlights =====
  { default: storyRoutes },         // router defines *relative* paths, base is /api/stories
  { default: highlightRoutes },     // router defines *relative* paths, base is /api/highlights
  storyCtrl,                        // 👈 keep module namespace (works for named or default)
] = await Promise.all([
  import("./routes/auth.js"),
  import("./routes/users.js"),
  import("./routes/friends.js"),
  import("./routes/groups.js"),
  import("./routes/posts.js"),
  import("./routes/messages.js"),
  import("./routes/events.js"),
  import("./routes/availability.js"),
  import("./routes/schedules.js"),
  import("./routes/avatar.js"),
  import("./routes/notes.js"),
  import("./routes/study.js"),
  import("./routes/streaks.js"),
  import("./routes/titles.js"),
  import("./routes/profilebg.js"),
  import("./controllers/profilebg.controller.js"),
  import("./routes/followers.js"),

  // Stories & Highlights (routers + controller)
  import("./routes/story.js"),
  import("./routes/highlight.js"),
  import("./controllers/story.controller.js"),
]);

const { default: schedulesRoutes, groupScheduleRouter } = schedulesModule;
// ⬇️ pull out the default messages router + the public pictures router
const { default: messagesRoutes, picturesRouter } = messagesModule;

// 🔧 Normalize stories controller to support both ESM named exports and CJS default export
const storyHandlers = storyCtrl?.default ?? storyCtrl;

// Use per-route auth inside the routers (cookie/Bearer aware controllers)
safeUse(app, "authRoutes", "/api/auth", authRoutes);
safeUse(app, "usersRoutes", "/api/users", usersRoutes);
safeUse(app, "friendsRoutes", "/api/friends", friendsRoutes);
safeUse(app, "groupsRoutes", "/api/groups", groupsRoutes);
safeUse(app, "postsRoutes", "/api/posts", postsRoutes);
safeUse(app, "messagesRoutes", "/api/messages", messagesRoutes);
safeUse(app, "eventsRoutes", "/api/events", eventsRoutes);
safeUse(app, "availabilityRoutes", "/api/availability", availabilityRoutes);
safeUse(app, "schedulesRoutes", "/api/schedules", schedulesRoutes);
safeUse(app, "avatarRoutes", "/api/avatar", avatarRoutes);
safeUse(app, "studyRoutes", "/api/study", studyRoutes);
safeUse(app, "notesRoutes", "/api/notes", notesRoutes);
safeUse(app, "streaksRoutes", "/api/streaks", streaksRoutes);
safeUse(app, "titlesRoutes", "/api", titlesRoutes);
safeUse(app, "followersRoutes", "/api/followers", followersRoutes);

// ✅ Profile Background API (metadata & mutations)
safeUse(app, "profileBgRoutes", "/api/profilebg", profileBgRoutes);

// ✅ Group schedule endpoints at /api/groups/:id/schedule
safeUse(app, "groupScheduleRoutes", "/api/groups", groupScheduleRouter);

// ===== Stories & Highlights =====
// These routers define *relative* paths (e.g., "/", "/feed"), so mount them at their API bases.
safeUse(app, "storyRoutes", "/api/stories", storyRoutes);
safeUse(app, "highlightRoutes", "/api/highlights", highlightRoutes);

// (Optional) catch accidental double /api prefix for old clients
app.get("/api/api/stories/:id/media", (req, res) =>
  res.redirect(301, `/api/stories/${encodeURIComponent(req.params.id)}/media`)
);

// ✅ Public, cacheable stories media route (bypasses /api no-store guard)
//    Mirrors /api/stories/:id/media but without the API cache headers.
{
  const publicStoriesRouter = express.Router();
  publicStoriesRouter.get("/stories/:id/media", storyHandlers.streamMedia);
  safeUse(app, "storiesPublicMedia", "/", publicStoriesRouter);
}

// ✅ Public, cacheable profile background bytes
{
  const publicProfileBgRouter = express.Router();
  // keep this OUTSIDE /api so Cache-Control from controller is respected
  publicProfileBgRouter.get("/profilebg/:username/raw", profileBgCtrl.getUserRaw);
  safeUse(app, "profileBgPublicRaw", "/", publicProfileBgRouter);
}

// ✅ Public image endpoints (no /api prefix): GET /pictures/:id
// (the router itself should define the /pictures/* paths)
if (picturesRouter) {
  safeUse(app, "picturesRouter", "/", picturesRouter);
}

/* ---------------- ERROR HANDLER ---------------- */
app.use((err, _req, res, _next) => {
  console.error("❌", err.stack || err);
  res.status(500).json({ error: "Internal Server Error" });
});

/* =========================================================
   HTTP SERVER + (shared) SOCKET.IO
   ========================================================= */
const server = http.createServer(app);

// ✅ Socket.IO path defaults to "/api/socket.io" to match your API prefix.
// Override via env if needed.
const SOCKET_PATH = (process.env.SOCKET_PATH || "/api/socket.io").replace(/\/+$/, "");

// Slightly higher timeouts help long-lived WS on some hosts
server.keepAliveTimeout = 75_000;
server.headersTimeout = 76_000;

// ✅ One Socket.IO instance, created via initializer (async)
const io = await initSockets(server, {
  path: SOCKET_PATH,
  cors: {
    origin: (origin, cb) =>
      isAllowedOrigin(origin)
        ? cb(null, true)
        : cb(new Error(`Not allowed by CORS: ${origin || "(no origin)"}`)),
    credentials: true,
    methods: ["GET", "POST"],
    // ✅ mirror extra header here too
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Access-Token"],
  },
  transports: ["websocket", "polling"],
});

// (optional) keep backwards-compat for any code that reads app.locals.io
app.locals.io = io;

console.log(`[boot] Socket.IO initialized at path ${SOCKET_PATH}`);

export { app, server };
export default app;
