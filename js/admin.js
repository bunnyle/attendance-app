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
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
  writeBatch,
  createUserWithEmailAndPassword,
  signOut,
  firebaseConfig
} from "./firebase-init.js";
import {
  formatHours,
  formatMoney,
  currentMonthStr,
  showToast,
  escapeHtml,
  normalizeUsername,
  calcWorkedHours,
  isOvernightShift,
  dateRangeDays,
  daysAgoStr,
  todayStr,
  renderBarChartSVG,
  skeletonRows
} from "./utils.js";
import { authErrorMessage, changeOwnPassword, newInternalEmail } from "./auth.js";
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
let paymentsCache = null;
let paymentsCacheAt = 0;

function invalidateUsersCache() {
  usersCache = null;
}
function invalidateRecordsCache() {
  recordsCache = null;
}
function invalidatePaymentsCache() {
  paymentsCache = null;
}
// “偷看”一下缓存是否还新鲜，用来决定要不要显示加载中——命中缓存时完全跳过 loading 闪烁
function peekUsers() {
  return usersCache && Date.now() - usersCacheAt < CACHE_TTL_MS ? usersCache : null;
}
function peekRecords() {
  return recordsCache && Date.now() - recordsCacheAt < CACHE_TTL_MS ? recordsCache : null;
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

async function fetchAllPayments(force) {
  const now = Date.now();
  if (!force && paymentsCache && now - paymentsCacheAt < CACHE_TTL_MS) return paymentsCache;
  const snap = await getDocs(collection(db, "payments"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  paymentsCache = list;
  paymentsCacheAt = now;
  return list;
}

async function createPayment({ uid, employeeName, amount, date, note, adminUid }) {
  await addDoc(collection(db, "payments"), {
    uid,
    employeeName,
    amount: Number(amount) || 0,
    date,
    note: note || "",
    createdBy: adminUid,
    createdAt: serverTimestamp()
  });
  invalidatePaymentsCache();
}

async function deletePayment(paymentId) {
  await deleteDoc(doc(db, "payments", paymentId));
  invalidatePaymentsCache();
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

async function deleteRecord(recordId) {
  await deleteDoc(doc(db, "timeRecords", recordId));
  invalidateRecordsCache();
}

async function updateRecord(recordId, data, adminUid) {
  const payload = { ...data };
  if (payload.status && payload.status !== "pending") {
    payload.reviewedBy = adminUid;
    payload.reviewedAt = serverTimestamp();
  }
  await updateDoc(doc(db, "timeRecords", recordId), payload);
  invalidateRecordsCache();
}

// 管理员代员工补录一条记录（比如对方忘了打卡，或者系统上线前的历史工时）。
// 跟员工自己提交不同：可以直接指定状态（通常直接建成 approved），会记一笔 reviewedBy/reviewedAt。
async function createRecordForEmployee({ uid, employeeName, date, startTime, endTime, lunchMinutes, note, status, workedHours, adminUid }) {
  await addDoc(collection(db, "timeRecords"), {
    uid,
    employeeName,
    date,
    startTime,
    endTime,
    lunchMinutes: Number(lunchMinutes) || 0,
    workedHours,
    note: note || "",
    status: status || "approved",
    reviewedBy: adminUid,
    reviewedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    addedByAdmin: true
  });
  invalidateRecordsCache();
}

// 使用「第二个 Firebase App 实例」创建账号（员工或管理员），避免影响当前管理员的登录态。
// 系统完全不使用真实邮箱：用用户名自动生成一个内部专用、界面上看不到的登录邮箱。
async function createAccount({ name, username, password, role, hourlyWage, canViewWage, fullName, zelleAccount }) {
  const uname = normalizeUsername(username);
  const email = newInternalEmail(uname);

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
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const newUid = cred.user.uid;
    await signOut(secondaryAuth);

    await setDoc(doc(db, "usernames", uname), {
      uid: newUid,
      email
    });

    await setDoc(doc(db, "users", newUid), {
      name: name.trim(),
      username: uname,
      role: role === "admin" ? "admin" : "employee",
      hourlyWage: Number(hourlyWage) || 0,
      canViewWage: !!canViewWage,
      fullName: (fullName || "").trim(),
      zelleAccount: (zelleAccount || "").trim(),
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

// 删除账号档案（Firestore 端），使其立即无法登录/使用系统，用户名也会被释放、可以给别人用。
// 注意：Firebase Authentication 里的登录账号本身不会被删除（客户端 SDK 无法删除他人账号），
// 如需彻底清除登录记录，需要管理员到 Firebase 控制台 Authentication 页面手动删除该用户。
// 这是给「员工离职/账号不再使用」这种永久性场景用的；如果只是想改这个人的登录密码、
// 又想保留他的历史工时和薪酬记录，用「重置密码」（resetEmployeePassword），不要用删除。
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

// 把某个集合里所有 uid == oldUid 的文档批量改成 uid == newUid（重置密码时用来迁移历史数据）。
// Firestore 单次 batch 最多 500 个操作，超出就分批提交，正常团队规模基本用不到分批。
async function migrateUidInCollection(collectionName, oldUid, newUid) {
  const q = query(collection(db, collectionName), where("uid", "==", oldUid));
  const snap = await getDocs(q);
  const docs = snap.docs;
  const chunkSize = 400;
  for (let i = 0; i < docs.length; i += chunkSize) {
    const batch = writeBatch(db);
    docs.slice(i, i + chunkSize).forEach((d) => batch.update(d.ref, { uid: newUid }));
    await batch.commit();
  }
}

// 重置员工登录密码。
// 背景：这个系统完全没有后端（不用 Cloud Functions），而 Firebase 客户端 SDK 无法删除「别人」的
// Auth 账号，也无法在不知道旧密码的情况下直接改「别人」的密码——这是 Firebase 本身的限制，不是这个
// 项目没做。能在纯前端做到的最佳方案是：用一个全新的内部邮箱注册一个新账号（新密码），
// 再把这个人在 Firestore 里的档案、历史工时记录、薪酬支付记录全部从旧 uid 迁移到新 uid，
// 用户名和登录体验完全不变，旧账号就晾在 Firebase Auth 后台不再使用（不影响任何功能，只是个死账号）。
//
// ⚠️ 不能用来重置「当前登录管理员自己」的密码——那样会把自己正在用的 users/{uid} 档案删掉，
// 把自己登出。管理员改自己的密码用「我的账号」里的入口（那个是真正的原生改密码，不需要这套迁移）。
async function resetEmployeePassword(account, newPassword) {
  if (auth.currentUser && account.id === auth.currentUser.uid) {
    const err = new Error("cannot reset own password this way");
    err.code = "cannot-reset-self";
    throw err;
  }
  const uname = account.username;
  const newEmail = newInternalEmail(uname);
  const oldUid = account.id;

  const secondaryApp = initializeApp(firebaseConfig, "Secondary-" + Date.now());
  let newUid;
  try {
    const { getAuth } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    const secondaryAuth = getAuth(secondaryApp);
    const cred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, newPassword);
    newUid = cred.user.uid;
    await signOut(secondaryAuth);
  } finally {
    await deleteApp(secondaryApp);
  }

  const profileSnap = await getDoc(doc(db, "users", oldUid));
  const profile = profileSnap.exists()
    ? profileSnap.data()
    : {
        name: account.name,
        username: uname,
        role: account.role,
        hourlyWage: account.hourlyWage,
        canViewWage: account.canViewWage,
        fullName: account.fullName,
        zelleAccount: account.zelleAccount,
        status: account.status
      };

  await setDoc(doc(db, "users", newUid), { ...profile, username: uname });
  await deleteDoc(doc(db, "users", oldUid));

  // usernames 规则里 update 永远是 false（只允许 create/delete），所以「换指向」必须先删再建
  await deleteDoc(doc(db, "usernames", uname));
  await setDoc(doc(db, "usernames", uname), { uid: newUid, email: newEmail });

  await migrateUidInCollection("timeRecords", oldUid, newUid);
  await migrateUidInCollection("payments", oldUid, newUid);

  invalidateUsersCache();
  invalidateRecordsCache();
  invalidatePaymentsCache();
  return newUid;
}

// ---------------- 记录编辑 / 删除（待审核、全部记录两个页签共用） ----------------

function recordCardHtml(r, { withApproveReject }) {
  // withApproveReject 只是「允许显示」，真正是否显示还要看这条记录本身是不是 pending——
  // 这样同一个函数既能用在「待审核」页（列表本来就全是 pending），
  // 也能用在「按日期」页（一天里 pending/approved/rejected 混在一起，只有 pending 的才需要批核按钮）。
  const showApproveReject = withApproveReject && r.status === "pending";
  const overnight = isOvernightShift(r.startTime, r.endTime);
  return `
    <div class="record-item" data-id="${r.id}">
      <div class="row-top">
        <span class="date">${escapeHtml(r.employeeName)} · ${r.date}</span>
        <span class="badge ${statusBadgeClass(r.status)}">${statusLabel(r.status)}</span>
      </div>
      <div class="times">${r.startTime} - ${r.endTime}${overnight ? " 🌙" : ""} · ${t("report.lunch")} ${r.lunchMinutes}</div>
      ${r.note ? `<div class="times">${t("records.noteLabel")}: ${escapeHtml(r.note)}</div>` : ""}
      <div class="meta"><span>${t("records.workedHours")}: <strong>${formatHours(r.workedHours)}</strong> ${t("records.hours")}</span></div>
      ${
        showApproveReject
          ? `<div class="record-actions">
              <button class="btn btn-success btn-small approve-btn">${t("approvals.approve")}</button>
              <button class="btn btn-danger btn-small reject-btn">${t("approvals.reject")}</button>
            </div>`
          : ""
      }
      <div class="record-actions">
        <button class="btn btn-secondary btn-small edit-record-btn">${t("records.edit")}</button>
        <button class="btn btn-danger btn-small delete-record-btn">${t("records.deleteRecord")}</button>
      </div>
    </div>
  `;
}

function wireRecordCardActions(containerEl, records, { withApproveReject, onChanged }) {
  if (withApproveReject) {
    containerEl.querySelectorAll(".approve-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const item = e.currentTarget.closest(".record-item");
        const r = records.find((x) => x.id === item.dataset.id);
        const ok = confirm(
          t("approvals.approveConfirm", { name: r.employeeName, date: r.date, hours: formatHours(r.workedHours) })
        );
        if (!ok) return;
        btn.disabled = true;
        await reviewRecord(r.id, "approved", "", auth.currentUser.uid);
        showToast(t("approvals.approved"));
        onChanged();
      });
    });

    containerEl.querySelectorAll(".reject-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const note = prompt(t("approvals.rejectPrompt"));
        if (note === null) return; // 用户点了取消，中止操作
        const id = e.currentTarget.closest(".record-item").dataset.id;
        btn.disabled = true;
        await reviewRecord(id, "rejected", note, auth.currentUser.uid);
        showToast(t("approvals.rejected"));
        onChanged();
      });
    });
  }

  containerEl.querySelectorAll(".edit-record-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.closest(".record-item").dataset.id;
      const r = records.find((x) => x.id === id);
      if (r) openRecordEditModal(r, onChanged);
    });
  });

  containerEl.querySelectorAll(".delete-record-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      if (!confirm(t("records.deleteRecordConfirm"))) return;
      const id = e.currentTarget.closest(".record-item").dataset.id;
      btn.disabled = true;
      await deleteRecord(id);
      showToast(t("records.recordDeleted"));
      onChanged();
    });
  });
}

