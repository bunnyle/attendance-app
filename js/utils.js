// 通用工具函数

export function todayStr() {
  const d = new Date();
  return toDateStr(d);
}

export function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function currentMonthStr() {
  return todayStr().slice(0, 7); // YYYY-MM
}

// 计算工时（小时），start/end 格式 "HH:MM"，lunchMinutes 为午休分钟数
export function calcWorkedHours(start, end, lunchMinutes) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  let startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) return 0; // 不支持跨日
  const lunch = Number(lunchMinutes) || 0;
  const worked = endMin - startMin - lunch;
  return Math.max(0, Math.round((worked / 60) * 100) / 100);
}

export function formatHours(h) {
  return (Math.round(h * 100) / 100).toFixed(2);
}

export function formatMoney(v) {
  return Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// 用户名统一转成小写、去空格，作为 Firestore 文档 ID 使用
export function normalizeUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

let toastTimer = null;
export function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

export function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
