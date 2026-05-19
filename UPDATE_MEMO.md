# Signal Deck 接力备忘

这份备忘用于从当前可运行基线继续开发或验收。

## 工作目录

- 当前唯一工作目录：`F:\webProject\5M`
- 不再修改：`D:\文档\New project 2`

## 当前产品状态

- 主策略：`liu_core_v2`
- 前台策略选择已收敛为：
  - `none`
  - `liu_core_v2`
  - `liu_stock_pick_v1`
- 勾选标的的 WebHook 监控由服务端 worker 常驻执行，不依赖前端页面保持打开。
- 首次勾选某个标的时，如果当前已经命中规则，会立即补发一次 WebHook。
- 顶部健康状态条、规则命中抽屉、雪球 Cookie 独立弹窗都已经接好。
- 规则命中抽屉行为：
  - 打开时加载一次
  - 打开期间不重复整组重载
  - 关闭后再次打开才重新加载

## 数据源状态

- `auto` 当前主要依赖：
  - `tencent`
  - `xueqiu`
- `eastmoney` 仍不稳定，不建议作为主源。
- 雪球已经支持 Cookie 录入、保存与校验。
- 雪球 Cookie 入口是独立弹窗，不再和 WebHook 弹窗混在一起。

## 打包与分发状态

这一轮已经完成“给其他电脑使用”的打包收口：

- 已清理开发机硬编码路径：
  - `run_local_server.py`
  - `build_windows.ps1`
  - `launch_signal_deck.cmd`
  - `start_signal_deck.cmd`
- `SignalDeck.spec` 已补齐关键 DLL 打包逻辑。
- 启动前搜索预热已改为后台异步，避免 EXE 启动卡住。
- 打包说明已整理到 `PACKAGING.md`。
- 当前打包产物：
  - `artifacts/SignalDeck-windows.zip`
  - `dist/SignalDeck/SignalDeck.exe`
- 已在打包后的 `SignalDeck.exe --server` 模式下做过健康检查，`/api/health` 返回 `ok`。

## 本地基线核验

以下检查已通过：

```powershell
python -m py_compile app.py strategy_engine.py market_signal_tool.py desktop_launcher.py run_local_server.py
node --check static\app.js
```

当前本地服务 `http://127.0.0.1:8000` 可用，并已确认：

- `/api/health` 返回 `200`
- `/api/alert-runtime` 返回 `200`
- `/api/xueqiu-cookie` 返回 `200`

## 下一轮更新前先看

1. 只在 `F:\webProject\5M` 工作。
2. 先看 `git status`，避免把旧改动和新改动混在一起。
3. 先检查本地 Signal Deck 服务是否已在运行，再决定是否需要重启。
4. 如果会改 `static/app.js`、`static/styles.css`、`templates/index.html`，记得同步更新 `templates/index.html` 里的静态资源版本号。
5. 如果会改策略逻辑，先判断改动应该落在：
   - `strategy_presets.json`
   - `strategy_engine.py`
   - `app.py`
6. 如果会改周期或 K 线聚合，必须同时验证：
   - 策略取数路径
   - 图表取数路径

## 需要保持的行为

- `120m` 仍然必须由 `60m` 聚合。
- `1q` 仍然必须由 `1M` 聚合。
- `1d`、`1w` 继续优先走 `auto`，并保持 `qfq` 下 Tencent 回退可用。
- 启动器应优先复用已健康的本地服务，避免重复拉起第二个实例。
- alert worker 继续保持服务端常驻，不要退回前端轮询驱动。
- 规则配置仍应可从规则弹窗编辑。

## 快速烟测

如果改了服务端或数据源，建议从 `F:\webProject\5M` 运行：

```powershell
@'
import requests
base = "http://127.0.0.1:8000"
checks = [
    f"{base}/api/health",
    f"{base}/api/chart?symbol=sh000001&timeframe=120m&bars=120&source=auto",
    f"{base}/api/chart?symbol=sh000001&timeframe=1q&bars=120&source=auto",
    f"{base}/api/strategy-signal?symbol=sh000001&strategy=liu_core_v2&source=auto",
    f"{base}/api/alert-runtime",
    f"{base}/api/xueqiu-cookie",
]
for url in checks:
    r = requests.get(url, timeout=30)
    print(r.status_code, url)
'@ | python -
```

## 建议的下一步

- 拿 `artifacts/SignalDeck-windows.zip` 到另一台干净 Windows 电脑做一次真实验收。
- 在目标电脑重新配置：
  - WebHook 地址
  - 雪球 Cookie
- 如果继续优化，优先考虑：
  - 左侧未勾选标的的懒更新
  - 前端大文件拆分
  - 更稳定的新数据源