// record 传已有记录对象（含 id）就是「编辑」；传 { uid, employeeName, date } 这种没有 id 的「草稿」
// 就是「补录」——用来给忘记打卡、系统上线前的历史工时等场景，管理员直接代员工建一条记录。
function openRecordEditModal(record, onSaved) {
  const isNew = !record.id;
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <h2>${isNew ? t("records.addTitle", { name: record.employeeName }) : t("records.editTitle")}</h2>
        <div id="modal-error" class="error-msg"></div>
        <div class="field">
          <label>${t("report.date")}</label>
          <input type="date" id="r-date" value="${record.date || todayStr()}" max="${todayStr()}" />
        </div>
        <div class="field-row">
          <div class="field">
            <label>${t("report.start")}</label>
            <input type="time" id="r-start" value="${record.startTime || "09:00"}" />
          </div>
          <div class="field">
            <label>${t("report.end")}</label>
            <input type="time" id="r-end" value="${record.endTime || "18:00"}" />
          </div>
        </div>
        <div class="field">
          <label>${t("report.lunch")}</label>
          <input type="number" min="0" step="5" id="r-lunch" value="${record.lunchMinutes ?? 60}" />
        </div>
        <div id="overnight-hint" class="hint hidden">🌙 ${t("report.overnightHint")}</div>
        <div class="field">
          <label>${t("report.note")}</label>
          <textarea id="r-note" rows="2">${escapeHtml(record.note || "")}</textarea>
        </div>
        <div class="field">
          <label>${t("records.status")}</label>
          <select id="r-status">
            <option value="pending" ${record.status === "pending" ? "selected" : ""}>${t("status.pending")}</option>
            <option value="approved" ${!record.status || record.status === "approved" ? "selected" : ""}>${t("status.approved")}</option>
            <option value="rejected" ${record.status === "rejected" ? "selected" : ""}>${t("status.rejected")}</option>
          </select>
        </div>
        <div class="summary-grid" style="margin-bottom:14px;">
          <div class="summary-box">
            <div class="num" id="r-preview">${formatHours(record.workedHours || 0)}</div>
            <div class="label">${t("report.previewLabel")}</div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${t("modal.cancel")}</button>
          <button class="btn btn-primary" id="modal-save">${isNew ? t("records.addSave") : t("records.saveChanges")}</button>
        </div>
      </div>
    </div>
  `;

  const startEl = document.getElementById("r-start");
  const endEl = document.getElementById("r-end");
  const lunchEl = document.getElementById("r-lunch");
  const previewEl = document.getElementById("r-preview");
  const overnightHintEl = document.getElementById("overnight-hint");

  function updatePreview() {
    previewEl.textContent = formatHours(calcWorkedHours(startEl.value, endEl.value, lunchEl.value));
    overnightHintEl.classList.toggle("hidden", !isOvernightShift(startEl.value, endEl.value));
  }
  [startEl, endEl, lunchEl].forEach((i) => i.addEventListener("input", updatePreview));
  updatePreview();

  document.getElementById("modal-cancel").addEventListener("click", () => (root.innerHTML = ""));
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") root.innerHTML = "";
  });

  document.getElementById("modal-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("modal-error");
    errEl.textContent = "";
    const date = document.getElementById("r-date").value;
    const status = document.getElementById("r-status").value;
    const note = document.getElementById("r-note").value.trim();
    const workedHours = calcWorkedHours(startEl.value, endEl.value, lunchEl.value);
    if (!date || !startEl.value || !endEl.value) {
      errEl.textContent = t("report.errorFields");
      return;
    }
    if (workedHours <= 0) {
      errEl.textContent = t("report.errorTime");
      return;
    }
    btn.disabled = true;
    btn.textContent = t("modal.processing");
    try {
      if (isNew) {
        await createRecordForEmployee({
          uid: record.uid,
          employeeName: record.employeeName,
          date,
          startTime: startEl.value,
          endTime: endEl.value,
          lunchMinutes: Number(lunchEl.value) || 0,
          note,
          status,
          workedHours,
          adminUid: auth.currentUser.uid
        });
        showToast(t("records.recordAdded"));
      } else {
        await updateRecord(
          record.id,
          {
            date,
            startTime: startEl.value,
            endTime: endEl.value,
            lunchMinutes: Number(lunchEl.value) || 0,
            note,
            status,
            workedHours
          },
          auth.currentUser.uid
        );
        showToast(t("records.recordUpdated"));
      }
      root.innerHTML = "";
      onSaved();
    } catch (err) {
      errEl.textContent = authErrorMessage(err);
      btn.disabled = false;
      btn.textContent = isNew ? t("records.addSave") : t("records.saveChanges");
    }
  });
}

// ---------------- 待审核 ----------------

async function renderApprovalsTab(el, profile) {
  el.innerHTML = skeletonRows();
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

  listEl.innerHTML = pending.map((r) => recordCardHtml(r, { withApproveReject: true })).join("");
  wireRecordCardActions(listEl, pending, {
    withApproveReject: true,
    onChanged: () => renderApprovalsTab(el, profile)
  });
}

// ---------------- 团队成员管理（员工 + 管理员） ----------------

async function renderEmployeesTab(el, profile) {
  const cached = peekUsers();
  if (!cached) el.innerHTML = skeletonRows();
  const accounts = await fetchAllUsers();

  el.innerHTML = `
    <button class="btn btn-primary" id="add-employee-btn">${t("employees.addButton")}</button>
    <div class="card" style="margin-top:14px;">
      <h2>👥 ${t("employees.listTitle", { count: accounts.length })}</h2>
      <div id="employee-list">${accounts.length === 0 ? `<div class="empty-state">${t("employees.empty")}</div>` : ""}</div>
    </div>
    <div class="card">
      <h2>🔑 ${t("employees.myAccount")}</h2>
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
          <input id="m-username" value="${isEdit ? escapeHtml(account.username || "") : ""}" ${isEdit ? "disabled" : ""} autocapitalize="none" />
          ${!isEdit ? `<div class="hint">${t("modal.usernameHint")}</div>` : ""}
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
        <div class="field">
          <label>${t("modal.fullName")}</label>
          <input id="m-fullname" value="${isEdit ? escapeHtml(account.fullName || "") : ""}" />
          <div class="hint">${t("modal.fullNameHint")}</div>
        </div>
        <div class="field">
          <label>${t("modal.zelleAccount")}</label>
          <input id="m-zelle" value="${isEdit ? escapeHtml(account.zelleAccount || "") : ""}" placeholder="name@email.com / 555-123-4567" />
          <div class="hint">${t("modal.zelleAccountHint")}</div>
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
            ? `<div class="field" style="margin-top:4px;">
                <label>${t("modal.resetPasswordLabel")}</label>
                <input type="password" id="m-resetpw" placeholder="${t("modal.resetPasswordPlaceholder")}" autocomplete="new-password" />
              </div>
              <div class="modal-actions">
                <button class="btn btn-secondary" id="modal-reset-pw" style="width:100%;">${t("modal.resetPasswordButton")}</button>
              </div>
              <div class="hint">${t("modal.resetPasswordHint")}</div>`
            : ""
        }
        ${
          isEdit && !isSelf
            ? `<div class="modal-actions">
                <button class="btn btn-danger" id="modal-delete" style="width:100%;">${t("modal.deleteEmployee")}</button>
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
      const pwInput = document.getElementById("m-resetpw");
      if (!pwInput.value || pwInput.value.length < 6) {
        errEl.textContent = t("modal.pwShort");
        return;
      }
      if (!confirm(t("modal.resetPasswordConfirm", { name: account.name || account.username }))) return;
      btn.disabled = true;
      btn.textContent = t("modal.processing");
      try {
        await resetEmployeePassword(account, pwInput.value);
        showToast(t("modal.resetPasswordDone"));
        root.innerHTML = "";
        renderEmployeesTab(refreshEl, profile);
      } catch (err) {
        errEl.textContent = authErrorMessage(err);
        btn.disabled = false;
        btn.textContent = t("modal.resetPasswordButton");
      }
    });

    document.getElementById("modal-delete").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const errEl = document.getElementById("modal-error");
      errEl.textContent = "";
      if (!confirm(t("modal.deleteConfirm", { name: account.name || account.username }))) return;
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
    const fullName = document.getElementById("m-fullname").value.trim();
    const zelleAccount = document.getElementById("m-zelle").value.trim();

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
          status: active ? "active" : "disabled",
          fullName,
          zelleAccount
        });
        showToast(t("modal.saved"));
      } else {
        const username = document.getElementById("m-username").value.trim();
        const password = document.getElementById("m-password").value;
        if (!username) {
          errEl.textContent = t("modal.usernameRequired");
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
        await createAccount({ name, username, password, role, hourlyWage: wage, canViewWage: canView, fullName, zelleAccount });
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

// ---------------- 全部记录：按员工 / 按日期 两个子页签 ----------------
// 原来是一个把所有记录堆在一起的长列表，很容易看花眼。改成两个更贴近老板实际需求的视角：
// 「按员工」——每个人这个月总共做了多少小时、多少钱，点进去是一个日历，一眼看出哪天请假/缺勤/待批；
// 「按日期」——选一天，看这天多少人上班、时间段是什么，还没打卡的人也列出来，方便直接帮忙补录。

let recordsSubTab = "byEmployee"; // "byEmployee" | "byDay"

function shiftMonth(m, delta) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function renderRecordsTab(el, profile) {
  const cachedRecords = peekRecords();
  const cachedUsers = peekUsers();
  if (!cachedRecords || !cachedUsers) el.innerHTML = skeletonRows();
  const [all, accounts] = await Promise.all([fetchAllTimeRecords(), fetchAllUsers()]);
  const empMap = {};
  accounts.forEach((e) => (empMap[e.id] = e));
  const employees = accounts.filter((e) => e.role !== "admin");

  el.innerHTML = `
    <div class="sub-tab-row">
      <button class="sub-tab-btn ${recordsSubTab === "byEmployee" ? "active" : ""}" data-sub="byEmployee">👤 ${t("allRecords.tabByEmployee")}</button>
      <button class="sub-tab-btn ${recordsSubTab === "byDay" ? "active" : ""}" data-sub="byDay">📅 ${t("allRecords.tabByDay")}</button>
    </div>
    <div id="records-sub-content"></div>
  `;

  el.querySelectorAll(".sub-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.sub === recordsSubTab) return;
      recordsSubTab = btn.dataset.sub;
      renderRecordsTab(el, profile);
    });
  });

  const contentEl = el.querySelector("#records-sub-content");
  if (recordsSubTab === "byEmployee") {
    renderByEmployeeSubTab(contentEl, el, profile, all, employees, empMap, currentMonthStr());
  } else {
    renderByDaySubTab(contentEl, el, profile, all, employees, empMap);
  }
}

// 按选定月份把「按员工」汇总导出成 Excel，方便老板直接拿去对着 Zelle 转账。
// SheetJS 通过 CDN 按需加载（index.html 里 <script defer>），这里只在真正点击导出时才检查是否加载完成，
// 避免因为脚本还没下载完/被浏览器拦截而卡住整个页面。
function exportPayrollExcel(rows, month) {
  if (typeof XLSX === "undefined") {
    showToast(t("allRecords.exportNoData"));
    return;
  }
  const withHours = rows.filter((r) => r.hours > 0);
  if (withHours.length === 0) {
    showToast(t("allRecords.exportNoData"));
    return;
  }

  const header = [
    t("allRecords.exportColName"),
    t("allRecords.exportColFullName"),
    t("allRecords.exportColZelle"),
    t("allRecords.exportColHours"),
    t("allRecords.exportColAmount")
  ];
  const body = withHours.map((r) => [
    r.name,
    r.fullName,
    r.zelleAccount,
    Number(formatHours(r.hours)),
    Number(r.pay.toFixed(2))
  ]);

  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws["!cols"] = [{ wch: 16 }, { wch: 18 }, { wch: 22 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t("allRecords.exportSheetName"));
  XLSX.writeFile(wb, `payroll-${month}.xlsx`);
  showToast(t("allRecords.exportDone"));
}

function renderByEmployeeSubTab(el, outerEl, profile, all, employees, empMap, initialMonth) {
  el.innerHTML = `
    <div class="field-row" style="align-items:center; margin-bottom:0;">
      <div class="filter-bar">
        <span class="filter-icon">📅</span>
        <div class="filter-text">
          <label>${t("allRecords.filterMonth")}</label>
          <input type="month" id="filter-month" value="${initialMonth}" />
        </div>
      </div>
      <button class="btn btn-secondary" id="export-excel-btn" style="width:auto; white-space:nowrap;">📤 ${t("allRecords.exportButton")}</button>
    </div>
    <div id="by-employee-list"></div>
  `;

  let currentRows = [];
  let currentMonth = initialMonth;

  el.querySelector("#export-excel-btn").addEventListener("click", () => {
    exportPayrollExcel(currentRows, currentMonth);
  });

  function render(m) {
    currentMonth = m;
    const monthRecords = all.filter((r) => r.date.startsWith(m));
    const byUid = {};
    monthRecords
      .filter((r) => r.status === "approved")
      .forEach((r) => {
        byUid[r.uid] = (byUid[r.uid] || 0) + (r.workedHours || 0);
      });
    const pendingByUid = {};
    monthRecords
      .filter((r) => r.status === "pending")
      .forEach((r) => {
        pendingByUid[r.uid] = (pendingByUid[r.uid] || 0) + 1;
      });

    // 把所有员工都列出来，哪怕这个月完全没有记录——这样「这个月还没打过卡的人」也一眼就能看出来
    const rows = employees
      .map((emp) => ({
        uid: emp.id,
        name: emp.name || emp.username,
        fullName: emp.fullName || emp.name || emp.username,
        zelleAccount: emp.zelleAccount || "",
        hours: byUid[emp.id] || 0,
        pay: (byUid[emp.id] || 0) * (emp.hourlyWage || 0),
        pending: pendingByUid[emp.id] || 0
      }))
      .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));
    currentRows = rows;

    const listEl = el.querySelector("#by-employee-list");
    if (rows.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${t("employees.empty")}</div>`;
      return;
    }
    listEl.innerHTML = rows
      .map(
        (r) => `
        <div class="employee-row emp-summary-row" data-uid="${r.uid}">
          <div style="display:flex; align-items:center; gap:10px; min-width:0;">
            <div class="avatar-circle">${escapeHtml((r.name || "?").slice(0, 1).toUpperCase())}</div>
            <div style="min-width:0;">
              <div class="name">${escapeHtml(r.name)} ${r.pending ? `<span class="tag tag-pending">${r.pending} ${t("allRecords.pendingBadge")}</span>` : ""}</div>
              <div class="wage">${formatHours(r.hours)} ${t("records.hours")} · $${formatMoney(r.pay)}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button class="btn btn-secondary btn-small icon-btn view-chart-btn" title="${t("allRecords.viewChart")}">📈</button>
            <button class="btn btn-secondary btn-small icon-btn pay-btn" title="${t("payments.recordPayment")}">💰</button>
          </div>
        </div>
      `
      )
      .join("");

    listEl.querySelectorAll(".emp-summary-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".icon-btn")) return;
        const uid = row.dataset.uid;
        const emp = empMap[uid];
        openEmployeeDetailModal({ uid, name: emp.name || emp.username, hourlyWage: emp.hourlyWage || 0 }, m, () =>
          renderRecordsTab(outerEl, profile)
        );
      });
    });
    listEl.querySelectorAll(".view-chart-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const uid = e.currentTarget.closest(".employee-row").dataset.uid;
        const emp = empMap[uid];
        openEmployeeChartModal({ uid, name: emp.name || emp.username, hourlyWage: emp.hourlyWage || 0 }, all);
      });
    });
    listEl.querySelectorAll(".pay-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const uid = e.currentTarget.closest(".employee-row").dataset.uid;
        const emp = empMap[uid];
        openPaymentModal({ uid, name: emp.name || emp.username, hourlyWage: emp.hourlyWage || 0 }, all);
      });
    });
  }

  el.querySelector("#filter-month").addEventListener("change", (e) => render(e.target.value));
  render(initialMonth);
}

