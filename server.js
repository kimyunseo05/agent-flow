const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const mysql = require("mysql2/promise");
const { Pool } = require("pg");
const multer = require("multer");
const SftpClient = require("ssh2-sftp-client");

/** 비밀번호를 UTF-8 문자열로 SHA-256 해시한 16진 문자열(소문자 64자) */
function sha256PasswordHex(plain) {
  return crypto.createHash("sha256").update(String(plain), "utf8").digest("hex");
}

/** 저장된 SHA-256(hex)과 입력 비밀번호가 같은지 타이밍 안전 비교 */
function passwordMatchesStoredSha256(plain, storedHash) {
  const expected = sha256PasswordHex(plain);
  const got = String(storedHash ?? "").trim().toLowerCase();
  if (got.length !== 64 || !/^[0-9a-f]{64}$/.test(got)) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(got, "hex"));
  } catch {
    return false;
  }
}

/**
 * MySQL (관리자·로그인): MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 * PostgreSQL (수집부): PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE
 */

const PORT = process.env.PORT || 3000;
const MODEL_FILE_TARGET_DIR = process.env.MODEL_FILE_TARGET_DIR || "/data/vdb/times/new/models";
const MODEL_FILE_BACKUP_DIR =
  process.env.MODEL_FILE_BACKUP_DIR || path.join(MODEL_FILE_TARGET_DIR, "backup");
const MODEL_FILE_REMOTE_HOST = String(process.env.MODEL_FILE_REMOTE_HOST || "210.109.80.1").trim();
const MODEL_FILE_REMOTE_PORT = Number(process.env.MODEL_FILE_REMOTE_PORT) || 22;
const MODEL_FILE_REMOTE_USER = String(process.env.MODEL_FILE_REMOTE_USER || "ubuntu").trim();
const MODEL_FILE_REMOTE_PASSWORD = process.env.MODEL_FILE_REMOTE_PASSWORD || "";
const MODEL_FILE_REMOTE_PRIVATE_KEY_PATH = String(
  process.env.MODEL_FILE_REMOTE_PRIVATE_KEY_PATH || "/Users/deiludenseu/Downloads/fitgoKey.pem"
).trim();
const MODEL_FILE_REMOTE_PRIVATE_KEY = process.env.MODEL_FILE_REMOTE_PRIVATE_KEY || "";
const MODEL_FILE_REMOTE_PASSPHRASE = process.env.MODEL_FILE_REMOTE_PASSPHRASE || "";
const MODEL_FILE_USE_REMOTE = Boolean(MODEL_FILE_REMOTE_HOST);
const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), "agent-flow-model-upload");
const modelUpload = multer({
  dest: UPLOAD_TEMP_DIR,
  limits: { fileSize: 1024 * 1024 * 1024, files: 100 },
});

const mysqlPool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "1234",
  database: process.env.MYSQL_DATABASE || "agent_flow_admin",
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
});

const pgPool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "deiludenseu",
  password: process.env.PGPASSWORD || "",
  database: process.env.PGDATABASE || "agent_flow_collect",
  max: 10,
});

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

async function seedMysqlIfEmpty() {
  const [rows] = await mysqlPool.query("SELECT COUNT(*) AS c FROM users");
  const c = Number(rows[0].c);
  if (c === 0) {
    const hash = sha256PasswordHex("admin");
    await mysqlPool.query("INSERT INTO users (username, password_hash) VALUES (?, ?)", ["admin", hash]);
    console.warn(
      "[회원 CMS] 기본 관리자: 아이디 admin / 비밀번호 admin — 운영 환경에서는 반드시 변경하세요."
    );
  }
}

async function seedPostgresIfEmpty() {
  const { rows } = await pgPool.query("SELECT COUNT(*)::int AS c FROM collection_units");
  const c = Number(rows[0].c);
  if (c === 0) {
    await pgPool.query(
      `INSERT INTO collection_units (process_name, process_code, status, auto_control)
       VALUES ($1, $2, $3, $4)`,
      ["에어크리너", "TAC30201_AL_00007", "정상", "ON"]
    );
  }
}

