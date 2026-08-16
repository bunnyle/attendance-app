// 班表（排班）功能的共用可视化模块：颜色分配、跨天班次拆分、周历网格渲染。
// 管理员端和员工端各自负责 Firestore 数据读写和弹窗表单，这个文件只管「画出一周网格」这件事。

import { toDateStr, startOfWeekStr, escapeHtml } from "./utils.js";
import { t } from "./i18n.js";

// 主播/员工的颜色条自动按 uid 哈希固定分配，同一个人在任何一周里颜色都不会变
export const SHIFT_COLORS = [
  "#6253d4",
  "#d1477a",
  "#1a9c7a",
  "#e08a1f",
  "#2f7fd6",
  "#b5308f",
  "#4f9a2c",
  "#c2410c",
  "#0e8a8a",
  "#7c3aed",
  "#b91c3c",
  "#0369a1"
];

export function colorForUid(uid) {
  let hash = 0;
  const s = String(uid || "");
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return SHIFT_COLORS[hash % SHIFT_COLORS.length];
}

const HOUR_PX = 40;
const DAY_PX = HOUR_PX * 24;

function timeToMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function minToTime(min) {
  const m = ((Math.round(min / 30) * 30) % 1440 + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDaysStr(weekStart, i));
}

// 把一条记录（班次或实际打卡）拆成落在某一天里的时间段。
// 跨天（结束时间数值上早于开始时间）会拆成两段：开始那天的后半段 + 次日的前半段。
function segmentsForDay(item, dateStr) {
  const startMin = timeToMin(item.startTime);
  let endMin = timeToMin(item.endTime);
  const overnight = endMin <= startMin;
  const segs = [];
  if (item.date === dateStr) {
    segs.push({ start: startMin, end: overnight ? 1440 : endMin });
  }
  if (overnight && addDaysStr(item.date, 1) === dateStr) {
    segs.push({ start: 0, end: endMin });
  }
  return segs;
}

// 贪心算法：把同一天里互相时间重叠的时段分到不同"泳道"（并排显示），不重叠的可以共用泳道。
// items 需要带 _segStart / _segEnd 字段。返回 { laneOf: Map(itemKey -> laneIndex), laneCount }
function packLanes(items) {
  const sorted = [...items].sort((a, b) => a._segStart - b._segStart);
  const laneEnds = [];
  const laneOf = new Map();
  sorted.forEach((it) => {
    let lane = laneEnds.findIndex((end) => end <= it._segStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it._segEnd);
    } else {
      laneEnds[lane] = it._segEnd;
    }
    laneOf.set(it._key, lane);
  });
  return { laneOf, laneCount: Math.max(1, laneEnds.length) };
}

