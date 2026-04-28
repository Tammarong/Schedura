// middleware/auth.js
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";

/**
 * Token sources (priority):
 *   1) Cookie: sid (AUTH_COOKIE_NAME) or legacy "token"
 *   2) Header: Authorization: Bearer <token>  (also tolerates JWT <token> or raw)
 *   3) Header: X-Access-Token: <token>
 *   4) Query:  ?token=<token>   (useful for deep links / previews)
 */

export const COOKIE_NAME   = process.env.AUTH_COOKIE_NAME || "sid";
export const JWT_SECRET    = process.env.JWT_SECRET || "supersecret";
export const COOKIE_DOMAIN = process.env.AUTH_COOKIE_DOMAIN || undefined;

const COOKIE_SECURE   = process.env.AUTH_COOKIE_SECURE
  ? String(process.env.AUTH_COOKIE_SECURE).toLowerCase() === "true"
  : true;
const COOKIE_SAMESITE = process.env.AUTH_COOKIE_SAMESITE || "none";
const COOKIE_PATH     = process.env.AUTH_COOKIE_PATH || "/";

/* ---------------- utils ---------------- */

// Defensive cookie read (works with/without cookie-parser)
function getCookie(req, name) {
  if (req.cookies && Object.prototype.hasOwnProperty.call(req.cookies, name)) {
    return req.cookies[name];
  }
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  const map = Object.fromEntries(
    raw.split(";").map((s) => {
      const i = s.indexOf("=");
      if (i < 0) return [s.trim(), ""];
      const k = s.slice(0, i).trim();
      const v = decodeURIComponent(s.slice(i + 1).trim());
      return [k, v];
    })
  );
  return map[name];
}

// Strip legacy prefixes and accidental quotes
function sanitizeToken(raw) {
  if (!raw) return null;
  let t = String(raw).trim();

  // Allow "Bearer ..." or "JWT ..." or raw
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
  else if (t.toLowerCase().startsWith("jwt ")) t = t.slice(4).trim();

  // Some clients persist a quoted token:  "eyJ..." or 'eyJ...'
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }

  return t || null;
}

export function extractToken(req) {
  // 1) Cookie
  const cookieToken =
    getCookie(req, COOKIE_NAME) ||
    getCookie(req, "token"); // legacy name
  if (cookieToken) {
    const cleaned = sanitizeToken(cookieToken);
    if (cleaned) return cleaned;
  }

  // 2) Authorization
  const auth = req.headers.authorization || "";
  if (auth) {
    const cleaned = sanitizeToken(auth);
    if (cleaned) return cleaned;
  }

  // 3) X-Access-Token
  const x = req.headers["x-access-token"];
  if (typeof x === "string" && x) {
    const cleaned = sanitizeToken(x);
    if (cleaned) return cleaned;
  }

  // 4) Query ?token=...
  if (req.query && typeof req.query.token === "string") {
    const cleaned = sanitizeToken(req.query.token);
    if (cleaned) return cleaned;
  }

  return null;
}

function normalizeUser(payload) {
  return {
    id: payload.id,
    username: payload.username,
    email: payload.email,
    display_name: payload.display_name ?? payload.displayName ?? payload.username,
    avatar_url: payload.avatar_url ?? payload.avatarUrl ?? null,
    role: payload.role ?? "user",
  };
}

export function setAuthCookie(res, token, maxAgeMs) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: COOKIE_PATH,
    domain: COOKIE_DOMAIN,
    ...(maxAgeMs ? { maxAge: Number(maxAgeMs) } : {}),
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SAMESITE,
    path: COOKIE_PATH,
    domain: COOKIE_DOMAIN,
  });
}

/* ---------------- JWT vs opaque detection ---------------- */

function looksLikeJwt(token) {
  return typeof token === "string" && token.split(".").length === 3;
}

/**
 * Resolve legacy opaque tokens to a user.
 * Adjust to your schema:
 *   A) users.api_token == token
 *   B) sessions.token -> include user
 */
async function resolveOpaqueTokenToUser(token) {
  // A) users.api_token
  const user = await prisma.users.findFirst({
    where: { api_token: token }, // <-- change if your column differs
  });
  if (user) return user;

  // B) sessions table example:
  // const session = await prisma.sessions.findUnique({
  //   where: { token },
  //   include: { user: true },
  // });
  // if (session?.user) return session.user;

  return null;
}

/* ---------------- middleware ---------------- */

export const authenticate = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "Not authenticated", code: "NO_TOKEN" });
    }

    let userSource = null;

    if (looksLikeJwt(token)) {
      // JWT path
      userSource = jwt.verify(token, JWT_SECRET); // throws if invalid/expired
    } else {
      // Opaque path
      userSource = await resolveOpaqueTokenToUser(token);

      // Last-ditch: token persisted as 'Bearer ey...' — sanitize and retry as JWT
      if (!userSource && looksLikeJwt(sanitizeToken(token))) {
        userSource = jwt.verify(sanitizeToken(token), JWT_SECRET);
      }
    }

    if (!userSource) {
      return res.status(401).json({ error: "Invalid or unknown token", code: "TOKEN_UNKNOWN" });
    }

    const user = normalizeUser(userSource);
    if (!user?.id) {
      return res.status(401).json({ error: "Invalid token payload", code: "PAYLOAD_INVALID" });
    }

    req.user = user;
    req.token = token;
    res.locals.user = user;
    return next();
  } catch (err) {
    if (err?.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Session expired", code: "TOKEN_EXPIRED" });
    }
    if (err?.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token", code: "TOKEN_INVALID" });
    }
    return res.status(401).json({ error: "Not authenticated", code: "TOKEN_ERROR" });
  }
};

export const authenticateOptional = async (req, _res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    // JWT first
    if (looksLikeJwt(token)) {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = normalizeUser(payload);
      req.token = token;
      return next();
    }

    // Opaque fallback
    const user = await resolveOpaqueTokenToUser(token);
    if (user) {
      req.user = normalizeUser(user);
      req.token = token;
    }
    return next();
  } catch {
    // ignore invalid tokens in optional mode
    return next();
  }
};