const MODEL_UNITS_DDL = `
CREATE TABLE IF NOT EXISTS model_units (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_name VARCHAR(255) NOT NULL,
  model_code VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT '정상',
  auto_learn VARCHAR(10) NOT NULL DEFAULT 'ON',
  auto_control VARCHAR(10) NOT NULL DEFAULT 'ON',
  learning_cycle VARCHAR(100) NOT NULL DEFAULT '',
  resample_size VARCHAR(100) NOT NULL DEFAULT '',
  interpolate VARCHAR(10) NOT NULL DEFAULT 'on',
  fill_method VARCHAR(20) NOT NULL DEFAULT 'ffill',
  model_output_path TEXT NULL,
  model_generated_at DATETIME NULL,
  control_tag_id VARCHAR(255) NOT NULL DEFAULT '',
  min_allowed VARCHAR(100) NOT NULL DEFAULT '',
  max_allowed VARCHAR(100) NOT NULL DEFAULT '',
  change_range VARCHAR(100) NOT NULL DEFAULT '',
  auto_apply VARCHAR(50) NOT NULL DEFAULT 'after_approval',
  memo TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_units_code (model_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function ensureModelUnitsTable() {
  await mysqlPool.query(MODEL_UNITS_DDL);
}

function formatModelDate(d) {
  if (!d) return null;
  if (d instanceof Date) {
    const iso = d.toISOString().slice(0, 19).replace("T", " ");
    return iso;
  }
  return String(d);
}

function rowToModelUnit(row) {
  if (!row) return null;
  return {
    id: row.id,
    model_name: row.model_name,
    model_code: row.model_code,
    status: row.status ?? "정상",
    auto_learn: row.auto_learn === "OFF" ? "OFF" : "ON",
    auto_control: row.auto_control === "OFF" ? "OFF" : "ON",
    learning_cycle: row.learning_cycle ?? "",
    resample_size: row.resample_size ?? "",
    interpolate: String(row.interpolate ?? "on").toLowerCase() === "off" ? "off" : "on",
    fill_method: ["bfill", "zero"].includes(String(row.fill_method ?? "").toLowerCase())
      ? String(row.fill_method).toLowerCase()
      : "ffill",
    model_output_path: row.model_output_path ?? "",
    model_generated_at: formatModelDate(row.model_generated_at),
    control_tag_id: row.control_tag_id ?? "",
    min_allowed: row.min_allowed ?? "",
    max_allowed: row.max_allowed ?? "",
    change_range: row.change_range ?? "",
    auto_apply: row.auto_apply === "immediate" ? "immediate" : "after_approval",
    memo: row.memo ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeModelBody(body, { partial } = {}) {
  const b = body ?? {};
  const out = {};
  if (!partial || Object.prototype.hasOwnProperty.call(b, "model_name")) {
    out.model_name = String(b.model_name ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "model_code")) {
    out.model_code = String(b.model_code ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "status")) {
    out.status = b.status === "비정상" ? "비정상" : "정상";
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "auto_learn")) {
    out.auto_learn = String(b.auto_learn ?? "ON").toUpperCase() === "OFF" ? "OFF" : "ON";
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "auto_control")) {
    out.auto_control = String(b.auto_control ?? "ON").toUpperCase() === "OFF" ? "OFF" : "ON";
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "learning_cycle")) {
    out.learning_cycle = String(b.learning_cycle ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "resample_size")) {
    out.resample_size = String(b.resample_size ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "interpolate")) {
    out.interpolate = String(b.interpolate ?? "on").toLowerCase() === "off" ? "off" : "on";
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "fill_method")) {
    const fm = String(b.fill_method ?? "ffill").toLowerCase();
    out.fill_method = ["bfill", "zero"].includes(fm) ? fm : "ffill";
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "model_output_path")) {
    out.model_output_path = String(b.model_output_path ?? "").trim() || null;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "control_tag_id")) {
    out.control_tag_id = String(b.control_tag_id ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "min_allowed")) {
    out.min_allowed = String(b.min_allowed ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "max_allowed")) {
    out.max_allowed = String(b.max_allowed ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "change_range")) {
    out.change_range = String(b.change_range ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "auto_apply")) {
    out.auto_apply = b.auto_apply === "immediate" ? "immediate" : "after_approval";
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "memo")) {
    out.memo = String(b.memo ?? "").trim() || null;
  }
  return out;
}

function backupSuffix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}${m}${day}_${hh}${mm}${ss}`;
}

