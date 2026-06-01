require("dotenv").config();
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
const { Client: SshClient } = require("ssh2");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const { executePlcModbusWrite } = require("./lib/plc-modbus-write");

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
const MODEL_FILE_TARGET_DIR = process.env.MODEL_FILE_TARGET_DIR || "/Users/deiludenseu/Documents/times/new/models";
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
const MODEL_FILE_USE_REMOTE = false; // 로컬 파일 업로드로 전환 (SFTP 권한 문제 해결)
const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), "agent-flow-model-upload");
const AI_PYTHON_BIN = process.env.AI_PYTHON_BIN || "/usr/bin/python3";
const AI_PREDICT_SCRIPT_PATH =
  process.env.AI_PREDICT_SCRIPT_PATH || "/Users/deiludenseu/Documents/times/new/predict_all_gru_models.py";
const AI_RUN_ON_REMOTE =
  String(process.env.AI_RUN_ON_REMOTE || (MODEL_FILE_USE_REMOTE ? "true" : "false")).toLowerCase() ===
  "true";
const AI_REMOTE_WORKDIR = process.env.AI_REMOTE_WORKDIR || "/data/vdb/times/new";
const AI_REMOTE_PYTHON_BIN = process.env.AI_REMOTE_PYTHON_BIN || "python3";
const AI_REMOTE_SCRIPT_PATH =
  process.env.AI_REMOTE_SCRIPT_PATH || "/data/vdb/times/new/predict_all_gru_models.py";
const AI_REMOTE_ENV_NAME = process.env.AI_REMOTE_ENV_NAME || "times";
const AI_REMOTE_ENV_TYPE = String(process.env.AI_REMOTE_ENV_TYPE || "conda").toLowerCase();
const AI_REMOTE_VENV_ACTIVATE = process.env.AI_REMOTE_VENV_ACTIVATE || "";
const POSTGRES_SOCKET_DIR = "/data/vdb/times/postgresql-16.2";
/** 자정(00:00:00) 실행을 잡기 위한 스케줄러 폴링 간격 */
const AUTO_LEARN_SCHEDULER_TICK_MS = Math.max(
  5_000,
  Number.parseInt(process.env.AUTO_LEARN_SCHEDULER_TICK_MS || "10000", 10) || 10_000
);
const AUTO_CONTROL_LOCAL_WORKDIR =
  process.env.AUTO_CONTROL_LOCAL_WORKDIR || "/Users/deiludenseu/Documents/times/new";
const AUTO_CONTROL_PYTHON_BIN = process.env.AUTO_CONTROL_PYTHON_BIN || "python3";
const AUTO_CONTROL_ENV_NAME = process.env.AUTO_CONTROL_ENV_NAME || "times";
const AUTO_CONTROL_ENV_TYPE = String(process.env.AUTO_CONTROL_ENV_TYPE || "conda").toLowerCase();
const AUTO_CONTROL_VENV_ACTIVATE = process.env.AUTO_CONTROL_VENV_ACTIVATE || "";
const AUTO_CONTROL_REMOTE_WORKDIR = process.env.AUTO_CONTROL_REMOTE_WORKDIR || AI_REMOTE_WORKDIR;
const AUTO_CONTROL_REMOTE_PYTHON_BIN = process.env.AUTO_CONTROL_REMOTE_PYTHON_BIN || AI_REMOTE_PYTHON_BIN;
const AUTO_CONTROL_REMOTE_ENV_NAME = process.env.AUTO_CONTROL_REMOTE_ENV_NAME || "times";
const AUTO_CONTROL_REMOTE_ENV_TYPE = String(
  process.env.AUTO_CONTROL_REMOTE_ENV_TYPE || AI_REMOTE_ENV_TYPE || "conda"
).toLowerCase();
const AUTO_CONTROL_REMOTE_VENV_ACTIVATE =
  process.env.AUTO_CONTROL_REMOTE_VENV_ACTIVATE || AI_REMOTE_VENV_ACTIVATE || "";
const AUTO_CONTROL_DB_HOST =
  process.env.AUTO_CONTROL_DB_HOST || process.env.DB_HOST || process.env.PGHOST || POSTGRES_SOCKET_DIR;
const AUTO_CONTROL_DB_PORT =
  process.env.AUTO_CONTROL_DB_PORT || process.env.DB_PORT || process.env.PGPORT || "";
const AUTO_CONTROL_DB_NAME =
  process.env.AUTO_CONTROL_DB_NAME || process.env.DB_NAME || process.env.PGDATABASE || "";
const AUTO_CONTROL_DB_USER =
  process.env.AUTO_CONTROL_DB_USER || process.env.DB_USER || process.env.PGUSER || "";
const AUTO_CONTROL_DB_PASSWORD =
  process.env.AUTO_CONTROL_DB_PASSWORD || process.env.DB_PASSWORD || process.env.PGPASSWORD || "";
const AI_MODEL_DIR = process.env.AI_MODEL_DIR || "/Users/deiludenseu/Documents/times/new/models";
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
  host: process.env.PGHOST || "210.109.80.110",
  port: Number(process.env.PGPORT) || 5433,
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
  table_name VARCHAR(255) NOT NULL DEFAULT '',
  plc_ip VARCHAR(255) NOT NULL DEFAULT '',
  plc_port VARCHAR(50) NOT NULL DEFAULT '',
  plc_use_value VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(50) NOT NULL DEFAULT '정상',
  auto_learn VARCHAR(10) NOT NULL DEFAULT 'ON',
  auto_control VARCHAR(10) NOT NULL DEFAULT 'ON',
  learning_cycle VARCHAR(100) NOT NULL DEFAULT '',
  resample_size VARCHAR(100) NOT NULL DEFAULT '',
  interpolate VARCHAR(10) NOT NULL DEFAULT 'on',
  fill_method VARCHAR(20) NOT NULL DEFAULT 'ffill',
  model_output_path TEXT NULL,
  model_generated_at DATETIME NULL,
  last_auto_learn_at DATETIME NULL,
  auto_learn_anchor_at DATETIME NULL,
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

