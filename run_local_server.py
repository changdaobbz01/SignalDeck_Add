#!/usr/bin/env python3
from __future__ import annotations

import os
import sys

from waitress import serve


PROJECT_ROOT = os.path.abspath(os.path.dirname(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from app import app  # noqa: E402


if __name__ == "__main__":
    host = os.getenv("APP_HOST", "127.0.0.1")
    port = int(os.getenv("APP_PORT", "8000"))
    threads = int(os.getenv("APP_THREADS", "8"))
    serve(app, host=host, port=port, threads=threads)
