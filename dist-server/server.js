// server/production.ts
import express from "express";
import path2 from "path";
import { fileURLToPath as fileURLToPath2 } from "url";

// server/api.ts
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";

// server/db.ts
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var DB_PATH = path.join(__dirname, "demo.db");
var db = null;
function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}
function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_participants
      ON messages(sender_id, receiver_id);
  `);
}

// server/api.ts
var SESSION_DAYS = 7;
function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function toPublicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    created_at: user.created_at
  };
}
function getToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}
function getCurrentUser(req) {
  const token = getToken(req);
  if (!token) return null;
  const db2 = getDb();
  const session = db2.prepare(
    "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')"
  ).get(token);
  if (!session) return null;
  const user = db2.prepare("SELECT * FROM users WHERE id = ?").get(session.user_id);
  return user ? toPublicUser(user) : null;
}
function enrichMessage(message, users) {
  return {
    ...message,
    sender: users.get(message.sender_id),
    receiver: users.get(message.receiver_id)
  };
}
async function handleApiRequest(req, res, url) {
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }
  const method = req.method ?? "GET";
  const path3 = url.pathname;
  try {
    if (method === "POST" && path3 === "/api/auth/signup") {
      const body = await readBody(req);
      const username = body.username?.trim();
      const email = body.email?.trim().toLowerCase();
      const password = body.password;
      if (!username || !email || !password) {
        sendJson(res, 400, { error: "Username, email, and password are required." });
        return true;
      }
      if (password.length < 6) {
        sendJson(res, 400, { error: "Password must be at least 6 characters." });
        return true;
      }
      const db2 = getDb();
      const existing = db2.prepare("SELECT id FROM users WHERE email = ? OR username = ?").get(email, username);
      if (existing) {
        sendJson(res, 409, { error: "Email or username already taken." });
        return true;
      }
      const userId = uuid();
      const passwordHash = bcrypt.hashSync(password, 10);
      db2.prepare(
        "INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)"
      ).run(userId, username, email, passwordHash);
      const token = uuid();
      const expiresAt = new Date(
        Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1e3
      ).toISOString();
      db2.prepare(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
      ).run(token, userId, expiresAt);
      const user = db2.prepare("SELECT * FROM users WHERE id = ?").get(userId);
      sendJson(res, 201, { token, user: toPublicUser(user) });
      return true;
    }
    if (method === "POST" && path3 === "/api/auth/signin") {
      const body = await readBody(req);
      const email = body.email?.trim().toLowerCase();
      const password = body.password;
      if (!email || !password) {
        sendJson(res, 400, { error: "Email and password are required." });
        return true;
      }
      const db2 = getDb();
      const user = db2.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        sendJson(res, 401, { error: "Invalid email or password." });
        return true;
      }
      const token = uuid();
      const expiresAt = new Date(
        Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1e3
      ).toISOString();
      db2.prepare(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)"
      ).run(token, user.id, expiresAt);
      sendJson(res, 200, { token, user: toPublicUser(user) });
      return true;
    }
    if (method === "POST" && path3 === "/api/auth/signout") {
      const token = getToken(req);
      if (token) {
        getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
      }
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (method === "GET" && path3 === "/api/auth/me") {
      const user = getCurrentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "Not authenticated." });
        return true;
      }
      sendJson(res, 200, { user });
      return true;
    }
    if (method === "GET" && path3 === "/api/users") {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        sendJson(res, 401, { error: "Not authenticated." });
        return true;
      }
      const users = getDb().prepare(
        "SELECT id, username, email, created_at FROM users WHERE id != ? ORDER BY username"
      ).all(currentUser.id);
      sendJson(res, 200, { users });
      return true;
    }
    if (method === "GET" && path3 === "/api/messages") {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        sendJson(res, 401, { error: "Not authenticated." });
        return true;
      }
      const withUserId = url.searchParams.get("with");
      if (!withUserId) {
        sendJson(res, 400, { error: "Missing 'with' query parameter." });
        return true;
      }
      const db2 = getDb();
      const rows = db2.prepare(
        `SELECT * FROM messages
           WHERE (sender_id = ? AND receiver_id = ?)
              OR (sender_id = ? AND receiver_id = ?)
           ORDER BY created_at ASC`
      ).all(currentUser.id, withUserId, withUserId, currentUser.id);
      const userIds = /* @__PURE__ */ new Set();
      for (const row of rows) {
        userIds.add(row.sender_id);
        userIds.add(row.receiver_id);
      }
      userIds.add(currentUser.id);
      userIds.add(withUserId);
      const users = /* @__PURE__ */ new Map();
      for (const id of userIds) {
        const user = db2.prepare("SELECT id, username, email, created_at FROM users WHERE id = ?").get(id);
        if (user) users.set(id, user);
      }
      sendJson(res, 200, {
        messages: rows.map((row) => enrichMessage(row, users))
      });
      return true;
    }
    if (method === "POST" && path3 === "/api/messages") {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        sendJson(res, 401, { error: "Not authenticated." });
        return true;
      }
      const body = await readBody(req);
      const receiverId = body.receiverId?.trim();
      const content = body.content?.trim();
      if (!receiverId || !content) {
        sendJson(res, 400, { error: "Receiver and content are required." });
        return true;
      }
      const db2 = getDb();
      const receiver = db2.prepare("SELECT id FROM users WHERE id = ?").get(receiverId);
      if (!receiver) {
        sendJson(res, 404, { error: "Receiver not found." });
        return true;
      }
      const messageId = uuid();
      db2.prepare(
        "INSERT INTO messages (id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)"
      ).run(messageId, currentUser.id, receiverId, content);
      const message = db2.prepare("SELECT * FROM messages WHERE id = ?").get(messageId);
      const users = /* @__PURE__ */ new Map();
      users.set(currentUser.id, currentUser);
      const receiverUser = db2.prepare("SELECT id, username, email, created_at FROM users WHERE id = ?").get(receiverId);
      users.set(receiverId, receiverUser);
      sendJson(res, 201, { message: enrichMessage(message, users) });
      return true;
    }
    sendJson(res, 404, { error: "Not found." });
    return true;
  } catch (error) {
    console.error("API error:", error);
    sendJson(res, 500, { error: "Internal server error." });
    return true;
  }
}

// server/production.ts
var __dirname2 = path2.dirname(fileURLToPath2(import.meta.url));
var app = express();
var PORT = Number(process.env.PORT) || 3e3;
var distDir = path2.join(__dirname2, "..", "dist");
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "demo-chat",
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
});
app.use(async (req, res, next) => {
  if (!req.url?.startsWith("/api/")) {
    next();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const handled = await handleApiRequest(
    req,
    res,
    url
  );
  if (!handled) {
    next();
  }
});
app.use(express.static(distDir));
app.use((_req, res) => {
  res.sendFile(path2.join(distDir, "index.html"));
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Demo Chat running on port ${PORT}`);
});
