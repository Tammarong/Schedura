// routes/auth.js
import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

const router = Router();

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || "supersecret", {
    expiresIn: "7d",
  });
}

// Helper: read token from Authorization/X-Access-Token headers (no cookies)
function getTokenFromHeaders(req) {
  const auth = req.headers.authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const xheader =
    typeof req.headers["x-access-token"] === "string"
      ? req.headers["x-access-token"]
      : null;
  return bearer || xheader || null;
}

/* ---------------- REGISTER ---------------- */
router.post("/register", async (req, res) => {
  try {
    const { username, email, display_name, password } = req.body;
    if (!username || !email || !display_name || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await prisma.users.findFirst({
      where: { OR: [{ username }, { email }] },
    });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Username or Email already exists" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await prisma.users.create({
      data: { username, email, display_name, password_hash },
    });

    const token = signToken({ id: user.id, email: user.email, username: user.username });

    // ⬇️ NO COOKIES — return the token in JSON
    res.status(201).json({
      message: "User registered successfully",
      token,
      expiresInMs: WEEK_MS,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- LOGIN ---------------- */
router.post("/login", async (req, res) => {
  try {
    const { identifier, password } = req.body; // email or username
    if (!identifier || !password) {
      return res
        .status(400)
        .json({ message: "Email/Username and password are required" });
    }

    const user = await prisma.users.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!user) return res.status(400).json({ message: "User not found" });

    const ok = await bcrypt.compare(password, user.password_hash || "");
    if (!ok) return res.status(400).json({ message: "Invalid password" });

    const token = signToken({ id: user.id, email: user.email, username: user.username });

    // ⬇️ NO COOKIES — return the token in JSON
    res.json({
      message: "Login successful",
      token,
      expiresInMs: WEEK_MS,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ---------------- LOGOUT ----------------
   Stateless JWT — client just drops its token.
----------------------------------------- */
router.post("/logout", (_req, res) => {
  return res.json({ message: "Logged out" });
});

/* ---------------- CHECK AUTH ----------------
   Reads token from Authorization/X-Access-Token (no cookies)
---------------------------------------------- */
router.get("/me", async (req, res) => {
  try {
    const raw = getTokenFromHeaders(req);
    if (!raw) return res.status(401).json({ message: "Not authenticated", code: "NO_TOKEN" });

    const decoded = jwt.verify(raw, process.env.JWT_SECRET || "supersecret");

    // Option A: return decoded only
    // return res.json({ user: decoded });

    // Option B (recommended): fetch fresh user data
    const user = await prisma.users.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, email: true, display_name: true },
    });
    if (!user) return res.status(404).json({ message: "User not found" });

    return res.json({ user });
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired", code: "TOKEN_EXPIRED" });
    }
    if (err?.name === "JsonWebTokenError") {
      return res.status(401).json({ message: "Invalid token", code: "TOKEN_INVALID" });
    }
    return res.status(401).json({ message: "Not authenticated", code: "TOKEN_ERROR" });
  }
});

export default router;
