const COLLECTION_API = "/api/collection-units";

const DEFAULT_TAG = () => ({
  tag_id: "",
  dataType: "DWord",
  address: "",
  ratio: "1",
});

let currentUnitId = null;
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
    dataType,
    address,
    ratio: rowEl.querySelector(".js-tag-ratio")?.value?.trim() ?? "1",
  };
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

async function persistTagsFromDom(unitId, { silent } = {}) {
  if (unitId == null) return;
  const mount = getMount();
  if (!mount) return;
  const rows = [...mount.querySelectorAll(".tag-row-block")];
  const tags = rows.map(readRowFromRowEl);
  try {
    await fetchJson(`${COLLECTION_API}/${unitId}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tags }),
    });
    if (!silent) showListMsg("저장되었습니다.", "ok");
  } catch (e) {
    if (!silent) showListMsg(e.message, "error");
  }
}

function applyTagRowValues(rowEl, tag) {
  rowEl.querySelector(".js-tag-id").value = tag.tag_id ?? "";
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

function rowMatchesSearch(rowEl, q) {
  if (!q) return true;
  const d = readRowFromRowEl(rowEl);
  const hay = `${d.tag_id} ${d.dataType} ${d.address} ${d.ratio}`.toLowerCase();
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

function updateRemoveButtonsVisibility() {
  const mount = getMount();
  if (!mount) return;
  const rows = mount.querySelectorAll(".tag-row-block");
  const single = rows.length <= 1;
  rows.forEach((row) => {
    const btn = row.querySelector("[data-remove-tag-row]");
    if (btn) {
      btn.disabled = single;
      btn.style.opacity = single ? "0.45" : "1";
      btn.style.cursor = single ? "not-allowed" : "pointer";
    }
  });
}

function appendTagRow(tag) {
  const tpl = document.getElementById("tagRowTpl");
  const mount = getMount();
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
    updateRemoveButtonsVisibility();
    if (currentUnitId != null) await persistTagsFromDom(currentUnitId, { silent: true });
    applyTagSearch();
  });

  row.querySelector("[data-save-tag-row]")?.addEventListener("click", async () => {
    if (currentUnitId == null) return;
    await persistTagsFromDom(currentUnitId, { silent: false });
  });

  mount.appendChild(frag);
  updateRemoveButtonsVisibility();
  applyTagSearch();
}

window.initCollectDetailListView = async function initCollectDetailListView() {
  const id = new URLSearchParams(window.location.search).get("id");
  const mount = getMount();
  const meta = document.getElementById("unitMeta");
  const btnAdd = document.getElementById("btnTagAdd");

  currentUnitId = id;

  if (!id || !mount) {
    showListMsg("잘못된 접근입니다. 수집부 목록에서 다시 선택해 주세요.", "error");
    return;
  }

  showListMsg("");
  mount.innerHTML = "";

  try {
    const unit = await fetchJson(`${COLLECTION_API}/${id}`);
    if (meta) {
      const stClass = unit.status === "비정상" ? "status-bad" : "status-ok";
      const inUseOn = unit.in_use !== false;
      const inUseClass = inUseOn ? "status-ok" : "status-inactive";
      const inUseText = inUseOn ? "사용" : "미사용";
      meta.hidden = false;
      meta.innerHTML = `${escapeHtml(unit.process_name)} · <span class="code-text">${escapeHtml(
        unit.process_code
      )}</span> · <span class="${stClass}">${escapeHtml(unit.status)}</span> · <span class="${inUseClass}">${escapeHtml(
        inUseText
      )}</span> · 자동제어 ${escapeHtml(unit.auto_control)}`;
    }

    let loadedTags = [];
    try {
      const tagRes = await fetchJson(`${COLLECTION_API}/${id}/tags`);
      loadedTags = Array.isArray(tagRes.tags) ? tagRes.tags : [];
    } catch {
      loadedTags = [];
    }

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
        tag_id: unit.process_code || "",
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
        appendTagRow(DEFAULT_TAG());
      });
    }
  } catch (e) {
    showListMsg(e.message, "error");
  }
};