function resolvePrivateKeyPath(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function createSftpClient() {
  const sftp = new SftpClient();
  const cfg = {
    host: MODEL_FILE_REMOTE_HOST,
    port: MODEL_FILE_REMOTE_PORT,
    username: MODEL_FILE_REMOTE_USER,
  };
  if (MODEL_FILE_REMOTE_PRIVATE_KEY) {
    cfg.privateKey = MODEL_FILE_REMOTE_PRIVATE_KEY;
    if (MODEL_FILE_REMOTE_PASSPHRASE) cfg.passphrase = MODEL_FILE_REMOTE_PASSPHRASE;
  } else if (MODEL_FILE_REMOTE_PRIVATE_KEY_PATH) {
    const keyPath = resolvePrivateKeyPath(MODEL_FILE_REMOTE_PRIVATE_KEY_PATH);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`PEM 키 파일을 찾을 수 없습니다: ${keyPath}`);
    }
    cfg.privateKey = fs.readFileSync(keyPath, "utf8");
    if (MODEL_FILE_REMOTE_PASSPHRASE) cfg.passphrase = MODEL_FILE_REMOTE_PASSPHRASE;
  } else if (MODEL_FILE_REMOTE_PASSWORD) {
    cfg.password = MODEL_FILE_REMOTE_PASSWORD;
  } else {
    throw new Error(
      "원격 업로드 인증 정보가 없습니다. MODEL_FILE_REMOTE_PRIVATE_KEY_PATH(또는 MODEL_FILE_REMOTE_PRIVATE_KEY), MODEL_FILE_REMOTE_PASSWORD 중 하나를 설정하세요."
    );
  }
  return { sftp, cfg };
}

async function seedModelUnitsIfEmpty() {
  const [rows] = await mysqlPool.query("SELECT COUNT(*) AS c FROM model_units");
  const c = Number(rows[0].c);
  if (c === 0) {
    await mysqlPool.query(
      `INSERT INTO model_units (
        model_name, model_code, status, auto_learn, auto_control,
        learning_cycle, resample_size, interpolate, fill_method,
        control_tag_id, min_allowed, max_allowed, change_range, auto_apply,
        model_generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        "에어크리너",
        "TAC30201_AL_00007",
        "정상",
        "ON",
        "ON",
        "7",
        "10s",
        "on",
        "ffill",
        "TAC30201_AL_00007",
        "10",
        "100",
        "±5%",
        "after_approval",
      ]
    );
  }
}

const app = express();
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(
  session({
    name: "cms.sid",
    secret: process.env.SESSION_SECRET || "member-cms-dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  next();
}

app.post(
  "/api/auth/login",
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {};
    const u = String(username ?? "").trim();
    if (!u || !password) {
      return res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    }
    const [rows] = await mysqlPool.query(
      "SELECT id, username, password_hash FROM users WHERE username = ?",
      [u]
    );
    const row = rows[0];
    if (!row || !passwordMatchesStoredSha256(password, row.password_hash)) {
      return res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    }
    req.session.userId = row.id;
    req.session.username = row.username;
    res.json({ user: { id: row.id, username: row.username } });
  })
);

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.status(204).send();
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  res.json({ user: { id: req.session.userId, username: req.session.username } });
});

app.get("/", (req, res) => {
  res.redirect(302, "/html/collect/index.html");
});

app.use(express.static(path.join(__dirname, "public")));

function rowToAdmin(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.display_name ?? "",
    email: row.email ?? "",
    phone: row.phone ?? "",
    role: row.role ?? "admin",
    memo: row.memo ?? "",
    created_at: row.created_at,
  };
}

app.get(
  "/api/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    let where = "1=1";
    const params = [];
    if (q) {
      where +=
        " AND (username LIKE ? OR IFNULL(display_name,'') LIKE ? OR IFNULL(email,'') LIKE ?)";
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    const [countRows] = await mysqlPool.query(`SELECT COUNT(*) AS c FROM users WHERE ${where}`, params);
    const total = Number(countRows[0].c);

    const [rows] = await mysqlPool.query(
      `SELECT id, username, display_name, email, phone, role, memo, created_at FROM users WHERE ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      items: rows.map(rowToAdmin),
      total,
      page,
      pageSize,
    });
  })
);

