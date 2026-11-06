# wangstock

轻量自选行情桌面端 · Windows x64 · 单文件约 4.6 MB

[![Release](https://github.com/LiangLiang723/wangstock/actions/workflows/release.yml/badge.svg)](https://github.com/LiangLiang723/wangstock/actions/workflows/release.yml)
[![CI](https://github.com/LiangLiang723/wangstock/actions/workflows/ci.yml/badge.svg)](https://github.com/LiangLiang723/wangstock/actions/workflows/ci.yml)
![platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)

A 股 / 港股 / ETF 自选管理、实时行情、分时与 K 线、五档盘口、系统托盘常驻。

---

## 设计原则

重构时按主流行情软件的共性重新组织信息，而不是继续往原有页面上叠加功能：

1. **列表是扫描雷达**：价格、涨跌、走势缩略图优先；操作常驻但低对比，hover 才强化，不抢占阅读视线。
2. **详情是聚焦视图**：价格 → 图表 → 指标 → 盘口，按人看一只票的扫视顺序排列。
3. **状态始终可见**：连接状态、数据源、更新时间、缓存标记、是否已自选、加载骨架，都在界面上明确表达。
4. **高频操作零层级**：搜索添加、排序、返回、周期切换、缩放复位都有可见入口；右键菜单是补充而非唯一路径。
5. **宽屏利用空间**：列表与详情可并排，窄窗口自动回到单栏覆盖。

## 界面结构

```
┌ 标题栏：品牌 · 数据时间 · 窗口控制
├ 左侧导航          主工作区
│  工作台           ┌ 面包屑 + 搜索 / 添加 / 视图 / 并排
│  全部自选         ├ 大盘指数条（常驻）
│  自选分组树       ├ 列表视图  或  详情视图  或  两者并排
│  行业分类树       └ 表格 / 图表 / 指标 / 盘口
│  暂停 · 设置
└ 状态栏：连接 · 数据源 · 更新时间 · 刷新间隔 · 标的数
```

## 功能模块

### 导航（左侧）

| 操作 | 方式 |
|---|---|
| 切换视图 | 点击「全部自选」或任意分组 / 行业节点 |
| 新建分组 | 分区标题右侧 `＋`，或分组 hover 的 `＋`（建子分组） |
| 重命名 | 双击分组名，或 `⋯` 菜单 |
| 折叠 / 展开 | 点击节点前的箭头 |
| 排序 / 标记颜色 / 删除 | 节点 `⋯` 菜单或右键 |
| 把标的移入分组 | 从列表直接拖到左侧节点 |

### 自选列表

- 列：名称 / 代码 / 市场、走势缩略图、最新价、涨跌额、涨跌幅、日内区间、成交额、状态、操作
- **排序**：直接拖动行（自定义鼠标手势，不依赖系统拖放）；行内 `↑` `↓`；右键菜单；点击表头按列排序，第三击回到自定义顺序
- **行内操作**：`↑`、`↓`、`⋯`（详情、管理分组、移动分组、移除、删除自选）
- **多选分组**：一个标的可以同时属于多个分组；添加时在命令面板底部勾选，已有标的通过「管理分组…」随时调整
- 单击行进入详情；首次加载显示骨架；行情失败给出可点击的重试
- 「视图」菜单：排序方式、显示 / 隐藏日内区间与成交额
- 「◫」按钮：宽屏下列表与详情并排展示

### 个股详情

- 面包屑返回 + `← 返回列表` + `↑ 上一只` / `↓ 下一只`，`Esc` 返回
- 大号价格、涨跌额、涨跌幅，状态徽标（实时 / 延迟 / 收盘 / 缓存）
- 图表：分时（价格线 + 均价线 + 昨收基准）、日 K / 周 K / 月 K（前复权、成交量、MA5/10/20）
- 图表交互：滚轮以光标为锚点缩放、拖拽平移、双击复位，工具条上另有 `−` `＋` `⟲` 可见按钮；十字光标显示分时读数或单根 K 线开收高低
- 指标 14 项：今开、昨收、最高、最低、成交量、成交额、振幅、换手率、市盈率 TTM、市净率、总市值、流通市值、涨停价、跌停价
- 五档盘口：卖五→卖一、买一→买五

### 命令与设置

| 入口 | 内容 |
|---|---|
| `Ctrl K` / 搜索框 / ＋添加 | 命令面板：代码、名称、拼音首字母搜索；结果带类型标签与「已添加」标记；底部可勾选多个目标分组；支持直接输入 6 位 A 股 / 5 位港股代码回车添加 |
| 行 `⋯` → 管理分组… | 勾选/取消该标的所属分组，可多选；取消全部即从自选中移除 |
| 设置（左下 ⚙） | 分区组织：行情刷新、显示、托盘菜单、关于 |
| 右键菜单 | 列表行 / 分组节点的补充操作 |
| 状态栏 | 连接状态灯、异常时「立即重试」、数据与刷新信息 |
| 托盘图标 | 左键打开主界面，右键弹出行情菜单（名称 + 涨跌幅、更新时间、退出程序） |

### 快捷键

| 键 | 作用 |
|---|---|
| `Ctrl K` | 打开搜索 / 添加 |
| `Esc` | 关闭弹层 → 返回列表 |
| `↑` `↓` | 详情视图中切换个股 / 命令面板中移动选中项 |
| `Enter` | 添加选中结果，或直接添加输入的代码 |
| 表头点击 | 按该列排序，第三次点击恢复自定义顺序 |

---

## 技术栈

| 层 | 选型 |
|---|---|
| 外壳 / 原生能力 | Tauri 2（Rust） |
| 前端 | 原生 ES Modules + CSS，无框架、无打包步骤 |
| 网络 | `ureq` + `rustls`，共享连接池 |
| 存储 | 本地 JSON（原子写入，损坏自动备份重建） |
| 渲染 | 系统 WebView2 |

选 Tauri 而不是 Electron：复用系统 WebView2，只打包业务代码，产物 4.6 MB、常驻约 44 MB。前端不用 React/Vite 是刻意取舍——界面是一张表、一棵树和一个详情视图，原生 DOM 足够，省掉整个构建链。

### 目录结构

```
src/
├─ index.html                 外框：标题栏 / 导航 / 工作区 / 状态栏
├─ assets/
│  ├─ core.css                设计令牌与基础组件
│  ├─ layout.css              外框布局、列表 / 详情的两种组织方式
│  ├─ views.css               指数条、行情表、详情与图表
│  ├─ flyout.css / flyout.js  托盘右键菜单（独立窗口）
│  └─ js/
│     ├─ core.js              状态、命令通道、toast / 弹窗 / 菜单原语
│     ├─ format.js            数据选择、格式化、SVG 图表（纯函数）
│     ├─ shell.js             标题栏、面包屑、指数条、状态栏、快捷键
│     ├─ sidebar.js           导航树与分组操作
│     ├─ watchlist.js         行情表、排序、行内操作、自定义拖拽
│     ├─ detail.js            详情页与图表交互
│     ├─ palette.js           搜索面板、视图菜单、设置
│     └─ main.js              启动、轮询、动作编排
├─ flyout.html
└─ src-tauri/
   ├─ src/  main.rs（命令）· model.rs（模型）· store.rs（持久化）
   │        quote.rs（行情/分时/K线）· tray.rs（托盘）
   ├─ capabilities/default.json
   └─ tauri.conf.json
```

**分层约定**：`core.js` 是单一状态源与命令通道；视图模块只依赖 `core` 与 `format`，彼此不互相 import，需要联动时通过 `actions` 注册表由 `main.js` 编排。`format.js` 全部是纯函数，便于单独复用或测试。

数据文件：`%APPDATA%\com.wangstock.desktop\data.json`

### 离屏自检

`tools/offscreen-shot.py` 可在完全不弹窗、不抢焦点的情况下检查界面渲染：以隐藏方式启动，把窗口移出可视区域后保持「可见但不激活」以维持 WebView2 绘制，再用 `PrintWindow` 取图。

```bat
python tools\offscreen-shot.py shot.png 12 --detail=sh000001
python tools\offscreen-shot.py shot.png 10 --palette
python tools\offscreen-shot.py shot.png 10 --groups=sz002602
```

`--detail` 直接打开个股详情，`--palette` 打开搜索添加面板，`--groups` 打开指定标的的管理分组弹窗。

---

## 快速开始

### 下载

[Releases](https://github.com/LiangLiang723/wangstock/releases) 提供 `wangstock.exe`（绿色版）与 `wangstock_*_x64-setup.exe`（安装版）。依赖系统 WebView2：Windows 11 自带，Windows 10 若缺失安装包会引导安装。

### 从源码构建

需要 [Rust](https://rustup.rs) 1.77+、Node 20+ 与 MSVC 生成工具。

```bat
npm install
npm run build
```

产物：`src-tauri/target/release/wangstock.exe`（`build.bat` 会自动复制到根目录）。首次编译约 5–8 分钟。

### 发布

```bash
git tag v2.1.0
git push origin v2.1.0
```

推送 tag 后 GitHub Actions 在 `windows-latest` 上构建 NSIS 安装包与裸 exe，创建 Release 并按标签归类变更。版本号需同步 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`，并更新 `CHANGELOG.md`。

---

## 数据来源与限制

| 用途 | 接口 |
|---|---|
| 行情主源 | `qt.gtimg.cn`（A 股 + 港股，GBK，批量 60 只） |
| 行情备源 | `hq.sinajs.cn` |
| 分时 / K 线 / 详情 | `web.ifzq.gtimg.cn` |
| 代码联想 | `smartbox.gtimg.cn` |

均为公开接口，无需申请 Key。

| 场景 | 处理 |
|---|---|
| 主源超时 / 报错 | 自动切备用源 |
| 两源都失败 | 回落上次成功数据并标记「缓存」，绝不静默展示旧价 |
| 单条异常 | 跳过该条 |
| 响应体过大 | 截断 4 MB |
| 请求超时 | 行情 4 秒、K 线 6 秒，前端 IPC 另有超时兜底 |
| 非交易时段 | 停止轮询，保留收盘快照 |
| 本地数据损坏 | 备份为 `data.bak` 并重建默认数据 |

限制：非官方开放平台接口，字段与可用性可能变化；港股为延迟行情，界面明确标注「延迟」；指数没有有效均价与五档盘口，界面会明确说明而不是画出误导性曲线；数据仅供参考，**不构成投资建议**。

## 默认自选

首次启动预置 7 个标的，便于立刻看到效果，全部可删：游戏传媒（世纪华通、游戏ETF）、核心持仓（贵州茅台、宁德时代、腾讯控股）、宽基 ETF（沪深300ETF、创业板ETF）。
