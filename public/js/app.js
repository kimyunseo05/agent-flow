const API = "/api/members";

const adminState = { page: 1, pageSize: 10, q: "", total: 0 };

const el = {
  rows: document.getElementById("memberRows"),
  empty: document.getElementById("emptyState"),
  message: document.getElementById("message"),
  btnNew: document.getElementById("btnNew"),
  adminPageSize: document.getElementById("adminPageSize"),
  adminSearch: document.getElementById("adminSearch"),
  adminPager: document.getElementById("adminPager"),
  btnAdminPrev: document.getElementById("btnAdminPrev"),
  btnAdminNext: document.getElementById("btnAdminNext"),
};

function showMessage(text, type) {
  el.message.textContent = text;
  el.message.hidden = !text;
  el.message.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function updateAdminPager() {
  if (!el.adminPager) return;
  const { page, pageSize, total } = adminState;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  el.adminPager.textContent = `총 ${total}건 · ${page} / ${totalPages} 페이지`;
}

function renderRows(items) {
  el.rows.innerHTML = "";
  el.empty.hidden = items.length > 0;

  for (const m of items) {
    const tr = document.createElement("tr");
    const dispName = (m.name || "").trim() || "—";
    const detailUrl = `/html/admin/detail.html?id=${m.id}`;
    tr.innerHTML = `
      <td><a class="link-like" href="${detailUrl}">${escapeHtml(dispName)}</a></td>
      <td>${escapeHtml(m.username ?? "")}</td>
      <td>${escapeHtml((m.email || "").trim() || "—")}</td>
      <td>${escapeHtml(m.phone || "—")}</td>
      <td>${escapeHtml(m.role || "admin")}</td>
      <td>${formatDate(m.created_at)}</td>
      <td class="actions">
        <a class="btn btn-sm btn-primary-solid" href="${detailUrl}">수정</a>
        <button type="button" class="btn btn-sm btn-danger-solid" data-del="${m.id}">삭제</button>
      </td>
    `;
    el.rows.appendChild(tr);
  }

  el.rows.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      if (!confirm("이 관리자를 삭제할까요?")) return;
      try {
        await fetchJson(`${API}/${id}`, { method: "DELETE" });
        showMessage("삭제되었습니다.", "ok");
        await loadMembers();
      } catch (e) {
        showMessage(e.message, "error");
      }
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

async function loadMembers() {
  showMessage("");
  const { page, pageSize, q } = adminState;
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    q,
  });
  try {
    const data = await fetchJson(`${API}?${params}`);
    adminState.total = data.total ?? 0;
    renderRows(data.items ?? []);
    updateAdminPager();
  } catch (e) {
    showMessage(e.message, "error");
    el.empty.hidden = false;
  }
}

let adminBindingsDone = false;

function bindAdminOnce() {
  if (adminBindingsDone) return;
  adminBindingsDone = true;

  el.btnNew?.addEventListener("click", () => {
    window.location.href = "/html/admin/detail.html";
  });

  el.adminPageSize?.addEventListener("change", () => {
    adminState.pageSize = Number(el.adminPageSize.value) || 10;
    adminState.page = 1;
    loadMembers();
  });

  el.adminSearch?.addEventListener("input", () => {
    adminState.q = el.adminSearch.value.trim();
    adminState.page = 1;
    loadMembers();
  });

  el.btnAdminPrev?.addEventListener("click", () => {
    if (adminState.page > 1) {
      adminState.page -= 1;
      loadMembers();
    }
  });

  el.btnAdminNext?.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(adminState.total / adminState.pageSize));
    if (adminState.page < totalPages) {
      adminState.page += 1;
      loadMembers();
    }
  });
}

window.initAdminView = function initAdminView() {
  bindAdminOnce();
  if (el.adminPageSize) adminState.pageSize = Number(el.adminPageSize.value) || 10;
  loadMembers();
};
