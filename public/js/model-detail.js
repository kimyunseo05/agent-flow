const MODEL_API = "/api/model-units";
let selectedModelFiles = [];

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function setModelMessage(text, type) {
  const el = document.getElementById("modelMessage");
  if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
  el.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function displayTrainingLogs(trainingRun) {
  const logsSection = document.getElementById("trainingLogsSection");
  const logsContent = document.getElementById("trainingLogsContent");
  const logsOutput = document.getElementById("trainingLogsOutput");
  const toggleBtn = document.getElementById("btnToggleTrainingLogs");
  const toggleText = document.getElementById("trainingLogsToggleText");
  
  if (!logsSection || !logsOutput) return;
  
  // Combine stdout and stderr for complete logs
  let logs = "";
  if (trainingRun.stdout_tail) {
    logs += "=== STDOUT ===\n" + trainingRun.stdout_tail + "\n\n";
  }
  if (trainingRun.stderr_tail) {
    logs += "=== STDERR ===\n" + trainingRun.stderr_tail + "\n\n";
  }
  if (trainingRun.command) {
    logs = "=== COMMAND ===\n" + trainingRun.command + "\n\n" + logs;
  }
  
  logsOutput.textContent = logs;
  logsSection.hidden = false;
  logsContent.hidden = true; // Start collapsed
  
  // Add toggle functionality
  if (toggleBtn && toggleText) {
    toggleBtn.onclick = () => {
      const isHidden = logsContent.hidden;
      logsContent.hidden = !isHidden;
      toggleText.textContent = isHidden ? "접기" : "펼치기";
    };
  }
}

function setUnitMeta(row) {
  const unitMetaEl = document.getElementById("unitMeta");
  if (!unitMetaEl || !row) return;
  const stClass = row.status === "비정상" ? "status-bad" : "status-ok";
  const learn = row.auto_learn === "OFF" ? "OFF" : "ON";
  const ctrl = row.auto_control === "OFF" ? "OFF" : "ON";
  unitMetaEl.hidden = false;
  unitMetaEl.innerHTML = `${escapeHtml(row.model_name)} · <span class="code-text">${escapeHtml(
    row.model_code
  )}</span> · <span class="${stClass}">${escapeHtml(row.status)}</span> · 자동학습 ${escapeHtml(
    learn
  )} · 자동제어 ${escapeHtml(ctrl)}`;
}

function readModelForm() {
  return {
    model_name: document.getElementById("mdlName")?.value.trim() ?? "",
    model_code: document.getElementById("mdlCode")?.value.trim() ?? "",
    table_name: document.getElementById("mdlTableName")?.value.trim() ?? "",
    status: document.getElementById("mdlStatus")?.value ?? "정상",
    auto_learn: document.getElementById("mdlAutoLearn")?.value ?? "ON",
    auto_control: document.getElementById("mdlAutoControl")?.value ?? "ON",
    learning_cycle: document.getElementById("mdlLearningCycle")?.value.trim() ?? "",
    resample_size: document.getElementById("mdlResampleSize")?.value.trim() ?? "",
    interpolate: document.getElementById("mdlInterpolate")?.value ?? "on",
    fill_method: document.getElementById("mdlFillMethod")?.value ?? "ffill",
    model_output_path: document.getElementById("mdlOutputPath")?.value.trim() ?? "",
    control_tag_id: document.getElementById("mdlControlTagId")?.value.trim() ?? "",
    min_allowed: document.getElementById("mdlMinAllowed")?.value.trim() ?? "",
    max_allowed: document.getElementById("mdlMaxAllowed")?.value.trim() ?? "",
    change_range: document.getElementById("mdlChangeRange")?.value.trim() ?? "",
    auto_apply: document.getElementById("mdlAutoApply")?.value ?? "after_approval",
    memo: document.getElementById("mdlMemo")?.value.trim() ?? "",
  };
}

function applyRowToForm(row) {
  const idEl = document.getElementById("mdlId");
  if (idEl) idEl.value = String(row.id);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v ?? "";
  };
  set("mdlName", row.model_name);
  set("mdlCode", row.model_code);
  set("mdlTableName", row.table_name);
  set("mdlStatus", row.status === "비정상" ? "비정상" : "정상");
  set("mdlAutoLearn", row.auto_learn === "OFF" ? "OFF" : "ON");
  set("mdlAutoControl", row.auto_control === "OFF" ? "OFF" : "ON");
  set("mdlLearningCycle", row.learning_cycle);
  set("mdlResampleSize", row.resample_size);
  set("mdlInterpolate", row.interpolate === "off" ? "off" : "on");
  set("mdlFillMethod", row.fill_method || "ffill");
  set("mdlOutputPath", row.model_output_path);
  set("mdlGeneratedAt", row.model_generated_at || "");
  set("mdlControlTagId", row.control_tag_id);
  set("mdlMinAllowed", row.min_allowed);
  set("mdlMaxAllowed", row.max_allowed);
  set("mdlChangeRange", row.change_range);
  set("mdlAutoApply", row.auto_apply === "immediate" ? "immediate" : "after_approval");
  set("mdlMemo", row.memo);
}

