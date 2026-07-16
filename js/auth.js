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

// 用户名登录时用不到真实邮箱，但 Firebase Auth 内部仍然要求一个邮箱格式的标识。
// 流程：先按用户名查出对应邮箱（usernames/{username} -> email），再用邮箱+密码登录。
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

// 创建第一个管理员账号：注册 Auth 账号 -> 落用户名映射 -> 写入 users 档案(role: admin) -> 落下 bootstrap 锁
export async function createFirstAdmin({ name, username, email, password }) {
  const uname = normalizeUsername(username);

  // 先检查用户名是否已被占用，避免白白创建一个没有档案的 Auth 账号
  const existing = await getDoc(doc(db, "usernames", uname));
  if (existing.exists()) {
    const err = new Error("username taken");
    err.code = "username-taken";
    throw err;
  }

  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  const uid = cred.user.uid;

  // 用户名映射必须先落，因为 users/{uid} 的 bootstrap 分支和它没有强绑定顺序要求，
  // 但如果用户名已被占用，这里会因为「create-only」规则而失败，从而中止整个流程。
  await setDoc(doc(db, "usernames", uname), {
    uid,
    email: email.trim()
  });

  await setDoc(doc(db, "users", uid), {
    name: name.trim(),
    username: uname,
    email: email.trim(),
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
    "username-taken": t("modal.usernameTaken")
  };
  return map[code] || (err && err.message) || t("error.unknown");
}