const MODEL_UNIT_TAGS_DDL = `
CREATE TABLE IF NOT EXISTS model_unit_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_unit_id INT UNSIGNED NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  tag_id VARCHAR(255) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  refresh_cycle VARCHAR(100) NOT NULL DEFAULT '',
  data_type VARCHAR(20) NOT NULL DEFAULT 'DWord',
  address VARCHAR(100) NOT NULL DEFAULT '',
  ratio VARCHAR(50) NOT NULL DEFAULT '1',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_model_unit_tags_model (model_unit_id),
  CONSTRAINT fk_model_unit_tags_model_unit
    FOREIGN KEY (model_unit_id) REFERENCES model_units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function ensureModelUnitsTable() {
  await mysqlPool.query(MODEL_UNITS_DDL);
  await mysqlPool.query(
    "ALTER TABLE model_units ADD COLUMN IF NOT EXISTS table_name VARCHAR(255) NOT NULL DEFAULT '' AFTER model_code"
  );
  // plc_* 컬럼은 기존 설치에 없을 수 있어 안전하게 추가
  try {
    await mysqlPool.query(
      "ALTER TABLE model_units ADD COLUMN plc_ip VARCHAR(255) NOT NULL DEFAULT '' AFTER table_name"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  try {
    await mysqlPool.query(
      "ALTER TABLE model_units ADD COLUMN plc_port VARCHAR(50) NOT NULL DEFAULT '' AFTER plc_ip"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  try {
    await mysqlPool.query(
      "ALTER TABLE model_units ADD COLUMN plc_use_value VARCHAR(255) NOT NULL DEFAULT '' AFTER plc_port"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  try {
    await mysqlPool.query(
      "ALTER TABLE model_units ADD COLUMN last_auto_learn_at DATETIME NULL AFTER model_generated_at"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  try {
    await mysqlPool.query(
      "ALTER TABLE model_units ADD COLUMN auto_learn_anchor_at DATETIME NULL AFTER last_auto_learn_at"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  await mysqlPool.query(
    "UPDATE model_units SET auto_learn_anchor_at = NOW() WHERE auto_learn = 'ON' AND auto_learn_anchor_at IS NULL"
  );

  await mysqlPool.query(MODEL_UNIT_TAGS_DDL);
  try {
    await mysqlPool.query(
      "ALTER TABLE model_unit_tags ADD COLUMN description VARCHAR(500) NOT NULL DEFAULT '' AFTER tag_id"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
  try {
    await mysqlPool.query(
      "ALTER TABLE model_unit_tags ADD COLUMN refresh_cycle VARCHAR(100) NOT NULL DEFAULT '' AFTER description"
    );
  } catch (e) {
    if (e.code !== "ER_DUP_FIELDNAME") throw e;
  }
}

async function ensureCollectionUnitTagsSchema() {
  await pgPool.query(
    `ALTER TABLE collection_unit_tags
     ADD COLUMN IF NOT EXISTS description VARCHAR(500) NOT NULL DEFAULT ''`
  );
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
    table_name: row.table_name ?? "",
    plc_ip: row.plc_ip ?? "",
    plc_port: row.plc_port ?? "",
    plc_use_value: row.plc_use_value ?? "",
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
    last_auto_learn_at: formatModelDate(row.last_auto_learn_at),
    auto_learn_anchor_at: formatModelDate(row.auto_learn_anchor_at),
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
  if (!partial || Object.prototype.hasOwnProperty.call(b, "table_name")) {
    out.table_name = String(b.table_name ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "plc_ip")) {
    out.plc_ip = String(b.plc_ip ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "plc_port")) {
    out.plc_port = String(b.plc_port ?? "").trim();
  }
  if (!partial || Object.prototype.hasOwnProperty.call(b, "plc_use_value")) {
    out.plc_use_value = String(b.plc_use_value ?? "").trim();
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

function shellEscapeSingle(v) {
  return `'${String(v ?? "").replace(/'/g, `'\\''`)}'`;
}

function getRemoteAuthConfig() {
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
  return cfg;
}

function toLookbackDays(learningCycle) {
  const raw = String(learningCycle ?? "").trim();
  const direct = Number.parseInt(raw, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const matched = raw.match(/(\d+)/);
  if (!matched) return 30;
  const parsed = Number.parseInt(matched[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * 학습 주기 파싱
 * - 분: "7분", "7m", "30min" → N분마다 (anchor 기준)
 * - 일: "7", "7일", "7d" → N일마다 매일 00:00:00
 */
function parseLearningCycle(learningCycle) {
  const raw = String(learningCycle ?? "").trim();
  if (!raw) return { unit: "days", value: 1 };

  const minMatch = raw.match(/(\d+)\s*(m|min|분)/i);
  if (minMatch) {
    const n = Number.parseInt(minMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return { unit: "minutes", value: n };
  }

  const dayMatch = raw.match(/(\d+)\s*(d|day|일)/i);
  if (dayMatch) {
    const n = Number.parseInt(dayMatch[1], 10);
    if (Number.isFinite(n) && n > 0) return { unit: "days", value: n };
  }

  const direct = Number.parseInt(raw, 10);
  if (Number.isFinite(direct) && direct > 0) return { unit: "days", value: direct };

  return { unit: "days", value: 1 };
}

function parseLearningCycleDays(learningCycle) {
  const c = parseLearningCycle(learningCycle);
  return c.value;
}

function getAutoLearnAnchorAt(row) {
  return row.auto_learn_anchor_at || null;
}

function learningCycleToMs(cycle) {
  if (cycle.unit === "minutes") return cycle.value * 60_000;
  return cycle.value * 86_400_000;
}

function isMidnightZeroWindow() {
  const now = new Date();
  return now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() < 30;
}

function msSinceDatetime(dt) {
  if (!dt) return Number.POSITIVE_INFINITY;
  const t = new Date(dt).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Date.now() - t;
}

function getDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(x.getTime())) return null;
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function elapsedMsSince(lastAt) {
  const ms = msSinceDatetime(lastAt);
  return ms === Number.POSITIVE_INFINITY ? 0 : ms;
}

function remainingMsUntilCycle(lastAt, cycleMs) {
  const elapsed = elapsedMsSince(lastAt);
  if (!lastAt) return 0;
  return Math.max(0, cycleMs - elapsed);
}

/** auto_learn=ON 모델 1건 — 지금 학습해야 하는지 */
function shouldRunAutoLearnForModel(row, opts = {}) {
  const force = opts.force === true;
  const cycle = parseLearningCycle(row.learning_cycle);
  const cycleMs = learningCycleToMs(cycle);

  if (force) {
    return { due: true, reason: "forced", cycle, cycle_ms: cycleMs, remaining_ms: 0 };
  }

  const anchorAt = getAutoLearnAnchorAt(row);
  if (!anchorAt) {
    const waiting = {
      due: false,
      reason: "waiting_anchor",
      cycle,
      cycle_ms: cycleMs,
      remaining_ms: 0,
    };
    if (cycle.unit === "minutes") {
      waiting.cycle_minutes = cycle.value;
      waiting.remaining_minutes = cycle.value;
      waiting.runs_at = `${cycle.value}분마다`;
    } else {
      waiting.cycle_days = cycle.value;
      waiting.remaining_days = cycle.value;
      waiting.runs_at = "00:00:00";
    }
    return waiting;
  }

  if (cycle.unit === "minutes") {
    if (elapsedMsSince(anchorAt) >= cycleMs) {
      return {
        due: true,
        reason: "interval_elapsed",
        cycle,
        cycle_ms: cycleMs,
        cycle_minutes: cycle.value,
        runs_at: `${cycle.value}분마다`,
        remaining_ms: 0,
      };
    }
    const remaining = remainingMsUntilCycle(anchorAt, cycleMs);
    return {
      due: false,
      reason: "cycle_not_elapsed",
      cycle,
      cycle_ms: cycleMs,
      cycle_minutes: cycle.value,
      runs_at: `${cycle.value}분마다`,
      remaining_ms: remaining,
      remaining_minutes: Math.ceil(remaining / 60_000),
    };
  }

  if (!isMidnightZeroWindow()) {
    return {
      due: false,
      reason: "not_midnight",
      cycle,
      cycle_ms: cycleMs,
      cycle_days: cycle.value,
      runs_at: "00:00:00",
      remaining_ms: remainingMsUntilCycle(anchorAt, cycleMs),
      remaining_days: Math.ceil(remainingMsUntilCycle(anchorAt, cycleMs) / 86_400_000),
    };
  }

  const now = new Date();
  const todayKey = getDateKey(now);
  const lastTrainKey = row.last_auto_learn_at ? getDateKey(row.last_auto_learn_at) : null;
  if (lastTrainKey === todayKey) {
    return { due: false, reason: "already_ran_today", cycle, cycle_ms: cycleMs, cycle_days: cycle.value };
  }
  if (elapsedMsSince(anchorAt) >= cycleMs) {
    return {
      due: true,
      reason: "midnight_cycle",
      cycle,
      cycle_ms: cycleMs,
      cycle_days: cycle.value,
      runs_at: "00:00:00",
      remaining_ms: 0,
    };
  }
  const remaining = remainingMsUntilCycle(anchorAt, cycleMs);
  return {
    due: false,
    reason: "cycle_not_elapsed",
    cycle,
    cycle_ms: cycleMs,
    cycle_days: cycle.value,
    runs_at: "00:00:00",
    remaining_ms: remaining,
    remaining_days: Math.ceil(remaining / 86_400_000),
  };
}

function buildAutoLearnScheduleInfo(model) {
  if (!model || model.auto_learn !== "ON") return null;
  const cycle = parseLearningCycle(model.learning_cycle);
  if (cycle.unit === "minutes") {
    return {
      unit: "minutes",
      cycle_minutes: cycle.value,
      runs_at: `${cycle.value}분마다`,
      pipeline: "manual-train",
      last_auto_learn_at: model.last_auto_learn_at,
      auto_learn_anchor_at: model.auto_learn_anchor_at,
    };
  }
  return {
    unit: "days",
    cycle_days: cycle.value,
    runs_at: "00:00:00",
    pipeline: "manual-train",
    last_auto_learn_at: model.last_auto_learn_at,
    auto_learn_anchor_at: model.auto_learn_anchor_at,
  };
}

/** 모델별 학습 중복 실행 방지 (수동·자동 공통) */
const modelTrainingLocks = new Set();
const TRAINING_LOG_MAX_CHARS = 32_000;

function appendTrainingLogBuffer(buf, chunk) {
  const next = buf + String(chunk);
  return next.length > TRAINING_LOG_MAX_CHARS ? next.slice(-TRAINING_LOG_MAX_CHARS) : next;
}

const MODEL_FILE_BY_TABLE = {
  air_cleaner_table: "air_cleaner_gru_forecast.pth",
  table_air_cleaner: "air_cleaner_gru_forecast.pth",
  capper_table: "capper_gru_forecast.pth",
  table_capper: "capper_gru_forecast.pth",
  carton_packer_table: "carton_packer_gru_forecast.pth",
  table_carton_packer: "carton_packer_gru_forecast.pth",
  chiller_table: "chiller_gru_forecast.pth",
  table_chiller: "chiller_gru_forecast.pth",
  filler_table: "filler_gru_forecast.pth",
  table_filler: "filler_gru_forecast.pth",
  robot_packer_table: "robot_packer_gru_forecast.pth",
  table_robot_packer: "robot_packer_gru_forecast.pth",
  shrink_tunnel_table: "shrink_tunnel_gru_forecast.pth",
  table_shrink_tunnel: "shrink_tunnel_gru_forecast.pth",
};

function inferExpectedModelFile(model) {
  const tableName = String(model?.table_name ?? "").trim().toLowerCase();
  if (tableName && MODEL_FILE_BY_TABLE[tableName]) return MODEL_FILE_BY_TABLE[tableName];
  const code = String(model?.model_code ?? "").trim().toLowerCase();
  if (code.endsWith(".pth")) return code;
  return code ? `${code}_gru_forecast.pth` : "";
}

async function verifyModelArtifactExists(model) {
  const modelFile = inferExpectedModelFile(model);
  if (!modelFile) {
    return { ok: false, model_file: "", path: "", message: "예상 모델 파일명을 계산할 수 없습니다." };
  }
  if (AI_RUN_ON_REMOTE) {
    const cfg = getRemoteAuthConfig();
    const modelPath = path.posix.join(AI_MODEL_DIR, modelFile);
    const command = `[ -f ${shellEscapeSingle(modelPath)} ] && echo EXISTS || echo MISSING`;
    return await new Promise((resolve, reject) => {
      const conn = new SshClient();
      let stdout = "";
      let stderr = "";
      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) return reject(err);
            stream.on("data", (d) => {
              stdout += String(d);
            });
            stream.stderr.on("data", (d) => {
              stderr += String(d);
            });
            stream.on("close", () => {
              conn.end();
              const ok = stdout.includes("EXISTS");
              resolve({
                ok,
                model_file: modelFile,
                path: modelPath,
                stdout_tail: stdout.slice(-1000),
                stderr_tail: stderr.slice(-1000),
                remote: true,
              });
            });
          });
        })
        .on("error", reject)
        .connect(cfg);
    });
  }

  const modelPath = path.join(AI_MODEL_DIR, modelFile);
  return {
    ok: fs.existsSync(modelPath),
    model_file: modelFile,
    path: modelPath,
    remote: false,
  };
}

