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

// 计算工时（小时），start/end 格式 "HH:MM"，lunchMinutes 为午休分钟数。
// 支持跨天班次（比如 22:00 上班、次日 01:00 下班）：结束时间比开始时间早，
// 就当作跨过了一次午夜，自动加 24 小时再算。结束时间等于开始时间视为无效（0 工时）。
export function calcWorkedHours(start, end, lunchMinutes) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return 0;
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin === startMin) return 0;
  if (endMin < startMin) endMin += 24 * 60; // 跨天班次
  const lunch = Number(lunchMinutes) || 0;
  const worked = endMin - startMin - lunch;
  return Math.max(0, Math.round((worked / 60) * 100) / 100);
}

// 是否是跨天班次（结束时间数值上比开始时间早），纯用于 UI 上给用户一个"是否已识别为跨天"的小提示
export function isOvernightShift(start, end) {
  if (!start || !end) return false;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return false;
  return eh * 60 + em < sh * 60 + sm;
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

// 首次加载时用的骨架屏占位（比纯文字更顺滑），n 为占位条数
export function skeletonRows(n = 3) {
  return `<div class="skeleton-list">${Array.from({ length: n })
    .map(() => '<div class="skeleton-row"></div>')
    .join("")}</div>`;
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

// 生成 [fromStr, todayStr] 区间内每一天的日期字符串列表（含首尾）
export function dateRangeDays(fromStr, toStr) {
  const days = [];
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return days;
  const cursor = new Date(from);
  // 最多给 400 天封顶，避免日期输入异常时卡死
  let guard = 0;
  while (cursor <= to && guard < 400) {
    days.push(toDateStr(cursor));
    cursor.setDate(cursor.getDate() + 1);
    guard++;
  }
  return days;
}

export function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - (n - 1));
  return toDateStr(d);
}

// 生成一个不依赖任何图表库的极简 SVG 柱状图。
// data: [{ label, value }]，value 为当天工时（小时）
export function renderBarChartSVG(data, opts = {}) {
  const width = opts.width || 640;
  const height = opts.height || 160;
  const padTop = 10;
  const padBottom = 22;
  const padLeft = 4;
  const padRight = 4;
  const plotHeight = height - padTop - padBottom;
  const max = Math.max(1, ...data.map((d) => d.value || 0));
  const n = Math.max(1, data.length);
  const gap = n > 40 ? 1 : n > 20 ? 2 : 4;
  const barWidth = Math.max(1, (width - padLeft - padRight) / n - gap);

  const bars = data
    .map((d, i) => {
      const x = padLeft + i * (barWidth + gap);
      const v = d.value || 0;
      const barHeight = v > 0 ? Math.max(2, (v / max) * plotHeight) : 0.5;
      const y = padTop + (plotHeight - barHeight);
      const opacity = v > 0 ? 1 : 0.12;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(0.5, barHeight).toFixed(1)}" rx="2" fill="var(--primary)" opacity="${opacity}"><title>${escapeHtml(d.label)}: ${formatHours(v)}</title></rect>`;
    })
    .join("");

  const baselineY = (height - padBottom).toFixed(1);
  const firstLabel = data.length ? escapeHtml(data[0].label) : "";
  const lastLabel = data.length ? escapeHtml(data[data.length - 1].label) : "";

  return `
    <svg viewBox="0 0 ${width} ${height}" class="mini-chart" preserveAspectRatio="none" role="img">
      <line x1="0" y1="${baselineY}" x2="${width}" y2="${baselineY}" stroke="var(--border)" stroke-width="1" />
      ${bars}
      <text x="0" y="${height - 6}" font-size="10" fill="var(--muted)">${firstLabel}</text>
      <text x="${width}" y="${height - 6}" font-size="10" fill="var(--muted)" text-anchor="end">${lastLabel}</text>
    </svg>
  `;
}
