const el = {
  form: document.getElementById("loginForm"),
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  message: document.getElementById("message"),
};

function showMessage(text, type) {
  el.message.textContent = text;
  el.message.hidden = !text;
  el.message.className = "hint" + (type ? ` ${type}` : "");
}

async function init() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (res.ok) {
      window.location.replace("/html/collect/index.html");
      return;
    }
  } catch (_) {
    /* 오프라인 등 — 로그인 폼 표시 */
  }
  el.username.focus();
}

el.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  showMessage("");
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: el.username.value.trim(),
        password: el.password.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "로그인에 실패했습니다.");
    }
    window.location.replace("/html/collect/index.html");
  } catch (err) {
    showMessage(err.message, "error");
  }
});

init();