app.get(
  "/api/members/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await mysqlPool.query(
      "SELECT id, username, display_name, email, phone, role, memo, created_at FROM users WHERE id = ?",
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "관리자를 찾을 수 없습니다." });
    res.json(rowToAdmin(row));
  })
);

app.post(
  "/api/members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { username, password, name, email, phone, role, memo } = req.body ?? {};
    const u = String(username ?? "").trim();
    const pw = String(password ?? "");
    const displayName = String(name ?? "").trim();
    if (!u || !pw) {
      return res.status(400).json({ error: "아이디와 비밀번호는 필수입니다." });
    }
    if (!displayName) {
      return res.status(400).json({ error: "이름은 필수입니다." });
    }
    const hash = sha256PasswordHex(pw);
    try {
      const [result] = await mysqlPool.query(
        `INSERT INTO users (username, password_hash, display_name, email, phone, role, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          u,
          hash,
          displayName,
          (email ?? "").trim() || null,
          (phone ?? "").trim(),
          (role ?? "admin").trim() || "admin",
          (memo ?? "").trim(),
        ]
      );
      const insertId = result.insertId;
      const [rows] = await mysqlPool.query(
        "SELECT id, username, display_name, email, phone, role, memo, created_at FROM users WHERE id = ?",
        [insertId]
      );
      res.status(201).json(rowToAdmin(rows[0]));
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        const msg = String(e.sqlMessage || e.message || "");
        if (msg.toLowerCase().includes("username")) {
          return res.status(409).json({ error: "이미 사용 중인 아이디입니다." });
        }
        return res.status(409).json({ error: "이미 등록된 이메일입니다." });
      }
      throw e;
    }
  })
);

app.put(
  "/api/members/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, email, phone, role, memo, password } = req.body ?? {};
    const displayName = String(name ?? "").trim();
    if (!displayName) {
      return res.status(400).json({ error: "이름은 필수입니다." });
    }
    const id = Number(req.params.id);
    const [existRows] = await mysqlPool.query("SELECT id FROM users WHERE id = ?", [id]);
    if (!existRows[0]) {
      return res.status(404).json({ error: "관리자를 찾을 수 없습니다." });
    }
    const pw = String(password ?? "").trim();
    try {
      if (pw) {
        const hash = sha256PasswordHex(pw);
        await mysqlPool.query(
          `UPDATE users SET password_hash = ?, display_name = ?, email = ?, phone = ?, role = ?, memo = ?
           WHERE id = ?`,
          [
            hash,
            displayName,
            (email ?? "").trim() || null,
            (phone ?? "").trim(),
            (role ?? "admin").trim() || "admin",
            (memo ?? "").trim(),
            id,
          ]
        );
      } else {
        await mysqlPool.query(
          `UPDATE users SET display_name = ?, email = ?, phone = ?, role = ?, memo = ?
           WHERE id = ?`,
          [
            displayName,
            (email ?? "").trim() || null,
            (phone ?? "").trim(),
            (role ?? "admin").trim() || "admin",
            (memo ?? "").trim(),
            id,
          ]
        );
      }
      const [rows] = await mysqlPool.query(
        "SELECT id, username, display_name, email, phone, role, memo, created_at FROM users WHERE id = ?",
        [id]
      );
      res.json(rowToAdmin(rows[0]));
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "이미 등록된 이메일입니다." });
      }
      throw e;
    }
  })
);

app.delete(
  "/api/members/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.session.userId) {
      return res.status(400).json({ error: "현재 로그인한 계정은 삭제할 수 없습니다." });
    }
    const [countRows] = await mysqlPool.query("SELECT COUNT(*) AS c FROM users");
    const total = Number(countRows[0].c);
    if (total <= 1) {
      return res.status(400).json({ error: "마지막 관리자 계정은 삭제할 수 없습니다." });
    }
    const [result] = await mysqlPool.query("DELETE FROM users WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "관리자를 찾을 수 없습니다." });
    }
    res.status(204).send();
  })
);

function parseCollectionInUse(v) {
  if (v === false || v === "false" || v === "미사용") return false;
  return true;
}

function rowToCollectionUnit(row) {
  return {
    id: row.id,
    process_name: row.process_name,
    process_code: row.process_code,
    device_name: row.device_name ?? "",
    device_ip: row.device_ip ?? "",
    device_port: row.device_port ?? "",
    status: row.status ?? "정상",
    auto_control: row.auto_control ?? "ON",
    in_use: row.in_use !== false,
    created_at: row.created_at,
  };
}

app.get(
  "/api/collection-units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    let where = "1=1";
    const params = [];
    let p = 1;
    if (q) {
      const like = `%${q}%`;
      where += ` AND (process_name ILIKE $${p} OR process_code ILIKE $${p + 1})`;
      params.push(like, like);
      p += 2;
    }

    const countSql = `SELECT COUNT(*)::int AS c FROM collection_units WHERE ${where}`;
    const { rows: countRows } = await pgPool.query(countSql, params);
    const total = Number(countRows[0].c);

    const listSql = `SELECT * FROM collection_units WHERE ${where}
       ORDER BY id DESC LIMIT $${p} OFFSET $${p + 1}`;
    const { rows } = await pgPool.query(listSql, [...params, pageSize, offset]);

    res.json({
      items: rows.map(rowToCollectionUnit),
      total,
      page,
      pageSize,
    });
  })
);

app.get(
  "/api/collection-units/:id/tags",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows: unitRows } = await pgPool.query("SELECT id FROM collection_units WHERE id = $1", [
      req.params.id,
    ]);
    if (!unitRows[0]) return res.status(404).json({ error: "수집부를 찾을 수 없습니다." });
    const { rows } = await pgPool.query(
      `SELECT tag_id, data_type, address, ratio FROM collection_unit_tags
       WHERE collection_unit_id = $1 ORDER BY sort_order ASC, id ASC`,
      [req.params.id]
    );
    res.json({
      tags: rows.map((r) => ({
        tag_id: r.tag_id ?? "",
        dataType: r.data_type ?? "DWord",
        address: r.address ?? "",
        ratio: r.ratio ?? "1",
      })),
    });
  })
);

app.put(
  "/api/collection-units/:id/tags",
  requireAuth,
  asyncHandler(async (req, res) => {
    const unitId = req.params.id;
    const { rows: unitRows } = await pgPool.query("SELECT id FROM collection_units WHERE id = $1", [
      unitId,
    ]);
    if (!unitRows[0]) return res.status(404).json({ error: "수집부를 찾을 수 없습니다." });

    const raw = req.body?.tags;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ error: "tags 배열이 필요합니다." });
    }

    const normalizeDT = (v) => {
      const s = String(v ?? "DWord");
      return ["Boolean", "Word", "DWord"].includes(s) ? s : "DWord";
    };

    const tags = raw.map((t) => ({
      tag_id: String(t.tag_id ?? "").trim(),
      data_type: normalizeDT(t.dataType),
      address: String(t.address ?? "").trim(),
      ratio: String(t.ratio ?? "1").trim() || "1",
    }));

    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM collection_unit_tags WHERE collection_unit_id = $1", [unitId]);
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        await client.query(
          `INSERT INTO collection_unit_tags (collection_unit_id, sort_order, tag_id, data_type, address, ratio)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [unitId, i, t.tag_id, t.data_type, t.address, t.ratio]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, count: tags.length });
  })
);

