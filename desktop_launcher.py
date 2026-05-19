#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import traceback
import tkinter as tk
import webbrowser
from tkinter import messagebox, ttk
from urllib.error import URLError
from urllib.request import urlopen


APP_NAME = "Signal Deck"
APP_RUNTIME_ID = "SignalDeck"
HOST = "127.0.0.1"
DEFAULT_PORT = 8000
HEALTH_ENDPOINT = "/api/health"
STARTUP_TIMEOUT_SECONDS = 25.0
HEALTH_PROBE_TIMEOUT_SECONDS = 1.5
PORT_SCAN_LIMIT = 20


def build_server_command(port: int, host: str = HOST) -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable, "--server", f"--host={host}", f"--port={port}"]
    return [sys.executable, os.path.abspath(__file__), "--server", f"--host={host}", f"--port={port}"]


def working_directory() -> str:
    if getattr(sys, "frozen", False):
        return os.path.abspath(os.path.dirname(sys.executable))
    return os.path.abspath(os.path.dirname(__file__))


def server_env(port: int) -> dict[str, str]:
    env = os.environ.copy()
    env["APP_HOST"] = HOST
    env["APP_PORT"] = str(port)
    return env


def parse_server_runtime() -> tuple[str, int]:
    host = HOST
    port = int(os.getenv("APP_PORT", str(DEFAULT_PORT)))
    for arg in sys.argv[1:]:
        if arg.startswith("--host="):
            host = arg.split("=", 1)[1].strip() or host
        elif arg.startswith("--port="):
            value = arg.split("=", 1)[1].strip()
            if value:
                port = int(value)
    return host, port


def write_launcher_log(message: str) -> None:
    log_path = os.path.join(working_directory(), "launcher-error.log")
    with open(log_path, "a", encoding="utf-8") as file:
        file.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {message}\n")


def is_port_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.25)
        return sock.connect_ex((HOST, port)) == 0


def find_available_port(start_port: int = DEFAULT_PORT) -> int:
    for port in range(start_port, start_port + PORT_SCAN_LIMIT):
        if not is_port_open(port):
            return port
    raise RuntimeError(f"Unable to find an available port in {start_port}-{start_port + PORT_SCAN_LIMIT - 1}")


def wait_for_health(base_url: str, timeout_seconds: float = STARTUP_TIMEOUT_SECONDS) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            payload = fetch_health_once(base_url, timeout_seconds=HEALTH_PROBE_TIMEOUT_SECONDS)
            if payload:
                return payload
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(0.4)
    if last_error:
        raise RuntimeError(f"Server did not become ready: {last_error}") from last_error
    raise RuntimeError("Server did not become ready in time")


def fetch_health_once(base_url: str, timeout_seconds: float = HEALTH_PROBE_TIMEOUT_SECONDS) -> dict[str, object] | None:
    url = f"{base_url}{HEALTH_ENDPOINT}"
    with urlopen(url, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
        if response.status != 200 or payload.get("status") != "ok":
            return None
        runtime_id = str(payload.get("app") or "").strip()
        if runtime_id and runtime_id != APP_RUNTIME_ID:
            return None
        return payload


def find_running_service(start_port: int = DEFAULT_PORT) -> tuple[str, int] | None:
    for port in range(start_port, start_port + PORT_SCAN_LIMIT):
        if not is_port_open(port):
            continue
        base_url = f"http://{HOST}:{port}"
        try:
            payload = fetch_health_once(base_url)
        except Exception:  # noqa: BLE001
            payload = None
        if payload:
            return base_url, port
    return None


def run_server_process() -> None:
    try:
        from app import DEFAULT_HOST, DEFAULT_PORT, app, warm_search_cache

        base_url = f"http://{DEFAULT_HOST}:{DEFAULT_PORT}"
        try:
            existing = fetch_health_once(base_url, timeout_seconds=HEALTH_PROBE_TIMEOUT_SECONDS)
        except Exception:  # noqa: BLE001
            existing = None
        if existing:
            write_launcher_log(f"Server launch skipped because an existing {APP_RUNTIME_ID} service is already running at {base_url}")
            return

        threading.Thread(target=warm_search_cache, name="signaldeck-search-warm", daemon=True).start()
        try:
            from waitress import serve
        except ImportError:
            app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, debug=False)
        else:
            serve(app, host=DEFAULT_HOST, port=DEFAULT_PORT, threads=8)
    except Exception:  # noqa: BLE001
        write_launcher_log(traceback.format_exc())
        raise


