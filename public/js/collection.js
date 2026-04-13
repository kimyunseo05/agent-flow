const COLLECTION_API = "/api/collection-units";

const col = {
  tbody: null,
  empty: null,
  message: null,
  search: null,
  pageSize: null,
  btnAdd: null,
  state: { page: 1, pageSize: 10, q: "", total: 0 },
};

function colShowMessage(text, type) {
  if (!col.message) return;
  col.message.textContent = text;
  col.message.hidden = !text;
  col.message.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function statusClass(status) {
  return status === "비정상" ? "status-bad" : "status-ok";
}

function inUseClass(inUse) {
  return inUse ? "status-ok" : "status-inactive";
}

function inUseLabel(inUse) {
  return inUse ? "사용" : "미사용";
}

async function loadCollectionList() {
  colShowMessage("");
  const { page, pageSize, q } = col.state;
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q });
  try {
    const data = await fetchJson(`${COLLECTION_API}?${params}`);
    col.state.total = data.total ?? 0;
    renderCollectionRows(data.items ?? []);
    updateCollectionPager();
  } catch (e) {
    colShowMessage(e.message, "error");
    if (col.empty) col.empty.hidden = false;
  }
}

function renderCollectionRows(items) {
  if (!col.tbody) return;
  col.tbody.innerHTML = "";
  if (col.empty) col.empty.hidden = items.length > 0;

  for (const row of items) {
    const detailUrl = `/html/collect/detail.html?id=${row.id}`;
    const detailUrlForBtn = `/html/collect/detail-list.html?id=${row.id}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a class="link-like" href="${detailUrl}">${escapeHtml(row.process_name)}</a></td>
      <td><a class="code-text" href="${detailUrl}">${escapeHtml(row.process_code)}</span></a></td>
      <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
      <td><span class="status-pill ${inUseClass(row.in_use !== false)}">${escapeHtml(inUseLabel(row.in_use !== false))}</span></td>
      <td>${escapeHtml(row.auto_control)}</td>
      <td class="actions">
        <a class="btn btn-sm btn-primary-solid" href="${detailUrlForBtn}">목록 보기</a>
        <button type="button" class="btn btn-sm btn-danger-solid" data-del="${row.id}">삭제</button>
      </td>
    `;
    col.tbody.appendChild(tr);
  }

  col.tbody.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("이 수집부를 삭제할까요?")) return;
      try {
        await fetchJson(`${COLLECTION_API}/${id}`, { method: "DELETE" });
        colShowMessage("삭제되었습니다.", "ok");
        await loadCollectionList();
      } catch (e) {
        colShowMessage(e.message, "error");
      }
    });
  });
}

function updateCollectionPager() {
  const elPager = document.getElementById("collectionPager");
  if (!elPager) return;
  const { page, pageSize, total } = col.state;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  elPager.textContent = `총 ${total}건 · ${page} / ${totalPages} 페이지`;
}

let collectionBindingsDone = false;

function bindCollectionOnce() {
  if (collectionBindingsDone) return;
  collectionBindingsDone = true;

  col.tbody = document.getElementById("collectionRows");
  col.empty = document.getElementById("collectionEmpty");
  col.message = document.getElementById("collectionMessage");
  col.search = document.getElementById("collectionSearch");
  col.pageSize = document.getElementById("collectionPageSize");
  col.btnAdd = document.getElementById("btnCollectionAdd");

  col.btnAdd?.addEventListener("click", () => {
    window.location.href = "/html/collect/detail-add.html";
  });

  col.search?.addEventListener("input", () => {
    col.state.q = col.search.value.trim();
    col.state.page = 1;
    loadCollectionList();
  });

  col.pageSize?.addEventListener("change", () => {
    col.state.pageSize = Number(col.pageSize.value) || 10;
    col.state.page = 1;
    loadCollectionList();
  });

  document.getElementById("btnCollectionPrev")?.addEventListener("click", () => {
    if (col.state.page > 1) {
      col.state.page -= 1;
      loadCollectionList();
    }
  });
  document.getElementById("btnCollectionNext")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(col.state.total / col.state.pageSize));
    if (col.state.page < totalPages) {
      col.state.page += 1;
      loadCollectionList();
    }
  });
}

window.initCollectionView = function initCollectionView() {
  bindCollectionOnce();
  if (col.pageSize) col.state.pageSize = Number(col.pageSize.value) || 10;
  loadCollectionList();
};
