import {
  db,
  auth,
  initializeApp,
  deleteApp,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  firebaseConfig
} from "./firebase-init.js";
import { formatHours, formatMoney, currentMonthStr, showToast, escapeHtml, normalizeUsername } from "./utils.js";
import { authErrorMessage, changeOwnPassword } from "./auth.js";
import { t } from "./i18n.js";

let currentTab = "approvals";

function statusLabel(status) {
  return t("status." + status) || status;
}
function statusBadgeClass(status) {
  return { pending: "badge-pending", approved: "badge-approved", rejected: "badge-rejected" }[status] || "";
}

export function renderAdminNav(nav, profile, onSwitch) {
  nav.innerHTML = `
    <button data-tab="approvals" class="${currentTab === "approvals" ? "active" : ""}">
      <span class="icon">✅</span><span>${t("nav.approvals")}</span>
    </button>
    <button data-tab="employees" class="${currentTab === "employees" ? "active" : ""}">
      <span class="icon">👥</span><span>${t("nav.employees")}</span>
    </button>
    <button data-tab="records" class="${currentTab === "records" ? "active" : ""}">
      <span class="icon">📊</span><span>${t("nav.allRecords")}</span>
    </button>
  `;
  nav.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = btn.dataset.tab;
      onSwitch();
    });
  });
}

export function renderAdminView(container, profile) {
  container.innerHTML = `<div id="admin-tab-content"></div>`;
  const el = document.getElementById("admin-tab-content");
  if (currentTab === "approvals") renderApprovalsTab(el, profile);
  if (currentTab === "employees") renderEmployeesTab(el, profile);
  if (currentTab === "records") renderRecordsTab(el, profile);
}

// ---------------- 数据函数（带一个很轻量的会话内缓存，减少切换页签时的重复请求） ----------------

const CACHE_TTL_MS = 20000;
let usersCache = null;
let usersCacheAt = 0;
let recordsCache = null;
let recordsCacheAt = 0;

function invalidateUsersCache() {
  usersCache = null;
}
function invalidateRecordsCache() {
  recordsCache = null;
}

