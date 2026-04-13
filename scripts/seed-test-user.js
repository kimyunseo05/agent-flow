/**
 * 테스트용 로그인 계정 추가 (한 번만 실행해도 됨)
 * 아이디: test / 비밀번호: test123
 *
 * 환경변수: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 */
const crypto = require("crypto");
const mysql = require("mysql2/promise");

function sha256PasswordHex(plain) {
  return crypto.createHash("sha256").update(String(plain), "utf8").digest("hex");
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "agent_flow_admin",
    waitForConnections: true,
    connectionLimit: 1,
  });

  const username = "test";
  const password = "test123";

  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE username = ?", [username]);
    if (rows[0]) {
      console.log(`이미 존재: ${username}`);
      await pool.end();
      process.exit(0);
    }

    const hash = sha256PasswordHex(password);
    await pool.query("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash]);
    console.log(`추가됨 — 아이디: ${username} / 비밀번호: ${password}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
