const MODEL_API = "/api/model-units";

const modelList = {
  tbody: null,
  empty: null,
  message: null,
  search: null,
  pageSize: null,
  btnAdd: null,
  state: { page: 1, pageSize: 10, q: "", total: 0 },
};

function modelShowMessage(text, type) {
  if (!modelList.message) return;
  modelList.message.textContent = text;
  modelList.message.hidden = !text;
  modelList.message.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function statusClass(status) {
  return status === "비정상" ? "status-bad" : "status-ok";
}

async function loadModelList() {
  modelShowMessage("");
  const { page, pageSize, q } = modelList.state;
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), q });
  try {
    const data = await fetchJson(`${MODEL_API}?${params}`);
    modelList.state.total = data.total ?? 0;
    renderModelRows(data.items ?? []);
    updateModelPager();
  } catch (e) {
    modelShowMessage(e.message, "error");
    if (modelList.empty) modelList.empty.hidden = false;
  }
}

function renderModelRows(items) {
  if (!modelList.tbody) return;
  modelList.tbody.innerHTML = "";
  if (modelList.empty) modelList.empty.hidden = items.length > 0;

  for (const row of items) {
    const detailUrl = `/html/model/detail.html?id=${row.id}`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><a class="link-like" href="${detailUrl}">${escapeHtml(row.model_name)}</a></td>
      <td><a class="code-text" href="${detailUrl}">${escapeHtml(row.model_code)}</a></td>
      <td><span class="status-pill ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
      <td>${escapeHtml(row.auto_learn)}</td>
      <td class="actions">
        <button type="button" class="btn btn-sm btn-danger-solid" data-model-del="${row.id}">삭제</button>
      </td>
    `;
    modelList.tbody.appendChild(tr);
  }

  modelList.tbody.querySelectorAll("[data-model-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-model-del");
      if (!confirm("이 모델을 삭제할까요?")) return;
      try {
        await fetchJson(`${MODEL_API}/${id}`, { method: "DELETE" });
        modelShowMessage("삭제되었습니다.", "ok");
        await loadModelList();
      } catch (e) {
        modelShowMessage(e.message, "error");
      }
    });
  });
}

function updateModelPager() {
  const elPager = document.getElementById("modelPager");
  if (!elPager) return;
  const { page, pageSize, total } = modelList.state;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  elPager.textContent = `총 ${total}건 · ${page} / ${totalPages} 페이지`;
}

let modelListBindingsDone = false;

function bindModelListOnce() {
  if (modelListBindingsDone) return;
  modelListBindingsDone = true;

  modelList.tbody = document.getElementById("modelRows");
  modelList.empty = document.getElementById("modelEmpty");
  modelList.message = document.getElementById("modelMessage");
  modelList.search = document.getElementById("modelSearch");
  modelList.pageSize = document.getElementById("modelPageSize");
  modelList.btnAdd = document.getElementById("btnModelAdd");

  modelList.btnAdd?.addEventListener("click", () => {
    window.location.href = "/html/model/detail-add.html";
  });

  modelList.search?.addEventListener("input", () => {
    modelList.state.q = modelList.search.value.trim();
    modelList.state.page = 1;
    loadModelList();
  });

  modelList.pageSize?.addEventListener("change", () => {
    modelList.state.pageSize = Number(modelList.pageSize.value) || 10;
    modelList.state.page = 1;
    loadModelList();
  });

  document.getElementById("btnModelPrev")?.addEventListener("click", () => {
    if (modelList.state.page > 1) {
      modelList.state.page -= 1;
      loadModelList();
    }
  });
  document.getElementById("btnModelNext")?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(modelList.state.total / modelList.state.pageSize));
    if (modelList.state.page < totalPages) {
      modelList.state.page += 1;
      loadModelList();
    }
  });
}

function initModelView() {
  bindModelListOnce();
  if (modelList.pageSize) modelList.state.pageSize = Number(modelList.pageSize.value) || 10;
  loadModelList();
}

window.initModelView = initModelView;
