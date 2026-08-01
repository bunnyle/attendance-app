import {
  db,
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "./firebase-init.js";
import {
  todayStr,
  currentMonthStr,
  calcWorkedHours,
  isOvernightShift,
  formatHours,
  formatMoney,
  showToast,
  escapeHtml,
  dateRangeDays,
  daysAgoStr,
  renderBarChartSVG,
  skeletonRows
} from "./utils.js";
import { changeOwnPassword, authErrorMessage } from "./auth.js";
import { t } from "./i18n.js";

let currentTab = "report";

function statusLabel(status) {
  return t("status." + status) || status;
}
function statusBadgeClass(status) {
  return { pending: "badge-pending", approved: "badge-approved", rejected: "badge-rejected" }[status] || "";
}

export async function submitRecord(profile, data) {
  const workedHours = calcWorkedHours(data.startTime, data.endTime, data.lunchMinutes);
  if (workedHours <= 0) {
    throw new Error(t("report.errorTime"));
  }

  // 同一天不能重复申请：如果这一天已经有 pending 或 approved 的记录，直接拒绝，
  // 提示去「我的记录」编辑/撤回那条已有记录，而不是悄悄再建一条造成混乱（重复计工时）。
  // 如果那天只有 rejected 的记录，说明员工已经撤回或即将撤回它，允许重新提交。
  const dupQ = query(
    collection(db, "timeRecords"),
    where("uid", "==", profile.id),
    where("date", "==", data.date)
  );
  const dupSnap = await getDocs(dupQ);
  const hasBlocking = dupSnap.docs.some((d) => {
    const s = d.data().status;
    return s === "pending" || s === "approved";
  });
  if (hasBlocking) {
    const err = new Error(t("report.errorDuplicateDate"));
    err.code = "duplicate-date";
    throw err;
  }

  await addDoc(collection(db, "timeRecords"), {
    uid: profile.id,
    employeeName: profile.name || profile.username || profile.email || "",
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    lunchMinutes: Number(data.lunchMinutes) || 0,
    workedHours,
    note: data.note || "",
    status: "pending",
    createdAt: serverTimestamp()
  });
  invalidateMyRecordsCache();
}

// 会话内轻量缓存：切换「上报/我的记录」页签时避免每次都重新拉取全部记录
const CACHE_TTL_MS = 20000;
let recordsCache = null;
let recordsCacheAt = 0;
let recordsCacheUid = null;

function invalidateMyRecordsCache() {
  recordsCache = null;
}
function peekMyRecords(uid) {
  return recordsCache && recordsCacheUid === uid && Date.now() - recordsCacheAt < CACHE_TTL_MS ? recordsCache : null;
}

export async function fetchMyRecords(uid, force) {
  if (!force) {
    const cached = peekMyRecords(uid);
    if (cached) return cached;
  }
  const q = query(collection(db, "timeRecords"), where("uid", "==", uid));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  recordsCache = list;
  recordsCacheAt = Date.now();
  recordsCacheUid = uid;
  return list;
}

export async function deleteMyRecord(recordId) {
  await deleteDoc(doc(db, "timeRecords", recordId));
  invalidateMyRecordsCache();
}

// 员工只读查看自己的薪酬支付记录
let paymentsCache = null;
let paymentsCacheAt = 0;
let paymentsCacheUid = null;

function peekMyPayments(uid) {
  return paymentsCache && paymentsCacheUid === uid && Date.now() - paymentsCacheAt < CACHE_TTL_MS ? paymentsCache : null;
}

async function fetchMyPayments(uid, force) {
  if (!force) {
    const cached = peekMyPayments(uid);
    if (cached) return cached;
  }
  const q = query(collection(db, "payments"), where("uid", "==", uid));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  paymentsCache = list;
  paymentsCacheAt = Date.now();
  paymentsCacheUid = uid;
  return list;
}

export function renderEmployeeView(container, profile) {
  container.innerHTML = `
    <div id="tab-report" class="${currentTab === "report" ? "" : "hidden"}"></div>
    <div id="tab-records" class="${currentTab === "records" ? "" : "hidden"}"></div>
  `;
  if (currentTab === "report") renderReportTab(document.getElementById("tab-report"), profile);
  if (currentTab === "records") renderRecordsTab(document.getElementById("tab-records"), profile);
}

export function renderEmployeeNav(nav, profile, onSwitch) {
  nav.innerHTML = `
    <button data-tab="report" class="${currentTab === "report" ? "active" : ""}">
      <span class="icon">🕒</span><span>${t("nav.report")}</span>
    </button>
    <button data-tab="records" class="${currentTab === "records" ? "active" : ""}">
      <span class="icon">📋</span><span>${t("nav.records")}</span>
    </button>
  `;
  nav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      onSwitch();
    });
  });
}

