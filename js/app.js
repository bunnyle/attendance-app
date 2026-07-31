import {
  loginWithUsername,
  logout,
  watchAuthState,
  getUserProfile,
  authErrorMessage,
  adminAlreadyExists,
  createFirstAdmin
} from "./auth.js";
import { renderEmployeeView, renderEmployeeNav } from "./employee.js";
import { renderAdminView, renderAdminNav } from "./admin.js";
import { showToast } from "./utils.js";
import { t, getLang, toggleLang, onLangChange } from "./i18n.js";

const viewLogin = document.getElementById("view-login");
const viewMain = document.getElementById("view-main");
const loadingEl = document.getElementById("loading");
const mainContent = document.getElementById("main-content");
const bottomNav = document.getElementById("bottom-nav");
const userInfoEl = document.getElementById("user-info");
const appTitleEl = document.getElementById("app-title");
const logoutBtn = document.getElementById("logout-btn");

let currentProfile = null;
let currentScreen = "loading"; // "loading" | "login" | "bootstrap" | "main"
let bootstrapChecked = false; // 是否已经确认过系统里已存在管理员（避免重复查询）

function showLoading(show) {
  loadingEl.classList.toggle("hidden", !show);
}

function showView(view) {
  viewLogin.classList.toggle("hidden", view !== "login" && view !== "bootstrap");
  viewMain.classList.toggle("hidden", view !== "main");
}

// 找到当前 DOM 里所有的语言切换按钮（顶栏一个、登录/引导卡片一个），统一同步文案与点击事件
function syncLangButtons() {
  document.querySelectorAll(".lang-toggle-btn").forEach((btn) => {
    btn.textContent = getLang() === "en" ? "中文" : "EN";
    btn.onclick = () => toggleLang();
  });
}

onLangChange(() => {
  rerenderCurrentScreen();
});

logoutBtn.textContent = t("app.logout");

function rerenderCurrentScreen() {
  if (currentScreen === "login") renderLogin();
  else if (currentScreen === "bootstrap") renderBootstrap();
  else if (currentScreen === "main" && currentProfile) renderMainForProfile(currentProfile);
}

function renderLogin() {
  currentScreen = "login";
  showView("login");
  showLoading(false);
  viewLogin.innerHTML = `
    <div class="login-card">
      <button class="lang-toggle-btn lang-pill">中文</button>
      <div class="brand-badge">⏱</div>
      <h1>${t("login.title")}</h1>
      <p class="sub">${t("login.subtitle")}</p>
      <div class="field">
        <label>${t("login.username")}</label>
        <input type="text" id="login-username" autocomplete="username" autocapitalize="none" />
      </div>
      <div class="field">
        <label>${t("login.password")}</label>
        <input type="password" id="login-password" placeholder="••••••••" autocomplete="current-password" />
      </div>
      <div id="login-error" class="error-msg"></div>
      <button class="btn btn-primary" id="login-btn">${t("login.button")}</button>
    </div>
  `;

  const userEl = document.getElementById("login-username");
  const pwEl = document.getElementById("login-password");
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-btn");

  async function doLogin() {
    errEl.textContent = "";
    if (!userEl.value.trim() || !pwEl.value) {
      errEl.textContent = t("login.errorMissing");
      return;
    }
    btn.disabled = true;
    btn.textContent = t("login.loading");
    try {
      await loginWithUsername(userEl.value, pwEl.value);
      // onAuthStateChanged 会接管后续流程
    } catch (err) {
      errEl.textContent = authErrorMessage(err);
      btn.disabled = false;
      btn.textContent = t("login.button");
    }
  }

  btn.addEventListener("click", doLogin);
  [userEl, pwEl].forEach((i) =>
    i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
    })
  );
  syncLangButtons();

  // 后台悄悄确认一下系统状态：如果其实还没有管理员，自动切换成引导创建页面。
  // 用乐观渲染（先展示登录框）而不是等这次查询完成再显示任何东西，减少可感知的加载时间。
  if (!bootstrapChecked) {
    adminAlreadyExists()
      .then((hasAdmin) => {
        bootstrapChecked = true;
        if (!hasAdmin && currentScreen === "login") renderBootstrap();
      })
      .catch(() => {
        /* 查询失败就先按已存在管理员处理，不打断登录 */
      });
  }
}

