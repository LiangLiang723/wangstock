# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.0] - 2026-10-29

首个可发布版本。

### 新增

- 自选股与 ETF 管理：新建 / 重命名 / 删除分组，拖拽排序与跨组移动
- A 股与港股行情：最新价、涨跌额、涨跌幅、日内区间、成交额、数据新鲜度徽标
- 自定义行业分类树，支持多级嵌套与股票归类
- 个股详情页：分时走势图、五档盘口、开高低收、成交量额、振幅、换手率、市盈率、市净率、总市值与流通市值、涨跌停价
- 托盘常驻：左键唤出主界面，右键弹出行情菜单（行情列表 + 更新时间 + 退出程序）
- 双数据源自动降级（腾讯为主、新浪为备），失败时回落缓存并标记「缓存」

### 说明

- 行情数据来自公开接口，仅供个人参考，不构成投资建议
- 港股为延迟行情

[Unreleased]: https://github.com/LiangLiang723/wangstock/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/LiangLiang723/wangstock/releases/tag/v1.0.0