async function fetchAllUsers(force) {
  const now = Date.now();
  if (!force && usersCache && now - usersCacheAt < CACHE_TTL_MS) return usersCache;
  const snap = await getDocs(collection(db, "users"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  usersCache = list;
  usersCacheAt = now;
  return list;
}

async function fetchAllTimeRecords(force) {
  const now = Date.now();
  if (!force && recordsCache && now - recordsCacheAt < CACHE_TTL_MS) return recordsCache;
  const snap = await getDocs(collection(db, "timeRecords"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  recordsCache = list;
  recordsCacheAt = now;
  return list;
}

// 待审核列表用精确查询，不走缓存：这是管理员最需要看到最新状态的页面，且 pending 记录一般不多，查询很快
async function fetchPendingRecords() {
  const q = query(collection(db, "timeRecords"), where("status", "==", "pending"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  return list;
}

async function reviewRecord(recordId, status, note, adminUid) {
  await updateDoc(doc(db, "timeRecords", recordId), {
    status,
    reviewNote: note || "",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp()
  });
  invalidateRecordsCache();
}

// 使用「第二个 Firebase App 实例」创建账号（员工或管理员），避免影响当前管理员的登录态
async function createAccount({ name, username, email, password, role, hourlyWage, canViewWage }) {
  const uname = normalizeUsername(username);

  // 先检查用户名是否已被占用，避免白白创建一个没有档案的 Auth 账号
  const existing = await getDoc(doc(db, "usernames", uname));
  if (existing.exists()) {
    const err = new Error("username taken");
    err.code = "username-taken";
    throw err;
  }

  const secondaryApp = initializeApp(firebaseConfig, "Secondary-" + Date.now());
  try {
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email.trim(), password);
    const newUid = cred.user.uid;
    await signOut(secondaryAuth);

    await setDoc(doc(db, "usernames", uname), {
      uid: newUid,
      email: email.trim()
    });

    await setDoc(doc(db, "users", newUid), {
      name: name.trim(),
      username: uname,
      email: email.trim(),
      role: role === "admin" ? "admin" : "employee",
      hourlyWage: Number(hourlyWage) || 0,
      canViewWage: !!canViewWage,
      status: "active",
      createdAt: serverTimestamp()
    });
    invalidateUsersCache();
    return newUid;
  } finally {
    await deleteApp(secondaryApp);
  }
}

async function updateAccount(uid, data) {
  await updateDoc(doc(db, "users", uid), data);
  invalidateUsersCache();
}

// 删除账号档案（Firestore 端），使其立即无法登录/使用系统。
// 注意：Firebase Authentication 里的登录账号本身不会被删除（客户端 SDK 无法删除他人账号），
// 如需彻底清除登录记录，需要管理员到 Firebase 控制台 Authentication 页面手动删除该用户。
async function deleteAccount(account) {
  await deleteDoc(doc(db, "users", account.id));
  if (account.username) {
    try {
      await deleteDoc(doc(db, "usernames", account.username));
    } catch (e) {
      /* 用户名清理失败不影响主流程 */
    }
  }
  invalidateUsersCache();
}

// 发送密码重置邮件（发到账号档案里的联系邮箱，用户点击链接后自行设置新密码）
async function resetAccountPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ---------------- 待审核 ----------------

async function renderApprovalsTab(el, profile) {
  el.innerHTML = `<div class="loading-spinner">${t("common.loading")}</div>`;
  const pending = await fetchPendingRecords();

  el.innerHTML = `
    <div class="section-title">${t("approvals.title", { count: pending.length })}</div>
    <div id="pending-list"></div>
  `;
  const listEl = el.querySelector("#pending-list");
  if (pending.length === 0) {
    listEl.innerHTML = `<div class="empty-state">${t("approvals.empty")}</div>`;
    return;
  }

  listEl.innerHTML = pending
    .map(
      (r) => `
      <div class="record-item" data-id="${r.id}">
        <div class="row-top">
          <span class="date">${escapeHtml(r.employeeName)} · ${r.date}</span>
          <span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
        </div>
        <div class="times">${r.startTime} - ${r.endTime} · ${t("report.lunch")} ${r.lunchMinutes}</div>
        ${r.note ? `<div class="times">${t("records.noteLabel")}: ${escapeHtml(r.note)}</div>` : ""}
        <div class="meta"><span>${t("records.workedHours")}: <strong>${formatHours(r.workedHours)}</strong> ${t("records.hours")}</span></div>
        <div class="record-actions">
          <button class="btn btn-success btn-small approve-btn">${t("approvals.approve")}</button>
          <button class="btn btn-danger btn-small reject-btn">${t("approvals.reject")}</button>
        </div>
      </div>
    `
    )
    .join("");

  listEl.querySelectorAll(".approve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const item = e.currentTarget.closest(".record-item");
      const r = pending.find((x) => x.id === item.dataset.id);
      const ok = confirm(
        t("approvals.approveConfirm", { name: r.employeeName, date: r.date, hours: formatHours(r.workedHours) })
      );
      if (!ok) return;
      btn.disabled = true;
      await reviewRecord(r.id, "approved", "", auth.currentUser.uid);
      showToast(t("approvals.approved"));
      renderApprovalsTab(el, profile);
    });
  });

  listEl.querySelectorAll(".reject-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const note = prompt(t("approvals.rejectPrompt"));
      if (note === null) return; // 用户点了取消，中止操作
      const id = e.currentTarget.closest(".record-item").dataset.id;
      btn.disabled = true;
      await reviewRecord(id, "rejected", note, auth.currentUser.uid);
      showToast(t("approvals.rejected"));
      renderApprovalsTab(el, profile);
    });
  });
}

// ---------------- 团队成员管理（员工 + 管理员） ----------------

