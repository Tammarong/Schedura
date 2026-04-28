// src/server/bootstrap.js
import http from "http";
import app from "../app.js";              // your Express app (do not create another server in app.js)
import { initSockets } from "./sockets.js";

const PORT = process.env.PORT || 4000;

async function start() {
  const server = http.createServer(app);

  // Initialize Socket.IO on THIS server instance (once)
  await initSockets(server);

  server.listen(PORT, () => {
    console.log(`[boot] HTTP+WS listening on ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Server bootstrap failed:", err);
  process.exit(1);
});