function renderReportTab(el, profile) {
  el.innerHTML = `
    <div class="card">
      <h2>🕒 ${t("report.title")}</h2>
      <div id="form-error" class="error-msg"></div>
      <div class="field">
        <label>${t("report.date")}</label>
        <input type="date" id="f-date" value="${todayStr()}" max="${todayStr()}" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>${t("report.start")}</label>
          <input type="time" id="f-start" value="09:00" />
        </div>
        <div class="field">
          <label>${t("report.end")}</label>
          <input type="time" id="f-end" value="18:00" />
        </div>
      </div>
      <div class="field">
        <label>${t("report.lunch")}</label>
        <input type="number" id="f-lunch" value="60" min="0" step="5" />
      </div>
      <div class="field">
        <label>${t("report.note")}</label>
        <textarea id="f-note" rows="2" placeholder="${t("report.notePlaceholder")}"></textarea>
      </div>
      <div class="summary-grid" style="margin-bottom:8px;">
        <div class="summary-box">
          <div class="icon">🕒</div>
          <div class="num" id="f-preview">9.00</div>
          <div class="label">${t("report.previewLabel")}</div>
        </div>
      </div>
      <div id="overnight-hint" class="hint hidden" style="margin-bottom:14px;">🌙 ${t("report.overnightHint")}</div>
      <button class="btn btn-primary" id="submit-record">${t("report.submit")}</button>
    </div>
  `;

  const startEl = el.querySelector("#f-start");
  const endEl = el.querySelector("#f-end");
  const lunchEl = el.querySelector("#f-lunch");
  const previewEl = el.querySelector("#f-preview");
  const overnightHintEl = el.querySelector("#overnight-hint");

  function updatePreview() {
    const h = calcWorkedHours(startEl.value, endEl.value, lunchEl.value);
    previewEl.textContent = formatHours(h);
    overnightHintEl.classList.toggle("hidden", !isOvernightShift(startEl.value, endEl.value));
  }
  [startEl, endEl, lunchEl].forEach((i) => i.addEventListener("input", updatePreview));
  updatePreview();

  el.querySelector("#submit-record").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errorEl = el.querySelector("#form-error");
    errorEl.textContent = "";
    const data = {
      date: el.querySelector("#f-date").value,
      startTime: startEl.value,
      endTime: endEl.value,
      lunchMinutes: lunchEl.value,
      note: el.querySelector("#f-note").value.trim()
    };
    if (!data.date || !data.startTime || !data.endTime) {
      errorEl.textContent = t("report.errorFields");
      return;
    }
    btn.disabled = true;
    btn.textContent = t("report.submitting");
    try {
      await submitRecord(profile, data);
      showToast(t("report.success"));
      renderReportTab(el, profile); // reset form
    } catch (err) {
      errorEl.textContent = err.message || t("error.unknown");
    } finally {
      btn.disabled = false;
      btn.textContent = t("report.submit");
    }
  });
}

