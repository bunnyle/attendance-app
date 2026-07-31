# 考勤记录系统

移动端优先的网页考勤工具。员工每日上报开始/结束时间与午休时长（自动扣减，支持跨天班次），同一天不能重复申请；提交后由管理员审核（审核前会二次确认）。管理员可编辑或删除任意一条工时记录、给员工补录忘记打卡的记录、新增员工或管理员账号、重置员工登录密码、设置时薪，并控制员工是否能查看自己的薪酬；管理员还能给员工记录薪酬支付（可部分可全额），系统自动算出累计应付/已付/待付。「全部记录」页分成「按员工」（月历一眼看出每人每天的状态）和「按日期」（一天有多少人上班、时间段是什么、谁还没打卡）两个视角。双方都能看工时趋势图表（近 7/14/30 天或自定义区间），显示总工时与预估收入。登录只需要「用户名 + 密码」，系统完全不使用真实邮箱。数据存储在 Firebase（Authentication + Firestore）。

> ⚠️ **本次更新改动了 `firestore.rules`（员工可以撤回被驳回的记录、管理员可以直接给员工建记录）—— 部署前请务必重新执行一次 `firebase deploy --only firestore:rules`（见下面「第五步」），不然补录工时、员工撤回驳回记录这些新功能会报 `Missing or insufficient permissions` 错误。**

屏幕宽度超过约 860px 时会自动切换成桌面布局（多列网格、居中弹窗），手机上则是单列卡片 + 底部导航，同一套代码自适应。可以直接用 Safari「添加到主屏幕」变成一个图标独立、全屏运行的类原生 App，也可以进一步用 Capacitor 打包成真正能上架 App Store 的 iOS App（详见下面「打包成 iOS App」）。

纯 HTML/CSS/JavaScript 实现，网站本身无需构建工具（Firebase SDK 通过 CDN 以 ES Module 方式引入）；只有想打包 iOS 原生壳时才会用到 `package.json` 里的 Capacitor 依赖。

## 目录结构

