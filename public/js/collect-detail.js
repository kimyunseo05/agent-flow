const COLLECTION_API = "/api/collection-units";

function showMsg(text, type) {
  const el = document.getElementById("detailMessage");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

window.initCollectDetailView = async function initCollectDetailView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const content = document.getElementById("detailContent");
  const titleEl = document.getElementById("detailTitle");
  if (!id || !content) {
    showMsg("잘못된 접근입니다. 목록에서 다시 선택해 주세요.", "error");
    return;
  }

  showMsg("");
  try {
    const row = await fetchJson(`${COLLECTION_API}/${id}`);
    if (titleEl) titleEl.textContent = row.process_name || "수집부 상세";
    const stClass = row.status === "비정상" ? "status-bad" : "status-ok";
    const inUseOn = row.in_use !== false;
    const inUseClass = inUseOn ? "status-ok" : "status-inactive";
    const inUseText = inUseOn ? "사용" : "미사용";
    content.innerHTML = `
      <p class="list-modal-meta">
        <strong>${escapeHtml(row.process_name)}</strong>
        <span class="code-text">${escapeHtml(row.process_code)}</span>
      </p>
      <p class="list-modal-note">이 공정에 연결된 수집 채널·로그는 추후 연동됩니다. 현재는 상세 정보만 표시합니다.</p>
      <ul class="detail-list">
        <li>공정코드: ${escapeHtml(row.process_code)}</li>
        <li>공정상태: <span class="${stClass}">${escapeHtml(row.status)}</span></li>
        <li>사용여부: <span class="${inUseClass}">${escapeHtml(inUseText)}</span></li>
        <li>자동제어: ${escapeHtml(row.auto_control)}</li>
        <li>등록일: ${escapeHtml(row.created_at || "—")}</li>
      </ul>
    `;
  } catch (e) {
    showMsg(e.message, "error");
    content.innerHTML = "";
  }
};