function renderByDaySubTab(el, outerEl, profile, all, employees, empMap) {
  const initialDate = todayStr();
  el.innerHTML = `
    <div class="filter-bar">
      <span class="filter-icon">📅</span>
      <div class="filter-text">
        <label>${t("allRecords.filterDate")}</label>
        <input type="date" id="filter-date" value="${initialDate}" max="${todayStr()}" />
      </div>
    </div>
    <div id="day-summary"></div>
    <div class="section-title">${t("allRecords.workedTitle")}</div>
    <div id="day-record-list"></div>
    <div class="section-title hidden" id="missing-title">${t("allRecords.missingTitle")}</div>
    <div id="day-missing-list"></div>
  `;

  function render(dateStr) {
    const dayRecords = all.filter((r) => r.date === dateStr);
    const workedUids = new Set(dayRecords.map((r) => r.uid));
    const approvedHours = dayRecords.filter((r) => r.status === "approved").reduce((s, r) => s + (r.workedHours || 0), 0);

    el.querySelector("#day-summary").innerHTML = `
      <div class="summary-grid">
        <div class="summary-box"><div class="num">${workedUids.size}</div><div class="label">${t("allRecords.headcountLabel")}</div></div>
        <div class="summary-box"><div class="num">${dayRecords.filter((r) => r.status === "pending").length}</div><div class="label">${t("allRecords.pendingLabel")}</div></div>
        <div class="summary-box"><div class="num">${formatHours(approvedHours)}</div><div class="label">${t("allRecords.dayHoursLabel")}</div></div>
      </div>
    `;

    const listEl = el.querySelector("#day-record-list");
    if (dayRecords.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${t("allRecords.dayEmpty")}</div>`;
    } else {
      const sorted = [...dayRecords].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
      listEl.innerHTML = sorted.map((r) => recordCardHtml(r, { withApproveReject: true })).join("");
      wireRecordCardActions(listEl, sorted, {
        withApproveReject: true,
        onChanged: () => renderRecordsTab(outerEl, profile)
      });
    }

    const missing = employees.filter((e) => !workedUids.has(e.id));
    const missingTitleEl = el.querySelector("#missing-title");
    const missingListEl = el.querySelector("#day-missing-list");
    missingTitleEl.classList.toggle("hidden", missing.length === 0);
    if (missing.length === 0) {
      missingListEl.innerHTML = "";
    } else {
      missingListEl.innerHTML = `<div class="card list-card">${missing
        .map(
          (e) => `
        <div class="employee-row" data-uid="${e.id}">
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="avatar-circle avatar-circle-muted">${escapeHtml((e.name || e.username || "?").slice(0, 1).toUpperCase())}</div>
            <div class="name">${escapeHtml(e.name || e.username)}</div>
          </div>
          <button class="btn btn-secondary btn-small add-missing-btn">${t("allRecords.addMissingBtn")}</button>
        </div>
      `
        )
        .join("")}</div>`;

      missingListEl.querySelectorAll(".add-missing-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const uid = e.currentTarget.closest(".employee-row").dataset.uid;
          const emp = empMap[uid];
          openRecordEditModal({ uid, employeeName: emp.name || emp.username, date: dateStr }, () =>
            renderRecordsTab(outerEl, profile)
          );
        });
      });
    }
  }

  el.querySelector("#filter-date").addEventListener("change", (e) => render(e.target.value));
  render(initialDate);
}

// 员工详情：一个月历，颜色区分当天的状态（已批准/待审/已驳回/空白）。
// 点有记录的格子 = 编辑那条记录；点没有记录的格子（且不是未来日期）= 直接给这个人补录当天的工时。
async function openEmployeeDetailModal(emp, initialMonth, onChanged) {
  const root = document.getElementById("modal-root");
  let month = initialMonth || currentMonthStr();
  let records = (await fetchAllTimeRecords()).filter((r) => r.uid === emp.uid);

  function render() {
    const monthRecords = records.filter((r) => r.date.startsWith(month));
    const approvedHours = monthRecords.filter((r) => r.status === "approved").reduce((s, r) => s + (r.workedHours || 0), 0);
    const pay = approvedHours * (emp.hourlyWage || 0);
    const byDate = {};
    monthRecords.forEach((r) => (byDate[r.date] = r));

    const [y, mo] = month.split("-").map(Number);
    const startWeekday = new Date(y, mo - 1, 1).getDay();
    const daysInMonth = new Date(y, mo, 0).getDate();
    const today = todayStr();

    let cells = "";
    for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell cal-cell-blank"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const rec = byDate[dateStr];
      const isFuture = dateStr > today;
      let cls = "cal-cell";
      if (dateStr === today) cls += " cal-cell-today";
      if (rec) cls += ` cal-cell-${rec.status}`;
      else if (isFuture) cls += " cal-cell-future";
      else cls += " cal-cell-open";
      cells += `<div class="${cls}" data-date="${dateStr}">
        <div class="cal-day-num">${d}</div>
        ${rec ? `<div class="cal-day-hours">${formatHours(rec.workedHours)}h</div>` : ""}
      </div>`;
    }

    const weekdayLabels = [t("cal.sun"), t("cal.mon"), t("cal.tue"), t("cal.wed"), t("cal.thu"), t("cal.fri"), t("cal.sat")];

    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet">
          <h2>📅 ${t("allRecords.detailTitle", { name: emp.name })}</h2>
          <div class="month-nav-row">
            <button class="btn btn-secondary btn-small" id="cal-prev">‹</button>
            <div class="month-nav-label">${month}</div>
            <button class="btn btn-secondary btn-small" id="cal-next">›</button>
          </div>
          <div class="summary-grid" style="margin:10px 0 14px;">
            <div class="summary-box"><div class="num">${formatHours(approvedHours)}</div><div class="label">${t("allRecords.periodApproved")}</div></div>
            <div class="summary-box"><div class="num">$${formatMoney(pay)}</div><div class="label">${t("allRecords.periodPay")}</div></div>
          </div>
          <div class="cal-weekday-row">${weekdayLabels.map((w) => `<div>${w}</div>`).join("")}</div>
          <div class="cal-grid">${cells}</div>
          <div class="cal-legend">
            <span><i class="dot dot-approved"></i>${t("status.approved")}</span>
            <span><i class="dot dot-pending"></i>${t("status.pending")}</span>
            <span><i class="dot dot-rejected"></i>${t("status.rejected")}</span>
          </div>
          <div class="hint">${t("allRecords.calendarHint")}</div>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel" style="width:100%;">${t("chart.close")}</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById("cal-prev").addEventListener("click", () => {
      month = shiftMonth(month, -1);
      render();
    });
    document.getElementById("cal-next").addEventListener("click", () => {
      month = shiftMonth(month, 1);
      render();
    });
    document.getElementById("modal-cancel").addEventListener("click", () => {
      root.innerHTML = "";
      onChanged();
    });
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") {
        root.innerHTML = "";
        onChanged();
      }
    });

    root.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
      cell.addEventListener("click", async () => {
        const dateStr = cell.dataset.date;
        if (dateStr > today) return; // 未来日期不能补录
        const rec = byDate[dateStr];
        const draft = rec || { uid: emp.uid, employeeName: emp.name, date: dateStr };
        openRecordEditModal(draft, async () => {
          records = (await fetchAllTimeRecords(true)).filter((r) => r.uid === emp.uid);
          onChanged();
          render();
        });
      });
    });
  }

  render();
}

// ---------------- 员工工时图表（管理端） ----------------

function openEmployeeChartModal(emp, allRecords) {
  const root = document.getElementById("modal-root");
  let range = "14";
  let customFrom = daysAgoStr(14);
  let customTo = todayStr();

  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <h2>📈 ${t("chart.modalTitle", { name: emp.name })}</h2>
        <div class="chart-range-row" id="range-btns">
          <button class="btn btn-secondary btn-small range-btn" data-range="7">${t("chart.range7")}</button>
          <button class="btn btn-secondary btn-small range-btn" data-range="14">${t("chart.range14")}</button>
          <button class="btn btn-secondary btn-small range-btn" data-range="30">${t("chart.range30")}</button>
          <button class="btn btn-secondary btn-small range-btn" data-range="custom">${t("chart.rangeCustom")}</button>
        </div>
        <div id="custom-range-fields" class="field-row hidden" style="margin-top:10px;">
          <div class="field">
            <label>${t("chart.from")}</label>
            <input type="date" id="range-from" value="${customFrom}" max="${todayStr()}" />
          </div>
          <div class="field">
            <label>${t("chart.to")}</label>
            <input type="date" id="range-to" value="${customTo}" max="${todayStr()}" />
          </div>
        </div>
        <div id="chart-area" style="margin-top:10px;"></div>
        <div class="summary-grid" style="margin-top:14px;">
          <div class="summary-box"><div class="num" id="chart-total-hours">0.00</div><div class="label">${t("chart.totalHours")}</div></div>
          <div class="summary-box"><div class="num" id="chart-total-pay">$0.00</div><div class="label">${t("chart.estPay")}</div></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${t("chart.close")}</button>
        </div>
      </div>
    </div>
  `;

  function compute() {
    let from, to;
    if (range === "custom") {
      from = document.getElementById("range-from").value || customFrom;
      to = document.getElementById("range-to").value || customTo;
    } else {
      from = daysAgoStr(Number(range));
      to = todayStr();
    }
    const days = dateRangeDays(from, to);
    const byDate = {};
    allRecords.forEach((r) => {
      if (r.uid === emp.uid && r.status === "approved" && r.date >= from && r.date <= to) {
        byDate[r.date] = (byDate[r.date] || 0) + (r.workedHours || 0);
      }
    });
    const data = days.map((d) => ({ label: d.slice(5), value: byDate[d] || 0 }));
    const totalHours = data.reduce((s, d) => s + d.value, 0);
    const pay = totalHours * (emp.hourlyWage || 0);

    const chartEl = document.getElementById("chart-area");
    if (totalHours === 0 || data.length === 0) {
      chartEl.innerHTML = `<div class="empty-state">${t("chart.noData")}</div>`;
    } else {
      chartEl.innerHTML = renderBarChartSVG(data, { width: 600, height: 160 });
    }
    document.getElementById("chart-total-hours").textContent = formatHours(totalHours);
    document.getElementById("chart-total-pay").textContent = "$" + formatMoney(pay);
  }

  function setRange(newRange) {
    range = newRange;
    root.querySelectorAll(".range-btn").forEach((b) => b.classList.toggle("active", b.dataset.range === range));
    document.getElementById("custom-range-fields").classList.toggle("hidden", range !== "custom");
    compute();
  }

  root.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => setRange(btn.dataset.range));
  });
  document.getElementById("range-from").addEventListener("change", () => range === "custom" && compute());
  document.getElementById("range-to").addEventListener("change", () => range === "custom" && compute());

  document.getElementById("modal-cancel").addEventListener("click", () => (root.innerHTML = ""));
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") root.innerHTML = "";
  });

  setRange("14");
}

