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
  formatHours,
  formatMoney,
  showToast,
  escapeHtml
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
  await addDoc(collection(db, "timeRecords"), {
    uid: profile.id,
    employeeName: profile.name || profile.email,
    date: data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    lunchMinutes: Number(data.lunchMinutes) || 0,
    workedHours,
    note: data.note || "",
    status: "pending",
    createdAt: serverTimestamp()
  });
}

export async function fetchMyRecords(uid) {
  const q = query(collection(db, "timeRecords"), where("uid", "==", uid));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  return list;
}

export async function deleteMyRecord(recordId) {
  await deleteDoc(doc(db, "timeRecords", recordId));
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
      <h2>${t("report.title")}</h2>
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
      <div class="summary-grid" style="margin-bottom:14px;">
        <div class="summary-box">
          <div class="num" id="f-preview">9.00</div>
          <div class="label">${t("report.previewLabel")}</div>
        </div>
      </div>
      <button class="btn btn-primary" id="submit-record">${t("report.submit")}</button>
    </div>
  `;

  const startEl = el.querySelector("#f-start");
  const endEl = el.querySelector("#f-end");
  const lunchEl = el.querySelector("#f-lunch");
  const previewEl = el.querySelector("#f-preview");

  function updatePreview() {
    const h = calcWorkedHours(startEl.value, endEl.value, lunchEl.value);
    previewEl.textContent = formatHours(h);
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
  el.innerHTML = `<div class="loading-spinner">${t("common.loading")}</div>`;
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
        <div class="num">${formatHours(totalHours)}</div>
        <div class="label">${t("records.monthApproved")}</div>
      </div>
      <div class="summary-box">
        <div class="num">${pendingCount}</div>
        <div class="label">${t("records.pendingCount")}</div>
      </div>
      ${
        canSeeWage
          ? `<div class="summary-box"><div class="num">$${formatMoney(totalPay)}</div><div class="label">${t("records.monthPay")}</div></div>`
          : ""
      }
    </div>
    <div class="section-title">${t("records.allRecords")}</div>
    <div id="record-list"></div>
    <div class="card" style="margin-top:8px;">
      <h2>${t("records.accountSettings")}</h2>
      <div id="pw-error" class="error-msg"></div>
      <div class="field">
        <label>${t("records.newPassword")}</label>
        <input type="password" id="f-newpw" placeholder="${t("records.newPasswordPlaceholder")}" />
      </div>
      <button class="btn btn-secondary" id="change-pw-btn">${t("records.changePassword")}</button>
    </div>
  `;

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
          r.status === "pending"
            ? `<div class="record-actions"><button class="btn btn-danger btn-small delete-record">${t("records.withdraw")}</button></div>`
            : r.status === "rejected" && r.reviewNote
              ? `<div class="times" style="margin-top:6px;">${t("records.rejectReason")}: ${escapeHtml(r.reviewNote)}</div>`
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