class SignalDeckLauncher:
    def __init__(self) -> None:
        self.root = tk.Tk()
        self.root.title(APP_NAME)
        self.root.geometry("420x180")
        self.root.resizable(False, False)
        self.root.protocol("WM_DELETE_WINDOW", self.handle_close)

        self.status_var = tk.StringVar(value="Preparing local workspace...")
        self.url_var = tk.StringVar(value="--")
        self.port_var = tk.StringVar(value="--")
        self.server_process: subprocess.Popen[str] | None = None
        self.server_ready = False
        self.browser_opened = False
        self.base_url = ""

        self.build_ui()
        self.root.after(120, self.start_server)

    def build_ui(self) -> None:
        self.root.configure(bg="#0b1320")
        frame = ttk.Frame(self.root, padding=16)
        frame.pack(fill="both", expand=True)

        style = ttk.Style()
        style.theme_use("clam")
        style.configure("Launcher.TFrame", background="#0b1320")
        style.configure("Launcher.TLabel", background="#0b1320", foreground="#e7eef8", font=("Segoe UI", 10))
        style.configure("Launcher.Title.TLabel", background="#0b1320", foreground="#f7fbff", font=("Segoe UI", 16, "bold"))
        style.configure("Launcher.Sub.TLabel", background="#0b1320", foreground="#8ea4bf", font=("Segoe UI", 9))
        style.configure("Launcher.TButton", font=("Segoe UI", 10))
        frame.configure(style="Launcher.TFrame")

        ttk.Label(frame, text=APP_NAME, style="Launcher.Title.TLabel").pack(anchor="w")
        ttk.Label(
            frame,
            text="Local desktop launcher for the Flask + Waitress workspace",
            style="Launcher.Sub.TLabel",
        ).pack(anchor="w", pady=(4, 14))

        info = ttk.Frame(frame, style="Launcher.TFrame")
        info.pack(fill="x")
        ttk.Label(info, text="Status", width=8, style="Launcher.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(info, textvariable=self.status_var, style="Launcher.TLabel").grid(row=0, column=1, sticky="w")
        ttk.Label(info, text="URL", width=8, style="Launcher.TLabel").grid(row=1, column=0, sticky="w", pady=(8, 0))
        ttk.Label(info, textvariable=self.url_var, style="Launcher.TLabel").grid(row=1, column=1, sticky="w", pady=(8, 0))
        ttk.Label(info, text="Port", width=8, style="Launcher.TLabel").grid(row=2, column=0, sticky="w", pady=(8, 0))
        ttk.Label(info, textvariable=self.port_var, style="Launcher.TLabel").grid(row=2, column=1, sticky="w", pady=(8, 0))

        button_row = ttk.Frame(frame, style="Launcher.TFrame")
        button_row.pack(fill="x", pady=(18, 0))
        self.open_button = ttk.Button(button_row, text="Open", command=self.open_browser, state="disabled", style="Launcher.TButton")
        self.open_button.pack(side="left")
        ttk.Button(button_row, text="Copy URL", command=self.copy_url, style="Launcher.TButton").pack(side="left", padx=(8, 0))
        ttk.Button(button_row, text="Exit", command=self.handle_close, style="Launcher.TButton").pack(side="right")

    def start_server(self) -> None:
        existing_service = find_running_service(int(os.getenv("APP_PORT", str(DEFAULT_PORT))))
        if existing_service:
            self.base_url, port = existing_service
            self.url_var.set(self.base_url)
            self.port_var.set(str(port))
            self.status_var.set("Connected to existing local service")
            self.server_ready = True
            self.open_button.configure(state="normal")
            self.open_browser()
            return

        try:
            port = find_available_port(int(os.getenv("APP_PORT", str(DEFAULT_PORT))))
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror(APP_NAME, str(exc))
            self.root.destroy()
            return

        self.base_url = f"http://{HOST}:{port}"
        self.url_var.set(self.base_url)
        self.port_var.set(str(port))
        self.status_var.set("Starting local service...")

        try:
            self.server_process = subprocess.Popen(
                build_server_command(port),
                cwd=working_directory(),
                env=server_env(port),
            )
        except Exception as exc:  # noqa: BLE001
            messagebox.showerror(APP_NAME, f"Failed to start local service:\n{exc}")
            self.root.destroy()
            return

        threading.Thread(target=self.await_server_ready, daemon=True).start()

    def await_server_ready(self) -> None:
        try:
            wait_for_health(self.base_url)
        except Exception as exc:  # noqa: BLE001
            self.root.after(0, lambda: self.handle_start_failure(exc))
            return
        self.root.after(0, self.mark_ready)

    def handle_start_failure(self, error: Exception) -> None:
        self.status_var.set("Startup failed")
        self.stop_server()
        messagebox.showerror(APP_NAME, str(error))
        self.root.destroy()

    def mark_ready(self) -> None:
        self.server_ready = True
        self.status_var.set("Ready")
        self.open_button.configure(state="normal")
        self.open_browser()

    def open_browser(self) -> None:
        if not self.base_url:
            return
        webbrowser.open(self.base_url)
        if not self.browser_opened:
            self.browser_opened = True
            self.status_var.set("Opened in your browser")

    def copy_url(self) -> None:
        if not self.base_url:
            return
        self.root.clipboard_clear()
        self.root.clipboard_append(self.base_url)
        self.status_var.set("URL copied")

    def stop_server(self) -> None:
        if not self.server_process:
            return
        if self.server_process.poll() is None:
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=4)
            except subprocess.TimeoutExpired:
                self.server_process.kill()
        self.server_process = None

    def handle_close(self) -> None:
        self.stop_server()
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()


def main() -> None:
    if "--server" in sys.argv:
        host, port = parse_server_runtime()
        os.environ["APP_HOST"] = host
        os.environ["APP_PORT"] = str(port)
        run_server_process()
        return
    launcher = SignalDeckLauncher()
    launcher.run()


if __name__ == "__main__":
    main()