async function renderRecordsTab(el, profile) {
  const cached = peekMyRecords(profile.id);
  if (!cached) el.innerHTML = skeletonRows();
  const records = await fetchMyRecords(profile.id);

  const month = currentMonthStr();
  const monthRecords = records.filter((r) => r.date.startsWith(month) && r.status === "approved");
  const totalHours = monthRecords.reduce((s, r) => s + (r.workedHours || 0), 0);
  const pendingCount = records.filter((r) => r.status === "pending").length;
  const canSeeWage = !!profile.canViewWage && !!profile.hourlyWage;
  const totalPay = totalHours * (profile.hourlyWage || 0);

  el.innerHTML = `
    <div class="summary-grid">
      <div class="summary-box">
        <div class="icon">🕒</div>
        <div class="num">${formatHours(totalHours)}</div>
        <div class="label">${t("records.monthApproved")}</div>
      </div>
      <div class="summary-box">
        <div class="icon">⏳</div>
        <div class="num">${pendingCount}</div>
        <div class="label">${t("records.pendingCount")}</div>
      </div>
      ${
        canSeeWage
          ? `<div class="summary-box"><div class="icon">💰</div><div class="num">$${formatMoney(totalPay)}</div><div class="label">${t("records.monthPay")}</div></div>`
          : ""
      }
    </div>

    <div class="card">
      <h2>📈 ${t("chart.title")}</h2>
      <div class="chart-range-row" id="range-btns">
        <button class="btn btn-secondary btn-small range-btn" data-range="7">${t("chart.range7")}</button>
        <button class="btn btn-secondary btn-small range-btn" data-range="14">${t("chart.range14")}</button>
        <button class="btn btn-secondary btn-small range-btn" data-range="30">${t("chart.range30")}</button>
        <button class="btn btn-secondary btn-small range-btn" data-range="custom">${t("chart.rangeCustom")}</button>
      </div>
      <div id="custom-range-fields" class="field-row hidden" style="margin-top:10px;">
        <div class="field">
          <label>${t("chart.from")}</label>
          <input type="date" id="range-from" value="${daysAgoStr(14)}" max="${todayStr()}" />
        </div>
        <div class="field">
          <label>${t("chart.to")}</label>
          <input type="date" id="range-to" value="${todayStr()}" max="${todayStr()}" />
        </div>
      </div>
      <div id="chart-area" style="margin-top:10px;"></div>
      <div class="summary-grid" style="margin-top:14px;">
        <div class="summary-box"><div class="icon">🕒</div><div class="num" id="chart-total-hours">0.00</div><div class="label">${t("chart.totalHours")}</div></div>
        ${
          canSeeWage
            ? `<div class="summary-box"><div class="icon">💰</div><div class="num" id="chart-total-pay">$0.00</div><div class="label">${t("chart.estPay")}</div></div>`
            : ""
        }
      </div>
    </div>

    ${
      canSeeWage
        ? `<div class="card" id="payments-card">
      <h2>💰 ${t("payments.myTitle")}</h2>
      <div id="payments-body">${skeletonRows(2)}</div>
    </div>`
        : ""
    }

    <div class="section-title">${t("records.allRecords")}</div>
    <div id="record-list"></div>
    <div class="card" style="margin-top:8px;">
      <h2>⚙️ ${t("records.accountSettings")}</h2>
      <div id="pw-error" class="error-msg"></div>
      <div class="field">
        <label>${t("records.newPassword")}</label>
        <input type="password" id="f-newpw" placeholder="${t("records.newPasswordPlaceholder")}" />
      </div>
      <button class="btn btn-secondary" id="change-pw-btn">${t("records.changePassword")}</button>
    </div>
  `;

  // ---- 工时趋势图表 ----
  let range = "14";
  function computeChart() {
    let from, to;
    if (range === "custom") {
      from = el.querySelector("#range-from").value || daysAgoStr(14);
      to = el.querySelector("#range-to").value || todayStr();
    } else {
      from = daysAgoStr(Number(range));
      to = todayStr();
    }
    const days = dateRangeDays(from, to);
    const byDate = {};
    records.forEach((r) => {
      if (r.status === "approved" && r.date >= from && r.date <= to) {
        byDate[r.date] = (byDate[r.date] || 0) + (r.workedHours || 0);
      }
    });
    const data = days.map((d) => ({ label: d.slice(5), value: byDate[d] || 0 }));
    const total = data.reduce((s, d) => s + d.value, 0);
    const pay = total * (profile.hourlyWage || 0);

    const chartEl = el.querySelector("#chart-area");
    if (total === 0 || data.length === 0) {
      chartEl.innerHTML = `<div class="empty-state">${t("chart.noData")}</div>`;
    } else {
      chartEl.innerHTML = renderBarChartSVG(data, { width: 600, height: 150 });
    }
    el.querySelector("#chart-total-hours").textContent = formatHours(total);
    const payEl = el.querySelector("#chart-total-pay");
    if (payEl) payEl.textContent = "$" + formatMoney(pay);
  }

  function setRange(r) {
    range = r;
    el.querySelectorAll(".range-btn").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
    el.querySelector("#custom-range-fields").classList.toggle("hidden", range !== "custom");
    computeChart();
  }
  el.querySelectorAll(".range-btn").forEach((btn) => btn.addEventListener("click", () => setRange(btn.dataset.range)));
  el.querySelector("#range-from").addEventListener("change", () => range === "custom" && computeChart());
  el.querySelector("#range-to").addEventListener("change", () => range === "custom" && computeChart());
  setRange("14");

  // ---- 薪酬支付（只读）----
  if (canSeeWage) {
    (async () => {
      const payments = await fetchMyPayments(profile.id);
      const totalEarned = records
        .filter((r) => r.status === "approved")
        .reduce((s, r) => s + (r.workedHours || 0) * (profile.hourlyWage || 0), 0);
      const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
      const outstanding = totalEarned - totalPaid;

      const bodyEl = el.querySelector("#payments-body");
      if (!bodyEl) return;
      bodyEl.innerHTML = `
        <div class="summary-grid" style="margin-bottom:14px;">
          <div class="summary-box"><div class="icon">💵</div><div class="num">$${formatMoney(totalEarned)}</div><div class="label">${t("payments.totalEarned")}</div></div>
          <div class="summary-box"><div class="icon">✅</div><div class="num">$${formatMoney(totalPaid)}</div><div class="label">${t("payments.totalPaid")}</div></div>
          <div class="summary-box${outstanding > 0.001 ? " summary-box-warn" : ""}">
            <div class="icon">⏳</div>
            <div class="num">$${formatMoney(outstanding > 0 ? outstanding : 0)}</div>
            <div class="label">${outstanding > 0.001 ? t("payments.outstanding") : t("payments.fullyPaid")}</div>
          </div>
        </div>
        <div class="section-title" style="margin-top:0;">${t("payments.history")}</div>
        ${
          payments.length === 0
            ? `<div class="empty-state">${t("payments.empty")}</div>`
            : payments
                .map(
                  (p) => `
              <div class="record-item">
                <div class="row-top">
                  <span class="date">${p.date}</span>
                  <span class="badge badge-approved">$${formatMoney(p.amount)}</span>
                </div>
                ${p.note ? `<div class="times">${escapeHtml(p.note)}</div>` : ""}
              </div>
            `
                )
                .join("")
        }
      `;
    })();
  }

  el.querySelector("#change-pw-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const pwInput = el.querySelector("#f-newpw");
    const errEl = el.querySelector("#pw-error");
    errEl.textContent = "";
    if (!pwInput.value || pwInput.value.length < 6) {
      errEl.textContent = t("records.pwTooShort");
      return;
    }
    btn.disabled = true;
    try {
      await changeOwnPassword(pwInput.value);
      showToast(t("records.pwUpdated"));
      pwInput.value = "";
    } catch (err) {
      errEl.textContent = authErrorMessage(err);
    } finally {
      btn.disabled = false;
    }
  });

  const listEl = el.querySelector("#record-list");
  if (records.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t("records.empty")}</div>`;
    return;
  }

  listEl.innerHTML = records
    .map((r) => {
      const pay = canSeeWage ? (r.workedHours || 0) * (profile.hourlyWage || 0) : null;
      return `
      <div class="record-item" data-id="${r.id}">
        <div class="row-top">
          <span class="date">${r.date}</span>
          <span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
        </div>
        <div class="times">${r.startTime} - ${r.endTime} · ${t("report.lunch")} ${r.lunchMinutes}</div>
        ${r.note ? `<div class="times">${t("records.noteLabel")}: ${escapeHtml(r.note)}</div>` : ""}
        <div class="meta">
          <span>${t("records.workedHours")}: <strong>${formatHours(r.workedHours)}</strong> ${t("records.hours")}</span>
          ${pay !== null ? `<span>${t("records.pay")}: <strong>$${formatMoney(pay)}</strong></span>` : ""}
        </div>
        ${
          r.status === "rejected" && r.reviewNote
            ? `<div class="times" style="margin-top:6px;">${t("records.rejectReason")}: ${escapeHtml(r.reviewNote)}</div>`
            : ""
        }
        ${
          r.status === "pending" || r.status === "rejected"
            ? `<div class="record-actions"><button class="btn btn-danger btn-small delete-record">${t("records.withdraw")}</button></div>`
            : ""
        }
      </div>
    `;
    })
    .join("");

  listEl.querySelectorAll(".delete-record").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const item = e.currentTarget.closest(".record-item");
      if (!confirm(t("records.withdrawConfirm"))) return;
      await deleteMyRecord(item.dataset.id);
      showToast(t("records.withdrawn"));
      renderRecordsTab(el, profile);
    });
  });
}

export function getCurrentEmployeeTab() {
  return currentTab;
}
