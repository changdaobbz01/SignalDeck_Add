# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path
import sys


block_cipher = None


def collect_runtime_binaries():
    binaries = []
    search_roots = [
        Path(sys.base_prefix) / "Library" / "bin",
        Path(sys.base_prefix) / "DLLs",
    ]
    required_names = [
        "libssl-3-x64.dll",
        "libcrypto-3-x64.dll",
        "liblzma.dll",
        "libbz2.dll",
        "ffi.dll",
        "tcl86t.dll",
        "tk86t.dll",
    ]
    seen = set()
    for root in search_roots:
        if not root.exists():
            continue
        for name in required_names:
            for candidate in root.glob(name):
                normalized = candidate.resolve()
                if normalized in seen:
                    continue
                seen.add(normalized)
                binaries.append((str(normalized), "."))
    return binaries

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
    binaries=collect_runtime_binaries(),
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