function goList() {
  window.location.href = "/html/model/index.html";
}

async function uploadModelFiles(id, modelBody, files) {
  const formData = new FormData();
  formData.append("modelBody", JSON.stringify(modelBody));
  for (const file of files) formData.append("modelFiles", file, file.name);

  const res = await fetch(`${MODEL_API}/${id}/refresh-files`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });
  if (res.status === 401) {
    window.location.replace("/html/login/login.html");
    throw new Error("로그인이 필요합니다.");
  }
  const data = res.headers.get("content-type")?.includes("application/json") ? await res.json() : null;
  if (!res.ok) {
    throw new Error(data?.error || res.statusText || "요청 실패");
  }
  return data;
}

async function manualTrain(id, body) {
  return await fetchJson(`${MODEL_API}/${id}/manual-train`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function runAutoControl(id, body) {
  return await fetchJson(`${MODEL_API}/${id}/auto-control`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function initModelDetailView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const form = document.getElementById("modelDetailForm");
  
  // 실시간 학습 로그 WebSocket 연결
  let trainingWebSocket = null;
  
  function connectTrainingWebSocket() {
    if (!id) {
      console.log('[DEBUG] modelId가 없어 WebSocket 연결 중단');
      return;
    }
    
    if (trainingWebSocket) {
      console.log('[DEBUG] 이미 WebSocket 연결이 존재함');
      return;
    }
    
    const wsUrl = `ws://localhost:3001?modelId=${id}`;
    console.log(`[DEBUG] WebSocket 연결 시도: ${wsUrl}`);
    
    try {
      trainingWebSocket = new WebSocket(wsUrl);
      
      trainingWebSocket.onopen = () => {
        console.log('[DEBUG] 학습 로그 WebSocket 연결 성공');
      };
      
      trainingWebSocket.onerror = (error) => {
        console.error('[DEBUG] WebSocket 연결 에러:', error);
        // 5초 후 재시도
        setTimeout(() => {
          console.log('[DEBUG] WebSocket 재시도 시도');
          trainingWebSocket = null;
          connectTrainingWebSocket();
        }, 5000);
      };
      
      trainingWebSocket.onmessage = (event) => {
        console.log('[DEBUG] WebSocket 메시지 수신:', event.data);
        try {
          const data = JSON.parse(event.data);
          console.log('[DEBUG] 파싱된 데이터:', data);
          if (data.type === 'training_log') {
            appendRealTimeLog(data.data);
          }
        } catch (e) {
          console.error('[DEBUG] WebSocket 메시지 파싱 오류:', e);
        }
      };
      
      trainingWebSocket.onclose = (event) => {
        console.log(`[DEBUG] WebSocket 연결 종료: code=${event.code}, reason=${event.reason}`);
        trainingWebSocket = null;
      };
      
      // 연결 타임아웃 설정
      setTimeout(() => {
        if (trainingWebSocket && trainingWebSocket.readyState === WebSocket.CONNECTING) {
          console.log('[DEBUG] WebSocket 연결 타임아웃');
          trainingWebSocket.close();
          trainingWebSocket = null;
        }
      }, 10000);
      
    } catch (error) {
      console.error('[DEBUG] WebSocket 생성 에러:', error);
    }
  }
  
  function appendRealTimeLog(logData) {
    console.log(`[DEBUG] appendRealTimeLog 호출:`, logData);
    const logsOutput = document.getElementById("trainingLogsOutput");
    const logsSection = document.getElementById("trainingLogsSection");
    const logsContent = document.getElementById("trainingLogsContent");
    const statusEl = document.getElementById("trainingStatus");
    const progressEl = document.getElementById("trainingProgress");
    const progressText = document.getElementById("progressText");
    const progressFill = document.getElementById("progressFill");
    
    console.log(`[DEBUG] UI 요소 확인: logsOutput=${!!logsOutput}, logsSection=${!!logsSection}`);
    
    if (!logsOutput || !logsSection) {
      console.log(`[DEBUG] 필수 UI 요소를 찾을 수 없음`);
      return;
    }
    
    // 로그 섹션 표시
    logsSection.hidden = false;
    logsContent.hidden = false;
    
    // 상태 업데이트
    if (statusEl) {
      statusEl.className = 'status-indicator';
      
      if (logData.type === 'start') {
        statusEl.classList.add('status-indicator--running');
        statusEl.textContent = '학습 중';
        if (progressEl) progressEl.hidden = false;
        if (progressText) progressText.textContent = 'GRU 모델 학습 시작...';
        if (progressFill) progressFill.style.width = '10%';
      } else if (logData.type === 'complete') {
        statusEl.classList.add(logData.success ? 'status-indicator--success' : 'status-indicator--error');
        statusEl.textContent = logData.success ? '완료' : '오류';
        if (progressEl) progressEl.hidden = true;
        if (progressFill) progressFill.style.width = '100%';
      }
    }
    
    // 로그 메시지 포맷팅
    const timestamp = new Date(logData.timestamp).toLocaleTimeString();
    let logMessage = '';
    
    if (logData.type === 'start') {
      logMessage = `[${timestamp}] 🚀 ${logData.message}`;
    } else if (logData.type === 'stdout') {
      logMessage = `[${timestamp}] ${logData.message.trim()}`;
      // 진행 상태 업데이트 (간단한 키워드 기반)
      if (progressText && progressFill) {
        if (logData.message.includes('Loading data') || logData.message.includes('데이터 로딩')) {
          progressText.textContent = '데이터 로딩 중...';
          progressFill.style.width = '30%';
        } else if (logData.message.includes('Training') || logData.message.includes('학습')) {
          progressText.textContent = '모델 학습 중...';
          progressFill.style.width = '60%';
        } else if (logData.message.includes('Epoch') || logData.message.includes('에포크')) {
          progressText.textContent = '학습 진행 중...';
          progressFill.style.width = '80%';
        }
      }
    } else if (logData.type === 'stderr') {
      logMessage = `[${timestamp}] ❌ ${logData.message.trim()}`;
    } else if (logData.type === 'complete') {
      logMessage = `[${timestamp}] ${logData.success ? '✅' : '❌'} ${logData.message}`;
    } else {
      logMessage = `[${timestamp}] ${logData.message}`;
    }
    
    // 로그 추가 (자동 스크롤)
    logsOutput.textContent += logMessage + '\n';
    logsOutput.scrollTop = logsOutput.scrollHeight;
  }
  
  function clearLogs() {
    const logsOutput = document.getElementById("trainingLogsOutput");
    const statusEl = document.getElementById("trainingStatus");
    const progressEl = document.getElementById("trainingProgress");
    
    if (logsOutput) logsOutput.textContent = '';
    if (statusEl) {
      statusEl.className = 'status-indicator status-indicator--idle';
      statusEl.textContent = '대기 중';
    }
    if (progressEl) progressEl.hidden = true;
  }
  
  if (!id) {
    setModelMessage("잘못된 접근입니다. 목록에서 모델을 선택하세요.", "error");
    form?.addEventListener("submit", (e) => e.preventDefault());
    return;
  }

  fetchJson(`${MODEL_API}/scheduler/status`)
    .then((st) => {
      const tickBtn = document.getElementById("btnMdlSchedulerTick");
      if (tickBtn) tickBtn.hidden = false;
      const me = (st.models || []).find((m) => String(m.id) === String(id));
      if (!me) return;
      const remain = me.due_now
        ? "다음 00:00:00 실행 가능"
        : `대기 (${me.reason}${me.remaining_days != null ? `, 약 ${me.remaining_days}일` : ""})`;
      setModelMessage(
        `[자동학습] ${me.cycle_days ?? me.cycle_value}일마다 매일 00:00:00 · ${remain}`,
        "ok"
      );
    })
    .catch(() => {});

  document.getElementById("btnMdlSchedulerTick")?.addEventListener("click", async () => {
    setModelMessage("스케줄러 테스트 실행 중…", "ok");
    clearLogs();
    try {
      const result = await fetchJson(`${MODEL_API}/scheduler/tick`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const ran = Array.isArray(result?.ran) ? result.ran : [];
      const executed = ran.filter((r) => !r.skipped);
      const okCount = executed.filter((r) => r.ok).length;
      const skipped = ran.filter((r) => r.skipped);
      let msg = `스케줄러 즉시 실행: 학습 ${executed.length}건(성공 ${okCount}), 건너뜀 ${skipped.length}건`;
      if (skipped.length) {
        const s = skipped[0];
        msg += ` — ${s.reason}${s.remaining_days != null ? ` (약 ${s.remaining_days}일 후)` : ""}`;
      }
      setModelMessage(msg, okCount > 0 ? "ok" : executed.length ? "error" : "ok");
    } catch (e) {
      setModelMessage(e.message, "error");
    }
  });

  // 먼저 모델 데이터 로드
  console.log(`[DEBUG] 모델 데이터 로드 시작, modelId=${id}`);
  fetchJson(`${MODEL_API}/${id}`)
    .then((row) => {
      console.log(`[DEBUG] 모델 데이터 로드 완료:`, row);
      applyRowToForm(row);
      setUnitMeta(row);
      
      // 데이터 로드 후 WebSocket 연결 시작
      console.log(`[DEBUG] WebSocket 연결 시도 시작`);
      setTimeout(() => {
        connectTrainingWebSocket();
      }, 500);
    })
    .catch((err) => {
      console.error(`[DEBUG] 모델 데이터 로드 실패:`, err);
      console.error(`[DEBUG] 에러 스택:`, err.stack);
      setModelMessage(`모델 데이터 로드 실패: ${err.message}`, "error");
    });

  document.getElementById("btnMdlFolder")?.addEventListener("click", () => {
    document.getElementById("mdlFolderInput")?.click();
  });
  
  document.getElementById("btnClearLogs")?.addEventListener("click", () => {
    clearLogs();
  });
  document.getElementById("mdlFolderInput")?.addEventListener("change", (e) => {
    const files = Array.from(e.target?.files || []);
    selectedModelFiles = files.filter((f) => !f.name.startsWith("."));
    const outputPathEl = document.getElementById("mdlOutputPath");
    if (outputPathEl && selectedModelFiles.length > 0) {
      outputPathEl.value = selectedModelFiles.map((f) => f.name).join(", ");
    }
    if (selectedModelFiles.length > 0) {
      setModelMessage(`${selectedModelFiles.length}개 파일을 선택했습니다.`, "ok");
      return;
    }
    setModelMessage("선택된 파일이 없습니다.", "error");
  });

  document.getElementById("btnMdlRefreshAi")?.addEventListener("click", async () => {
    setModelMessage("");
    try {
      const body = readModelForm();
      if (!body.model_name || !body.model_code || !body.table_name) {
        setModelMessage("모델명, 모델ID, 테이블명은 필수입니다.", "error");
        return;
      }
      if (!selectedModelFiles.length) {
        setModelMessage("업로드할 모델 파일을 먼저 선택하세요.", "error");
        return;
     }
      const result = await uploadModelFiles(id, body, selectedModelFiles);
      applyRowToForm(result.model);
      setUnitMeta(result.model);

      const uploaded = Array.isArray(result.uploaded) ? result.uploaded : [];
      const backedUp = Array.isArray(result.backed_up) ? result.backed_up : [];
      setModelMessage(
        `AI 모델 갱신 완료 — 파일 업로드 및 DB 저장 (업로드 ${uploaded.length}개, 백업 ${backedUp.length}개)`,
        "ok"
      );

      selectedModelFiles = [];
      const fileInput = document.getElementById("mdlFolderInput");
      if (fileInput) fileInput.value = "";
    } catch (e) {
      setModelMessage(e.message, "error");
    }
  });

  document.getElementById("btnMdlManualTrain")?.addEventListener("click", async () => {
    setModelMessage("");
    clearLogs();
    const body = readModelForm();
    if (!body.model_name || !body.model_code || !body.table_name) {
      setModelMessage("모델명, 모델ID, 테이블명은 필수입니다.", "error");
      return;
    }
    try {
      setModelMessage("GRU 수동 학습을 실행 중입니다…", "ok");
      const result = await manualTrain(id, body);
      applyRowToForm(result.model);
      setUnitMeta(result.model);
      const run = result.training_run || {};
      displayTrainingLogs(run);
      setModelMessage(
        `수동 학습 완료 (script=${run.training_script ?? "-"}, days=${run.data_days ?? "-"}, code=${run.exit_code ?? "-"})`,
        "ok"
      );
    } catch (e) {
      setModelMessage(e.message, "error");
    }
  });

  document.getElementById("btnMdlToggleAuto")?.addEventListener("click", async () => {
    const sel = document.getElementById("mdlAutoControl");
    if (!sel) return;
    sel.value = sel.value === "OFF" ? "ON" : "OFF";
    const body = readModelForm();
    console.log('[DEBUG] 자동제어 버튼 클릭 - 폼 데이터:', body);
    setUnitMeta({ ...body, id, status: body.status });
    setModelMessage("");
    console.log('[DEBUG] 필수 필드 확인:', {
      model_name: body.model_name,
      model_code: body.model_code,
      table_name: body.table_name
    });
    if (!body.model_name || !body.model_code || !body.table_name) {
      console.log('[DEBUG] 필수 필드 누락:', {
        model_name: !!body.model_name,
        model_code: !!body.model_code,
        table_name: !!body.table_name
      });
      setModelMessage("모델명, 모델ID, 테이블명은 필수입니다.", "error");
      return;
    }
    try {
      const result = await runAutoControl(id, body);
      const saved = result?.model ?? body;
      const predictionRun = result?.auto_control_run ?? null;
      applyRowToForm(saved);
      setUnitMeta(saved);

      if (predictionRun) {
        setModelMessage(
          `자동 제어 실행 완료 (model=${predictionRun.model_file ?? "-"}, days=${predictionRun.data_days ?? "-"}, resample=${predictionRun.resample_interval ?? "-"})`,
          "ok"
        );
      } else {
        setModelMessage(`자동 제어가 ${saved.auto_control === "ON" ? "ON" : "OFF"}으로 저장되었습니다.`, "ok");
      }
    } catch (e) {
      sel.value = sel.value === "OFF" ? "ON" : "OFF";
      const rollbackRow = readModelForm();
      setUnitMeta({ ...rollbackRow, id, status: rollbackRow.status });
      setModelMessage(e.message, "error");
    }
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setModelMessage("");
    const body = readModelForm();
    if (!body.model_name || !body.model_code || !body.table_name) {
      setModelMessage("모델명, 모델ID, 테이블명은 필수입니다.", "error");
      return;
    }
    try {
      const result = await fetchJson(`${MODEL_API}/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const saved = result?.model ?? result;
      const schedule = result?.auto_learn_schedule ?? null;
      applyRowToForm(saved);
      setUnitMeta(saved);
      if (schedule) {
        const scheduleText = `자동 학습: ${schedule.cycle_days}일 주기, 매일 ${schedule.runs_at} (적용 직후 바로 학습 안 함)`;
        const anchorNote = result?.auto_learn_anchor_reset
          ? " 지금부터 주기만큼 대기 후 첫 자동학습이 실행됩니다."
          : "";
        setModelMessage(`저장되었습니다. ${scheduleText}${anchorNote}`, "ok");
      } else {
        setModelMessage("저장되었습니다.", "ok");
      }
    } catch (err) {
      setModelMessage(err.message, "error");
    }
  });
}

window.initModelDetailView = initModelDetailView;
