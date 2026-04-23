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

function initModelDetailView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const form = document.getElementById("modelDetailForm");

  if (!id) {
    setModelMessage("잘못된 접근입니다. 목록에서 모델을 선택하세요.", "error");
    form?.addEventListener("submit", (e) => e.preventDefault());
    return;
  }

  document.getElementById("btnMdlFolder")?.addEventListener("click", () => {
    document.getElementById("mdlFolderInput")?.click();
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
    const body = readModelForm();
    if (!body.model_name || !body.model_code) {
      setModelMessage("모델명과 모델ID는 필수입니다.", "error");
      return;
    }
    if (selectedModelFiles.length === 0) {
      setModelMessage("먼저 모델 파일 선택에서 업로드할 파일을 선택하세요.", "error");
      return;
    }
    try {
      const result = await uploadModelFiles(id, body, selectedModelFiles);
      applyRowToForm(result.model);
      setUnitMeta(result.model);
      const backupText =
        Array.isArray(result.backed_up) && result.backed_up.length > 0
          ? ` (기존 ${result.backed_up.length}개 백업)`
          : "";
      setModelMessage(
        `${result.uploaded?.length || 0}개 파일 업로드 완료${backupText} · 경로 ${result.target_dir}`,
        "ok"
      );
    } catch (e) {
      setModelMessage(e.message, "error");
    }
  });

  document.getElementById("btnMdlToggleAuto")?.addEventListener("click", () => {
    const sel = document.getElementById("mdlAutoControl");
    if (!sel) return;
    sel.value = sel.value === "OFF" ? "ON" : "OFF";
    const row = readModelForm();
    setUnitMeta({ ...row, id, status: row.status });
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    setModelMessage("");
    const body = readModelForm();
    if (!body.model_name || !body.model_code) {
      setModelMessage("모델명과 모델ID는 필수입니다.", "error");
      return;
    }
    try {
      const saved = await fetchJson(`${MODEL_API}/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      applyRowToForm(saved);
      setUnitMeta(saved);
      setModelMessage("저장되었습니다.", "ok");
    } catch (err) {
      setModelMessage(err.message, "error");
    }
  });

  fetchJson(`${MODEL_API}/${id}`)
    .then((row) => {
      applyRowToForm(row);
      setUnitMeta(row);
    })
    .catch((err) => {
      setModelMessage(err.message, "error");
    });
}

window.initModelDetailView = initModelDetailView;
