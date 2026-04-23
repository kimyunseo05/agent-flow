const MODEL_API = "/api/model-units";

function showMsg(text, type) {
  const el = document.getElementById("addMessage");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function goList() {
  window.location.href = "/html/model/index.html";
}

function readAddForm() {
  const code = document.getElementById("madCode")?.value.trim() ?? "";
  let tag = document.getElementById("madControlTagId")?.value.trim() ?? "";
  if (!tag) tag = code;
  return {
    model_name: document.getElementById("madName")?.value.trim() ?? "",
    model_code: code,
    status: document.getElementById("madStatus")?.value ?? "정상",
    auto_learn: document.getElementById("madAutoLearn")?.value ?? "ON",
    auto_control: document.getElementById("madAutoControl")?.value ?? "ON",
    learning_cycle: document.getElementById("madLearningCycle")?.value.trim() ?? "",
    resample_size: document.getElementById("madResampleSize")?.value.trim() ?? "",
    interpolate: document.getElementById("madInterpolate")?.value ?? "on",
    fill_method: document.getElementById("madFillMethod")?.value ?? "ffill",
    model_output_path: document.getElementById("madOutputPath")?.value.trim() ?? "",
    control_tag_id: tag,
    min_allowed: document.getElementById("madMinAllowed")?.value.trim() ?? "",
    max_allowed: document.getElementById("madMaxAllowed")?.value.trim() ?? "",
    change_range: document.getElementById("madChangeRange")?.value.trim() ?? "",
    auto_apply: document.getElementById("madAutoApply")?.value ?? "after_approval",
    memo: document.getElementById("madMemo")?.value.trim() ?? "",
  };
}

function initModelAddView() {
  const form = document.getElementById("modelAddForm");

  const codeEl = document.getElementById("madCode");
  const tagEl = document.getElementById("madControlTagId");
  const syncTag = () => {
    if (!codeEl || !tagEl) return;
    if (!tagEl.dataset.touched) {
      tagEl.value = codeEl.value.trim();
    }
  };
  codeEl?.addEventListener("input", syncTag);
  tagEl?.addEventListener("input", () => {
    tagEl.dataset.touched = "1";
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const body = readAddForm();
    if (!body.model_name || !body.model_code) {
      showMsg("모델명과 모델ID는 필수입니다.", "error");
      return;
    }
    try {
      await fetchJson(MODEL_API, { method: "POST", body: JSON.stringify(body) });
      goList();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  document.getElementById("madName")?.focus();
}

window.initModelAddView = initModelAddView;
