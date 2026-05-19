# Signal Deck Packaging Notes

This project can be distributed to other Windows computers as a packaged desktop app.

## Recommended distribution format

- Build with `PyInstaller`
- Distribute the generated `dist/SignalDeck` folder as a zip package
- End users should run `SignalDeck.exe`

## Build steps on Windows

From the project root:

```powershell
./build_windows.ps1
```

The script will:

- create a local `.venv-package` virtual environment when needed
- install dependencies from `requirements.txt`
- build the packaged app with `SignalDeck.spec`
- generate `artifacts/SignalDeck-windows.zip`

## What the packaged app stores on the target computer

Runtime data is stored outside the install folder.

On Windows, the default runtime directory is:

```text
%APPDATA%\SignalDeck
```

Important runtime files include:

- `alert_runtime.json`
- `strategy_overrides.json`
- `xueqiu_cookies.json`
- `config.example.json`

This means users can replace the app folder without losing their runtime configuration.

## First-run checklist on another computer

1. Start `SignalDeck.exe`
2. Open the app in the browser
3. Configure the webhook target if needed
4. Paste and validate the Xueqiu cookie if Xueqiu data is required
5. Confirm that `/api/health` is normal and the selected data source is healthy

## Notes

- The packaged app does not require the original source directory path.
- The packaged app should not depend on `E:\anaconda` or any machine-specific Python path.
- For source-based usage, `launch_signal_deck.cmd` and `start_signal_deck.cmd` now prefer:
  - repo-local `.venv-package`
  - system `pythonw`
  - system `python`
