import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  createUserWithEmailAndPassword,
  serverTimestamp
} from "./firebase-init.js";
import { t } from "./i18n.js";
import { normalizeUsername } from "./utils.js";

// Firebase Auth 的邮箱/密码登录方式底层必须要有一个邮箱格式的标识，
// 但这个系统完全不使用真实邮箱——直接用用户名拼一个内部专用、不会真的发信的地址。
// 这样管理员和员工都只需要记用户名，界面上完全看不到、也不用填邮箱。
const INTERNAL_EMAIL_DOMAIN = "users.attendance-app.internal";

// 只用来查东西时（不注册新账号），从用户名反推出「最初那个」内部邮箱的样子。
// 登录时其实不用这个函数——登录是直接读 usernames/{username} 文档里存的 email 字段
// （见下面 resolveUsernameToEmail），那个字段会跟着「重置密码」的迁移一起更新，两者不冲突。
export function internalEmailFor(username) {
  return `${normalizeUsername(username)}@${INTERNAL_EMAIL_DOMAIN}`;
}

// 每次「新注册一个 Auth 账号」都用这个：邮箱带时间戳后缀，保证全局唯一，不会跟任何已存在的
// （包括已经被删除账号、但 Auth 端仍然残留的）邮箱撞车。
// 背景：Firebase 客户端 SDK 没法删除别人的 Auth 账号，所以「删除员工」「重置密码」这些操作
// 都只能在 Firestore 端清理，Auth 端的旧账号会一直留着；如果新账号还用回原来固定不变的邮箱
// （比如单纯 用户名@域名），一旦这个用户名之前被用过、又删掉重建，就会撞上残留的旧 Auth 账号，
// 报 auth/email-already-in-use。带时间戳后缀从根源上避免这个问题。
export function newInternalEmail(username) {
  return `${normalizeUsername(username)}.${Date.now()}@${INTERNAL_EMAIL_DOMAIN}`;
}

// 用户名登录：先按用户名查出对应的（内部）邮箱，再用邮箱+密码登录。
export async function resolveUsernameToEmail(username) {
  const uname = normalizeUsername(username);
  if (!uname) return null;
  const snap = await getDoc(doc(db, "usernames", uname));
  if (!snap.exists()) return null;
  return snap.data().email || null;
}

export async function loginWithUsername(username, password) {
  const input = String(username || "").trim();
  // 兼容旧账号：如果直接输入的是邮箱格式（比如在用户名系统上线之前就手动建好的账号），
  // 直接当邮箱登录，不用非要先查用户名映射。
  if (input.includes("@")) {
    return signInWithEmailAndPassword(auth, input, password);
  }
  const email = await resolveUsernameToEmail(input);
  if (!email) {
    // 伪造一个和"账号或密码错误"一致的错误，避免暴露用户名是否存在
    const err = new Error("wrong credentials");
    err.code = "auth/wrong-password";
    throw err;
  }
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function watchAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

// 获取当前登录用户的档案（users/{uid}）
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export function changeOwnPassword(newPassword) {
  if (!auth.currentUser) return Promise.reject(new Error("Not signed in"));
  return updatePassword(auth.currentUser, newPassword);
}

// ------- 首次使用：自动创建管理员账号 -------

// 系统里是否已经存在管理员（即 meta/adminBootstrap 锁是否已被创建）
export async function adminAlreadyExists() {
  const snap = await getDoc(doc(db, "meta", "adminBootstrap"));
  return snap.exists();
}

// 创建第一个管理员账号：注册 Auth 账号（用内部邮箱）-> 落用户名映射 -> 写入 users 档案(role: admin) -> 落下 bootstrap 锁
export async function createFirstAdmin({ name, username, password }) {
  const uname = normalizeUsername(username);
  const email = newInternalEmail(uname);

  // 先检查用户名是否已被占用，避免白白创建一个没有档案的 Auth 账号
  const existing = await getDoc(doc(db, "usernames", uname));
  if (existing.exists()) {
    const err = new Error("username taken");
    err.code = "username-taken";
    throw err;
  }

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;

  // 用户名映射必须先落，因为 users/{uid} 的 bootstrap 分支和它没有强绑定顺序要求，
  // 但如果用户名已被占用，这里会因为「create-only」规则而失败，从而中止整个流程。
  await setDoc(doc(db, "usernames", uname), {
    uid,
    email
  });

  await setDoc(doc(db, "users", uid), {
    name: name.trim(),
    username: uname,
    role: "admin",
    hourlyWage: 0,
    canViewWage: true,
    status: "active",
    createdAt: serverTimestamp()
  });

  // 锁住引导流程，防止之后再有人通过这个入口创建管理员
  await setDoc(doc(db, "meta", "adminBootstrap"), {
    claimedBy: uid,
    createdAt: serverTimestamp()
  });

  return uid;
}

export function authErrorMessage(err) {
  const code = err && err.code;
  const map = {
    "auth/invalid-email": t("error.invalidEmail"),
    "auth/user-disabled": t("error.userDisabled"),
    "auth/user-not-found": t("error.wrongPassword"),
    "auth/wrong-password": t("error.wrongPassword"),
    "auth/invalid-credential": t("error.wrongPassword"),
    "auth/too-many-requests": t("error.tooManyRequests"),
    "auth/email-already-in-use": t("error.emailInUse"),
    "auth/weak-password": t("error.weakPassword"),
    "auth/requires-recent-login": t("error.requiresRecentLogin"),
    "username-taken": t("modal.usernameTaken"),
    "cannot-reset-self": t("modal.cannotResetSelf")
  };
  return map[code] || (err && err.message) || t("error.unknown");
}
