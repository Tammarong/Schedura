// controllers/auth.controller.js
import prisma from "../lib/prisma.js";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { hashPassword, comparePassword } from "../utils/hash.js";

const WEEK = 1000 * 60 * 60 * 24 * 7;
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || "sid";
const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || undefined; // e.g. ".yourdomain.com"

// helpful: no-store + proper vary for all auth responses
function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  // make sure caches don't collapse by token differences
  res.setHeader("Vary", "Authorization, Cookie");
}

/* ---------------------------------------------
   Helpers
---------------------------------------------- */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function setAuthCookie(res, token, maxAgeMs = WEEK) {
  // Cross-site cookie (Vercel <-> Render): Secure + SameSite=None required.
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,        // must be true for SameSite=None on HTTPS
    sameSite: "none",    // allows cross-site
    path: "/",
    maxAge: maxAgeMs,
    domain: COOKIE_DOMAIN, // keep undefined unless you control a parent domain
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    path: "/",
    sameSite: "none",
    secure: true,
    domain: COOKIE_DOMAIN,
  });
}

// Cookie first, then Bearer, then X-Access-Token
function getTokenFromRequest(req) {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7).trim();

  const xHeader =
    typeof req.headers["x-access-token"] === "string"
      ? req.headers["x-access-token"]
      : null;

  return xHeader || null;
}

/* ---------------- REGISTER ---------------- */
const registerSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  display_name: z.string().min(1),
  password: z.string().min(6),
});

export async function register(req, res) {
  try {
    setNoStore(res);

    const data = registerSchema.parse(req.body);

    const exists = await prisma.users.findFirst({
      where: { OR: [{ email: data.email }, { username: data.username }] },
      select: { id: true },
    });
    if (exists) {
      return res.status(409).json({ error: "Email or username already exists" });
    }

    const password_hash = await hashPassword(data.password);

    const u = await prisma.users.create({
      data: {
        username: data.username,
        email: data.email,
        display_name: data.display_name,
        password_hash,
      },
    });

    // Issue JWT and (optionally) set cookie for browser sessions.
    const token = signToken({
      id: u.id,
      email: u.email,
      username: u.username,
      display_name: u.display_name,
    });
    setAuthCookie(res, token);

    // Always return token too (frontend uses Bearer)
    return res.status(201).json({
      message: "Register success",
      token,
      expiresInMs: WEEK,
      user: {
        id: u.id,
        username: u.username,
        email: u.email,
        display_name: u.display_name,
      },
    });
  } catch (e) {
    console.error("Register error:", e);
    setNoStore(res);
    if (e?.issues) return res.status(400).json({ error: e.issues });
    return res.status(500).json({ error: "Register failed" });
  }
}

/* ---------------- LOGIN ---------------- */
const loginSchema = z.object({
  identifier: z.string().min(1), // email or username
  password: z.string().min(1),
});

export async function login(req, res) {
  try {
    setNoStore(res);

    const { identifier, password } = loginSchema.parse(req.body);

    const u = await prisma.users.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });
    if (!u) return res.status(404).json({ error: "User not found" });

    const ok = await comparePassword(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = signToken({
      id: u.id,
      email: u.email,
      username: u.username,
      display_name: u.display_name,
    });

    // Set HttpOnly cookie for browser sessions (optional)
    setAuthCookie(res, token);

    // And return token for FE Bearer flow
    return res.json({
      message: "Login success",
      token,
      expiresInMs: WEEK,
      user: {
        id: u.id,
        email: u.email,
        username: u.username,
        display_name: u.display_name,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    setNoStore(res);
    if (e?.issues) return res.status(400).json({ error: e.issues });
    return res.status(500).json({ error: "Login failed" });
  }
}

/* ---------------- LOGOUT ---------------- */
export async function logout(_req, res) {
  try {
    setNoStore(res);
    clearAuthCookie(res);
    return res.json({ message: "Logout success" });
  } catch (err) {
    console.error("Logout error:", err);
    setNoStore(res);
    return res.status(500).json({ error: "Logout failed" });
  }
}

/* ---------------- CHECK AUTH / ME ---------------- */
export async function me(req, res) {
  try {
    setNoStore(res);

    const raw = getTokenFromRequest(req);
    if (!raw) {
      return res
        .status(401)
        .json({ error: "Not authenticated", code: "NO_TOKEN" });
    }

    const decoded = jwt.verify(raw, JWT_SECRET);

    const user = await prisma.users.findUnique({
      where: { id: decoded.id },
      select: { id: true, username: true, email: true, display_name: true },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    return res.json({ user });
  } catch (err) {
    setNoStore(res);
    if (err?.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Session expired", code: "TOKEN_EXPIRED" });
    }
    if (err?.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json({ error: "Invalid token", code: "TOKEN_INVALID" });
    }
    console.error("Auth check error:", err);
    return res.status(401).json({ error: "Not authenticated", code: "TOKEN_ERROR" });
  }
}
