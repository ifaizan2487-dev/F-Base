

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const HOST = "0.0.0.0";
const PORT = Number(process.env.PORT) || 10000;
const DATA_DIR = process.env.FBASE_DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "fbase.db"));
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS user_records (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "https://ifaizan2487-dev.github.io",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("TOO_LARGE"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("BAD_JSON"));
      }
    });
    req.on("error", reject);
  });
}

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(salt.toString("hex") + ":" + key.toString("hex"));
    });
  });
}

function checkPassword(password, stored) {
  const parts = stored.split(":");
  if (parts.length !== 2) return Promise.resolve(false);

  const salt = Buffer.from(parts[0], "hex");
  const expected = Buffer.from(parts[1], "hex");
  if (salt.length !== 16 || expected.length !== 64) {
    return Promise.resolve(false);
  }

  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(expected, key));
    });
  });
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function getUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;

  const hashed = tokenHash(header.slice(7));
  const session = db.prepare(`
    SELECT users.id, users.email, users.username, sessions.expires_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(hashed);

  if (!session) return null;

  if (Date.parse(session.expires_at) <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashed);
    return null;
  }

  return {
    id: session.id,
    email: session.email,
    username: session.username
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const route = url.pathname;
    if (req.method === "POST" && route === "/admin/cleanup-all") {
      const expected = process.env.FBASE_CLEANUP_SECRET;
      const supplied = req.headers["x-cleanup-secret"];

      if (!expected) {
        return send(res, 503, { error: "Cleanup is not configured" });
      }

      if (
        typeof supplied !== "string" ||
        supplied.length !== expected.length ||
        !crypto.timingSafeEqual(
          Buffer.from(supplied),
          Buffer.from(expected)
        )
      ) {
        return send(res, 401, { error: "Unauthorized" });
      }

      const counts = {
        users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
        sessions: db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
        records: db.prepare("SELECT COUNT(*) AS n FROM user_records").get().n
      };

      try {
        db.exec("BEGIN IMMEDIATE");
        db.exec("DELETE FROM users");
        db.exec("DELETE FROM sessions");
        db.exec("DELETE FROM user_records");
        db.exec("COMMIT");

        return send(res, 200, {
          message: "Cleanup completed",
          deleted: counts
        });
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch (_) {}
        throw error;
      }
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "https://ifaizan2487-dev.github.io",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400"
      });
      return res.end();
    }
    if (req.method === "GET" && route === "/health") {
      return send(res, 200, {
        project: "F-Base",
        status: "running",
        storage: "SQLite"
      });
    }

    if (req.method === "POST" && route === "/api/register") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const username = String(body.username || "").trim();
      const password = String(body.password || "");

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return send(res, 400, { error: "Enter a valid email" });
      }
if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
  return send(res, 400, {
    error: "Username must be 3-24 characters using letters, numbers, or underscores"
  });
}

if (password.length < 8 || password.length > 128) {
  return send(res, 400, {
    error: "Password must be 8-128 characters"
  });
}
      const id = crypto.randomUUID();
      const passwordHash = await hashPassword(password);
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO users (id, email, username, password_hash, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, email, username, passwordHash, now);

      return send(res, 201, {
        message: "Account created. You can now log in.",
        user: { id, email, username }
      });
    }

    if (req.method === "POST" && route === "/api/login") {
      const body = await readBody(req);
      const identity = String(
        body.identity || body.email || body.username || ""
      ).trim();

      const user = db.prepare(`
        SELECT * FROM users
        WHERE email = ? OR username = ? COLLATE NOCASE
      `).get(identity.toLowerCase(), identity);

      if (!user || !(await checkPassword(
        String(body.password || ""), user.password_hash
      ))) {
        return send(res, 401, { error: "Invalid login details" });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

      db.prepare(`
        INSERT INTO sessions (token_hash, user_id, expires_at)
        VALUES (?, ?, ?)
      `).run(tokenHash(token), user.id, expiresAt);

      return send(res, 200, {
        token,
        expiresAt,
        user: {
          id: user.id,
          email: user.email,
          username: user.username
        }
      });
    }

    if (req.method === "GET" && route === "/api/me") {
      const user = getUser(req);
      if (!user) return send(res, 401, { error: "Please log in" });
      return send(res, 200, { user });
    }

    if (req.method === "POST" && route === "/api/logout") {
      const header = req.headers.authorization || "";
      if (header.startsWith("Bearer ")) {
        db.prepare("DELETE FROM sessions WHERE token_hash = ?")
          .run(tokenHash(header.slice(7)));
      }
      return send(res, 200, { message: "Logged out" });
    }

    if (route === "/api/records") {
      const user = getUser(req);
      if (!user) return send(res, 401, { error: "Please log in" });

      if (req.method === "GET") {
        const rows = db.prepare(`
          SELECT id, data, created_at, updated_at
          FROM user_records WHERE user_id = ?
          ORDER BY created_at DESC
        `).all(user.id);

        return send(res, 200, {
          records: rows.map(row => ({
            id: row.id,
            data: JSON.parse(row.data),
            createdAt: row.created_at,
            updatedAt: row.updated_at
          }))
        });
      }

      if (req.method === "POST") {
        const body = await readBody(req);
        if (body.data === undefined) {
          return send(res, 400, { error: "data is required" });
        }

        const id = crypto.randomUUID();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO user_records
          (id, user_id, data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, user.id, JSON.stringify(body.data), now, now);

        return send(res, 201, { id, data: body.data, createdAt: now });
      }

      return send(res, 405, { error: "Method not allowed" });
    }


    if (req.method === "GET") {
      const staticFiles = {
        "/": ["index.html", "text/html; charset=utf-8"],
        "/index.html": ["index.html", "text/html; charset=utf-8"],
        "/style.css": ["style.css", "text/css; charset=utf-8"],
        "/app.js": ["app.js", "text/javascript; charset=utf-8"]
      };

      const asset = staticFiles[route];
      if (asset) {
        return fs.readFile(
          path.join(__dirname, "public", asset[0]),
          (err, content) => {
            if (err) {
              return send(res, 500, { error: "Frontend file unavailable" });
            }
            res.writeHead(200, {
              "Content-Type": asset[1],
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff"
            });
            res.end(content);
          }
        );
      }
    }

    return send(res, 404, { error: "Endpoint not found" });
  } catch (err) {
    if (res.headersSent || res.destroyed) return;

    if (err.message === "BAD_JSON") {
      return send(res, 400, { error: "Invalid JSON" });
    }
    if (err.message === "TOO_LARGE") {
      return send(res, 413, { error: "Request too large" });
    }
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return send(res, 409, {
        error: "Email or username already registered"
      });
    }

    console.error("F-Base error:", err.message);
    return send(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log("F-Base API running locally");
  console.log("URL: http://127.0.0.1:" + PORT);
  console.log("Storage: SQLite");
  console.log("Public access: disabled");
});

process.on("SIGINT", () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});


