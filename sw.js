// Service worker：只负责缓存「本站自己的静态文件」（HTML/CSS/JS/图标），
// 让应用在 iOS 上「添加到主屏幕」后启动更快、弱网/离线时也能打开界面。
// 完全不拦截 Firebase/Firestore 等跨域请求——数据永远走网络，保证考勤数据实时准确。

const CACHE_NAME = "attendance-app-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/auth.js",
  "./js/admin.js",
  "./js/employee.js",
  "./js/utils.js",
  "./js/i18n.js",
  "./js/firebase-config.js",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 只处理同源的 GET 请求；Firebase Auth / Firestore 等跨域请求一律放行，不缓存、不拦截
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      // stale-while-revalidate：先立刻用缓存渲染，同时后台悄悄更新缓存
      return cached || network;
    })
  );
});