async function renderEmployeesTab(el, profile) {
  el.innerHTML = `<div class="loading-spinner">${t("common.loading")}</div>`;
  const accounts = await fetchAllUsers();

  el.innerHTML = `
    <button class="btn btn-primary" id="add-employee-btn">${t("employees.addButton")}</button>
    <div class="card" style="margin-top:14px;">
      <h2>${t("employees.listTitle", { count: accounts.length })}</h2>
      <div id="employee-list">${accounts.length === 0 ? `<div class="empty-state">${t("employees.empty")}</div>` : ""}</div>
    </div>
    <div class="card">
      <h2>${t("employees.myAccount")}</h2>
      <div id="my-pw-error" class="error-msg"></div>
      <div class="field">
        <label>${t("records.newPassword")}</label>
        <input type="password" id="my-newpw" placeholder="${t("records.newPasswordPlaceholder")}" />
      </div>
      <button class="btn btn-secondary" id="my-change-pw-btn">${t("employees.myAccountPw")}</button>
    </div>
  `;

  const listEl = el.querySelector("#employee-list");
  accounts.forEach((u) => {
    const row = document.createElement("div");
    row.className = "employee-row";
    row.innerHTML = `
      <div>
        <div class="name">${escapeHtml(u.name || "—")}
          ${u.role === "admin" ? `<span class="tag">${t("employees.adminTag")}</span>` : ""}
          ${u.status === "disabled" ? `<span class="tag tag-disabled">${t("employees.disabledTag")}</span>` : ""}
          ${u.canViewWage && u.role !== "admin" ? `<span class="tag">${t("employees.canViewTag")}</span>` : ""}
        </div>
        <div class="email">@${escapeHtml(u.username || "—")}</div>
        ${u.role !== "admin" ? `<div class="wage">${t("employees.wageLabel")}: $${formatMoney(u.hourlyWage || 0)}</div>` : ""}
      </div>
      <button class="btn btn-secondary btn-small edit-emp-btn">${t("employees.editButton")}</button>
    `;
    row.querySelector(".edit-emp-btn").addEventListener("click", () => openEmployeeModal(u, el, profile));
    listEl.appendChild(row);
  });

  el.querySelector("#add-employee-btn").addEventListener("click", () => openEmployeeModal(null, el, profile));

  el.querySelector("#my-change-pw-btn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const pwInput = el.querySelector("#my-newpw");
    const errEl = el.querySelector("#my-pw-error");
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
}

function openEmployeeModal(account, refreshEl, profile) {
  const isEdit = !!account;
  const isSelf = isEdit && auth.currentUser && account.id === auth.currentUser.uid;
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <h2>${isEdit ? t("modal.editTitle") : t("modal.addTitle")}</h2>
        <div id="modal-error" class="error-msg"></div>
        <div class="field">
          <label>${t("modal.name")}</label>
          <input id="m-name" value="${isEdit ? escapeHtml(account.name || "") : ""}" />
        </div>
        <div class="field">
          <label>${t("modal.username")}</label>
          <input id="m-username" value="${isEdit ? escapeHtml(account.username || "") : ""}" ${isEdit ? "disabled" : ""} />
          ${!isEdit ? `<div class="hint">${t("modal.usernameHint")}</div>` : ""}
        </div>
        <div class="field">
          <label>${t("modal.email")}${isEdit ? " " + t("modal.emailReadonly") : ""}</label>
          <input id="m-email" type="email" value="${isEdit ? escapeHtml(account.email || "") : ""}" ${isEdit ? "disabled" : ""} />
          ${!isEdit ? `<div class="hint">${t("modal.emailHint")}</div>` : ""}
        </div>
        ${
          isEdit
            ? ""
            : `<div class="field">
                <label>${t("modal.initialPassword")}</label>
                <input id="m-password" type="text" placeholder="${t("modal.initialPasswordPlaceholder")}" />
              </div>`
        }
        <div class="field">
          <label>${t("modal.role")}</label>
          <select id="m-role" ${isSelf ? "disabled" : ""}>
            <option value="employee" ${(isEdit ? account.role : "employee") === "employee" ? "selected" : ""}>${t("modal.roleEmployee")}</option>
            <option value="admin" ${isEdit && account.role === "admin" ? "selected" : ""}>${t("modal.roleAdmin")}</option>
          </select>
        </div>
        <div class="field">
          <label>${t("modal.wage")}</label>
          <input id="m-wage" type="number" min="0" step="0.5" value="${isEdit ? account.hourlyWage || 0 : 0}" />
        </div>
        <div class="switch-row">
          <span class="label-text">${t("modal.allowViewWage")}</span>
          <label class="switch">
            <input type="checkbox" id="m-canview" ${isEdit ? (account.canViewWage ? "checked" : "") : "checked"} />
            <span class="slider"></span>
          </label>
        </div>
        ${
          isEdit && !isSelf
            ? `<div class="switch-row">
                <span class="label-text">${t("modal.accountEnabled")}</span>
                <label class="switch">
                  <input type="checkbox" id="m-active" ${account.status !== "disabled" ? "checked" : ""} />
                  <span class="slider"></span>
                </label>
              </div>`
            : ""
        }
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${t("modal.cancel")}</button>
          <button class="btn btn-primary" id="modal-save">${isEdit ? t("modal.save") : t("modal.create")}</button>
        </div>
        ${
          isEdit && !isSelf
            ? `<div class="modal-actions">
                <button class="btn btn-secondary" id="modal-reset-pw">${t("modal.resetPassword")}</button>
                <button class="btn btn-danger" id="modal-delete">${t("modal.deleteEmployee")}</button>
              </div>
              <div class="hint">${t("modal.deleteHint")}</div>`
            : ""
        }
      </div>
    </div>
  `;

  document.getElementById("modal-cancel").addEventListener("click", () => (root.innerHTML = ""));
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") root.innerHTML = "";
  });

  if (isEdit && !isSelf) {
    document.getElementById("modal-reset-pw").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errEl = document.getElementById("modal-error");
      errEl.textContent = "";
      if (!confirm(t("modal.resetConfirm", { email: account.email }))) return;
      btn.disabled = true;
      btn.textContent = t("modal.resetSending");
      try {
        await resetAccountPassword(account.email);
        showToast(t("modal.resetSent"));
      } catch (err) {
        errEl.textContent = authErrorMessage(err);
      } finally {
        btn.disabled = false;
        btn.textContent = t("modal.resetPassword");
      }
    });

    document.getElementById("modal-delete").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errEl = document.getElementById("modal-error");
      errEl.textContent = "";
      if (!confirm(t("modal.deleteConfirm", { name: account.name || account.email }))) return;
      btn.disabled = true;
      btn.textContent = t("modal.deleting");
      try {
        await deleteAccount(account);
        showToast(t("modal.deleted"));
        root.innerHTML = "";
        renderEmployeesTab(refreshEl, profile);
      } catch (err) {
        errEl.textContent = authErrorMessage(err);
        btn.disabled = false;
        btn.textContent = t("modal.deleteEmployee");
      }
    });
  }

  document.getElementById("modal-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("modal-error");
    errEl.textContent = "";
    const name = document.getElementById("m-name").value.trim();
    const wage = document.getElementById("m-wage").value;
    const canView = document.getElementById("m-canview").checked;
    const role = document.getElementById("m-role").value;

    if (!name) {
      errEl.textContent = t("modal.nameRequired");
      return;
    }

    btn.disabled = true;
    btn.textContent = t("modal.processing");
    try {
      if (isEdit) {
        const active = isSelf ? true : document.getElementById("m-active").checked;
        await updateAccount(account.id, {
          name,
          hourlyWage: Number(wage) || 0,
          canViewWage: canView,
          role: isSelf ? account.role : role,
          status: active ? "active" : "disabled"
        });
        showToast(t("modal.saved"));
      } else {
        const username = document.getElementById("m-username").value.trim();
        const email = document.getElementById("m-email").value.trim();
        const password = document.getElementById("m-password").value;
        if (!username) {
          errEl.textContent = t("modal.usernameRequired");
          btn.disabled = false;
          btn.textContent = t("modal.create");
          return;
        }
        if (!email) {
          errEl.textContent = t("modal.emailRequired");
          btn.disabled = false;
          btn.textContent = t("modal.create");
          return;
        }
        if (!password || password.length < 6) {
          errEl.textContent = t("modal.pwShort");
          btn.disabled = false;
          btn.textContent = t("modal.create");
          return;
        }
        await createAccount({ name, username, email, password, role, hourlyWage: wage, canViewWage: canView });
        showToast(t("modal.created"));
      }
      root.innerHTML = "";
      renderEmployeesTab(refreshEl, profile);
    } catch (err) {
      errEl.textContent = authErrorMessage(err);
      btn.disabled = false;
      btn.textContent = isEdit ? t("modal.save") : t("modal.create");
    }
  });
}

// ---------------- 全部记录 ----------------

async function renderRecordsTab(el, profile) {
  el.innerHTML = `<div class="loading-spinner">${t("common.loading")}</div>`;
  const [all, accounts] = await Promise.all([fetchAllTimeRecords(), fetchAllUsers()]);
  const empMap = {};
  accounts.forEach((e) => (empMap[e.id] = e));

  const month = currentMonthStr();

  el.innerHTML = `
    <div class="field">
      <label>${t("allRecords.filterMonth")}</label>
      <input type="month" id="filter-month" value="${month}" />
    </div>
    <div class="section-title">${t("allRecords.byEmployeeTitle")}</div>
    <div id="by-employee-list"></div>

    <div class="field" style="margin-top:6px;">
      <label>${t("allRecords.filterEmployee")}</label>
      <select id="filter-emp">
        <option value="">${t("allRecords.allEmployees")}</option>
        ${accounts
          .filter((e) => e.role !== "admin")
          .map((e) => `<option value="${e.id}">${escapeHtml(e.name || e.email)}</option>`)
          .join("")}
      </select>
    </div>
    <div id="records-summary"></div>
    <div class="section-title">${t("records.allRecords")}</div>
    <div id="all-record-list"></div>
  `;

  function renderByEmployee(m) {
    const approved = all.filter((r) => r.status === "approved" && r.date.startsWith(m));
    const byUid = {};
    approved.forEach((r) => {
      if (!byUid[r.uid]) byUid[r.uid] = { hours: 0, name: r.employeeName };
      byUid[r.uid].hours += r.workedHours || 0;
    });
    const rows = Object.keys(byUid)
      .map((uid) => {
        const wage = (empMap[uid] && empMap[uid].hourlyWage) || 0;
        return { uid, name: (empMap[uid] && empMap[uid].name) || byUid[uid].name, hours: byUid[uid].hours, pay: byUid[uid].hours * wage };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const byEmployeeEl = el.querySelector("#by-employee-list");
    if (rows.length === 0) {
      byEmployeeEl.innerHTML = `<div class="empty-state">${t("allRecords.byEmployeeEmpty")}</div>`;
      return;
    }
    byEmployeeEl.innerHTML = rows
      .map(
        (r) => `
        <div class="employee-row">
          <div class="name">${escapeHtml(r.name)}</div>
          <div class="wage" style="text-align:right;">
            <div>${formatHours(r.hours)} ${t("records.hours")}</div>
            <div>$${formatMoney(r.pay)}</div>
          </div>
        </div>
      `
      )
      .join("");
  }

  function apply() {
    const m = el.querySelector("#filter-month").value;
    const empId = el.querySelector("#filter-emp").value;
    renderByEmployee(m);

    let filtered = all.filter((r) => (!m || r.date.startsWith(m)) && (!empId || r.uid === empId));

    const approved = filtered.filter((r) => r.status === "approved");
    const totalHours = approved.reduce((s, r) => s + (r.workedHours || 0), 0);
    const totalPay = approved.reduce((s, r) => {
      const wage = (empMap[r.uid] && empMap[r.uid].hourlyWage) || 0;
      return s + (r.workedHours || 0) * wage;
    }, 0);

    el.querySelector("#records-summary").innerHTML = `
      <div class="summary-grid">
        <div class="summary-box"><div class="num">${filtered.length}</div><div class="label">${t("allRecords.countLabel")}</div></div>
        <div class="summary-box"><div class="num">${formatHours(totalHours)}</div><div class="label">${t("allRecords.approvedHoursLabel")}</div></div>
        <div class="summary-box"><div class="num">$${formatMoney(totalPay)}</div><div class="label">${t("allRecords.estPayLabel")}</div></div>
      </div>
    `;

    const listEl = el.querySelector("#all-record-list");
    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${t("allRecords.empty")}</div>`;
      return;
    }
    listEl.innerHTML = filtered
      .map(
        (r) => `
        <div class="record-item">
          <div class="row-top">
            <span class="date">${escapeHtml(r.employeeName)} · ${r.date}</span>
            <span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
          </div>
          <div class="times">${r.startTime} - ${r.endTime} · ${t("report.lunch")} ${r.lunchMinutes}</div>
          <div class="meta"><span>${t("records.workedHours")}: <strong>${formatHours(r.workedHours)}</strong> ${t("records.hours")}</span></div>
        </div>
      `
      )
      .join("");
  }

  el.querySelector("#filter-month").addEventListener("change", apply);
  el.querySelector("#filter-emp").addEventListener("change", apply);
  apply();
}
