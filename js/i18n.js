// 极简 i18n：默认英文，可切换中文，偏好保存在 localStorage
const STRINGS = {
  en: {
    "app.titleAdmin": "Attendance Admin",
    "app.titleEmployee": "Attendance",
    "app.logout": "Log out",

    "login.title": "Attendance System",
    "login.subtitle": "Sign in with the account your admin gave you",
    "login.email": "Email",
    "login.username": "Username",
    "login.password": "Password",
    "login.button": "Log in",
    "login.loading": "Signing in...",
    "login.errorMissing": "Please enter both username and password",
    "login.firstTime": "First time setting this up?",
    "login.setupLink": "Create the admin account",

    "bootstrap.title": "Create Admin Account",
    "bootstrap.subtitle": "No admin account exists yet. Set one up now — this only needs to be done once.",
    "bootstrap.name": "Your name",
    "bootstrap.username": "Username (for login)",
    "bootstrap.email": "Contact email (used for password reset)",
    "bootstrap.password": "Password",
    "bootstrap.passwordHint": "At least 6 characters. You can change it later.",
    "bootstrap.button": "Create admin account",
    "bootstrap.loading": "Creating...",
    "bootstrap.errorMissing": "Please fill in all fields",
    "bootstrap.errorPasswordShort": "Password must be at least 6 characters",
    "bootstrap.errorTaken": "An admin account already exists. Please log in instead.",
    "bootstrap.errorUsernameTaken": "That username is already taken",
    "bootstrap.success": "Admin account created — signing you in...",
    "bootstrap.backToLogin": "Back to login",
    "bootstrap.checking": "Checking setup status...",

    "nav.report": "Report",
    "nav.records": "My Records",
    "nav.approvals": "Approvals",
    "nav.employees": "Employees",
    "nav.allRecords": "All Records",

    "report.title": "Report today's hours",
    "report.date": "Date",
    "report.start": "Start time",
    "report.end": "End time",
    "report.lunch": "Lunch break (minutes)",
    "report.note": "Note (optional)",
    "report.notePlaceholder": "Reason for overtime, etc.",
    "report.previewLabel": "Estimated hours",
    "report.submit": "Submit for approval",
    "report.submitting": "Submitting...",
    "report.success": "Submitted — waiting for admin approval",
    "report.errorTime": "End time must be after start time, and worked hours after lunch deduction must be greater than 0",
    "report.errorFields": "Please fill in date and both times",

    "records.monthApproved": "Approved hours (this month)",
    "records.pendingCount": "Pending entries",
    "records.monthPay": "Estimated pay (this month)",
    "records.allRecords": "All records",
    "records.empty": "No time records yet",
    "records.withdraw": "Withdraw",
    "records.withdrawConfirm": "Withdraw this pending record?",
    "records.withdrawn": "Withdrawn",
    "records.rejectReason": "Rejection reason",
    "records.noteLabel": "Note",
    "records.accountSettings": "Account settings",
    "records.newPassword": "New password (min 6 characters)",
    "records.newPasswordPlaceholder": "Enter a new password",
    "records.changePassword": "Change password",
    "records.pwTooShort": "Password must be at least 6 characters",
    "records.pwUpdated": "Password updated",
    "records.hours": "hours",
    "records.pay": "Pay",
    "records.workedHours": "Worked hours",

    "status.pending": "Pending",
    "status.approved": "Approved",
    "status.rejected": "Rejected",

    "approvals.title": "Pending approvals ({count})",
    "approvals.empty": "No records waiting for approval",
    "approvals.approve": "Approve",
    "approvals.reject": "Reject",
    "approvals.approveConfirm": "Approve this record for {name} ({date}, {hours}h)?",
    "approvals.rejectPrompt": "Reason for rejection (optional). Cancel to abort.",
    "approvals.approved": "Approved",
    "approvals.rejected": "Rejected",

    "employees.addButton": "+ Add account",
    "employees.listTitle": "Team ({count})",
    "employees.empty": "No accounts yet",
    "employees.editButton": "Edit",
    "employees.disabledTag": "Disabled",
    "employees.canViewTag": "Can view pay",
    "employees.adminTag": "Admin",
    "employees.wageLabel": "Hourly wage",
    "employees.myAccount": "My account",
    "employees.myAccountPw": "Change your password",

    "modal.editTitle": "Edit account",
    "modal.addTitle": "Add account",
    "modal.name": "Name",
    "modal.username": "Username (for login)",
    "modal.usernameHint": "Letters/numbers only, no spaces. Cannot be changed after creation.",
    "modal.email": "Contact email",
    "modal.emailHint": "Used to send password-reset emails — not used for login.",
    "modal.emailReadonly": "(cannot be changed)",
    "modal.initialPassword": "Initial password (min 6 characters, can be changed later)",
    "modal.initialPasswordPlaceholder": "e.g. 123456",
    "modal.role": "Role",
    "modal.roleEmployee": "Employee",
    "modal.roleAdmin": "Admin",
    "modal.wage": "Hourly wage",
    "modal.allowViewWage": "Allow employee to see their own pay",
    "modal.accountEnabled": "Account enabled",
    "modal.cancel": "Cancel",
    "modal.save": "Save",
    "modal.create": "Create",
    "modal.nameRequired": "Please enter a name",
    "modal.usernameRequired": "Please enter a username",
    "modal.processing": "Processing...",
    "modal.saved": "Saved",
    "modal.emailRequired": "Please enter a contact email",
    "modal.pwShort": "Password must be at least 6 characters",
    "modal.created": "Account created",
    "modal.usernameTaken": "That username is already taken",
    "modal.resetPassword": "Reset password",
    "modal.deleteEmployee": "Delete account",
    "modal.resetConfirm": "Send a password reset email to {email}?",
    "modal.resetSending": "Sending...",
    "modal.resetSent": "Password reset email sent",
    "modal.deleteConfirm": "Delete account \"{name}\"? This cannot be undone.",
    "modal.deleteHint": "Reset password sends a password-reset email to the contact email on file. Delete revokes access immediately; historical records are kept, but the underlying Firebase login account is not automatically removed.",
    "modal.deleting": "Deleting...",
    "modal.deleted": "Account deleted",

    "allRecords.filterMonth": "Filter by month",
    "allRecords.filterEmployee": "Filter by employee",
    "allRecords.allEmployees": "All employees",
    "allRecords.countLabel": "Records",
    "allRecords.approvedHoursLabel": "Approved hours",
    "allRecords.estPayLabel": "Est. payroll",
    "allRecords.empty": "No records match this filter",
    "allRecords.byEmployeeTitle": "By employee this period",
    "allRecords.byEmployeeEmpty": "No approved hours in this period",

    "common.loading": "Loading...",

    "toast.loggedOut": "Logged out",

    "error.noProfile": "This account has no profile yet. Please contact your admin.",
    "error.disabledAccount": "This account has been disabled. Please contact your admin.",
    "error.loadFailed": "Failed to load account info: {msg}",
    "error.invalidEmail": "Invalid email format",
    "error.userDisabled": "This account has been disabled",
    "error.wrongPassword": "Incorrect email or password",
    "error.tooManyRequests": "Too many attempts, please try again later",
    "error.emailInUse": "This email is already registered",
    "error.weakPassword": "Password is too weak, at least 6 characters",
    "error.requiresRecentLogin": "Please log in again and retry",
    "error.unknown": "Something went wrong"
  },

  zh: {
    "app.titleAdmin": "考勤管理",
    "app.titleEmployee": "考勤记录",
    "app.logout": "登出",

    "login.title": "考勤记录系统",
    "login.subtitle": "请使用管理员分配的账号登录",
    "login.email": "邮箱",
    "login.username": "用户名",
    "login.password": "密码",
    "login.button": "登录",
    "login.loading": "登录中...",
    "login.errorMissing": "请输入用户名与密码",
    "login.firstTime": "第一次使用？",
    "login.setupLink": "创建管理员账号",

    "bootstrap.title": "创建管理员账号",
    "bootstrap.subtitle": "系统里还没有管理员账号，现在建一个吧——只需要做一次。",
    "bootstrap.name": "你的姓名",
    "bootstrap.username": "用户名（用于登录）",
    "bootstrap.email": "联系邮箱（用于重置密码）",
    "bootstrap.password": "密码",
    "bootstrap.passwordHint": "至少 6 位，之后可以自行修改。",
    "bootstrap.button": "创建管理员账号",
    "bootstrap.loading": "创建中...",
    "bootstrap.errorMissing": "请完整填写各项",
    "bootstrap.errorPasswordShort": "密码至少 6 位",
    "bootstrap.errorTaken": "管理员账号已存在，请直接登录。",
    "bootstrap.errorUsernameTaken": "该用户名已被使用",
    "bootstrap.success": "管理员账号已创建，正在登录...",
    "bootstrap.backToLogin": "返回登录",
    "bootstrap.checking": "正在检查系统状态...",

    "nav.report": "上报工时",
    "nav.records": "我的记录",
    "nav.approvals": "待审核",
    "nav.employees": "员工",
    "nav.allRecords": "全部记录",

    "report.title": "上报今日工时",
    "report.date": "日期",
    "report.start": "开始时间",
    "report.end": "结束时间",
    "report.lunch": "午休时长（分钟）",
    "report.note": "备注（可选）",
    "report.notePlaceholder": "加班原因等",
    "report.previewLabel": "预计工时（小时）",
    "report.submit": "提交审核",
    "report.submitting": "提交中...",
    "report.success": "已提交，等待管理员审核",
    "report.errorTime": "结束时间需晚于开始时间，且扣除午休后工时需大于 0",
    "report.errorFields": "请完整填写日期与时间",

    "records.monthApproved": "本月已批准工时",
    "records.pendingCount": "待审核笔数",
    "records.monthPay": "本月预估薪酬",
    "records.allRecords": "全部记录",
    "records.empty": "还没有工时记录",
    "records.withdraw": "撤回",
    "records.withdrawConfirm": "确定撤回这条待审核记录吗？",
    "records.withdrawn": "已撤回",
    "records.rejectReason": "驳回原因",
    "records.noteLabel": "备注",
    "records.accountSettings": "账号设置",
    "records.newPassword": "新密码（至少 6 位）",
    "records.newPasswordPlaceholder": "输入新密码",
    "records.changePassword": "修改密码",
    "records.pwTooShort": "密码至少 6 位",
    "records.pwUpdated": "密码已更新",
    "records.hours": "小时",
    "records.pay": "薪酬",
    "records.workedHours": "工时",

    "status.pending": "待审核",
    "status.approved": "已批准",
    "status.rejected": "已驳回",

    "approvals.title": "待审核（{count}）",
    "approvals.empty": "目前没有待审核记录",
    "approvals.approve": "批准",
    "approvals.reject": "驳回",
    "approvals.approveConfirm": "确定批准 {name} 的这条记录吗？（{date}，{hours} 小时）",
    "approvals.rejectPrompt": "驳回原因（可留空，点击取消可中止操作）：",
    "approvals.approved": "已批准",
    "approvals.rejected": "已驳回",

    "employees.addButton": "+ 新增账号",
    "employees.listTitle": "团队成员（{count}）",
    "employees.empty": "还没有账号",
    "employees.editButton": "编辑",
    "employees.disabledTag": "已停用",
    "employees.canViewTag": "可查看薪酬",
    "employees.adminTag": "管理员",
    "employees.wageLabel": "时薪",
    "employees.myAccount": "我的账号",
    "employees.myAccountPw": "修改我的密码",

    "modal.editTitle": "编辑账号",
    "modal.addTitle": "新增账号",
    "modal.name": "姓名",
    "modal.username": "用户名（用于登录）",
    "modal.usernameHint": "仅限字母/数字，不含空格；创建后不可修改。",
    "modal.email": "联系邮箱",
    "modal.emailHint": "用于发送重置密码邮件，不用于登录。",
    "modal.emailReadonly": "（不可修改）",
    "modal.initialPassword": "初始密码（至少 6 位，之后可修改）",
    "modal.initialPasswordPlaceholder": "例如 123456",
    "modal.role": "角色",
    "modal.roleEmployee": "员工",
    "modal.roleAdmin": "管理员",
    "modal.wage": "时薪（元/小时）",
    "modal.allowViewWage": "允许员工查看自己的薪酬",
    "modal.accountEnabled": "账号启用",
    "modal.cancel": "取消",
    "modal.save": "保存",
    "modal.create": "创建",
    "modal.nameRequired": "请输入姓名",
    "modal.usernameRequired": "请输入用户名",
    "modal.processing": "处理中...",
    "modal.saved": "已保存",
    "modal.emailRequired": "请输入联系邮箱",
    "modal.pwShort": "密码至少 6 位",
    "modal.created": "账号已创建",
    "modal.usernameTaken": "该用户名已被使用",
    "modal.resetPassword": "重置密码",
    "modal.deleteEmployee": "删除账号",
    "modal.resetConfirm": "向 {email} 发送密码重置邮件？",
    "modal.resetSending": "发送中...",
    "modal.resetSent": "重置密码邮件已发送",
    "modal.deleteConfirm": "确定删除账号「{name}」吗？此操作不可撤销。",
    "modal.deleteHint": "重置密码会给档案里的联系邮箱发一封密码重置邮件；删除账号会立即使其无法登录，历史工时记录会保留，但登录用的 Firebase 账号不会被自动清除。",
    "modal.deleting": "删除中...",
    "modal.deleted": "已删除账号",

    "allRecords.filterMonth": "筛选月份",
    "allRecords.filterEmployee": "筛选员工",
    "allRecords.allEmployees": "全部员工",
    "allRecords.countLabel": "记录数",
    "allRecords.approvedHoursLabel": "已批准工时",
    "allRecords.estPayLabel": "预估薪酬支出",
    "allRecords.empty": "没有符合条件的记录",
    "allRecords.byEmployeeTitle": "本期各员工汇总",
    "allRecords.byEmployeeEmpty": "本期还没有已批准的工时",

    "common.loading": "加载中...",

    "toast.loggedOut": "已登出",

    "error.noProfile": "账号尚未配置档案，请联系管理员",
    "error.disabledAccount": "该账号已被停用，请联系管理员",
    "error.loadFailed": "加载账号信息失败：{msg}",
    "error.invalidEmail": "邮箱格式不正确",
    "error.userDisabled": "该账号已被停用",
    "error.wrongPassword": "账号或密码错误",
    "error.tooManyRequests": "尝试次数过多，请稍后再试",
    "error.emailInUse": "该邮箱已被注册",
    "error.weakPassword": "密码强度太弱，至少 6 位",
    "error.requiresRecentLogin": "请重新登录后再试",
    "error.unknown": "发生未知错误"
  }
};

const STORAGE_KEY = "attendance_lang";
let currentLang = (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY)) || "en";
if (!STRINGS[currentLang]) currentLang = "en";

const listeners = [];

export function t(key, vars) {
  let str = (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(`{${k}}`, vars[k]);
    });
  }
  return str;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!STRINGS[lang] || lang === currentLang) return;
  currentLang = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (e) {
    /* ignore */
  }
  listeners.forEach((fn) => fn(lang));
}

export function toggleLang() {
  setLang(currentLang === "en" ? "zh" : "en");
}

export function onLangChange(fn) {
  listeners.push(fn);
}
