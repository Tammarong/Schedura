// src/index.js
import { server } from "./app.js";

const PORT = Number(process.env.PORT || 4000);

// Optional: show allowed origins once
if (process.env.CORS_ORIGINS) {
  console.log("[boot] CORS_ORIGINS =", process.env.CORS_ORIGINS);
}

// Improve connection stability on platforms like Render
server.keepAliveTimeout = 75_000; // 75s
server.headersTimeout = 76_000;

server.listen(PORT, () => {
  console.log(`[boot] HTTP listening on :${PORT}`);
  // ⛔️ Do NOT log or init Socket.IO here—it's owned by app.js
});

server.on("error", (err) => {
  console.error("❌ Server error:", err);
  process.exitCode = 1;
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[shutdown] ${signal} received. Closing server...`);
  server.close(() => {
    console.log("[shutdown] HTTP server closed.");
    process.exit(0);
  });

  // Force-exit if something hangs
  setTimeout(() => {
    console.warn("[shutdown] Force exit after timeout.");
    process.exit(0);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
