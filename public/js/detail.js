const API = "/api/members";

const el = {
  form: document.getElementById("adminDetailForm"),
  title: document.getElementById("detailTitle"),
  message: document.getElementById("detailMessage"),
  fieldId: document.getElementById("fieldId"),
  fieldUsername: document.getElementById("fieldUsername"),
  fieldPassword: document.getElementById("fieldPassword"),
  fieldPasswordConfirm: document.getElementById("fieldPasswordConfirm"),
  fieldName: document.getElementById("fieldName"),
  fieldEmail: document.getElementById("fieldEmail"),
  fieldPhone: document.getElementById("fieldPhone"),
  fieldRole: document.getElementById("fieldRole"),
  passwordHint: document.getElementById("passwordHint"),
  passwordReq: document.getElementById("passwordReq"),
  passwordConfirmReq: document.getElementById("passwordConfirmReq"),
  passwordConfirmHint: document.getElementById("passwordConfirmHint"),
  btnCancel: document.getElementById("btnCancel"),
  btnLogout: document.getElementById("btnLogout"),
};

function showMessage(text, type) {
  if (!el.message) return;
  el.message.textContent = text;
  el.message.hidden = !text;
  el.message.className = "hint collection-hint" + (type ? ` ${type}` : "");
}

function getEditId() {
  const id = new URLSearchParams(window.location.search).get("id");
  if (!id) return null;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function goList() {
  window.location.href = "/html/admin/index.html";
}

function setCreateMode() {
  el.title.textContent = "관리자 등록";
  el.form.reset();
  el.fieldId.value = "";
  el.fieldUsername.disabled = false;
  el.fieldUsername.value = "";
  el.fieldPassword.value = "";
  el.fieldPasswordConfirm.value = "";
  el.fieldPassword.placeholder = "";
  el.fieldPassword.setAttribute("required", "required");
  el.fieldPasswordConfirm.setAttribute("required", "required");
  el.passwordHint.hidden = true;
  if (el.passwordReq) el.passwordReq.hidden = false;
  if (el.passwordConfirmReq) el.passwordConfirmReq.hidden = false;
  if (el.passwordConfirmHint) el.passwordConfirmHint.hidden = true;
  el.fieldRole.value = "admin";
  el.fieldUsername.focus();
}

async function setEditMode(id) {
  el.title.textContent = "관리자 수정";
  el.fieldId.value = String(id);
  el.fieldUsername.disabled = true;
  el.fieldPassword.value = "";
  el.fieldPasswordConfirm.value = "";
  el.fieldPassword.placeholder = "변경 시에만 입력";
  el.fieldPassword.removeAttribute("required");
  el.fieldPasswordConfirm.removeAttribute("required");
  el.passwordHint.hidden = false;
  if (el.passwordReq) el.passwordReq.hidden = true;
  if (el.passwordConfirmReq) el.passwordConfirmReq.hidden = true;
  if (el.passwordConfirmHint) el.passwordConfirmHint.hidden = false;

  const row = await fetchJson(`${API}/${id}`);
  el.fieldUsername.value = row.username ?? "";
  el.fieldName.value = row.name ?? "";
  el.fieldEmail.value = row.email ?? "";
  el.fieldPhone.value = row.phone ?? "";
  el.fieldRole.value = row.role || "admin";
  el.fieldName.focus();
}

async function init() {
  try {
    const me = await fetchJson("/api/auth/me");
    const badge = document.getElementById("userBadge");
    if (badge && me?.user?.username) {
      badge.textContent = `로그인: ${me.user.username}`;
      badge.hidden = false;
    }
  } catch (e) {
    return;
  }

  el.btnLogout?.addEventListener("click", async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } catch (_) {
      /* */
    }
    window.location.replace("/html/login/login.html");
  });

  el.btnCancel?.addEventListener("click", () => goList());

  const editId = getEditId();
  if (editId) {
    try {
      await setEditMode(editId);
    } catch (err) {
      showMessage(err.message || "관리자를 불러오지 못했습니다.", "error");
    }
  } else {
    setCreateMode();
  }

  el.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage("");
    const id = el.fieldId.value.trim();
    const isCreate = !id;
    // 모드에 따라 required를 확실히 맞춘다(브라우저 기본 검증용).
    if (isCreate) {
      el.fieldPassword.setAttribute("required", "required");
      el.fieldPasswordConfirm.setAttribute("required", "required");
    } else {
      el.fieldPassword.removeAttribute("required");
      el.fieldPasswordConfirm.removeAttribute("required");
    }
    const name = el.fieldName.value.trim();
    const email = el.fieldEmail.value.trim();
    const body = {
      name,
      email,
      phone: el.fieldPhone.value,
      role: el.fieldRole.value,
    };

    try {
      if (!id) {
        body.username = el.fieldUsername.value.trim();
        body.password = el.fieldPassword.value;
        if (!body.username || !body.password) {
          showMessage("아이디와 비밀번호를 입력하세요.", "error");
          return;
        }
        if (body.password !== el.fieldPasswordConfirm.value) {
          showMessage("비밀번호가 일치하지 않습니다.", "error");
          return;
        }
        await fetchJson(API, { method: "POST", body: JSON.stringify(body) });
      } else {
        const rawPw = el.fieldPassword.value;
        const rawPwConfirm = el.fieldPasswordConfirm.value;
        const pw = rawPw.trim();
        if (pw) {
          if (rawPw !== rawPwConfirm) {
            showMessage("비밀번호가 일치하지 않습니다.", "error");
            return;
          }
          body.password = pw;
        } else if (rawPwConfirm.trim()) {
          showMessage("비밀번호를 입력하지 않았습니다. 확인란을 비우거나 비밀번호를 입력하세요.", "error");
          return;
        }
        await fetchJson(`${API}/${id}`, { method: "PUT", body: JSON.stringify(body) });
      }
      goList();
    } catch (err) {
      showMessage(err.message, "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