// ---------------- 薪酬支付（管理端） ----------------

async function openPaymentModal(emp, allRecords) {
  const root = document.getElementById("modal-root");

  const totalEarned = allRecords
    .filter((r) => r.uid === emp.uid && r.status === "approved")
    .reduce((s, r) => s + (r.workedHours || 0) * (emp.hourlyWage || 0), 0);

  root.innerHTML = `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal-sheet">
        <h2>💰 ${t("payments.modalTitle", { name: emp.name })}</h2>
        <div class="summary-grid" id="pay-summary" style="margin-bottom:14px;">
          <div class="summary-box"><div class="num">$${formatMoney(totalEarned)}</div><div class="label">${t("payments.totalEarned")}</div></div>
          <div class="summary-box"><div class="num" id="pay-total-paid">$0.00</div><div class="label">${t("payments.totalPaid")}</div></div>
          <div class="summary-box"><div class="num" id="pay-outstanding">$0.00</div><div class="label">${t("payments.outstanding")}</div></div>
        </div>
        <div id="modal-error" class="error-msg"></div>
        <div class="field">
          <label>${t("payments.amount")}</label>
          <div class="field-row" style="align-items:flex-end;">
            <input type="number" min="0" step="0.01" id="pay-amount" style="flex:1;" />
            <button class="btn btn-secondary btn-small" id="pay-full-btn" type="button">${t("payments.payFull")}</button>
          </div>
        </div>
        <div class="field">
          <label>${t("payments.date")}</label>
          <input type="date" id="pay-date" value="${todayStr()}" max="${todayStr()}" />
        </div>
        <div class="field">
          <label>${t("payments.note")}</label>
          <input type="text" id="pay-note" placeholder="${t("payments.notePlaceholder")}" />
        </div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modal-cancel">${t("modal.cancel")}</button>
          <button class="btn btn-primary" id="modal-save">${t("payments.save")}</button>
        </div>
        <div class="section-title" style="margin-top:18px;">${t("payments.history")}</div>
        <div id="pay-history-list"></div>
      </div>
    </div>
  `;

  let outstanding = totalEarned;

  async function refreshHistory() {
    const listEl = document.getElementById("pay-history-list");
    listEl.innerHTML = skeletonRows(2);
    const payments = (await fetchAllPayments()).filter((p) => p.uid === emp.uid);
    const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
    outstanding = totalEarned - totalPaid;

    document.getElementById("pay-total-paid").textContent = "$" + formatMoney(totalPaid);
    const outEl = document.getElementById("pay-outstanding");
    outEl.textContent = "$" + formatMoney(outstanding);
    outEl.parentElement.classList.toggle("summary-box-warn", outstanding > 0.001);

    if (payments.length === 0) {
      listEl.innerHTML = `<div class="empty-state">${t("payments.empty")}</div>`;
      return;
    }
    listEl.innerHTML = payments
      .map(
        (p) => `
        <div class="employee-row" data-id="${p.id}">
          <div class="name">
            <div>${p.date}</div>
            ${p.note ? `<div style="font-size:12px; color:var(--muted);">${escapeHtml(p.note)}</div>` : ""}
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="wage">$${formatMoney(p.amount)}</div>
            <button class="btn btn-secondary btn-small pay-delete-btn" data-id="${p.id}">${t("payments.delete")}</button>
          </div>
        </div>
      `
      )
      .join("");

    listEl.querySelectorAll(".pay-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(t("payments.deleteConfirm"))) return;
        await deletePayment(btn.dataset.id);
        showToast(t("payments.deleted"));
        await refreshHistory();
      });
    });
  }

  document.getElementById("pay-full-btn").addEventListener("click", () => {
    document.getElementById("pay-amount").value = outstanding > 0 ? outstanding.toFixed(2) : "0.00";
  });

  document.getElementById("modal-cancel").addEventListener("click", () => (root.innerHTML = ""));
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") root.innerHTML = "";
  });

  document.getElementById("modal-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const errEl = document.getElementById("modal-error");
    errEl.textContent = "";
    const amount = Number(document.getElementById("pay-amount").value);
    const date = document.getElementById("pay-date").value;
    const note = document.getElementById("pay-note").value.trim();
    if (!amount || amount <= 0) {
      errEl.textContent = t("payments.errorAmount");
      return;
    }
    if (!date) {
      errEl.textContent = t("payments.errorDate");
      return;
    }
    btn.disabled = true;
    btn.textContent = t("modal.processing");
    try {
      await createPayment({
        uid: emp.uid,
        employeeName: emp.name,
        amount,
        date,
        note,
        adminUid: auth.currentUser.uid
      });
      showToast(t("payments.saved"));
      document.getElementById("pay-amount").value = "";
      document.getElementById("pay-note").value = "";
      await refreshHistory();
    } catch (err) {
      errEl.textContent = authErrorMessage(err);
    } finally {
      btn.disabled = false;
      btn.textContent = t("payments.save");
    }
  });

  await refreshHistory();
}
