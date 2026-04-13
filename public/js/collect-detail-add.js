const COLLECTION_API = "/api/collection-units";

function showMsg(text, type) {
  const el = document.getElementById("addMessage");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function goList() {
  window.location.href = "/html/collect/index.html";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

/** detail-list.html unitMeta와 동일한 한 줄 요약 */
function setUnitMetaFromRow(meta) {
  const unitMetaEl = document.getElementById("unitMeta");
  if (!unitMetaEl) return;
  const stClass = meta.status === "비정상" ? "status-bad" : "status-ok";
  const statusText = meta.status === "비정상" ? "비정상" : "정상";
  const inUseOn = meta.in_use !== false;
  const inUseClass = inUseOn ? "status-ok" : "status-inactive";
  const inUseText = inUseOn ? "사용" : "미사용";
  const auto = meta.auto_control === "OFF" ? "OFF" : "ON";
  unitMetaEl.hidden = false;
  unitMetaEl.innerHTML = `${escapeHtml(meta.process_name)} · <span class="code-text">${escapeHtml(
    meta.process_code
  )}</span> · <span class="${stClass}">${escapeHtml(statusText)}</span> · <span class="${inUseClass}">${escapeHtml(
    inUseText
  )}</span> · 자동제어 ${escapeHtml(auto)}`;
}

function setDbMeta(meta) {
  setUnitMetaFromRow(meta);
  const processNameEl = document.getElementById("dbProcessName");
  const processCodeEl = document.getElementById("dbProcessCode");
  const statusEl = document.getElementById("dbStatus");
  const autoEl = document.getElementById("dbAutoControl");
  const inUseEl = document.getElementById("dbInUse");
  if (processNameEl) processNameEl.textContent = meta.process_name || "-";
  if (processCodeEl) processCodeEl.textContent = meta.process_code || "-";
  if (statusEl) {
    const status = meta.status === "비정상" ? "비정상" : "정상";
    statusEl.textContent = status;
    statusEl.className = status === "비정상" ? "status-bad" : "status-ok";
  }
  if (inUseEl) {
    const on = meta.in_use !== false;
    inUseEl.textContent = on ? "사용" : "미사용";
    inUseEl.className = on ? "status-ok" : "status-inactive";
  }
  if (autoEl) autoEl.textContent = `자동 제어 여부 (${meta.auto_control === "OFF" ? "OFF" : "ON"})`;
}

function readFormBody() {
  const inUseEl = document.getElementById("colInUse");
  const in_use = inUseEl ? inUseEl.value === "true" : true;
  return {
    process_name: document.getElementById("colProcessName")?.value.trim() ?? "",
    process_code: document.getElementById("colProcessCode")?.value.trim() ?? "",
    device_name: document.getElementById("colDeviceName")?.value.trim() ?? "",
    device_ip: document.getElementById("colIp")?.value.trim() ?? "",
    device_port: document.getElementById("colPort")?.value.trim() ?? "",
    status: document.getElementById("colStatus")?.value ?? "정상",
    in_use,
    auto_control: document.getElementById("colAuto")?.value ?? "ON",
  };
}

function bindMetaSync() {
  const sync = () => {
    const body = readFormBody();
    setDbMeta(body);
  };
  ["colProcessName", "colProcessCode", "colStatus", "colInUse", "colAuto"].forEach((id) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
  });
  sync();
}

window.initCollectAddView = function initCollectAddView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const isEdit = Boolean(id);
  const form = document.getElementById("collectAddForm");
  document.getElementById("btnCancel")?.addEventListener("click", goList);

  bindMetaSync();

  if (isEdit) {
    fetchJson(`${COLLECTION_API}/${id}`)
      .then((row) => {
        if (row) {
          if (document.getElementById("colProcessName"))
            document.getElementById("colProcessName").value = row.process_name ?? "";
          if (document.getElementById("colProcessCode"))
            document.getElementById("colProcessCode").value = row.process_code ?? "";
          if (document.getElementById("colDeviceName"))
            document.getElementById("colDeviceName").value = row.device_name ?? "";
          if (document.getElementById("colIp")) document.getElementById("colIp").value = row.device_ip ?? "";
          if (document.getElementById("colPort"))
            document.getElementById("colPort").value = row.device_port ?? "";
          if (document.getElementById("colStatus"))
            document.getElementById("colStatus").value = row.status === "비정상" ? "비정상" : "정상";
          if (document.getElementById("colInUse"))
            document.getElementById("colInUse").value = row.in_use === false ? "false" : "true"; 
          if (document.getElementById("colAuto"))
            document.getElementById("colAuto").value = row.auto_control === "OFF" ? "OFF" : "ON";
          setDbMeta(row);
        }
      })
      .catch((err) => {
        showMsg(err.message, "error");
      });
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("");
    const body = readFormBody();
    if (!body.device_name || !body.device_ip || !body.device_port) {
      showMsg("공정/디바이스/IP/Port 정보를 모두 입력하세요.", "error");
      return;
    }
    try {
      const url = isEdit ? `${COLLECTION_API}/${id}` : COLLECTION_API;
      const method = isEdit ? "PUT" : "POST";
      await fetchJson(url, { method, body: JSON.stringify(body) });
      goList();
    } catch (err) {
      showMsg(err.message, "error");
    }
  });

  const pn = document.getElementById("colProcessName");
  if (pn && pn.type !== "hidden") pn.focus();
  else document.getElementById("colDeviceName")?.focus();
};