async function runAiPredictScript(model) {
  const lookbackDays = toLookbackDays(model.learning_cycle);
  const env = {
    AF_MODEL_NAME: String(model.model_name ?? ""),
    AF_MODEL_CODE: String(model.model_code ?? ""),
    AF_TABLE_NAME: String(model.table_name ?? ""),
    AF_LEARNING_CYCLE: String(model.learning_cycle ?? ""),
    AF_RESAMPLE_SIZE: String(model.resample_size ?? ""),
    AF_INTERPOLATE: String(model.interpolate ?? ""),
    AF_FILL_METHOD: String(model.fill_method ?? ""),
    AF_MODEL_OUTPUT_PATH: String(model.model_output_path ?? ""),
    AF_CONTROL_TAG_ID: String(model.control_tag_id ?? ""),
  };

  if (AI_RUN_ON_REMOTE) {
    const cfg = getRemoteAuthConfig();
    const envExports = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shellEscapeSingle(v)}`)
      .join(" && ");

    let runCommand;
    if (AI_REMOTE_ENV_TYPE === "venv") {
      const activatePath =
        AI_REMOTE_VENV_ACTIVATE || `${AI_REMOTE_WORKDIR}/${AI_REMOTE_ENV_NAME}/bin/activate`;
      runCommand = `source ${shellEscapeSingle(activatePath)} && ${shellEscapeSingle(
        AI_REMOTE_PYTHON_BIN
      )} ${shellEscapeSingle(AI_REMOTE_SCRIPT_PATH)} ${lookbackDays}`;
    } else if (AI_REMOTE_ENV_TYPE === "local") {
      // Use local Python without any environment activation
      runCommand = `${shellEscapeSingle(AI_REMOTE_PYTHON_BIN)} ${shellEscapeSingle(
        AI_REMOTE_SCRIPT_PATH
      )} ${lookbackDays}`;
    } else {
      // Default to conda (fallback for remote environments)
      runCommand =
        `source /data/vdb/miniconda3/etc/profile.d/conda.sh && conda activate ${shellEscapeSingle(
          AI_REMOTE_ENV_NAME
        )} && ${shellEscapeSingle(AI_REMOTE_PYTHON_BIN)} ${shellEscapeSingle(
          AI_REMOTE_SCRIPT_PATH
        )} ${lookbackDays}`;
    }
    const command = [
      `cd ${shellEscapeSingle(AI_REMOTE_WORKDIR)}`,
      envExports,
      runCommand,
    ].join(" && ");

    return await new Promise((resolve, reject) => {
      const conn = new SshClient();
      let stdout = "";
      let stderr = "";
      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) return reject(err);
            stream.on("data", (d) => {
              stdout += String(d);
            });
            stream.stderr.on("data", (d) => {
              stderr += String(d);
            });
            stream.on("close", (code) => {
              conn.end();
              resolve({
                ok: code === 0,
                exit_code: code,
                lookback_days: lookbackDays,
                command,
                stdout_tail: stdout.slice(-4000),
                stderr_tail: stderr.slice(-4000),
                remote: true,
              });
            });
          });
        })
        .on("error", reject)
        .connect(cfg);
    });
  }

  if (!fs.existsSync(AI_PREDICT_SCRIPT_PATH)) {
    throw new Error(`AI 스크립트가 없습니다: ${AI_PREDICT_SCRIPT_PATH}`);
  }
  const args = [AI_PREDICT_SCRIPT_PATH, String(lookbackDays)];

  return await new Promise((resolve, reject) => {
    const child = spawn(AI_PYTHON_BIN, args, { env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exit_code: code,
        lookback_days: lookbackDays,
        command: `${AI_PYTHON_BIN} ${args.join(" ")}`,
        stdout_tail: stdout.slice(-4000),
        stderr_tail: stderr.slice(-4000),
        remote: false,
      });
    });
  });
}

function emitTrainingLog(modelId, liveLog, payload) {
  if (!liveLog || !global.broadcastTrainingLog) return;
  global.broadcastTrainingLog(String(modelId), {
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

async function runGruTrainingScript(model, opts = {}) {
  const liveLog = opts.liveLog !== false;
  const logSource = opts.logSource === "auto_learn" ? "auto_learn" : "manual";
  const tableName = String(model.table_name ?? "").trim();
  const dataDays = toLookbackDays(model.learning_cycle);
  const resampleInterval = String(model.resample_size ?? "").trim() || "1s";
  const modelId = String(model.id ?? "");
  
  // Determine training script based on table name
  let trainingScript;
  if (tableName.includes("air_cleaner")) {
    trainingScript = "train_air_cleaner_gru.py";
  } else if (tableName.includes("capper")) {
    trainingScript = "train_capper_gru.py";
  } else if (tableName.includes("carton_packer")) {
    trainingScript = "train_carton_packer_gru.py";
  } else if (tableName.includes("chiller")) {
    trainingScript = "train_chiller_gru.py";
  } else if (tableName.includes("filler")) {
    trainingScript = "train_filler_gru.py";
  } else if (tableName.includes("robot_packer")) {
    trainingScript = "train_robot_packer_gru.py";
  } else if (tableName.includes("shrink_tunnel")) {
    trainingScript = "train_shrink_tunnel_gru.py";
  } else {
    trainingScript = "train_air_cleaner_gru.py"; // fallback
  }
  
  const startMsg =
    logSource === "auto_learn"
      ? `[자동학습] GRU 모델 학습 시작: ${trainingScript}`
      : `GRU 모델 학습 시작: ${trainingScript}`;
  emitTrainingLog(modelId, liveLog, {
    type: "start",
    message: startMsg,
    script: trainingScript,
    dataDays: dataDays,
    resampleInterval: resampleInterval,
    source: logSource,
  });
  const dbEnv = {
    DB_HOST: AUTO_CONTROL_DB_HOST,
    DB_PORT: String(AUTO_CONTROL_DB_PORT || ""),
    DB_NAME: AUTO_CONTROL_DB_NAME,
    DB_USER: AUTO_CONTROL_DB_USER,
    DB_PASSWORD: AUTO_CONTROL_DB_PASSWORD,
  };

  if (AI_RUN_ON_REMOTE) {
    const cfg = getRemoteAuthConfig();
    const envExports = Object.entries(dbEnv)
      .filter(([, v]) => String(v ?? "").trim() !== "")
      .map(([k, v]) => `export ${k}=${shellEscapeSingle(v)}`)
      .join(" && ");
    
    let runCommand;
    if (AUTO_CONTROL_REMOTE_ENV_TYPE === "venv") {
      const activatePath =
        AUTO_CONTROL_REMOTE_VENV_ACTIVATE ||
        `${AUTO_CONTROL_REMOTE_WORKDIR}/${AUTO_CONTROL_REMOTE_ENV_NAME}/bin/activate`;
      runCommand = `source ${shellEscapeSingle(activatePath)} && ${shellEscapeSingle(
        AUTO_CONTROL_REMOTE_PYTHON_BIN
      )} training/${trainingScript}`;
    } else if (AUTO_CONTROL_REMOTE_ENV_TYPE === "local") {
      runCommand = `${shellEscapeSingle(AUTO_CONTROL_REMOTE_PYTHON_BIN)} training/${trainingScript}`;
    } else {
      runCommand =
        `source /data/vdb/miniconda3/etc/profile.d/conda.sh && conda activate ${shellEscapeSingle(
          AUTO_CONTROL_REMOTE_ENV_NAME
        )} && ${shellEscapeSingle(AUTO_CONTROL_REMOTE_PYTHON_BIN)} training/${trainingScript}`;
    }
    
    const lockPath = `/tmp/agent-flow-train-${modelId}.lock`;
    const inner = [`cd ${shellEscapeSingle(AUTO_CONTROL_REMOTE_WORKDIR)}`, envExports, runCommand]
      .filter(Boolean)
      .join(" && ");
    const command = [
      `find ${shellEscapeSingle(lockPath)} -mmin +180 -delete 2>/dev/null || true`,
      `flock -n ${shellEscapeSingle(lockPath)} bash -lc ${shellEscapeSingle(inner)}`,
    ].join(" && ");

    return await new Promise((resolve, reject) => {
      const conn = new SshClient();
      let stdout = "";
      let stderr = "";
      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) return reject(err);
            stream.on("data", (d) => {
              const output = String(d);
              stdout = appendTrainingLogBuffer(stdout, output);
              emitTrainingLog(modelId, liveLog, { type: "stdout", message: output, source: logSource });
            });
            stream.stderr.on("data", (d) => {
              const output = String(d);
              stderr = appendTrainingLogBuffer(stderr, output);
              emitTrainingLog(modelId, liveLog, { type: "stderr", message: output, source: logSource });
            });
            stream.on("close", (code) => {
              emitTrainingLog(modelId, liveLog, {
                type: "complete",
                message: `GRU 모델 학습 완료 (종료 코드: ${code})`,
                exitCode: code,
                success: code === 0,
                source: logSource,
              });
              conn.end();
              resolve({
                ok: code === 0,
                exit_code: code,
                command,
                training_script: trainingScript,
                data_days: dataDays,
                resample_interval: resampleInterval,
                stdout_tail: stdout.slice(-8000), // More lines for training logs
                stderr_tail: stderr.slice(-4000),
                remote: true,
              });
            });
          });
        })
        .on("error", reject)
        .connect(cfg);
    });
  }

  let command;
  if (AUTO_CONTROL_ENV_TYPE === "venv") {
    const activatePath =
      AUTO_CONTROL_VENV_ACTIVATE || `${AUTO_CONTROL_LOCAL_WORKDIR}/${AUTO_CONTROL_ENV_NAME}/bin/activate`;
    command = `source ${shellEscapeSingle(activatePath)} && ${shellEscapeSingle(
      AUTO_CONTROL_PYTHON_BIN
    )} training/${trainingScript}`;
  } else if (AUTO_CONTROL_ENV_TYPE === "local") {
    command = `${shellEscapeSingle(AUTO_CONTROL_PYTHON_BIN)} training/${trainingScript}`;
  } else {
    command =
      `source /opt/homebrew/Caskroom/miniconda/base/etc/profile.d/conda.sh && conda activate ${shellEscapeSingle(
        AUTO_CONTROL_ENV_NAME
      )} && ${shellEscapeSingle(AUTO_CONTROL_PYTHON_BIN)} training/${trainingScript}`;
  }

  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: AUTO_CONTROL_LOCAL_WORKDIR,
      env: { ...process.env, ...dbEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const output = String(chunk);
      stdout = appendTrainingLogBuffer(stdout, output);
      emitTrainingLog(modelId, liveLog, { type: "stdout", message: output, source: logSource });
    });
    child.stderr.on("data", (chunk) => {
      const output = String(chunk);
      stderr = appendTrainingLogBuffer(stderr, output);
      emitTrainingLog(modelId, liveLog, { type: "stderr", message: output, source: logSource });
    });
    child.on("error", reject);
    child.on("close", (code) => {
      emitTrainingLog(modelId, liveLog, {
        type: "complete",
        message: `GRU 모델 학습 완료 (종료 코드: ${code})`,
        exitCode: code,
        success: code === 0,
        source: logSource,
      });
      
      resolve({
        ok: code === 0,
        exit_code: code,
        command,
        training_script: trainingScript,
        data_days: dataDays,
        resample_interval: resampleInterval,
        stdout_tail: stdout.slice(-8000), // More lines for training logs
        stderr_tail: stderr.slice(-4000),
        remote: false,
      });
    });
  });
}

/** 수동 학습 버튼과 동일: runGruTrainingScript → DB 갱신 */
async function executeModelTraining(modelId, opts = {}) {
  const id = Number(modelId);
  if (modelTrainingLocks.has(id)) {
    const err = new Error(`모델 ${id} 학습이 이미 진행 중입니다.`);
    err.code = "TRAINING_IN_PROGRESS";
    throw err;
  }
  modelTrainingLocks.add(id);
  try {
    const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
    if (!rows[0]) {
      const err = new Error("모델을 찾을 수 없습니다.");
      err.status = 404;
      throw err;
    }
    const model = rowToModelUnit(rows[0]);
    const trainingRun = await runGruTrainingScript(model, {
      liveLog: opts.liveLog !== false,
      logSource: opts.logSource,
    });
    if (trainingRun.ok) {
      await mysqlPool.query(
        `UPDATE model_units SET
          model_generated_at = NOW(),
          last_auto_learn_at = NOW(),
          auto_learn_anchor_at = NOW()
        WHERE id = ?`,
        [id]
      );
    }
    const [updated] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
    return { model: rowToModelUnit(updated[0]), training_run: trainingRun };
  } finally {
    modelTrainingLocks.delete(id);
  }
}

/** 자동학습: due 시 백그라운드 실행 (스케줄러 tick이 학습 완료까지 막히지 않음) */
function queueAutoLearnTraining(modelId, meta = {}) {
  const id = Number(modelId);
  if (modelTrainingLocks.has(id)) return false;

  const label = meta.label || `모델 ${id}`;
  console.log(`[자동학습] ${label} 학습 시작 (백그라운드)`);

  void executeModelTraining(id, { liveLog: true, logSource: "auto_learn" })
    .then((result) => {
      const run = result.training_run || {};
      if (run.ok) {
        console.log(`[자동학습] ${label} 학습 완료 (code=${run.exit_code})`);
      } else {
        console.error(
          `[자동학습] ${label} 학습 실패 (code=${run.exit_code}):`,
          run.stderr_tail || run.stdout_tail || ""
        );
      }
    })
    .catch((e) => {
      if (e.code === "TRAINING_IN_PROGRESS") return;
      console.error(`[자동학습] ${label} 오류:`, e.message || e);
    });

  return true;
}

async function tickAutoLearnScheduler(opts = {}) {
  const force = opts.force === true;
  const wait = opts.wait === true || force;
  const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE auto_learn = 'ON'");
  const ran = [];
  const checked_at = new Date().toISOString();

  for (const row of rows) {
    const id = row.id;
    const schedule = shouldRunAutoLearnForModel(row, { force });

    if (modelTrainingLocks.has(id)) {
      ran.push({ id, skipped: true, reason: "already_running", due: schedule.due });
      continue;
    }

    if (!schedule.due) {
      ran.push({
        id,
        skipped: true,
        reason: schedule.reason,
        remaining_minutes: schedule.remaining_minutes,
        remaining_days: schedule.remaining_days,
        last_auto_learn_at: formatModelDate(row.last_auto_learn_at),
        learning_cycle: row.learning_cycle,
      });
      continue;
    }

    const cycleLabel =
      schedule.cycle?.unit === "minutes"
        ? `${schedule.cycle_minutes ?? schedule.cycle?.value}분`
        : `${schedule.cycle_days ?? schedule.cycle?.value}일`;
    const whenLabel = schedule.cycle?.unit === "minutes" ? "주기경과" : "00:00:00";

    if (wait) {
      try {
        console.log(`[자동학습] ${cycleLabel}, ${whenLabel}, ${schedule.reason} (동기 실행)`);
        const { training_run: trainingRun } = await executeModelTraining(id, {
          liveLog: true,
          logSource: "auto_learn",
        });
        ran.push({
          id,
          ok: trainingRun.ok,
          exit_code: trainingRun.exit_code,
          forced: force,
          reason: schedule.reason,
        });
      } catch (e) {
        if (e.code === "TRAINING_IN_PROGRESS") {
          ran.push({ id, skipped: true, reason: "already_running" });
        } else {
          ran.push({ id, ok: false, error: String(e.message || e) });
        }
      }
      continue;
    }

    const started = queueAutoLearnTraining(id, { label: `${id} (${cycleLabel}, ${whenLabel})` });
    ran.push({
      id,
      started,
      reason: schedule.reason,
      cycle_label: cycleLabel,
    });
  }

  return { ran, forced: force, wait, checked_at };
}

function startAutoLearnScheduler() {
  setInterval(() => {
    tickAutoLearnScheduler().catch((e) => console.error("[자동학습 스케줄러]", e));
  }, AUTO_LEARN_SCHEDULER_TICK_MS);
  console.log(
    `[자동학습] 스케줄러 시작 (${AUTO_LEARN_SCHEDULER_TICK_MS / 1000}s tick) — 분: N분마다 / 일: 매일 00:00:00`
  );
}

async function runSpecificPredictScript(model) {
  const modelFile = inferExpectedModelFile(model);
  if (!modelFile) {
    throw new Error("자동 제어용 모델 파일명을 계산할 수 없습니다.");
  }

  const dataDays = toLookbackDays(model.learning_cycle);
  const tableName = String(model.table_name ?? "").trim();
  const resampleInterval = String(model.resample_size ?? "").trim() || "1s";
  const payload = {
    model_file: modelFile,
    table_name: tableName,
    data_days: dataDays,
    resample_interval: resampleInterval,
    control_tag_id: String(model.control_tag_id ?? ""),
    min_allowed: String(model.min_allowed ?? ""),
    max_allowed: String(model.max_allowed ?? ""),
    change_range: String(model.change_range ?? ""),
    auto_apply: String(model.auto_apply ?? ""),
  };
  const payloadJson = JSON.stringify(payload);

  const inlineCode = [
    "import json, sys",
    "from pathlib import Path",
    "sys.path.append(str(Path.cwd()))",
    "from predict_specific_gru_model import predict_with_model",
    "payload = json.loads(sys.argv[1])",
    "result = predict_with_model(",
    "    model_file=payload['model_file'],",
    "    table_name=payload.get('table_name') or None,",
    "    data_days=int(payload.get('data_days') or 30),",
    "    resample_interval=payload.get('resample_interval') or '1s'",
    ")",
    "print(json.dumps({'success': True, 'payload': payload, 'data': result}, ensure_ascii=False))",
  ].join("\n");
  const dbEnv = {
    DB_HOST: AUTO_CONTROL_DB_HOST,
    DB_PORT: String(AUTO_CONTROL_DB_PORT || ""),
    DB_NAME: AUTO_CONTROL_DB_NAME,
    DB_USER: AUTO_CONTROL_DB_USER,
    DB_PASSWORD: AUTO_CONTROL_DB_PASSWORD,
  };

  if (AI_RUN_ON_REMOTE) {
    const cfg = getRemoteAuthConfig();
    const envExports = Object.entries(dbEnv)
      .filter(([, v]) => String(v ?? "").trim() !== "")
      .map(([k, v]) => `export ${k}=${shellEscapeSingle(v)}`)
      .join(" && ");
    let runCommand;
    if (AUTO_CONTROL_REMOTE_ENV_TYPE === "venv") {
      const activatePath =
        AUTO_CONTROL_REMOTE_VENV_ACTIVATE ||
        `${AUTO_CONTROL_REMOTE_WORKDIR}/${AUTO_CONTROL_REMOTE_ENV_NAME}/bin/activate`;
      runCommand = `source ${shellEscapeSingle(activatePath)} && ${shellEscapeSingle(
        AUTO_CONTROL_REMOTE_PYTHON_BIN
      )} -c ${shellEscapeSingle(inlineCode)} ${shellEscapeSingle(payloadJson)}`;
    } else if (AUTO_CONTROL_REMOTE_ENV_TYPE === "local") {
      // Use local Python without any environment activation
      runCommand = `${shellEscapeSingle(AUTO_CONTROL_REMOTE_PYTHON_BIN)} -c ${shellEscapeSingle(
        inlineCode
      )} ${shellEscapeSingle(payloadJson)}`;
    } else {
      // Default to conda (fallback for remote environments)
      runCommand =
        `source /data/vdb/miniconda3/etc/profile.d/conda.sh && conda activate ${shellEscapeSingle(
          AUTO_CONTROL_REMOTE_ENV_NAME
        )} && ${shellEscapeSingle(AUTO_CONTROL_REMOTE_PYTHON_BIN)} -c ${shellEscapeSingle(
          inlineCode
        )} ${shellEscapeSingle(payloadJson)}`;
    }
    const command = [
      `cd ${shellEscapeSingle(AUTO_CONTROL_REMOTE_WORKDIR)}`,
      envExports,
      runCommand,
    ]
      .filter(Boolean)
      .join(" && ");

    return await new Promise((resolve, reject) => {
      const conn = new SshClient();
      let stdout = "";
      let stderr = "";
      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) return reject(err);
            stream.on("data", (d) => {
              stdout += String(d);
            });
            stream.stderr.on("data", (d) => {
              stderr += String(d);
            });
            stream.on("close", (code) => {
              conn.end();
              resolve({
                ok: code === 0,
                exit_code: code,
                command,
                model_file: modelFile,
                data_days: dataDays,
                resample_interval: resampleInterval,
                stdout_tail: stdout.slice(-4000),
                stderr_tail: stderr.slice(-4000),
                remote: true,
              });
            });
          });
        })
        .on("error", reject)
        .connect(cfg);
    });
  }

  let command;
  if (AUTO_CONTROL_ENV_TYPE === "venv") {
    const activatePath =
      AUTO_CONTROL_VENV_ACTIVATE || `${AUTO_CONTROL_LOCAL_WORKDIR}/${AUTO_CONTROL_ENV_NAME}/bin/activate`;
    command = `source ${shellEscapeSingle(activatePath)} && ${shellEscapeSingle(
      AUTO_CONTROL_PYTHON_BIN
    )} -c ${shellEscapeSingle(inlineCode)} ${shellEscapeSingle(payloadJson)}`;
  } else if (AUTO_CONTROL_ENV_TYPE === "local") {
    // Use local Python without any environment activation
    command = `${shellEscapeSingle(AUTO_CONTROL_PYTHON_BIN)} -c ${shellEscapeSingle(
      inlineCode
    )} ${shellEscapeSingle(payloadJson)}`;
  } else {
    // Default to conda (fallback for remote environments)
    command =
      `source /opt/homebrew/Caskroom/miniconda/base/etc/profile.d/conda.sh && conda activate ${shellEscapeSingle(
        AUTO_CONTROL_ENV_NAME
      )} && ${shellEscapeSingle(AUTO_CONTROL_PYTHON_BIN)} -c ${shellEscapeSingle(
        inlineCode
      )} ${shellEscapeSingle(payloadJson)}`;
  }

  return await new Promise((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: AUTO_CONTROL_LOCAL_WORKDIR,
      env: { ...process.env, ...dbEnv },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        exit_code: code,
        command,
        model_file: modelFile,
        data_days: dataDays,
        resample_interval: resampleInterval,
        stdout_tail: stdout.slice(-4000),
        stderr_tail: stderr.slice(-4000),
        remote: false,
      });
    });
  });
}

function createSftpClient() {
  const sftp = new SftpClient();
  const cfg = getRemoteAuthConfig();
  return { sftp, cfg };
}

async function seedModelUnitsIfEmpty() {
  const [rows] = await mysqlPool.query("SELECT COUNT(*) AS c FROM model_units");
  const c = Number(rows[0].c);
  if (c === 0) {
    await mysqlPool.query(
      `INSERT INTO model_units (
        model_name, model_code, table_name, status, auto_learn, auto_control,
        learning_cycle, resample_size, interpolate, fill_method,
        control_tag_id, min_allowed, max_allowed, change_range, auto_apply,
        model_generated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        "에어크리너",
        "TAC30201_AL_00007",
        "air_cleaner_table",
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
      `SELECT tag_id, description, data_type, address, ratio FROM collection_unit_tags
       WHERE collection_unit_id = $1 ORDER BY sort_order ASC, id ASC`,
      [req.params.id]
    );
    res.json({
      tags: rows.map((r) => ({
        tag_id: r.tag_id ?? "",
        description: r.description ?? "",
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
      description: String(t.description ?? "").trim(),
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
          `INSERT INTO collection_unit_tags (collection_unit_id, sort_order, tag_id, description, data_type, address, ratio)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [unitId, i, t.tag_id, t.description, t.data_type, t.address, t.ratio]
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
  "/api/model-units/scheduler/status",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await mysqlPool.query(
      "SELECT id, model_name, auto_learn, learning_cycle, last_auto_learn_at, auto_learn_anchor_at FROM model_units WHERE auto_learn = 'ON'"
    );
    res.json({
      tick_interval_seconds: AUTO_LEARN_SCHEDULER_TICK_MS / 1000,
      pipeline: "executeModelTraining (= 수동학습 runGruTrainingScript)",
      models: rows.map((r) => {
        const schedule = shouldRunAutoLearnForModel(r);
        const cycle = parseLearningCycle(r.learning_cycle);
        return {
          id: r.id,
          model_name: r.model_name,
          learning_cycle: r.learning_cycle,
          cycle_unit: cycle.unit,
          cycle_minutes: cycle.unit === "minutes" ? cycle.value : null,
          cycle_days: cycle.unit === "days" ? cycle.value : null,
          last_auto_learn_at: formatModelDate(r.last_auto_learn_at),
          auto_learn_anchor_at: formatModelDate(r.auto_learn_anchor_at),
          due_now: schedule.due,
          training_in_progress: modelTrainingLocks.has(r.id),
          reason: schedule.reason,
          runs_at: cycle.unit === "minutes" ? `${cycle.value}분마다` : "00:00:00",
          remaining_minutes: schedule.remaining_minutes,
          remaining_days: schedule.remaining_days,
        };
      }),
      hint: "분: 7분·7m / 일: 7·7일. auto_learn=ON. POST scheduler/tick = 즉시 1회",
    });
  })
);

app.post(
  "/api/model-units/scheduler/tick",
  requireAuth,
  asyncHandler(async (req, res) => {
    const wait = Boolean(req.body?.wait);
    const result = await tickAutoLearnScheduler({ force: true, wait });
    res.json(result);
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

app.get(
  "/api/model-units/:id/tags",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [exist] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!exist[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

    const [rows] = await mysqlPool.query(
      `SELECT tag_id, description, refresh_cycle, data_type, address, ratio
       FROM model_unit_tags
       WHERE model_unit_id = ?
       ORDER BY sort_order ASC, id ASC`,
      [id]
    );

    res.json({
      tags: rows.map((r) => ({
        tag_id: r.tag_id ?? "",
        description: r.description ?? "",
        refresh_cycle: r.refresh_cycle ?? "",
        dataType: r.data_type ?? "DWord",
        address: r.address ?? "",
        ratio: r.ratio ?? "1",
      })),
    });
  })
);

app.put(
  "/api/model-units/:id/tags",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [exist] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!exist[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

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
      description: String(t.description ?? "").trim(),
      refresh_cycle: String(t.refresh_cycle ?? "").trim(),
      data_type: normalizeDT(t.dataType),
      address: String(t.address ?? "").trim(),
      ratio: String(t.ratio ?? "1").trim() || "1",
    }));

    await mysqlPool.query("DELETE FROM model_unit_tags WHERE model_unit_id = ?", [id]);
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      // tag_id/address는 비어있으면 저장하지 않음 (UI에서 빈 행 방지)
      if (!t.tag_id || !t.address) continue;
      await mysqlPool.query(
        `INSERT INTO model_unit_tags (model_unit_id, sort_order, tag_id, description, refresh_cycle, data_type, address, ratio)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i, t.tag_id, t.description, t.refresh_cycle, t.data_type, t.address, t.ratio]
      );
    }

    res.json({ ok: true });
  })
);