function renderBootstrap() {
  currentScreen = "bootstrap";
  showView("bootstrap");
  showLoading(false);
  viewLogin.innerHTML = `
    <div class="login-card">
      <button class="lang-toggle-btn lang-pill">中文</button>
      <div class="brand-badge">✨</div>
      <h1>${t("bootstrap.title")}</h1>
      <p class="sub">${t("bootstrap.subtitle")}</p>
      <div class="field">
        <label>${t("bootstrap.name")}</label>
        <input type="text" id="bs-name" />
      </div>
      <div class="field">
        <label>${t("bootstrap.username")}</label>
        <input type="text" id="bs-username" autocomplete="username" autocapitalize="none" />
      </div>
      <div class="field">
        <label>${t("bootstrap.password")}</label>
        <input type="password" id="bs-password" placeholder="••••••••" autocomplete="new-password" />
        <div class="hint">${t("bootstrap.passwordHint")}</div>
      </div>
      <div id="bs-error" class="error-msg"></div>
      <button class="btn btn-primary" id="bs-btn">${t("bootstrap.button")}</button>
      <button class="btn btn-link" id="bs-back">${t("bootstrap.backToLogin")}</button>
    </div>
  `;

  const nameEl = document.getElementById("bs-name");
  const usernameEl = document.getElementById("bs-username");
  const pwEl = document.getElementById("bs-password");
  const errEl = document.getElementById("bs-error");
  const btn = document.getElementById("bs-btn");

  document.getElementById("bs-back").addEventListener("click", () => renderLogin());

  btn.addEventListener("click", async () => {
    errEl.textContent = "";
    if (!nameEl.value.trim() || !usernameEl.value.trim() || !pwEl.value) {
      errEl.textContent = t("bootstrap.errorMissing");
      return;
    }
    if (pwEl.value.length < 6) {
      errEl.textContent = t("bootstrap.errorPasswordShort");
      return;
    }
    btn.disabled = true;
    btn.textContent = t("bootstrap.loading");
    try {
      await createFirstAdmin({
        name: nameEl.value,
        username: usernameEl.value,
        password: pwEl.value
      });
      showToast(t("bootstrap.success"));
      // onAuthStateChanged 会接管后续流程（自动进入管理后台）
    } catch (err) {
      if (err && err.code === "username-taken") {
        errEl.textContent = t("bootstrap.errorUsernameTaken");
      } else if (err && (err.code === "permission-denied" || err.code === "auth/email-already-in-use")) {
        errEl.textContent = t("bootstrap.errorTaken");
      } else {
        errEl.textContent = authErrorMessage(err);
      }
      btn.disabled = false;
      btn.textContent = t("bootstrap.button");
    }
  });
  syncLangButtons();
}

function renderMainForProfile(profile) {
  currentScreen = "main";
  currentProfile = profile;
  showView("main");
  showLoading(false);
  appTitleEl.textContent = profile.role === "admin" ? t("app.titleAdmin") : t("app.titleEmployee");
  userInfoEl.textContent = profile.name || profile.username || profile.email;
  logoutBtn.textContent = t("app.logout");
  syncLangButtons();

  function refresh() {
    if (profile.role === "admin") {
      renderAdminNav(bottomNav, profile, refresh);
      renderAdminView(mainContent, profile);
    } else {
      renderEmployeeNav(bottomNav, profile, refresh);
      renderEmployeeView(mainContent, profile);
    }
  }
  refresh();
}

logoutBtn.addEventListener("click", async () => {
  await logout();
  showToast(t("toast.loggedOut"));
});

syncLangButtons();

watchAuthState(async (user) => {
  document.getElementById("modal-root").innerHTML = "";
  if (!user) {
    currentProfile = null;
    // 乐观渲染登录框，不等后台的 bootstrap 检查完成——多数情况下系统早已有管理员，
    // 这样可以省掉一次网络往返带来的可感知延迟。
    renderLogin();
    return;
  }
  showLoading(true);
  try {
    const profile = await getUserProfile(user.uid);
    if (!profile) {
      showLoading(false);
      await logout();
      showToast(t("error.noProfile"));
      return;
    }
    if (profile.status === "disabled") {
      showLoading(false);
      await logout();
      showToast(t("error.disabledAccount"));
      return;
    }
    renderMainForProfile(profile);
  } catch (err) {
    showLoading(false);
    console.error(err);
    showToast(t("error.loadFailed", { msg: err.message || err }));
  }
});

// 注册 Service Worker：让「添加到主屏幕」后的应用有离线外壳缓存和更快的二次启动速度。
// 只缓存本站自己的静态文件，不影响 Firebase 的实时数据请求。
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