```
attendance-app/
├── index.html             页面入口
├── manifest.json          PWA 配置（图标、名称、全屏模式）
├── sw.js                  Service Worker（离线缓存网站静态文件）
├── favicon.ico            浏览器标签页图标
├── icons/                 各尺寸 App 图标（PWA + iOS 主屏幕用）
├── splash/                iOS 启动画面（各机型尺寸）
├── icon-src.svg           图标设计源文件（改设计从这里改，再重新导出各尺寸）
├── icon-maskable-src.svg  自适应形状图标源文件（Android/PWA maskable 用）
├── css/style.css          样式（移动优先，含 iOS 安全区适配）
├── js/
│   ├── firebase-config.js 你的 Firebase 项目配置（需要你填写）
│   ├── firebase-init.js   初始化 Firebase SDK
│   ├── auth.js            登录/登出/权限
│   ├── employee.js        员工端：上报工时、我的记录、薪酬查看
│   ├── admin.js           管理端：审核、员工管理、全部记录、薪酬支付
│   ├── utils.js           工具函数（工时计算等）
│   ├── i18n.js             中英文字典与语言切换（默认英文）
│   └── app.js             主控制器（含 Service Worker 注册）
├── firestore.rules        Firestore 安全规则
├── firebase.json          Firebase Hosting/Firestore 配置
├── .firebaserc            Firebase 项目 ID（需要你填写）
├── package.json           Capacitor 依赖与打包脚本（只有做 iOS 原生壳才需要）
├── capacitor.config.json  Capacitor 配置（App 名称、Bundle ID 等，见下方说明）
├── www/                   打包 iOS 时自动生成的网站文件副本（不用手动改，会被覆盖）
└── ios/                   Capacitor 生成的 Xcode 工程（需要在 Mac 上用 Xcode 打开）
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

现在不需要再手动去 Firebase 控制台建账号了。打开你的网站，如果系统里还没有任何管理员，登录页会自动变成「创建管理员账号 / Create Admin Account」的引导页面，只需要填**姓名、用户名、密码**三项，不需要填任何邮箱——系统会在后台自动用用户名生成一个不会真的发信、界面上也看不到的内部登录标识，纯粹是为了满足 Firebase Auth 底层的技术要求。提交后会自动帮你登录进管理后台。这个入口只能成功使用一次——第一个人建好之后，其他人再打开这个页面会提示「管理员账号已存在，请直接登录」，之后所有账号（员工或管理员）都由这位管理员在「员工」页签里新增，同样只需要用户名，不需要填邮箱。

> 这个功能依赖 `firestore.rules` 里的 `meta/adminBootstrap` 锁和 `usernames` 集合规则。如果你是在很早期部署过一个更旧版本的规则、之后从没重新发布过，记得执行一次 `firebase deploy --only firestore:rules`。
>
> **每一轮只要 `firestore.rules` 文件内容有变化，就必须重新执行一次第五步的 `firebase deploy --only firestore:rules`（或手动把最新内容粘贴进 Firebase 控制台重新发布），否则对应的新功能会报 `Missing or insufficient permissions`。** 这一轮改动了 `timeRecords` 的规则（员工可以撤回被驳回的记录、管理员可以直接给员工建记录），务必重新部署一次。

> **如果你之前用邮箱方式建过账号**（比如在用户名系统上线之前，在 Firebase 控制台手动建的那个管理员账号）：它仍然可以正常登录——在登录页的「用户名」栏直接输入当初注册的邮箱地址，系统会自动识别出这是邮箱格式，按邮箱处理，密码不变，不用做任何迁移。如果这个账号忘记密码了，处理方式跟其他账号一样，见下面「忘记密码怎么办」。

### 忘记密码怎么办

管理员在「员工」页签找到这个账号 → 编辑 → 输入新密码 → 点击「重置密码」。这个人的用户名、姓名、时薪、历史工时和薪酬支付记录都完全不变，登录体验也一样，只是密码换成了新的，把新密码告诉对方就行。

> 技术上的小背景（不影响使用，好奇的话可以看看）：这个系统完全不留存真实邮箱，没法走「发邮件重置密码」那条路，Firebase 客户端 SDK 也没法直接改「别人」的密码。「重置密码」按钮背后的做法是：悄悄注册一个新的登录凭证，再把这个人在 Firestore 里的档案和全部历史记录自动搬过去，旧的登录凭证就晾在 Firebase 后台不再使用——你完全不需要关心这些细节，界面操作跟「改密码」感觉完全一样。
>
> 管理员自己的密码不要用这个功能改（按钮本身也不会出现在自己这一行），直接在「员工」页签最下方「我的账号」卡片里改，那是真正原生的改密码方式。
>
> 「删除账号」和「重置密码」是两个不同的按钮：删除是给员工离职、账号永久不用了的场景（用户名会被释放）；只是想换个密码、账号还要继续用，一定要用「重置密码」，不要用删除再新建的方式，否则这个人的历史工时会因为账号变了而在统计上被拆成两段。

### 如果你想清空数据、完全重新开始

如果嫌迁移麻烦，想干脆把测试数据全部清空、从「创建管理员账号」引导页重新走一遍，去 Firebase 控制台 **Firestore Database → 数据** 标签，把这几样删掉：

- `users` 集合下的所有文档
- `usernames` 集合下的所有文档
- `timeRecords` 集合下的所有文档（如果不想留任何历史工时的话）
- `meta` 集合下的 `adminBootstrap` 文档（这一步最关键，删掉它系统才会重新认为「还没有管理员」）

删完之后刷新网站，就会重新看到「创建管理员账号」的引导页。

## 第七步：部署网站

### 方案 A：GitHub + Netlify 自动部署（推荐，长期维护更省心）

比每次改完代码都手动拖一次文件夹更好——接上 GitHub 之后，以后只要 `git push`，Netlify 会自动重新构建部署，还能看到每次部署的历史记录，出问题也能一键回滚到上一个版本。

1. 在项目文件夹里初始化 Git 仓库并提交（如果文件夹里已经有一个 `.git` 目录、且 `git status` 报 `index.lock` 相关的错误，先把 `.git` 整个删掉再重新 `git init`，避免用到一个状态不完整的仓库）：

```bash
cd attendance-app
git init
git add -A
git commit -m "Initial commit"
git branch -M main
```

2. 去 https://github.com/new 创建一个新仓库（名字随意，比如 `attendance-app`；建议选 **Private** 私有仓库，公开也没关系——`firebase-config.js` 里的 apiKey 不是敏感信息，真正的权限控制在 Firestore 规则里，但私有仓库更干净）。创建时**不要**勾选「初始化 README / .gitignore」，保持空仓库。
3. 复制 GitHub 给你的仓库地址（形如 `https://github.com/你的用户名/attendance-app.git`），继续执行：

```bash
git remote add origin https://github.com/你的用户名/attendance-app.git
git push -u origin main
```

