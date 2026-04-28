// server.js — ตั้งค่าแอป Express, view engine, static, session, routes
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import cookieSession from "cookie-session";
import pool from "./db.js";
import expressLayouts from "express-ejs-layouts";

// โหลดตัวแปรแวดล้อมจาก .env (เวลา deploy บน Render จะใช้ Environment Variables)
dotenv.config();

// routes
import indexRoutes from "./src/routes/index.routes.js";
import authRoutes from "./src/routes/auth.routes.js";
import groupRoutes from "./src/routes/group.routes.js";
import postRoutes from "./src/routes/post.routes.js";
import friendsRoutes from "./src/routes/friends.routes.js";


const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ตั้งค่า EJS เป็น template engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");   // ใช้ views/layout.ejs เป็น default

// ให้บริการไฟล์ static (CSS/JS)
app.use(express.static(path.join(__dirname, "public")));

// รองรับ JSON และ form-urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ตั้งค่า session แบบเก็บบน cookie (ง่ายและพอสำหรับโปรเจกต์เริ่มต้น)
app.use(
  cookieSession({
    name: "schedura_session",
    // ควรตั้งค่า SECRET จริงจังจาก ENV (ตอน dev ใช้ค่าเริ่มต้นได้)
    keys: [process.env.SESSION_SECRET || "dev-secret"],
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 วัน
  })
);

// ใส่ตัวแปรที่ต้องใช้บ่อย ๆ ไปยัง res.locals (เช่น เอาไปใช้ใน EJS)
app.use((req, res, next) => {
  res.locals.appName = "Schedura";
  res.locals.user = req.session.user || null;
  res.locals.theme = req.session.theme || "light";

  // ✅ flash message
  res.locals.message = req.session.message || null;
  delete req.session.message;

  next();
});

// ผูก routes
app.use("/", indexRoutes);
app.use("/", authRoutes);
app.use("/groups", groupRoutes);
app.use("/posts", postRoutes);
app.use("/friends", friendsRoutes);

// route สำหรับเทส DB
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT COUNT(*) FROM users");
    res.send(`✅ Users table has ${result.rows[0].count} rows`);
  } catch (err) {
    console.error("❌ DB Error:", err.message);
    res.status(500).send("Database connection error");
  }
});

// start server
app.listen(PORT, () => {
  console.log(`✅ Schedura running at http://localhost:${PORT}`);
});

app.use((req, res, next) => {
  res.locals.appName = "Schedura";
  res.locals.user = req.session?.user || null;
  res.locals.theme = req.session?.theme || "light";
  res.locals.message = req.session?.message || null;
  if (req.session) delete req.session.message; // ลบ flash ถ้ามี
  next();
});
