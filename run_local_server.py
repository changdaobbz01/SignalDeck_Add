#!/usr/bin/env python3
from __future__ import annotations

import sys

from waitress import serve


PROJECT_ROOT = r"F:\webProject\5M"
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import app  # noqa: E402


if __name__ == "__main__":
    serve(app, listen="127.0.0.1:8000", threads=8)