首次 push 会要求你登录 GitHub 账号授权（弹出浏览器或要求输入 Personal Access Token，跟着提示走就行）。

4. 打开 https://app.netlify.com → 「Add new site」→「Import an existing project」→ 选 **GitHub**，授权后选择刚才建的仓库。
5. 部署设置：**Build command 留空**，**Publish directory 填 `.`**（因为这是纯静态站点，不需要构建步骤），然后点「Deploy site」。
6. **关键一步**：回到 Firebase 控制台 → **Authentication** → 「设置」标签 → 「已授权网域」（Authorized domains）→ 「新增网域」，把 Netlify 给的网址域名（例如 `your-site-name.netlify.app`，不带 `https://`）加进去。不做这一步登录会报错 `auth/unauthorized-domain`。

之后每次改完代码，在项目文件夹里 `git add -A && git commit -m "更新说明" && git push`，Netlify 会自动检测到新提交并重新部署，几十秒后网站就更新好了，不用再手动拖文件夹。

### 方案 B：Netlify 拖拽部署（最快，适合先试用）

不想折腾 GitHub、只想先看看效果，可以用这个：

1. 打开 https://app.netlify.com/drop
2. 直接把整个 `attendance-app` 文件夹拖进页面，几秒后会生成一个网址，例如 `https://random-name-123.netlify.app`。
3. 同样别忘了上面第 6 步的「已授权网域」设置。
4. 之后代码有更新，重新拖一次文件夹覆盖部署即可；随时也可以按方案 A 的步骤 2-4 把这次的部署「关联」到 GitHub 仓库，切换成自动部署。

### 方案 C：Firebase Hosting

```bash
cd attendance-app
firebase deploy --only hosting
```

部署完成后会给出一个 `https://你的项目ID.web.app` 网址。用 Firebase Hosting 部署不需要额外配置「已授权网域」（Firebase 会自动信任自己的域名）。

### 本地测试

由于代码使用了 ES Module，不能直接双击打开 `index.html`（浏览器会因跨域限制拒绝加载），需要用本地服务器打开，例如在项目目录运行 `npx serve .` 或 `python3 -m http.server 8000`，再访问 `http://localhost:8000`（记得把 `localhost` 也加入 Firebase 已授权网域，通常默认已经加好）。

## 界面适配

手机上是单列卡片 + 底部 tab 导航；屏幕宽度超过约 860px（平板横屏/电脑浏览器）时会自动切换成桌面布局：底部 tab 变成贴着顶栏的横向导航条，员工列表、待审核列表、全部记录等改成多列网格铺开显示，弹窗从底部滑出变成居中对话框。不需要额外设置，同一套代码根据浏览器窗口宽度自动切换。

## 语言

界面默认是英文，登录页/引导页卡片右上角、以及登录后顶部导航栏都有一个「中文 / EN」切换按钮，点击即可切换，选择会记住（存在浏览器本地）。

## 打包成 iOS App

网站变成手机上的「App」有两条路线，难度和你需要动手的部分差别很大，项目里两条都已经准备好了。

### 方案 A：PWA（添加到主屏幕）—— 已经做完，你只需要试用

这是最简单的路线：把网站「安装」到 iPhone 主屏幕，图标、启动画面、全屏运行（没有浏览器地址栏）都跟原生 App 一样，完全免费，不用 Mac，也不用上架 App Store。我已经把这些都加好了：

- `manifest.json`：App 名称、图标、主题色、`standalone` 全屏模式。
- `sw.js`（Service Worker）：缓存网站自身的静态文件（HTML/CSS/JS/图标），二次打开更快，弱网时也能先看到界面；完全不缓存 Firebase 数据请求，考勤/薪酬数据始终是实时的。
- 一整套图标（`icons/` 目录，从 512×512 到 16×16）和适配各种 iPhone/iPad 屏幕尺寸的启动画面（`splash/` 目录）。
- `index.html` 里加了 iOS 专属的 meta 标签（`apple-mobile-web-app-capable`、状态栏样式等），CSS 里也适配了刘海屏/灵动岛/Home Indicator 的安全区域。

**你需要做的，只有部署 + 在 iPhone 上测试**：