app.get(
  "/api/collection-units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { rows } = await pgPool.query("SELECT * FROM collection_units WHERE id = $1", [req.params.id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "수집부를 찾을 수 없습니다." });
    res.json(rowToCollectionUnit(row));
  })
);

app.post(
  "/api/collection-units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      process_name,
      process_code,
      device_name,
      device_ip,
      device_port,
      status,
      auto_control,
      in_use,
    } = req.body ?? {};
    const name = String(process_name ?? "").trim();
    const code = String(process_code ?? "").trim();
    const deviceName = String(device_name ?? "").trim();
    const deviceIp = String(device_ip ?? "").trim();
    const devicePort = String(device_port ?? "").trim();
    if (!name || !code || !deviceName || !deviceIp || !devicePort) {
      return res.status(400).json({ error: "공정/디바이스/IP/Port는 필수입니다." });
    }
    const st = status === "비정상" ? "비정상" : "정상";
    const auto = auto_control === "OFF" ? "OFF" : "ON";
    const inUse = parseCollectionInUse(in_use);
    try {
      const { rows } = await pgPool.query(
        `INSERT INTO collection_units
         (process_name, process_code, device_name, device_ip, device_port, status, auto_control, in_use)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [name, code, deviceName, deviceIp, devicePort, st, auto, inUse]
      );
      res.status(201).json(rowToCollectionUnit(rows[0]));
    } catch (e) {
      if (e.code === "23505") {
        return res.status(409).json({ error: "이미 등록된 공정코드입니다." });
      }
      throw e;
    }
  })
);

app.put(
  "/api/collection-units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: existRows } = await pgPool.query("SELECT id FROM collection_units WHERE id = $1", [id]);
    if (!existRows[0]) {
      return res.status(404).json({ error: "수집부를 찾을 수 없습니다." });
    }
    const body = req.body ?? {};
    const { device_name, device_ip, device_port, in_use } = body;
    const deviceName = String(device_name ?? "").trim();
    const deviceIp = String(device_ip ?? "").trim();
    const devicePort = String(device_port ?? "").trim();
    if (!deviceName || !deviceIp || !devicePort) {
      return res.status(400).json({ error: "공정/디바이스/IP/Port는 필수입니다." });
    }
    const hasInUse = Object.prototype.hasOwnProperty.call(body, "in_use");
    try {
      const { rows } = hasInUse
        ? await pgPool.query(
            `UPDATE collection_units
             SET device_name = $1, device_ip = $2, device_port = $3, in_use = $4
             WHERE id = $5
             RETURNING *`,
            [deviceName, deviceIp, devicePort, parseCollectionInUse(in_use), id]
          )
        : await pgPool.query(
            `UPDATE collection_units
             SET device_name = $1, device_ip = $2, device_port = $3
             WHERE id = $4
             RETURNING *`,
            [deviceName, deviceIp, devicePort, id]
          );
      res.json(rowToCollectionUnit(rows[0]));
    } catch (e) {
      if (e.code === "23505") {
        return res.status(409).json({ error: "이미 등록된 공정코드입니다." });
      }
      throw e;
    }
  })
);

app.delete(
  "/api/collection-units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    await pgPool.query("DELETE FROM collection_unit_tags WHERE collection_unit_id = $1", [req.params.id]);
    const { rowCount } = await pgPool.query("DELETE FROM collection_units WHERE id = $1", [req.params.id]);
    if (rowCount === 0) {
      return res.status(404).json({ error: "수집부를 찾을 수 없습니다." });
    }
    res.status(204).send();
  })
);

app.get(
  "/api/model-units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const offset = (page - 1) * pageSize;

    let where = "1=1";
    const params = [];
    if (q) {
      where += " AND (model_name LIKE ? OR model_code LIKE ?)";
      params.push(`%${q}%`, `%${q}%`);
    }

    const [countRows] = await mysqlPool.query(
      `SELECT COUNT(*) AS c FROM model_units WHERE ${where}`,
      params
    );
    const total = Number(countRows[0].c);

    const [listRows] = await mysqlPool.query(
      `SELECT * FROM model_units WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      items: listRows.map(rowToModelUnit),
      total,
      page,
      pageSize,
    });
  })
);

