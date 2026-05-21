#!/usr/bin/env node
/**
 * 자동학습 스케줄러 테스트
 *
 * CMS에서 auto_learn=ON, 학습 주기 예: "7" (7일)
 * 실행: npm run test:auto-learn
 */
require("dotenv").config();

const BASE = (process.env.CMS_URL || "http://localhost:3000").replace(/\/$/, "");
const USER = process.env.CMS_USER || "admin";
const PASS = process.env.CMS_PASSWORD || "admin";

let cookie = "";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(options.headers || {}),
    },
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  } else {
    const raw = res.headers.get("set-cookie");
    if (raw) cookie = raw.split(",").map((c) => c.split(";")[0].trim()).join("; ");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function main() {
  console.log(`[1/3] 로그인 ${BASE} (${USER})`);
  await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  console.log("  OK\n");

  console.log("[2/3] 스케줄러 상태");
  const status = await request("/api/model-units/scheduler/status");
  console.log(JSON.stringify(status, null, 2));
  for (const m of status.models || []) {
    const due = m.due_now ? "지금 실행" : `대기 (${m.reason})`;
    console.log(`  - #${m.id} ${m.model_name}: ${m.runs_at} · ${due}`);
  }
  if (!status.models?.length) {
    console.warn("\nauto_learn=ON 인 모델이 없습니다. CMS에서 자동학습 ON + 학습 주기(예: 7일) 후 적용하세요.");
  }
  console.log("");

  console.log("[3/3] 스케줄러 즉시 실행 (POST scheduler/tick, force)");
  const tick = await request("/api/model-units/scheduler/tick", {
    method: "POST",
    body: JSON.stringify({}),
  });
  console.log(JSON.stringify(tick, null, 2));

  const ran = tick.ran || [];
  const trained = ran.filter((r) => !r.skipped && r.ok);
  const failed = ran.filter((r) => !r.skipped && r.ok === false);
  console.log(`\n완료: 성공 ${trained.length}, 실패 ${failed.length}, 건너뜀 ${ran.filter((r) => r.skipped).length}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error("오류:", e.message);
  if (e.data) console.error(e.data);
  process.exit(1);
});
