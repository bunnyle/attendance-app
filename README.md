# 考勤记录系统

移动端优先的网页考勤工具。员工每日上报开始/结束时间与午休时长（自动扣减），提交后由管理员审核（审核前会二次确认）；管理员可新增员工或管理员账号、设置时薪，并控制员工是否能查看自己的薪酬，还能在「全部记录」页看到每位员工本期的工时与预估收入汇总。登录用「用户名 + 密码」，不需要员工记邮箱。数据存储在 Firebase（Authentication + Firestore）。

纯 HTML/CSS/JavaScript 实现，无需构建工具（Firebase SDK 通过 CDN 以 ES Module 方式引入）。

## 目录结构

```
attendance-app/
├── index.html            页面入口
├── css/style.css          样式（移动优先）
├── js/
│   ├── firebase-config.js 你的 Firebase 项目配置（需要你填写）
│   ├── firebase-init.js   初始化 Firebase SDK
│   ├── auth.js            登录/登出/权限
│   ├── employee.js        员工端：上报工时、我的记录
│   ├── admin.js           管理端：审核、员工管理、全部记录
│   ├── utils.js           工具函数（工时计算等）
│   ├── i18n.js             中英文字典与语言切换（默认英文）
│   └── app.js             主控制器
├── firestore.rules        Firestore 安全规则
├── firebase.json          Firebase Hosting/Firestore 配置
└── .firebaserc            Firebase 项目 ID（需要你填写）
```

## 第一步：创建 Firebase 项目

1. 打开 https://console.firebase.google.com ，用你的 Google 账号登录。
2. 点击「新增专案 / Add project」，输入项目名称（例如 `attendance-app`），按提示完成创建（可以关闭 Google Analytics）。
3. 项目创建完成后，进入项目控制台。

## 第二步：启用 Authentication（邮箱/密码登录）

1. 左侧菜单 → **Authentication** → 点击「开始使用」。
2. 「Sign-in method」标签 → 启用 **电子邮件地址/密码**（Email/Password），保存。

## 第三步：创建 Firestore 数据库

1. 左侧菜单 → **Firestore Database** → 「创建数据库」。
2. 选择「以正式版模式启动」（production mode），选择离你最近的区域（如 `asia-east1`），完成创建。
3. 稍后我们会用 `firestore.rules` 里的规则覆盖默认规则（默认规则会拒绝所有读写）。

## 第四步：获取 Web 应用配置并填入项目

1. 项目总览页 → 点击「</>」（网页）图标，注册一个 Web 应用（随便取个昵称，不需要勾选 Hosting）。
2. 复制生成的 `firebaseConfig` 对象。
3. 打开本项目的 `js/firebase-config.js`，把里面的占位内容替换为你复制的配置，例如：

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "attendance-app-xxxx.firebaseapp.com",
  projectId: "attendance-app-xxxx",
  storageBucket: "attendance-app-xxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

4. 同时把 `.firebaserc` 里的 `YOUR_PROJECT_ID` 换成你的项目 ID（即 `projectId`）。

## 第五步：部署安全规则（重要）

安全规则决定谁能读写数据（比如：只有管理员能审核记录、员工只能看自己的数据）。

**方法 A（推荐，用命令行）：**

```bash
npm install -g firebase-tools
firebase login
cd attendance-app
firebase deploy --only firestore:rules
```

**方法 B（手动，用控制台）：**

打开 Firestore Database → 「规则」标签，把 `firestore.rules` 文件的内容整段复制粘贴进去，点击「发布」。

## 第六步：创建第一个管理员账号（网页里直接建，不用去控制台）

现在不需要再手动去 Firebase 控制台建账号了。打开你的网站，如果系统里还没有任何管理员，登录页会自动变成「创建管理员账号 / Create Admin Account」的引导页面，填姓名、用户名（登录用）、联系邮箱（用于重置密码，不用于登录）、密码提交即可，提交后会自动帮你登录进管理后台。这个入口只能成功使用一次——第一个人建好之后，其他人再打开这个页面会提示「管理员账号已存在，请直接登录」，之后所有账号（员工或管理员）都由这位管理员在「员工」页签里新增。