function fmtHM(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * 渲染一整周的网格视图。
 * opts:
 *   weekStart: "YYYY-MM-DD"（周日）
 *   shifts: [{id,uid,employeeName,date,startTime,endTime,status}]
 *   actuals: 可选，[{uid,date,startTime,endTime,status}]（实际打卡记录，用来跟排班对比，仅管理端传）
 *   mode: "admin" | "employee"
 *   onSlotClick(dateStr, hour): 点击空白格子（新建班次），不传则不可点击新建
 *   onShiftClick(shift): 点击已有班次条
 *   onActualClick(actual): 点击实际打卡的浅色条
 */
export function renderWeekGrid(container, opts) {
  const { weekStart, shifts = [], actuals = [], mode = "admin", onSlotClick, onShiftClick, onActualClick } = opts;
  const days = weekDates(weekStart);
  const today = toDateStr(new Date());
  const weekdayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  const hourLabels = Array.from({ length: 24 }, (_, h) => {
    const period = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12} ${period}`;
  });

  const dayHeaderHtml = days
    .map((d, i) => {
      const dayNum = Number(d.slice(8, 10));
      const isToday = d === today;
      return `<div class="week-day-head${isToday ? " week-day-head-today" : ""}">
        <div class="week-day-name">${t("cal." + weekdayKeys[i])}</div>
        <div class="week-day-num${isToday ? " week-day-num-today" : ""}">${dayNum}</div>
      </div>`;
    })
    .join("");

  const hourLabelsHtml = hourLabels
    .map((label) => `<div class="week-hour-label" style="height:${HOUR_PX}px;">${label}</div>`)
    .join("");

  const dayColumnsHtml = days
    .map((dateStr) => {
      const hourCells = Array.from(
        { length: 24 },
        (_, h) => `<div class="week-hour-cell" style="height:${HOUR_PX}px;" data-date="${dateStr}" data-hour="${h}"></div>`
      ).join("");

      // 这一天里所有班次的时间段
      const shiftBlocks = [];
      shifts.forEach((s) => {
        segmentsForDay(s, dateStr).forEach((seg, i) => {
          shiftBlocks.push({ ...seg, _key: `${s.id}-${i}`, _segStart: seg.start, _segEnd: seg.end, shift: s });
        });
      });
      const { laneOf, laneCount } = packLanes(shiftBlocks);

      const shiftBarsHtml = shiftBlocks
        .map((b) => {
          const s = b.shift;
          const lane = laneOf.get(b._key) || 0;
          const top = (b.start / 1440) * DAY_PX;
          const height = Math.max(10, ((b.end - b.start) / 1440) * DAY_PX);
          const left = (lane / laneCount) * 100;
          const width = 100 / laneCount;
          const color = colorForUid(s.uid);
          const pending = s.status === "pending";
          const rejected = s.status === "rejected";
          const label = `${escapeHtml(s.employeeName || "")} · ${fmtHM(timeToMin(s.startTime))}–${fmtHM(timeToMin(s.endTime))}`;
          return `<div class="shift-bar${pending ? " shift-bar-pending" : ""}${rejected ? " shift-bar-rejected" : ""}"
            style="top:${top}px; height:${height}px; left:calc(${left}% + 2px); width:calc(${width}% - 4px); background:${rejected ? "transparent" : color}; border-color:${color};"
            data-shift-id="${s.id}" title="${label}${pending ? " (" + t("status.pending") + ")" : ""}">
            <span class="shift-bar-label">${escapeHtml(s.employeeName || "")}</span>
          </div>`;
        })
        .join("");

      // 实际打卡时间的浅色叠加条：尽量复用同一位员工当天排班条所在的泳道，方便直接对比
      let actualBarsHtml = "";
      if (actuals && actuals.length) {
        const laneByUid = {};
        shiftBlocks.forEach((b) => {
          laneByUid[b.shift.uid] = laneOf.get(b._key) || 0;
        });
        const actualBlocks = [];
        actuals.forEach((a) => {
          segmentsForDay(a, dateStr).forEach((seg, i) => {
            actualBlocks.push({ ...seg, _key: `a-${a.uid}-${dateStr}-${i}`, _segStart: seg.start, _segEnd: seg.end, actual: a });
          });
        });
        // 没有对应排班的实际打卡，单独占一条泳道（说明是没排班却来上班，或者排班对不上），追加在已用泳道之后
        let extraLane = laneCount;
        const laneByActualKey = {};
        actualBlocks.forEach((b) => {
          if (laneByUid[b.actual.uid] !== undefined) {
            laneByActualKey[b._key] = laneByUid[b.actual.uid];
          } else {
            laneByActualKey[b._key] = extraLane++;
          }
        });
        const totalLanes = Math.max(laneCount, extraLane);
        actualBarsHtml = actualBlocks
          .map((b) => {
            const a = b.actual;
            const lane = laneByActualKey[b._key];
            const top = (b.start / 1440) * DAY_PX;
            const height = Math.max(8, ((b.end - b.start) / 1440) * DAY_PX);
            const left = (lane / totalLanes) * 100;
            const width = 100 / totalLanes;
            const color = colorForUid(a.uid);
            const label = `${escapeHtml(a.employeeName || "")} · ${t("schedule.actualLabel")} ${fmtHM(timeToMin(a.startTime))}–${fmtHM(timeToMin(a.endTime))}`;
            return `<div class="shift-bar-actual" style="top:${top}px; height:${height}px; left:calc(${left}% + 5px); width:calc(${width}% - 10px); background:${color};" title="${label}" data-actual-uid="${a.uid}" data-actual-date="${a.date}"></div>`;
          })
          .join("");
      }

      return `<div class="week-day-col" data-date="${dateStr}" style="height:${DAY_PX}px;">
        ${hourCells}
        <div class="week-day-col-events">${shiftBarsHtml}${actualBarsHtml}</div>
      </div>`;
    })
    .join("");

  container.innerHTML = `
    <div class="week-header-row">
      <div class="week-hour-gutter-head"></div>
      ${dayHeaderHtml}
    </div>
    <div class="week-body-scroll">
      <div class="week-body-inner">
        <div class="week-hour-gutter">${hourLabelsHtml}</div>
        <div class="week-days-row">${dayColumnsHtml}</div>
      </div>
    </div>
  `;

  if (onSlotClick) {
    container.querySelectorAll(".week-hour-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        onSlotClick(cell.dataset.date, Number(cell.dataset.hour));
      });
    });
  }
  if (onShiftClick) {
    container.querySelectorAll(".shift-bar").forEach((bar) => {
      bar.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = bar.dataset.shiftId;
        const shift = shifts.find((s) => s.id === id);
        if (shift) onShiftClick(shift);
      });
    });
  }
  if (onActualClick) {
    container.querySelectorAll(".shift-bar-actual").forEach((bar) => {
      bar.addEventListener("click", (e) => {
        e.stopPropagation();
        const uid = bar.dataset.actualUid;
        const date = bar.dataset.actualDate;
        const actual = actuals.find((a) => a.uid === uid && a.date === date);
        if (actual) onActualClick(actual);
      });
    });
  }

  // 打开时自动滚动到早上 8 点附近，避免用户一进来先看到一整屏凌晨的空白时段
  const scrollEl = container.querySelector(".week-body-scroll");
  if (scrollEl) scrollEl.scrollTop = 6 * HOUR_PX;
}

export { minToTime, timeToMin, startOfWeekStr };