app.post(
  "/api/model-units",
  requireAuth,
  asyncHandler(async (req, res) => {
    const m = normalizeModelBody(req.body, { partial: false });
    if (!m.model_name || !m.model_code || !m.table_name) {
      return res.status(400).json({ error: "모델명, 모델ID, 테이블명은 필수입니다." });
    }
    try {
      const [result] = await mysqlPool.query(
        `INSERT INTO model_units (
          model_name, model_code, table_name, plc_ip, plc_port, plc_use_value, status, auto_learn, auto_control,
          learning_cycle, resample_size, interpolate, fill_method, model_output_path,
          model_generated_at, control_tag_id, min_allowed, max_allowed, change_range, auto_apply, memo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)`,
        [
          m.model_name,
          m.model_code,
          m.table_name,
          m.plc_ip,
          m.plc_port,
          m.plc_use_value,
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
      if (m.auto_learn === "ON") {
        await mysqlPool.query(
          "UPDATE model_units SET auto_learn_anchor_at = NOW() WHERE id = ?",
          [insertId]
        );
      }
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
    if (!m.model_name || !m.model_code || !m.table_name) {
      return res.status(400).json({ error: "모델명, 모델ID, 테이블명은 필수입니다." });
    }
    const bumpGen = Boolean(req.body?.bump_model_generated_at);
    const anchorOn = m.auto_learn === "ON";

    try {
      await mysqlPool.query(
        `UPDATE model_units SET
          model_name = ?, model_code = ?, table_name = ?, plc_ip = ?, plc_port = ?, plc_use_value = ?, status = ?, auto_learn = ?, auto_control = ?,
          learning_cycle = ?, resample_size = ?, interpolate = ?, fill_method = ?, model_output_path = ?,
          control_tag_id = ?, min_allowed = ?, max_allowed = ?, change_range = ?, auto_apply = ?, memo = ?,
          model_generated_at = IF(?, NOW(), model_generated_at),
          auto_learn_anchor_at = IF(?, NOW(), NULL)
        WHERE id = ?`,
        [
          m.model_name,
          m.model_code,
          m.table_name,
          m.plc_ip,
          m.plc_port,
          m.plc_use_value,
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
          anchorOn ? 1 : 0,
          id,
        ]
      );
      const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
      const savedModel = rowToModelUnit(rows[0]);

      const schedule = buildAutoLearnScheduleInfo(savedModel);
      res.json({
        model: savedModel,
        auto_learn_schedule: schedule,
        auto_learn_anchor_reset: anchorOn,
      });
    } catch (e) {
      if (e.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ error: "이미 등록된 모델ID입니다." });
      }
      throw e;
    }
  })
);

async function loadModelUnitTags(modelId) {
  const [rows] = await mysqlPool.query(
    `SELECT tag_id, description, refresh_cycle, data_type, address, ratio
     FROM model_unit_tags
     WHERE model_unit_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [modelId]
  );
  return rows.map((r) => ({
    tag_id: r.tag_id ?? "",
    description: r.description ?? "",
    refresh_cycle: r.refresh_cycle ?? "",
    dataType: r.data_type ?? "DWord",
    address: r.address ?? "",
    ratio: r.ratio ?? "1",
  }));
}

app.post(
  "/api/model-units/:id/plc-write",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
    if (!rows[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

    const model = rowToModelUnit(rows[0]);
    const body = req.body ?? {};

    const plc_ip = String(body.plc_ip ?? model.plc_ip ?? "").trim();
    const plc_port = String(body.plc_port ?? model.plc_port ?? "502").trim();
    const plc_use_value = String(body.plc_use_value ?? model.plc_use_value ?? "").trim();

    let tags = body.tags;
    if (!Array.isArray(tags)) {
      tags = await loadModelUnitTags(id);
    } else {
      tags = tags.map((t) => ({
        tag_id: String(t.tag_id ?? "").trim(),
        dataType: t.dataType ?? t.data_type ?? "DWord",
        address: String(t.address ?? "").trim(),
        ratio: String(t.ratio ?? "1").trim() || "1",
      }));
    }

    const control_tag_id = String(body.control_tag_id ?? model.control_tag_id ?? "").trim();

    const writeResult = await executePlcModbusWrite({
      plc_ip,
      plc_port,
      plc_use_value,
      tags,
      control_tag_id,
    });

    if (!writeResult.ok) {
      return res.status(500).json({
        error: writeResult.message,
        model,
        plc_write: writeResult,
      });
    }

    res.json({
      model,
      plc_write: writeResult,
      message: writeResult.message,
    });
  })
);

app.post(
  "/api/model-units/:id/auto-control",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [exist] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!exist[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

    const m = normalizeModelBody(req.body, { partial: false });
    if (!m.model_name || !m.model_code || !m.table_name) {
      return res.status(400).json({ error: "모델명, 모델ID, 테이블명은 필수입니다." });
    }

    await mysqlPool.query(
      `UPDATE model_units SET
        model_name = ?, model_code = ?, table_name = ?, plc_ip = ?, plc_port = ?, plc_use_value = ?, status = ?, auto_learn = ?, auto_control = ?,
        learning_cycle = ?, resample_size = ?, interpolate = ?, fill_method = ?, model_output_path = ?,
        control_tag_id = ?, min_allowed = ?, max_allowed = ?, change_range = ?, auto_apply = ?, memo = ?
      WHERE id = ?`,
      [
        m.model_name,
        m.model_code,
        m.table_name,
        m.plc_ip,
        m.plc_port,
        m.plc_use_value,
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
        id,
      ]
    );

    const [rows] = await mysqlPool.query("SELECT * FROM model_units WHERE id = ?", [id]);
    const savedModel = rowToModelUnit(rows[0]);
    if (savedModel.auto_control !== "ON") {
      return res.json({ model: savedModel, auto_control_run: null });
    }

    const { training_run: trainingRun } = await executeModelTraining(id, { liveLog: true });

    if (!trainingRun.ok) {
      const detail = trainingRun.stderr_tail || trainingRun.stdout_tail || "학습 로그가 없습니다.";
      return res.status(500).json({
        error: `자동 제어 학습 실행에 실패했습니다. ${detail}`,
        model: savedModel,
        auto_control_run: trainingRun,
      });
    }

    return res.json({
      model: savedModel,
      auto_control_run: trainingRun,
    });
  })
);

app.post(
  "/api/model-units/:id/refresh-files",
  requireAuth,
  modelUpload.array("modelFiles"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const files = req.files || [];

    if (!files.length) {
      return res.status(400).json({ error: "업로드할 모델 파일을 선택하세요." });
    }

    // 기존 데이터 조회
    const [rows] = await mysqlPool.query(
      "SELECT * FROM model_units WHERE id = ?",
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "모델을 찾을 수 없습니다." });
    }

    // FormData에서 modelBody 파싱
    let m = {};
    if (req.body && req.body.modelBody) {
      try {
        m = JSON.parse(req.body.modelBody);
      } catch (e) {
        console.error('[DEBUG] modelBody 파싱 실패:', e);
        return res.status(400).json({
          error: "modelBody 파싱에 실패했습니다.",
        });
      }
    }

    if (!m.model_name || !m.model_code || !m.table_name) {
      return res.status(400).json({
        error: "모델명, 모델ID, 테이블명은 필수입니다.",
      });
    }

    const ts = backupSuffix();
    const uploaded = [];
    const backedUp = [];
    const tempPaths = [];

    if (MODEL_FILE_USE_REMOTE) {
      if (!MODEL_FILE_REMOTE_USER) {
        return res.status(500).json({
          error: "MODEL_FILE_REMOTE_USER 설정이 필요합니다.",
        });
      }

      const { sftp, cfg } = createSftpClient();

      try {
        await sftp.connect(cfg);
        await sftp.mkdir(MODEL_FILE_TARGET_DIR, true);
        await sftp.mkdir(MODEL_FILE_BACKUP_DIR, true);

        for (const file of files) {
          tempPaths.push(file.path);
          const name = path.basename(
            file.originalname || file.filename || ""
          );
          if (!name) continue;

          const remoteTargetPath = path.posix.join(
            MODEL_FILE_TARGET_DIR,
            name
          );
          const remoteBackupPath = path.posix.join(
            MODEL_FILE_BACKUP_DIR,
            `${name}.${ts}.bak`
          );

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
        await Promise.allSettled(
          tempPaths.map((p) => fsp.unlink(p).catch(() => {}))
        );
      }
    } else {
      await fsp.mkdir(MODEL_FILE_TARGET_DIR, { recursive: true });
      await fsp.mkdir(MODEL_FILE_BACKUP_DIR, { recursive: true });

      try {
        for (const file of files) {
          tempPaths.push(file.path);
          const name = path.basename(
            file.originalname || file.filename || ""
          );
          if (!name) continue;

          const targetPath = path.join(MODEL_FILE_TARGET_DIR, name);

          if (fs.existsSync(targetPath)) {
            const backupPath = path.join(
              MODEL_FILE_BACKUP_DIR,
              `${name}.${ts}.bak`
            );
            await fsp.copyFile(targetPath, backupPath);
            backedUp.push(path.basename(backupPath));
          }

          await fsp.copyFile(file.path, targetPath);
          uploaded.push(name);
        }
      } finally {
        await Promise.allSettled(
          tempPaths.map((p) => fsp.unlink(p).catch(() => {}))
        );
      }
    }

    // 업데이트
    await mysqlPool.query(
      `UPDATE model_units SET
        model_name = ?, model_code = ?, table_name = ?, plc_ip = ?, plc_port = ?, plc_use_value = ?, status = ?, auto_learn = ?, auto_control = ?,
        learning_cycle = ?, resample_size = ?, interpolate = ?, fill_method = ?, model_output_path = ?,
        control_tag_id = ?, min_allowed = ?, max_allowed = ?, change_range = ?, auto_apply = ?, memo = ?,
        model_generated_at = NOW()
      WHERE id = ?`,
      [
        m.model_name,
        m.model_code,
        m.table_name,
        m.plc_ip,
        m.plc_port,
        m.plc_use_value,
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

    // 최신 데이터 조회
    const [updatedRows] = await mysqlPool.query(
      "SELECT * FROM model_units WHERE id = ?",
      [id]
    );

    res.json({
      model: rowToModelUnit(updatedRows[0]),
      uploaded,
      backed_up: backedUp,
      target_dir: MODEL_FILE_TARGET_DIR,
      backup_dir: MODEL_FILE_BACKUP_DIR,
    });
  })
);

app.post(
  "/api/model-units/:id/manual-train",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [exist] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!exist[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });

    const m = normalizeModelBody(req.body, { partial: false });
    if (!m.model_name || !m.model_code || !m.table_name) {
      return res.status(400).json({ error: "모델명, 모델ID, 테이블명은 필수입니다." });
    }

    await mysqlPool.query(
      `UPDATE model_units SET
        model_name = ?, model_code = ?, table_name = ?, plc_ip = ?, plc_port = ?, plc_use_value = ?, status = ?, auto_learn = ?, auto_control = ?,
        learning_cycle = ?, resample_size = ?, interpolate = ?, fill_method = ?, model_output_path = ?,
        control_tag_id = ?, min_allowed = ?, max_allowed = ?, change_range = ?, auto_apply = ?, memo = ?
      WHERE id = ?`,
      [
        m.model_name,
        m.model_code,
        m.table_name,
        m.plc_ip,
        m.plc_port,
        m.plc_use_value,
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
        id,
      ]
    );

    try {
      const result = await executeModelTraining(id, { liveLog: true });
      if (!result.training_run.ok) {
        const detail =
          result.training_run.stderr_tail || result.training_run.stdout_tail || "학습 로그가 없습니다.";
        return res.status(500).json({
          error: `수동 학습에 실패했습니다. ${detail}`,
          ...result,
        });
      }
      return res.json(result);
    } catch (e) {
      if (e.code === "TRAINING_IN_PROGRESS") {
        return res.status(409).json({ error: e.message });
      }
      throw e;
    }
  })
);

/** @deprecated refresh-ai → manual-train 과 동일 (하위 호환) */
app.post(
  "/api/model-units/:id/refresh-ai",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [exist] = await mysqlPool.query("SELECT id FROM model_units WHERE id = ?", [id]);
    if (!exist[0]) return res.status(404).json({ error: "모델을 찾을 수 없습니다." });
    const result = await executeModelTraining(id, { liveLog: true });
    if (!result.training_run.ok) {
      const detail =
        result.training_run.stderr_tail || result.training_run.stdout_tail || "학습 로그가 없습니다.";
      return res.status(500).json({
        error: `학습 실행에 실패했습니다. ${detail}`,
        ...result,
      });
    }
    res.json(result);
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
  const status = Number(err.status) || 500;
  res.status(status).json({
    error: status === 500 ? "서버 오류가 발생했습니다." : err.message || "요청 처리에 실패했습니다.",
  });
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
    await ensureCollectionUnitTagsSchema();
  } catch (e) {
    console.error("[DB] 연결 실패 — MySQL·PostgreSQL 설정과 db/mysql, db/postgresql 스키마를 확인하세요.");
    console.error(e);
    process.exit(1);
  }

  // WebSocket 서버 설정
  const WS_PORT = 3001; // 명시적으로 포트 3001 설정
  console.log(`[DEBUG] WebSocket 서버 시작 시도: 포트 ${WS_PORT}`);
  const wss = new WebSocket.Server({ port: WS_PORT });
  console.log(`[DEBUG] WebSocket 서버 시작 성공: 포트 ${WS_PORT}`);
  
  // 학습 로그를 전송할 클라이언트 관리
  const trainingClients = new Map(); // modelId -> Set of WebSocket connections
  
  wss.on('connection', (ws, req) => {
    console.log(`[WebSocket] 새 연결 요청: ${req.url}`);
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const modelId = url.searchParams.get('modelId');
    
    console.log(`[WebSocket] 파싱된 modelId: ${modelId}`);
    
    if (modelId) {
      // 해당 모델의 학습 로그를 구독
      if (!trainingClients.has(modelId)) {
        trainingClients.set(modelId, new Set());
      }
      trainingClients.get(modelId).add(ws);
      
      console.log(`[WebSocket] 모델 ${modelId}의 학습 로그 구독 시작 (클라이언트 수: ${trainingClients.get(modelId).size})`);
      
      ws.on('close', () => {
        trainingClients.get(modelId)?.delete(ws);
        if (trainingClients.get(modelId)?.size === 0) {
          trainingClients.delete(modelId);
        }
        console.log(`[WebSocket] 모델 ${modelId}의 학습 로그 구독 종료`);
      });
      
      ws.on('error', (error) => {
        console.error(`[WebSocket] 에러:`, error);
        trainingClients.get(modelId)?.delete(ws);
      });
    }
  });
  
  // 학습 로그 전송 함수
  function broadcastTrainingLog(modelId, logData) {
    console.log(`[DEBUG] broadcastTrainingLog 호출: modelId=${modelId}, logType=${logData.type}`);
    const clients = trainingClients.get(String(modelId));
    console.log(`[DEBUG] 연결된 클라이언트 수: ${clients ? clients.size : 0}`);
    
    if (clients) {
      const message = JSON.stringify({
        type: 'training_log',
        modelId: modelId,
        timestamp: new Date().toISOString(),
        data: logData
      });
      
      console.log(`[DEBUG] 전송할 메시지: ${message}`);
      
      let sentCount = 0;
      clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(message);
          sentCount++;
          console.log(`[DEBUG] 메시지 전송 완료 (클라이언트)`);
        } else {
          console.log(`[DEBUG] 클라이언트 연결 상태가 OPEN이 아님: ${ws.readyState}`);
        }
      });
      console.log(`[DEBUG] 총 ${sentCount}개 클라이언트에게 메시지 전송 완료`);
    } else {
      console.log(`[DEBUG] modelId ${modelId}에 대한 연결된 클라이언트가 없음`);
    }
  }
  
  global.hasTrainingLogSubscribers = (modelId) => {
    const clients = trainingClients.get(String(modelId));
    return Boolean(clients && clients.size > 0);
  };
  global.broadcastTrainingLog = broadcastTrainingLog;

  startAutoLearnScheduler();

  app.listen(PORT, () => {
    console.log(`회원 CMS: http://localhost:${PORT}`);
    console.log(`WebSocket 서버: ws://localhost:${WS_PORT}`);
  });
}

main();
