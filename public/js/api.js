async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (res.status === 401) {
    window.location.replace("/html/login/login.html");
    throw new Error("로그인이 필요합니다.");
  }
  const data = res.headers.get("content-type")?.includes("application/json")
    ? await res.json()
    : null;
  if (!res.ok) {
    const msg = data?.error || res.statusText || "요청 실패";
    throw new Error(msg);
  }
  return data;
}