> 这个功能依赖第五步部署的最新 `firestore.rules`（里面新增了 `meta/adminBootstrap` 锁和 `usernames` 集合的规则）。如果你是在拿到这份更新之前就已经部署过旧版规则，记得重新执行一次 `firebase deploy --only firestore:rules`（或把新的 `firestore.rules` 内容重新粘贴发布），否则创建管理员/新增账号时会报权限错误。

> **如果你已经在 Firebase 控制台手动建过一个管理员账号**（在用户名登录功能上线之前）：这个账号仍然可以登录——在登录页的「用户名」栏直接输入你当初注册的邮箱地址（系统会识别出这是邮箱格式，直接按邮箱处理），密码不变。之后建议让这个账号也补一个用户名：编辑该账号所在的「员工」列表暂时还改不了已存在账号的用户名字段（首次创建后用户名不可改），如果想让它也能用纯用户名登录，可以到 Firestore 控制台手动给它的 `users/{uid}` 文档加一个 `username` 字段，并在 `usernames` 集合里新建一个以该用户名为文档 ID 的文档，字段为 `{ uid: <该账号UID>, email: <该账号邮箱> }`；不做这步也完全没问题，用邮箱登录一样有效。

## 第七步：部署网站

### 方案 A：用 Netlify（推荐，最简单）

1. 打开 https://app.netlify.com/drop
2. 直接把整个 `attendance-app` 文件夹拖进页面，几秒后会生成一个网址，例如 `https://random-name-123.netlify.app`。
3. **关键一步**：回到 Firebase 控制台 → **Authentication** → 「设置」标签 → 「已授权网域」（Authorized domains）→ 「新增网域」，把你的 Netlify 网址域名（例如 `random-name-123.netlify.app`，不带 `https://`）加进去。不做这一步登录会报错 `auth/unauthorized-domain`。
4. 之后如果代码有更新，重新把文件夹拖进 https://app.netlify.com/drop 再次覆盖部署即可；如果想要固定网址、绑定 GitHub 自动部署，可以在 Netlify 后台把这次的 drop 部署「关联」到一个正式站点，或改用 Netlify CLI：

```bash
npm install -g netlify-cli
cd attendance-app
netlify deploy --prod
```

首次运行会提示登录 Netlify 账号并选择/新建一个站点，`publish` 目录已在 `netlify.toml` 中设为当前目录。

### 方案 B：用 Firebase Hosting

```bash
cd attendance-app
firebase deploy --only hosting
```

部署完成后会给出一个 `https://你的项目ID.web.app` 网址。用 Firebase Hosting 部署不需要额外配置「已授权网域」（Firebase 会自动信任自己的域名）。

### 本地测试

由于代码使用了 ES Module，不能直接双击打开 `index.html`（浏览器会因跨域限制拒绝加载），需要用本地服务器打开，例如在项目目录运行 `npx serve .` 或 `python3 -m http.server 8000`，再访问 `http://localhost:8000`（记得把 `localhost` 也加入 Firebase 已授权网域，通常默认已经加好）。

## 语言

界面默认是英文，登录页/引导页卡片右上角、以及登录后顶部导航栏都有一个「中文 / EN」切换按钮，点击即可切换，选择会记住（存在浏览器本地）。

## 使用说明

### 管理员

