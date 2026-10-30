# wangstock

轻量自选行情桌面端 · Windows x64 · 单文件 4.6 MB

[![Release](https://github.com/LiangLiang723/wangstock/actions/workflows/release.yml/badge.svg)](https://github.com/LiangLiang723/wangstock/actions/workflows/release.yml)
[![CI](https://github.com/LiangLiang723/wangstock/actions/workflows/ci.yml/badge.svg)](https://github.com/LiangLiang723/wangstock/actions/workflows/ci.yml)
![platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)
![size](https://img.shields.io/badge/binary-4.6%20MB-success)

自选股与 ETF 管理、A 股 + 港股行情、自定义行业分类、个股详情、系统托盘常驻。

---

## 功能

### 自选与分组

| 操作 | 方式 |
|---|---|
| 添加标的 | `Ctrl K`，支持代码 / 名称 / 拼音首字母；也可直接输入 6 位 A 股或 5 位港股代码回车 |
| 新建分组 | 侧栏「自选分组」右侧 `＋` |
| 重命名 | 双击分组名 |
| 删除 / 上移 / 下移 / 建子分组 | 分组上右键 |
| 自选排序 | 直接拖拽行；或行右键「上移 / 下移」。在「全部自选」里拖改的是全局顺序，在具体分组里拖改的是组内顺序 |
| 跨组移动 | 把行拖到左侧目标分组 |
| 删除标的 | 行上右键 |

「全部自选」自动汇总所有自选分组并去重，顺序独立保存在 `order` 字段，可直接拖动调整；分组内顺序仍由成员顺序决定，两者互不干扰。

### 个股详情

点击列表任意一行进入详情页：

- **分时走势**：当日价格曲线 + 黄色均价线（VWAP），含昨收基准线与时间轴
- **K 线**：日 / 周 / 月切换，前复权，含成交量柱与 MA5 / MA10 / MA20
- **十字光标**：悬停查看分时的时间与价格，或单根 K 线的开收高低
- **五档盘口**：卖五至卖一、买一至买五，价格按昨收着色
- **关键指标**：今开、昨收、最高、最低、成交量、成交额、振幅、换手率、市盈率 TTM、市净率、总市值、流通市值、涨停价、跌停价
- **键盘**：`Esc` 返回列表，`↑` / `↓` 在当前分组内切换个股
- 详情页独立轮询，返回列表自动恢复分组视图

### 大盘指数

主界面顶部常驻指数条，随主轮询同步刷新：上证指数、深证成指、创业板指、恒生指数。

### 行业分类

行业与自选分组共用同一套树（`kind` 区分），支持任意多级（科技 → 半导体 → 设备），把股票拖到行业节点即完成归类，一只股票可属于多个行业。

### 托盘常驻

- 关闭 / 最小化 → 收进托盘，进程继续运行
- **左键单击托盘图标** → 打开主界面
- **右键单击托盘图标** → 弹出行情菜单：当前分组标的（名称 + 涨跌幅）→ 分隔线 → 更新时间 → **退出程序**
- 点击菜单以外区域自动收起

> 若右键无反应，说明图标还在 Win11 的「隐藏的图标」溢出区——那里的右键会被系统菜单接管。到「设置 → 个性化 → 任务栏 → 系统托盘图标」把 wangstock 打开即可。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 / 原生能力 | Tauri 2（Rust） |
| 前端 | 原生 HTML + CSS + JavaScript（无框架、无打包步骤） |
| 网络 | `ureq` + `rustls` |
| 存储 | 本地 JSON（原子写入） |
| 渲染 | 系统 WebView2 |

选 Tauri 而不是 Electron 的原因很直接——Electron 自带整个 Chromium，安装后通常 150–250 MB，空载常驻 150 MB 以上；Tauri 复用系统 WebView2，只打包业务代码。

实测（Windows 11 26100 / 100% 缩放）：

| 指标 | 实测值 |
|---|---|
| 可执行文件 | **4.6 MB** 单文件 |
| 主进程常驻内存 | **约 44 MB** |
| 冷启动到界面可见 | **约 0.6 秒** |
| 前台轮询 CPU | < 1% |

前端不用 React/Vite 是刻意的：界面只有一张表、一棵树和一个详情页，原生 DOM 足够，省掉 200 MB `node_modules` 和整条构建链。存储不用 SQLite 也是：自选规模几百条，JSON 够用且能一键备份。

---

## 快速开始

### 下载

到 [Releases](https://github.com/LiangLiang723/wangstock/releases) 下载：

- `wangstock_*_x64-setup.exe` — 安装版
- `wangstock.exe` — 绿色版，双击即用

依赖系统 WebView2：Windows 11 自带，Windows 10 若缺失安装包会引导安装。

### 从源码构建

需要 [Rust](https://rustup.rs)（1.77+）、Node 20+ 与 MSVC 生成工具。

```bat
npm install
npm run build
```

产物：`src-tauri/target/release/wangstock.exe`（`build.bat` 会自动复制到根目录）。

首次编译约 5–8 分钟，之后增量 1–2 分钟。

### 开发

```bat
npm run dev
```

或直接 `run.bat` 运行已构建版本。

---

## 发布流程

```bash
git tag v1.1.0
git push origin v1.1.0
```

推送 tag 后 GitHub Actions 自动：

1. 在 `windows-latest` 上安装 Node / Rust 并缓存依赖
2. `tauri build` 生成 NSIS 安装包与裸 exe
3. 创建对应 tag 的 Release，附上安装包与绿色版
4. `.github/release.yml` 按标签自动归类变更

版本号需同步三处：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，并更新 `CHANGELOG.md`。

---

## 数据来源与限制

| 用途 | 接口 |
|---|---|
| 行情主源 | `qt.gtimg.cn`（A 股 + 港股，GBK，批量 60 只） |
| 行情备源 | `hq.sinajs.cn`（需 Referer） |
| 分时 / K 线 / 详情 | `web.ifzq.gtimg.cn` |
| 代码联想 | `smartbox.gtimg.cn` |

均为公开接口，无需申请 Key。

限制：

- 非官方开放平台接口，字段与可用性可能变化；已做字段容错，单条异常只跳过该条
- 港股为延迟行情，界面明确标注「延迟」而非伪装实时
- 默认 3 秒一次批量请求，远低于触发限流的量级
- 数据仅供个人参考，**不构成投资建议**

### 异常处理

| 场景 | 处理 |
|---|---|
| 主源超时 / 报错 | 自动切备用源 |
| 两源都失败 | 回落上次成功数据并标记「缓存」，绝不静默展示旧价 |
| 单条异常 | 跳过该条，其余正常渲染 |
| 响应体过大 | 截断 4 MB |
| 请求超时 | 6 秒 |
| 非交易时段 | 停止轮询，保留收盘快照 |
| 本地数据损坏 | 备份为 `data.bak` 并重建默认数据 |

---

## 目录结构

```
wangstock/
├─ src/                        前端（直接打包，无构建步骤）
│  ├─ index.html               主窗口与详情页
│  ├─ flyout.html              托盘右键菜单
│  └─ assets/
│     ├─ app.css / app.js
│     └─ flyout.css / flyout.js
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs               命令注册、窗口生命周期、业务操作
│  │  ├─ model.rs              数据模型与默认自选
│  │  ├─ store.rs              持久化（原子写 + 损坏回退）
│  │  ├─ quote.rs              行情抓取、GBK 解码、双源降级、分时与详情
│  │  └─ tray.rs               托盘、菜单定位、圆角
│  ├─ icons/
│  ├─ capabilities/default.json 权限白名单
│  └─ tauri.conf.json
├─ .github/
│  ├─ workflows/release.yml    tag 触发构建与发布
│  ├─ workflows/ci.yml         push / PR 编译检查
│  └─ release.yml              Release 变更分类
├─ package.json
├─ build.bat / run.bat
├─ CHANGELOG.md
└─ README.md
```

数据文件：`%APPDATA%\com.wangstock.desktop\data.json`

---

## 默认自选

首次启动预置 7 个标的，便于立刻看到效果，全部可删：

- 游戏传媒：世纪华通、游戏ETF
- 核心持仓：贵州茅台、宁德时代、腾讯控股
- 宽基 ETF：沪深300ETF、创业板ETF
