const MODEL_API = "/api/model-units";

const DEFAULT_TAG = () => ({
  tag_id: "",
  description: "",
  dataType: "DWord",
  address: "",
  ratio: "1",
});

let currentModelId = null;
let currentModel = null;
let addButtonBound = false;
let tagListPage = 1;
let tagListPaginationBound = false;

function showListMsg(text, type) {
  const el = document.getElementById("listMessage");
  if (!el) return;
  el.textContent = text;
  el.hidden = !text;
  el.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function getMount() {
  return document.getElementById("tagListMount");
}

function getTagListPageSize() {
  const sel = document.getElementById("adminPageSize");
  return Math.max(1, Number(sel?.value) || 10);
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

const DWORD_ADDR_SEP = "|";

function readRowFromRowEl(rowEl) {
  const dataType = rowEl.querySelector(".js-data-type")?.value ?? "DWord";
  const a1 = rowEl.querySelector(".js-tag-addr")?.value?.trim() ?? "";
  const a2 = rowEl.querySelector(".js-tag-addr-2")?.value?.trim() ?? "";
  let address = a1;
  if (dataType === "DWord") {
    address = a2 ? `${a1}${DWORD_ADDR_SEP}${a2}` : a1;
  }
  return {
    tag_id: rowEl.querySelector(".js-tag-id")?.value?.trim() ?? "",
    description: rowEl.querySelector(".js-tag-description")?.value?.trim() ?? "",
    dataType,
    address,
    ratio: rowEl.querySelector(".js-tag-ratio")?.value?.trim() ?? "1",
  };
}

function rowsMatchingSearch() {
  const mount = getMount();
  if (!mount) return [];
  return [...mount.querySelectorAll(".tag-row-block")].filter(
    (r) => !r.classList.contains("tag-row-block--hidden")
  );
}

function updateTagListPager(total) {
  const elPager = document.getElementById("adminPager");
  if (!elPager) return;
  const pageSize = getTagListPageSize();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  elPager.textContent = `총 ${total}건 · ${tagListPage} / ${totalPages} 페이지`;
}

function applyTagListPagination() {
  const mount = getMount();
  if (!mount) return;
  const rows = [...mount.querySelectorAll(".tag-row-block")];
  const visibleForSearch = rowsMatchingSearch();
  const total = visibleForSearch.length;
  const pageSize = getTagListPageSize();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (tagListPage > totalPages) tagListPage = totalPages;
  if (tagListPage < 1) tagListPage = 1;

  const start = (tagListPage - 1) * pageSize;
  const end = start + pageSize;

  visibleForSearch.forEach((row, i) => {
    const onPage = i >= start && i < end;
    row.classList.toggle("tag-row-block--page-hidden", !onPage);
  });

  rows.forEach((r) => {
    if (r.classList.contains("tag-row-block--hidden")) {
      r.classList.remove("tag-row-block--page-hidden");
    }
  });

  updateTagListPager(total);

  const btnPrev = document.getElementById("btnAdminPrev");
  const btnNext = document.getElementById("btnAdminNext");
  if (btnPrev) btnPrev.disabled = tagListPage <= 1;
  if (btnNext) btnNext.disabled = tagListPage >= totalPages;
}

function rowMatchesSearch(rowEl, q) {
  if (!q) return true;
  const d = readRowFromRowEl(rowEl);
  const hay = `${d.tag_id} ${d.description} ${d.dataType} ${d.address} ${d.ratio}`.toLowerCase();
  return hay.includes(q);
}

function applyTagSearch() {
  const input = document.getElementById("tagListSearch");
  const mount = getMount();
  if (!input || !mount) return;
  const q = input.value.trim().toLowerCase();
  const rows = mount.querySelectorAll(".tag-row-block");
  let visible = 0;
  rows.forEach((row) => {
    const show = rowMatchesSearch(row, q);
    row.classList.toggle("tag-row-block--hidden", !show);
    if (show) visible += 1;
  });
  if (q && rows.length > 0 && visible === 0) {
    showListMsg("검색 조건에 맞는 항목이 없습니다.", "error");
  } else if ((!q || visible > 0) && rows.length > 0) {
    const msg = document.getElementById("listMessage");
    if (msg && msg.textContent.includes("검색 조건")) showListMsg("");
  }
  applyTagListPagination();
}

function bindSearchInput() {
  const input = document.getElementById("tagListSearch");
  if (!input || input.dataset.bound) return;
  input.dataset.bound = "1";
  input.addEventListener("input", () => {
    tagListPage = 1;
    applyTagSearch();
  });
}

function bindTagListPagination() {
  if (tagListPaginationBound) return;
  tagListPaginationBound = true;
  const sel = document.getElementById("adminPageSize");
  const btnPrev = document.getElementById("btnAdminPrev");
  const btnNext = document.getElementById("btnAdminNext");

  sel?.addEventListener("change", () => {
    tagListPage = 1;
    applyTagListPagination();
  });

  btnPrev?.addEventListener("click", () => {
    if (tagListPage > 1) {
      tagListPage -= 1;
      applyTagListPagination();
    }
  });

  btnNext?.addEventListener("click", () => {
    const total = rowsMatchingSearch().length;
    const pageSize = getTagListPageSize();
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (tagListPage < totalPages) {
      tagListPage += 1;
      applyTagListPagination();
    }
  });
}

function syncAddrInputsForDataType(rowEl) {
  const dataType = rowEl.querySelector(".js-data-type")?.value ?? "DWord";
  const row2 = rowEl.querySelector(".js-tag-addr-row-2");
  const addr2Input = rowEl.querySelector(".js-tag-addr-2");
  const b1 = rowEl.querySelector(".js-tag-addr-badge-1");

  if (!row2 || !addr2Input) return;

  const isDword = dataType === "DWord";

  row2.hidden = !isDword;
  addr2Input.disabled = !isDword;

  if (!isDword) addr2Input.value = "";

  if (b1) b1.textContent = isDword ? "주소 1" : "주소";
}

async function persistTagsFromDom(modelId, { silent } = {}) {
  if (modelId == null) return;
  const mount = getMount();
  if (!mount) return;
  const rows = [...mount.querySelectorAll(".tag-row-block")];
  const tags = rows.map(readRowFromRowEl);
  try {
    await fetchJson(`${MODEL_API}/${modelId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    });
    if (!silent) showListMsg("저장되었습니다.", "ok");
  } catch (e) {
    if (!silent) showListMsg(e.message, "error");
  }
}

function readPlcAndTagsFromDom() {
  const mount = getMount();
  const tags = mount ? [...mount.querySelectorAll(".tag-row-block")].map(readRowFromRowEl) : [];
  return {
    plc_ip: document.getElementById("plcIp")?.value?.trim() ?? "",
    plc_port: document.getElementById("plcPort")?.value?.trim() ?? "",
    plc_use_value: currentModel?.plc_use_value ?? "",
    tags,
    control_tag_id: currentModel?.control_tag_id ?? "",
  };
}

async function runPlcModbusWrite() {
  if (currentModelId == null) return;
  const payload = readPlcAndTagsFromDom();

  if (!payload.plc_ip) {
    showListMsg("PLC IP를 입력하세요.", "error");
    return;
  }
  if (!payload.plc_use_value) {
    showListMsg("PLC 제어값이 없습니다. 모델 상세 화면에서 사용값을 설정하세요.", "error");
    return;
  }
  const validTags = payload.tags.filter((t) => t.tag_id && t.address);
  if (!validTags.length) {
    showListMsg("쓰기할 태그(tag_id, 주소)를 1개 이상 등록하세요.", "error");
    return;
  }

  const ctrlHint = payload.control_tag_id
    ? `\n제어 대상 tag_id(${payload.control_tag_id})에 해당하는 태그만 쓰기 시도합니다.`
    : "";
  if (
    !confirm(
      `PLC ${payload.plc_ip}:${payload.plc_port || "502"}에 사용값 "${payload.plc_use_value}"을(를) Modbus Write 하시겠습니까?${ctrlHint}`
    )
  ) {
    return;
  }

  showListMsg("PLC Modbus Write 실행 중…", "ok");
  try {
    const result = await fetchJson(`${MODEL_API}/${currentModelId}/plc-write`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const wr = result.plc_write || {};
    const detail = (wr.results || [])
      .map((r) => (r.ok ? `✓ ${r.tag_id}` : `✗ ${r.tag_id}: ${r.error}`))
      .join(" · ");
    showListMsg(`${result.message || "PLC 제어 완료"}${detail ? ` — ${detail}` : ""}`, "ok");
  } catch (e) {
    const extra = e.data?.plc_write?.results
      ?.map((r) => (r.ok ? `✓ ${r.tag_id}` : `✗ ${r.tag_id}: ${r.error}`))
      .join(" · ");
    showListMsg(extra ? `${e.message} — ${extra}` : e.message, "error");
  }
}

async function persistPlcSettings({ silent } = {}) {
  if (currentModelId == null || !currentModel) return;
  const plc_ip = document.getElementById("plcIp")?.value?.trim() ?? "";
  const plc_port = document.getElementById("plcPort")?.value?.trim() ?? "";

  const body = { ...currentModel, plc_ip, plc_port };
  if (!body.model_name || !body.model_code || !body.table_name) {
    if (!silent) showListMsg("모델명, 모델ID, 테이블명은 필수입니다.", "error");
    return;
  }

  try {
    const result = await fetchJson(`${MODEL_API}/${currentModelId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    currentModel = result.model || result;
    setUnitMeta(currentModel);
    if (!silent) showListMsg("저장되었습니다.", "ok");
  } catch (e) {
    if (!silent) showListMsg(e.message, "error");
  }
}

function applyTagRowValues(rowEl, tag) {
  rowEl.querySelector(".js-tag-id").value = tag.tag_id ?? "";
  const descEl = rowEl.querySelector(".js-tag-description");
  if (descEl) descEl.value = tag.description ?? "";
  const sel = rowEl.querySelector(".js-data-type");
  const dt = ["Boolean", "Word", "DWord"].includes(tag.dataType) ? tag.dataType : "DWord";
  sel.value = dt;
  const raw = String(tag.address ?? "");
  const addrEl = rowEl.querySelector(".js-tag-addr");
  const addr2El = rowEl.querySelector(".js-tag-addr-2");
  if (dt === "DWord") {
    const i = raw.indexOf(DWORD_ADDR_SEP);
    if (i >= 0) {
      addrEl.value = raw.slice(0, i).trim();
      if (addr2El) addr2El.value = raw.slice(i + 1).trim();
    } else {
      addrEl.value = raw.trim();
      if (addr2El) addr2El.value = "";
    }
  } else {
    addrEl.value = raw;
    if (addr2El) addr2El.value = "";
  }
  rowEl.querySelector(".js-tag-ratio").value = tag.ratio ?? "1";
  syncAddrInputsForDataType(rowEl);
}

window.initModelDetailListView = async function initModelDetailListView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const mount = getMount();
  const btnDetail = document.getElementById("btnGoDetail");
  const btnAdd = document.getElementById("btnTagAdd");
  const btnPlcSave = document.getElementById("btnPlcSave");
  const btnPlcWrite = document.getElementById("btnPlcWrite");

  currentModelId = id;

  if (!id || !mount) {
    showListMsg("잘못된 접근입니다. 모델부 목록에서 다시 선택해 주세요.", "error");
    return;
  }

  if (btnDetail) btnDetail.href = `/html/model/detail.html?id=${id}`;
  btnPlcSave?.addEventListener("click", async () => {
    await persistPlcSettings({ silent: false });
  });
  btnPlcWrite?.addEventListener("click", async () => {
    await runPlcModbusWrite();
  });

  showListMsg("");
  mount.innerHTML = "";

  try {
    const model = await fetchJson(`${MODEL_API}/${id}`);
    currentModel = model;
    setUnitMeta(model);

    const plcIp = document.getElementById("plcIp");
    const plcPort = document.getElementById("plcPort");
    if (plcIp) plcIp.value = model.plc_ip ?? "";
    if (plcPort) plcPort.value = model.plc_port ?? "";

    let loadedTags = [];
    try {
      const tagRes = await fetchJson(`${MODEL_API}/${id}/tags`);
      loadedTags = Array.isArray(tagRes.tags) ? tagRes.tags : [];
    } catch {
      loadedTags = [];
    }

    const appendTagRow = (tag) => {
      const tpl = document.getElementById("tagRowTpl");
      if (!tpl || !mount) return;
      const frag = tpl.content.cloneNode(true);
      const row = frag.querySelector(".tag-row-block");
      applyTagRowValues(row, tag);

      row.querySelector(".js-data-type")?.addEventListener("change", () => {
        syncAddrInputsForDataType(row);
        applyTagSearch();
      });

      row.querySelector("[data-remove-tag-row]")?.addEventListener("click", async () => {
        if (mount.querySelectorAll(".tag-row-block").length <= 1) return;
        row.remove();
        if (currentModelId != null) await persistTagsFromDom(currentModelId, { silent: true });
        applyTagSearch();
      });

      row.querySelector("[data-save-tag-row]")?.addEventListener("click", async () => {
        if (currentModelId == null) return;
        await persistTagsFromDom(currentModelId, { silent: false });
      });

      mount.appendChild(frag);
      applyTagSearch();
    };

    if (loadedTags.length) {
      loadedTags.forEach((t) =>
        appendTagRow({
          ...DEFAULT_TAG(),
          ...t,
          dataType: ["Boolean", "Word", "DWord"].includes(t.dataType) ? t.dataType : "DWord",
        })
      );
    } else {
      appendTagRow({
        ...DEFAULT_TAG(),
        tag_id: model.model_code || "",
        dataType: "DWord",
        ratio: "1",
      });
    }

    bindSearchInput();
    bindTagListPagination();
    applyTagListPagination();

    if (!addButtonBound) {
      addButtonBound = true;
      btnAdd?.addEventListener("click", () => {
        const tpl = document.getElementById("tagRowTpl");
        if (!tpl) return;
        const frag = tpl.content.cloneNode(true);
        const row = frag.querySelector(".tag-row-block");
        applyTagRowValues(row, DEFAULT_TAG());
        row.querySelector(".js-data-type")?.addEventListener("change", () => {
          syncAddrInputsForDataType(row);
          applyTagSearch();
        });
        row.querySelector("[data-remove-tag-row]")?.addEventListener("click", async () => {
          if (mount.querySelectorAll(".tag-row-block").length <= 1) return;
          row.remove();
          if (currentModelId != null) await persistTagsFromDom(currentModelId, { silent: true });
          applyTagSearch();
        });
        row.querySelector("[data-save-tag-row]")?.addEventListener("click", async () => {
          if (currentModelId == null) return;
          await persistTagsFromDom(currentModelId, { silent: false });
        });
        mount.appendChild(frag);
        applyTagSearch();
      });
    }
  } catch (e) {
    showListMsg(e.message, "error");
  }
};
