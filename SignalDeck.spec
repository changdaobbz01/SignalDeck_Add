# -*- mode: python ; coding: utf-8 -*-
import sys


block_cipher = None

datas = [
    ("templates", "templates"),
    ("static", "static"),
    ("config.example.json", "."),
    ("custom_strategies.json", "."),
    ("strategy_presets.json", "."),
]

a = Analysis(
    ["desktop_launcher.py"],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="SignalDeck",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="SignalDeck",
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name="SignalDeck.app",
        icon=None,
        bundle_identifier="com.signaldeck.desktop",
    )