app.get(
  "/api/model-units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });
    res.json(rowToModelUnit(row));
  })
);

app.post(
  "/api/model-units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const m = normalizeModelBody(req.body, { partial: false });
    if (!m.model_name || !m.model_code) {
      return res.status(400).json({ error: "모델명과 모델ID는 필수입니다." });
    }
    try {
      const [result] = await mysqlPool.query(
        `INSERT INTO model_units (
          model_name, model_code, status, auto_learn, auto_control,
          learning_cycle, resample_size, interpolate, fill_method, model_output_path,
          model_generated_at, control_tag_id, min_allowed, max_allowed, change_range, auto_apply, memo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [
          m.model_name,
          m.model_code,
          m.status,
          m.auto_learn,
          m.auto_control,
          m.learning_cycle,
          m.resample_size,
          m.interpolate,
          m.fill_method,
          m.model_output_path,
          m.control_tag_id || m.model_code,
          m.min_allowed,
          m.max_allowed,
          m.change_range,
          m.auto_apply,
          m.memo,
        ]
      );
      const insertId = result.insertId;
      const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [insertId]);
      res.status(201).json(rowToModelUnit(rows[0]));
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "이미 등록된 모델ID입니다." });
      }
      throw e;
    }
  })
);

app.put(
  "/api/model-units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [exist] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!exist[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

    const m = normalizeModelBody(req.body, { partial: false });
    if (!m.model_name || !m.model_code) {
      return res.status(400).json({ error: "모델명과 모델ID는 필수입니다." });
    }
    const bumpGen = Boolean(req.body?.bump_model_generated_at);

    try {
      await mysqlPool.query(
        `UPDATE model_units SET
          model_name = ?, model_code = ?, status = ?, auto_learn = ?, auto_control = ?,
          learning_cycle = ?, resample_size = ?, interpolate = ?, fill_method = ?, model_output_path = ?,
          control_tag_id = ?, min_allowed = ?, max_allowed = ?, change_range = ?, auto_apply = ?, memo = ?,
          model_generated_at = IF(?, NOW(), model_generated_at)
        WHERE id = ?`,
        [
          m.model_name,
          m.model_code,
          m.status,
          m.auto_learn,
          m.auto_control,
          m.learning_cycle,
          m.resample_size,
          m.interpolate,
          m.fill_method,
          m.model_output_path,
          m.control_tag_id || m.model_code,
          m.min_allowed,
          m.max_allowed,
          m.change_range,
          m.auto_apply,
          m.memo,
          bumpGen ? 1 : 0,
          id,
        ]
      );
      const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
      res.json(rowToModelUnit(rows[0]));
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "이미 등록된 모델ID입니다." });
      }
      throw e;
    }
  })
);

app.post(
  "/api/model-units/:id/refresh-files",
  requireAuth,
  modelUpload.array("modelFiles"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [existRows] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!existRows[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ error: "업로드할 파일을 선택하세요." });
    }

    let body;
    try {
      body = JSON.parse(String(req.body?.modelBody ?? "{}"));
    } catch {
      return res.status(400).json({ error: "모델 정보 형식이 올바르지 않습니다." });
    }
    const m = normalizeModelBody(body, { partial: false });
    if (!m.model_name || !m.model_code) {
      return res.status(400).json({ error: "모델명과 모델ID는 필수입니다." });
    }

    const ts = backupSuffix();
    const uploaded = [];
    const backedUp = [];
    const tempPaths = [];
    if (MODEL_FILE_USE_REMOTE) {
      if (!MODEL_FILE_REMOTE_USER) {
        return res
          .status(500)
          .json({ error: "MODEL_FILE_REMOTE_USER 설정이 필요합니다." });
      }
      const { sftp, cfg } = createSftpClient();
      try {
        await sftp.connect(cfg);
        await sftp.mkdir(MODEL_FILE_TARGET_DIR, true);
        await sftp.mkdir(MODEL_FILE_BACKUP_DIR, true);

        for (const file of files) {
          tempPaths.push(file.path);
          const name = path.basename(file.originalname || file.filename || "");
          if (!name) continue;
          const remoteTargetPath = path.posix.join(MODEL_FILE_TARGET_DIR, name);
          const remoteBackupPath = path.posix.join(MODEL_FILE_BACKUP_DIR, `${name}.${ts}.bak`);
          const exists = await sftp.exists(remoteTargetPath);
          if (exists) {
            await sftp.rename(remoteTargetPath, remoteBackupPath);
            backedUp.push(path.posix.basename(remoteBackupPath));
          }
          await sftp.put(file.path, remoteTargetPath);
          uploaded.push(name);
        }
      } finally {
        await sftp.end().catch(() => {});
        await Promise.allSettled(tempPaths.map((p) => fsp.unlink(p).catch(() => {})));
      }
    } else {
      await fsp.mkdir(MODEL_FILE_TARGET_DIR, { recursive: true });
      await fsp.mkdir(MODEL_FILE_BACKUP_DIR, { recursive: true });
      try {
        for (const file of files) {
          tempPaths.push(file.path);
          const name = path.basename(file.originalname || file.filename || "");
          if (!name) continue;
          const targetPath = path.join(MODEL_FILE_TARGET_DIR, name);
          if (fs.existsSync(targetPath)) {
            const backupPath = path.join(MODEL_FILE_BACKUP_DIR, `${name}.${ts}.bak`);
            await fsp.copyFile(targetPath, backupPath);
            backedUp.push(path.basename(backupPath));
          }
          await fsp.copyFile(file.path, targetPath);
          uploaded.push(name);
        }
      } finally {
        await Promise.allSettled(tempPaths.map((p) => fsp.unlink(p).catch(() => {})));
      }
    }

    await mysqlPool.query(
      `UPDATE model_units SET
        model_name = ?, model_code = ?, status = ?, auto_learn = ?, auto_control = ?,
        learning_cycle = ?, resample_size = ?, interpolate = ?, fill_method = ?, model_output_path = ?,
        control_tag_id = ?, min_allowed = ?, max_allowed = ?, change_range = ?, auto_apply = ?, memo = ?,
        model_generated_at = NOW()
      WHERE id = ?`,
      [
        m.model_name,
        m.model_code,
        m.status,
        m.auto_learn,
        m.auto_control,
        m.learning_cycle,
        m.resample_size,
        m.interpolate,
        m.fill_method,
        m.model_output_path || MODEL_FILE_TARGET_DIR,
        m.control_tag_id || m.model_code,
        m.min_allowed,
        m.max_allowed,
        m.change_range,
        m.auto_apply,
        m.memo,
        id,
      ]
    );
    const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
    res.json({
      model: rowToModelUnit(rows[0]),
      uploaded,
      backed_up: backedUp,
      target_dir: MODEL_FILE_TARGET_DIR,
      backup_dir: MODEL_FILE_BACKUP_DIR,
    });
  })
);

app.delete(
  "/api/model-units/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [result] = await mysqlPool.query("DELETE FROM model_units WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "모델을 찾을 수 없습니다." });
    }
    res.status(204).send();
  })
);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "서버 오류가 발생했습니다." });
});

async function main() {
  try {
    await fsp.mkdir(UPLOAD_TEMP_DIR, { recursive: true });
    await mysqlPool.query("SELECT 1");
    await pgPool.query("SELECT 1");
    await seedMysqlIfEmpty();
    await ensureModelUnitsTable();
    await seedModelUnitsIfEmpty();
    await seedPostgresIfEmpty();
  } catch (e) {
    console.error("[DB] 연결 실패 — MySQL·PostgreSQL 설정과 db/mysql, db/postgresql 스키마를 확인하세요.");
    console.error(e);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`회원 CMS: http://localhost:${PORT}`);
  });
}

main();