1. 按前面「第七步」把最新代码部署上去（GitHub 自动部署的话 `git push` 一下；拖拽部署的话重新拖一次文件夹）。
2. 用 iPhone 的 **Safari**（必须是 Safari，微信/Chrome 内置浏览器不支持）打开你的网站。
3. 点底部分享按钮（方框加箭头）→ 「添加到主屏幕」→ 确认。
4. 主屏幕上就会出现「Attendance」图标，点开是全屏运行的独立 App，不会看到 Safari 的地址栏。

### 方案 B：真正上架 App Store 的原生壳（Capacitor）—— 工程已搭好，接下来要在你的 Mac 上完成

这条路线是用 [Capacitor](https://capacitorjs.com) 把网站包进一个真正的原生 iOS 项目，可以上架 App Store。这一步 **必须在 Mac 上用 Xcode 完成**——我这边是纯 Linux 环境，没有 Xcode，编译、真机调试、App Store 上传这几步做不了，但项目该搭的部分我已经搭好了：

- 已安装好 `@capacitor/core`、`@capacitor/cli`、`@capacitor/ios`（见 `package.json`）。
- 已生成完整的 Xcode 工程 `ios/App/App.xcodeproj`，并把网站文件（`index.html`/`css`/`js`/图标等）正确打包进了工程里的 `ios/App/App/public` 目录。
- 已经把 App 图标（1024×1024）和启动画面替换成了项目自己的品牌设计，不是 Capacitor 默认的蓝色三角图标。
- App 显示名称已设为「Attendance」，Bundle ID 暂时设为占位符 `com.attendanceapp.tracker`（**你需要改成自己的**，见下面步骤 2）。
- 用的是较新版本的 Capacitor（Swift Package Manager 管理依赖），**不需要额外装 CocoaPods**，Xcode 打开工程会自动解析依赖。

以后每次网页内容有更新，想同步进 iOS 壳，在项目目录跑一次：

```bash
npm run ios:sync
```

这条命令会把最新的网站文件重新复制进 Xcode 工程（对应 `npm run build:www` + `npx cap sync ios`）。

**接下来你需要在自己的 Mac 上做（无法代劳的部分）：**

1. **准备环境**：一台 Mac，装好最新版 [Xcode](https://apps.apple.com/app/xcode/id497799835)（App Store 免费下载），以及 [Node.js](https://nodejs.org)。把整个 `attendance-app` 项目文件夹拷到 Mac 上（比如通过 GitHub 仓库 `git clone`，这也是最推荐的方式，方便以后同步更新）。
2. **注册 Apple Developer Program**（如果还没有）：[https://developer.apple.com/programs/](https://developer.apple.com/programs/)，个人或公司账号，年费 $99 美元。只做 PWA（方案 A）完全不需要这个账号；只有想真正上架 App Store 才需要。
3. **改成你自己的 Bundle ID**：打开 `capacitor.config.json`，把 `appId` 从占位符 `com.attendanceapp.tracker` 改成你自己的反向域名标识（例如 `com.你的公司名.attendance`），改完执行一次 `npm install && npm run ios:sync` 让改动同步进 Xcode 工程。
4. **在 Xcode 里配置签名**：终端运行 `npm run ios:open`（等价于 `npx cap open ios`）会自动打开 Xcode 工程；在 Xcode 左侧选中 `App` 项目 → 「Signing & Capabilities」标签 → 「Team」下拉框选择你的 Apple 开发者账号，Xcode 会自动生成签名证书和描述文件。
5. **本地测试**：用 USB 连上你自己的 iPhone（或用 Xcode 自带的模拟器），在 Xcode 顶部选中你的设备，点左上角的 ▶ 运行按钮，几十秒后 App 会自动装到手机上打开。
6. **准备上架素材**（如果要提交 App Store）：App Store 截图（不同尺寸机型各准备几张）、App 描述文字、隐私政策网址（哪怕只是一个简单的静态页面说明你收集哪些数据也可以）、支持网址/联系邮箱。在 [App Store Connect](https://appstoreconnect.apple.com) 创建 App 记录（Bundle ID 要跟第 3 步保持一致）。
7. **打包上传**：Xcode 菜单栏 「Product」→「Archive」，打包完成后会弹出 Organizer 窗口，点「Distribute App」→「App Store Connect」，跟着向导上传即可。上传后的版本会出现在 App Store Connect 里，等 Apple 审核（通常 1-3 天）通过后就能上架。

> 如果只是想让团队成员在 iPhone 上更方便地打开考勤 App，不需要真的上架 App Store、也不想折腾 Apple Developer 账号和审核流程，**方案 A（PWA）已经完全够用**，效果跟原生 App 几乎没有区别，而且是零成本、零审核、随时能更新。方案 B 主要适合你希望这个 App 能被搜索到、正式出现在 App Store 里的情况。

## 使用说明

### 管理员

- **待审核**：查看所有员工提交的工时。点「批准」会先弹出确认框（显示员工姓名、日期、工时，避免手滑批错）；点「驳回」会弹出填写原因的提示框，如果点了「取消」则整个操作会中止，不会误驳回。每条记录下方还有「编辑」「删除」——编辑可以直接改日期、时间、午休、备注甚至状态；删除会永久移除这条记录，操作前都会二次确认。
- **员工**（团队成员管理）：新增账号时可以选择角色是「员工」还是「管理员」——需要多个管理员一起管理时，直接在这里加，不用回 Firebase 控制台。新增账号只需要填：姓名、用户名（登录用，创建后不可改）、初始密码，**不需要填邮箱**。点击某个账号进入编辑弹窗后还可以：
  - **重置密码**：填一个新密码点「重置密码」，对方的用户名、历史工时、薪酬记录完全不变，只是密码换了——这是「对方忘记密码」时该用的功能（详见上面「忘记密码怎么办」）。
  - **删除账号**：立即清除登录档案，使其无法再登录系统；历史工时记录会保留，但用户名会被释放。这个操作是给「员工离职、账号永久不再使用」用的，不要用来处理忘记密码。
  - 编辑自己账号时，角色和启用状态是锁住的（避免不小心把自己降级或停用），也没有「重置密码」按钮（自己改密码用下面的「我的账号」），但仍可以调整时薪等其它字段。
  - 页面最下方有「我的账号」卡片，管理员可以随时在这里修改自己的登录密码。
- **全部记录**：分成两个子页签：
  - **按员工**：选择月份后，列出这个月每一位员工（哪怕这个月完全没打卡的人也会列出来，一眼看出谁没交工时）——头像、姓名、待审核笔数提醒、已批准工时和预估收入。点击某一行会打开一个**月历**：这个月每一天用颜色区分状态（绿=已批准、黄=待审核、红=已驳回、灰=还没有记录），点有记录的格子可以直接编辑/批核，点空白格子（非未来日期）可以直接给这位员工**补录**一条记录——很适合处理「有几天员工忘了打卡，需要我帮忙补上」的情况，補完一条马上能接着点下一天，不用重新打开。每一行右边还有两个小图标按钮：📈 查看工时趋势图表、💰 记录薪酬支付（部分/全额都可以，见下方薪酬支付说明）。
  - **按日期**：选一天（默认今天），最上面会显示这天一共有几个人上班、几笔还在待审核、已批准的总工时。下面列出这天所有人的打卡记录（时间段、工时、状态），待审核的可以直接批准/驳回，任何一条都能编辑或删除。再往下是「这天还没打卡」的名单，每个人旁边有「+ 补录」按钮，点一下就能直接帮 ta 把这天的记录填上。这个页签是专门用来回答「今天/某天到底几个人上班、都是什么时间段、谁还没交」这类问题的。
  - **薪酬支付**弹窗：顶部显示累计应付（全部已批准工时 × 时薪，不限月份）、累计已付、当前待付三个数字；下方可以填支付金额（有「填入全额」快捷按钮，自动带出当前待付金额，方便一键结清，也可以只填一部分金额做部分支付）、支付日期、备注（可选），保存后会计入支付记录；再往下是这位员工完整的支付历史列表，每条都能删除（删除前会二次确认）。

新增账号时，系统会用你填的初始密码创建登录用的 Auth 账号，请把用户名和初始密码告知对方，对方登录后可在自己的账号设置里修改密码。

### 员工

- **上报工时**：选择日期、开始/结束时间、午休时长（分钟，自动从工时中扣除），提交后进入待审核状态。**同一天只能有一条待审核或已批准的记录**——如果这天已经报过、还在等审核或已经批准了，再提交会被拒绝并提示去「我的记录」处理；如果这天的记录被驳回了，先在「我的记录」里撤回那条，再重新填一次。**支持跨天班次**：比如 22:00 上班、次日 01:00 下班，结束时间直接填 01:00 即可，系统会自动识别并按跨天计算工时（表单上会出现一个 🌙 小提示确认识别正确）。
- **我的记录**：查看每条记录的状态（待审核/已批准/已驳回）；待审核和已驳回的记录都可以撤回（已驳回的撤回后就能在上报页重新填这一天了）；若管理员开放了「查看薪酬」权限，会显示按时薪计算的预估薪酬与本月合计。上方新增了「工时趋势」图表卡片，可以切换 7 天/14 天/30 天/自定义区间查看自己的工时走势和预估收入。若管理员开放了查看薪酬权限，还会看到一张「薪酬支付」卡片，显示累计应付、累计已付、当前待付（结清后显示「已结清」），以及管理员每次给自己付款的历史记录（日期、金额、备注）——这部分是只读的，员工不能自行修改或删除，只能核对。

## 数据结构（Firestore）

- `users/{uid}`：`name`、`username`、`role`（`admin`/`employee`）、`hourlyWage`、`canViewWage`、`status`（`active`/`disabled`）。（早期在用户名系统上线前手动建的账号可能还带一个 `email` 字段，新建的账号不会再写这个字段）
- `usernames/{username}`：`uid`、`email`（这里的 email 是系统自动生成的内部登录标识，不是真实邮箱，也不会展示在界面上）—— 登录时先按用户名查出对应的内部邮箱，再用邮箱+密码调用 Firebase Auth；文档 ID 即用户名，天然保证唯一
- `timeRecords/{id}`：`uid`、`employeeName`、`date`、`startTime`、`endTime`、`lunchMinutes`、`workedHours`、`note`、`status`（`pending`/`approved`/`rejected`）、`reviewNote`、`reviewedBy`、`reviewedAt`；管理员代员工补录的记录会多一个 `addedByAdmin: true` 标记（纯用于以后统计/排查，界面上不影响任何显示）
- `payments/{id}`：`uid`、`employeeName`、`amount`、`date`、`note`、`createdBy`（记录这笔支付的管理员 uid）、`createdAt`。只有管理员能新增/修改/删除；员工只能读到自己名下的支付记录。「累计应付」不单独存字段，而是每次实时用「该员工全部已批准工时 × 时薪」现算，「待付」= 累计应付 − 该员工所有 `payments` 金额之和。
- `meta/adminBootstrap`：只有一个字段作用的锁文档，标记「第一个管理员是否已经创建」

## 性能与流畅度

- `index.html` 里加了 `preconnect`/`modulepreload` 提示，提前并行拉取 Firebase SDK 和本地模块文件，减少首次打开时逐层发现依赖造成的等待。
- 未登录状态下会先乐观显示登录框，不等「系统是否已有管理员」这个后台检查完成，减少一次网络往返的可感知延迟。
- 管理端的「员工」和「全部记录」页、员工端的「我的记录」页在同一次会话里有 20 秒的轻量缓存，来回切换页签命中缓存时会完全跳过加载状态，不会有一闪而过的「加载中」；首次加载没有缓存时改用骨架屏占位，比纯文字更顺滑。「待审核」页为保证实时性不走缓存，且只查询 `status == pending` 的记录，不会拉取全部历史工时。
- 每次切换页签、弹窗打开/关闭都加了淡入动效和卡片阴影反馈，减少界面切换时的生硬感。
- 关掉了整页的橡皮筋回弹效果（`overscroll-behavior`），按钮加了轻量按压反馈（缩放/变暗），底部导航栏用了毛玻璃背景，「添加到主屏幕」全屏运行时顶栏会自动让出刘海屏/灵动岛的安全区域——这些都是让它在 iPhone 上摸起来更接近原生 App、而不是「一个网页」的细节。

## 注意事项

- Firebase 免费额度（Spark 方案）足够支撑几十人规模的团队日常使用；如需自定义域名等更多功能可升级 Blaze 方案（仍有免费额度）。
- 新增账号功能在浏览器端通过「第二个 Firebase App 实例」创建，不会影响当前管理员的登录状态；该操作只应由管理员在后台完成。
- 部署到 Netlify（或任何非 Firebase 域名）后，务必在 Firebase 控制台 Authentication → 设置 → 已授权网域中加入该域名，否则登录会失败。
- 「创建管理员账号」引导页面部署上线后，建议立刻完成第一次注册，不要把网址分享给不相关的人，避免被抢先注册成管理员（这个限制主要靠单文档锁保证，属于轻量防护，不是强一致事务）。
- 用户名登录的本质仍然是 Firebase Auth 的邮箱登录，只是界面上用用户名做了一层查找；这是因为 Firebase 没有原生的「纯用户名」登录方式，纯前端（不接后端/Cloud Functions）能做到的最简方案就是这种「用户名查邮箱」映射。