- **待审核**：查看所有员工提交的工时。点「批准」会先弹出确认框（显示员工姓名、日期、工时，避免手滑批错）；点「驳回」会弹出填写原因的提示框，如果点了「取消」则整个操作会中止，不会误驳回。
- **员工**（团队成员管理）：新增账号时可以选择角色是「员工」还是「管理员」——需要多个管理员一起管理时，直接在这里加，不用回 Firebase 控制台。新增账号需要填：姓名、用户名（登录用，创建后不可改）、联系邮箱（仅用于重置密码，不用于登录）、初始密码。点击某个账号进入编辑弹窗后还可以：
  - **重置密码**：向该账号的联系邮箱发送一封 Firebase 官方密码重置邮件，对方点击邮件里的链接自行设置新密码（无需管理员知道旧密码）。
  - **删除账号**：立即清除登录档案，使其无法再登录系统；历史工时记录会保留，但不会自动删除 Firebase Authentication 里的登录账号本身（这是客户端 SDK 的限制），如需彻底清除，需要到 Firebase 控制台 Authentication 页面手动删除一次。日常场景更推荐用「启用/停用」代替删除，方便随时恢复。
  - 编辑自己账号时，角色和启用状态是锁住的（避免不小心把自己降级或停用），但仍可以调整时薪等其它字段。
  - 页面最下方有「我的账号」卡片，管理员可以随时在这里修改自己的登录密码。
- **全部记录**：按月份筛选后，最上方会先列出「本期各员工汇总」——每位员工本月的已批准工时和预估收入一目了然；下方仍保留按员工筛选、看单条记录明细的功能。

新增账号时，系统会用你填的初始密码创建登录用的 Auth 账号，请把用户名和初始密码告知对方，对方登录后可在自己的账号设置里修改密码，管理员也可以随时发送重置密码邮件。

### 员工

- **上报工时**：选择日期、开始/结束时间、午休时长（分钟，自动从工时中扣除），提交后进入待审核状态。
- **我的记录**：查看每条记录的状态（待审核/已批准/已驳回）；待审核的记录可以撤回重填；若管理员开放了「查看薪酬」权限，会显示按时薪计算的预估薪酬与本月合计。

## 数据结构（Firestore）

- `users/{uid}`：`name`、`username`、`email`（联系邮箱，用于重置密码）、`role`（`admin`/`employee`）、`hourlyWage`、`canViewWage`、`status`（`active`/`disabled`）
- `usernames/{username}`：`uid`、`email` —— 登录时先按用户名查出对应邮箱，再用邮箱+密码调用 Firebase Auth；文档 ID 即用户名，天然保证唯一
- `timeRecords/{id}`：`uid`、`employeeName`、`date`、`startTime`、`endTime`、`lunchMinutes`、`workedHours`、`note`、`status`（`pending`/`approved`/`rejected`）、`reviewNote`、`reviewedBy`
- `meta/adminBootstrap`：只有一个字段作用的锁文档，标记「第一个管理员是否已经创建」

## 性能相关

- `index.html` 里加了 `preconnect`/`modulepreload` 提示，提前并行拉取 Firebase SDK 和本地模块文件，减少首次打开时逐层发现依赖造成的等待。
- 未登录状态下会先乐观显示登录框，不等「系统是否已有管理员」这个后台检查完成，减少一次网络往返的可感知延迟。
- 管理端的「员工」和「全部记录」页在同一次会话里有 20 秒的轻量缓存，来回切换页签不会每次都重新拉取整个集合；「待审核」页为保证实时性不走缓存，且只查询 `status == pending` 的记录，不会拉取全部历史工时。

## 注意事项

- Firebase 免费额度（Spark 方案）足够支撑几十人规模的团队日常使用；如需自定义域名等更多功能可升级 Blaze 方案（仍有免费额度）。
- 新增账号功能在浏览器端通过「第二个 Firebase App 实例」创建，不会影响当前管理员的登录状态；该操作只应由管理员在后台完成。
- 部署到 Netlify（或任何非 Firebase 域名）后，务必在 Firebase 控制台 Authentication → 设置 → 已授权网域中加入该域名，否则登录会失败。
- 「创建管理员账号」引导页面部署上线后，建议立刻完成第一次注册，不要把网址分享给不相关的人，避免被抢先注册成管理员（这个限制主要靠单文档锁保证，属于轻量防护，不是强一致事务）。
- 用户名登录的本质仍然是 Firebase Auth 的邮箱登录，只是界面上用用户名做了一层查找；这是因为 Firebase 没有原生的「纯用户名」登录方式，纯前端（不接后端/Cloud Functions）能做到的最简方案就是这种「用户名查邮箱」映射。
