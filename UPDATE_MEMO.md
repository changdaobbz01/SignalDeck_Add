# Signal Deck Update Memo

This memo is the quick checklist for the next update cycle.

## Workspace

- Active workspace: `F:\webProject\5M`
- Do not modify: `D:\文档\New project 2`
- Local desktop launcher entry:
  - Project script: `F:\webProject\5M\launch_signal_deck.cmd`
  - Desktop shortcut: `C:\Users\admin\Desktop\Signal Deck 启动器.lnk`

## Before The Next Update

1. Confirm the worktree is clean enough to identify new changes clearly.
2. Start from `F:\webProject\5M` only.
3. Check whether a local Signal Deck service is already running.
4. If `static/app.js`, `static/styles.css`, or `templates/index.html` will change, plan to bump the static asset version in `templates/index.html`.
5. If strategy logic will change, decide first whether it belongs in:
   - `strategy_presets.json`
   - `strategy_engine.py`
   - `app.py`
6. If chart timeframes will change, verify both:
   - strategy fetch path
   - chart fetch path

## Current Architecture Notes

- Strategy engine:
  - `strategy_engine.py`
  - `strategy_presets.json`
- Web app and background worker:
  - `app.py`
- Market source adapters:
  - `market_signal_tool.py`
- Desktop launcher:
  - `desktop_launcher.py`
- Frontend:
  - `templates/index.html`
  - `static/app.js`
  - `static/styles.css`

## Important Behavior To Preserve

- `120m` chart data must be aggregated from `60m`.
- `1q` chart data must be aggregated from `1M`.
- `1d` and `1w` should prefer `auto`, with Tencent fallback working under `qfq`.
- The launcher should reuse an existing healthy local Signal Deck service instead of starting a duplicate one.
- The alert worker should stay server-side, not front-end driven.
- Strategy config should remain editable from the rules modal.

## Quick Smoke Tests

Run these from `F:\webProject\5M`.

```powershell
python -m py_compile app.py strategy_engine.py market_signal_tool.py desktop_launcher.py run_local_server.py
node --check static\app.js
```

```powershell
@'
import requests
base = "http://127.0.0.1:8000"
checks = [
    f"{base}/api/health",
    f"{base}/api/chart?symbol=sh000001&timeframe=120m&bars=120&source=auto",
    f"{base}/api/chart?symbol=sh000001&timeframe=1q&bars=120&source=auto",
    f"{base}/api/strategy-signal?symbol=sh000001&strategy=liu_core_v1&source=auto",
    f"{base}/api/alert-runtime",
]
for url in checks:
    r = requests.get(url, timeout=30)
    print(r.status_code, url)
'@ | python -
```

## Rules And Strategy Checks

- Verify `liu_core_v1` still includes:
  - weekly trend
  - daily wave
  - 60m entry
  - 120m confirmation
- Verify divergence coverage is still present for:
  - weekly bottom/top divergence
  - daily bottom/top divergence
  - 60m bottom/top divergence
  - 120m bottom/top divergence
- Verify `liu_stock_pick_v1` degrades gracefully to `HOLD` when quarterly data is insufficient.

## WebHook / Worker Checks

- Confirm `/api/alert-runtime` returns:
  - `worker.running`
  - `worker.last_run_at`
  - `worker.last_success_at`
  - `worker.last_sent_at`
- If the worker stops, inspect:
  - `%APPDATA%\SignalDeck\alert_runtime.json`
  - `launcher-error.log`

## Known Technical Debt

- `static/app.js` still contains repeated function definitions from older iterations.
- The app runs correctly, but large front-end changes should be done carefully and verified after each edit.
- Rule evaluation still uses `eval` in a constrained context. Keep strategy sources trusted.

## Recommended Update Order

1. Read this memo.
2. Check local service and health.
3. Pull or inspect the current repo state.
4. Make the smallest backend change first.
5. Then update frontend bindings and version stamp.
6. Run smoke tests.
7. Verify the launcher path and duplicate-service behavior if launcher files changed.
8. Only then stage, commit, and push.
