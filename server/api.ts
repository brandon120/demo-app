import type { IncomingMessage, ServerResponse } from "http";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import { getDb, type MessageRow, type PublicUser, type UserRow } from "./db";

const SESSION_DAYS = 7;

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<Record<string, string>> {
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

function toPublicUser(user: UserRow): PublicUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    created_at: user.created_at,
  };
}

function getToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

function getCurrentUser(req: IncomingMessage): PublicUser | null {
  const token = getToken(req);
  if (!token) return null;

  const db = getDb();
  const session = db
    .prepare(
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > datetime('now')",
    )
    .get(token) as { user_id: string } | undefined;

  if (!session) return null;

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(session.user_id) as UserRow | undefined;

  return user ? toPublicUser(user) : null;
}

function enrichMessage(
  message: MessageRow,
  users: Map<string, PublicUser>,
): MessageRow & { sender: PublicUser; receiver: PublicUser } {
  return {
    ...message,
    sender: users.get(message.sender_id)!,
    receiver: users.get(message.receiver_id)!,
  };
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/")) {
    return false;
  }

  const method = req.method ?? "GET";
  const path = url.pathname;

  try {
    if (method === "POST" && path === "/api/auth/signup") {
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

      const db = getDb();
      const existing = db
        .prepare("SELECT id FROM users WHERE email = ? OR username = ?")
        .get(email, username);

      if (existing) {
        sendJson(res, 409, { error: "Email or username already taken." });
        return true;
      }

      const userId = uuid();
      const passwordHash = bcrypt.hashSync(password, 10);
      db.prepare(
        "INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)",
      ).run(userId, username, email, passwordHash);

      const token = uuid();
      const expiresAt = new Date(
        Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.prepare(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
      ).run(token, userId, expiresAt);

      const user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(userId) as UserRow;

      sendJson(res, 201, { token, user: toPublicUser(user) });
      return true;
    }

    if (method === "POST" && path === "/api/auth/signin") {
      const body = await readBody(req);
      const email = body.email?.trim().toLowerCase();
      const password = body.password;

      if (!email || !password) {
        sendJson(res, 400, { error: "Email and password are required." });
        return true;
      }

      const db = getDb();
      const user = db
        .prepare("SELECT * FROM users WHERE email = ?")
        .get(email) as UserRow | undefined;

      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        sendJson(res, 401, { error: "Invalid email or password." });
        return true;
      }

      const token = uuid();
      const expiresAt = new Date(
        Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      db.prepare(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
      ).run(token, user.id, expiresAt);

      sendJson(res, 200, { token, user: toPublicUser(user) });
      return true;
    }

    if (method === "POST" && path === "/api/auth/signout") {
      const token = getToken(req);
      if (token) {
        getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
      }
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "GET" && path === "/api/auth/me") {
      const user = getCurrentUser(req);
      if (!user) {
        sendJson(res, 401, { error: "Not authenticated." });
        return true;
      }
      sendJson(res, 200, { user });
      return true;
    }

    if (method === "GET" && path === "/api/users") {
      const currentUser = getCurrentUser(req);
      if (!currentUser) {
        sendJson(res, 401, { error: "Not authenticated." });
        return true;
      }

      const users = getDb()
        .prepare(
          "SELECT id, username, email, created_at FROM users WHERE id != ? ORDER BY username",
        )
        .all(currentUser.id) as PublicUser[];

      sendJson(res, 200, { users });
      return true;
    }

    if (method === "GET" && path === "/api/messages") {
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

      const db = getDb();
      const rows = db
        .prepare(
          `SELECT * FROM messages
           WHERE (sender_id = ? AND receiver_id = ?)
              OR (sender_id = ? AND receiver_id = ?)
           ORDER BY created_at ASC`,
        )
        .all(currentUser.id, withUserId, withUserId, currentUser.id) as MessageRow[];

      const userIds = new Set<string>();
      for (const row of rows) {
        userIds.add(row.sender_id);
        userIds.add(row.receiver_id);
      }
      userIds.add(currentUser.id);
      userIds.add(withUserId);

      const users = new Map<string, PublicUser>();
      for (const id of userIds) {
        const user = db
          .prepare("SELECT id, username, email, created_at FROM users WHERE id = ?")
          .get(id) as PublicUser | undefined;
        if (user) users.set(id, user);
      }

      sendJson(res, 200, {
        messages: rows.map((row) => enrichMessage(row, users)),
      });
      return true;
    }

    if (method === "POST" && path === "/api/messages") {
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

      const db = getDb();
      const receiver = db
        .prepare("SELECT id FROM users WHERE id = ?")
        .get(receiverId);

      if (!receiver) {
        sendJson(res, 404, { error: "Receiver not found." });
        return true;
      }

      const messageId = uuid();
      db.prepare(
        "INSERT INTO messages (id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)",
      ).run(messageId, currentUser.id, receiverId, content);

      const message = db
        .prepare("SELECT * FROM messages WHERE id = ?")
        .get(messageId) as MessageRow;

      const users = new Map<string, PublicUser>();
      users.set(currentUser.id, currentUser);
      const receiverUser = db
        .prepare("SELECT id, username, email, created_at FROM users WHERE id = ?")
        .get(receiverId) as PublicUser;
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
