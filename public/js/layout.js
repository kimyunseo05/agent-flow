const LOGIN_HTML = "/html/login/login.html";

async function mountSidebar() {
  const mount = document.getElementById("sidebarMount");
  if (!mount) return;
  const active = document.body.dataset.nav || "";
  const res = await fetch("/html/common/sidebar.html", { credentials: "same-origin" });
  if (!res.ok) {
    mount.innerHTML = "<p class=\"sidebar-fail\">메뉴를 불러오지 못했습니다.</p>";
    return;
  }
  const html = await res.text();
  mount.innerHTML = html;
  mount.querySelectorAll("[data-nav]").forEach((el) => {
    el.classList.toggle("is-active", el.getAttribute("data-nav") === active);
  });
}

async function ensureSession() {
  const data = await fetchJson("/api/auth/me");
  const badge = document.getElementById("userBadge");
  if (badge && data?.user?.username) {
    badge.textContent = `로그인: ${data.user.username}`;
    badge.hidden = false;
  }
}

function initDashboardChrome() {
  document.getElementById("btnLogout")?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (_) {
      /* */
    }
    window.location.replace(LOGIN_HTML);
  });
}

/**
 * 사이드바가 있는 대시보드 페이지 공통 초기화 후 콜백 실행
 */
async function initDashboardPage(initFn) {
  await ensureSession();
  await mountSidebar();
  initDashboardChrome();
  if (typeof initFn === "function") initFn();
}
