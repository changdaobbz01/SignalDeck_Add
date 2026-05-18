#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from threading import Event, Lock, Thread
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from uuid import uuid4

from flask import Flask, jsonify, render_template, request

from market_signal_tool import (
    Bar,
    MarketDataError,
    MarketDataClient,
    MarketSnapshot,
    SOURCE_HEALTH_TRACKER,
    SOURCE_METADATA,
    SignalEngine,
    load_config,
    macd,
    normalize_source_name,
    sma,
    source_label,
)
from security_search import (
    SecuritySearchService,
    normalize_import_query as normalize_import_query_value,
    normalize_query_symbol as normalize_query_symbol_value,
)
from strategy_engine import (
    SUPPORTED_STRATEGY_TIMEFRAMES,
    action_label_for_value,
    collect_divergence_pairs,
    evaluate_strategy_record,
    load_strategy_catalog,
    normalize_strategy_record,
)


def resolve_resource_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.abspath(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)))
    return os.path.abspath(os.path.dirname(__file__))


def resolve_app_data_dir() -> str:
    override = os.getenv("SIGNAL_DECK_DATA_DIR", "").strip()
    if override:
        return os.path.abspath(override)
    home_dir = os.path.expanduser("~")
    if sys.platform == "darwin":
        return os.path.join(home_dir, "Library", "Application Support", "SignalDeck")
    if os.name == "nt":
        appdata = os.getenv("APPDATA", "").strip()
        if appdata:
            return os.path.join(appdata, "SignalDeck")
        return os.path.join(home_dir, "AppData", "Roaming", "SignalDeck")
    return os.path.join(home_dir, ".signal-deck")


def ensure_runtime_file(target_path: str, default_path: str, fallback: str = "") -> None:
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    if os.path.exists(target_path):
        return
    if default_path and os.path.exists(default_path):
        shutil.copyfile(default_path, target_path)
        return
    with open(target_path, "w", encoding="utf-8") as file:
        file.write(fallback)


RESOURCE_DIR = resolve_resource_dir()
DATA_DIR = resolve_app_data_dir()
CONFIG_TEMPLATE_PATH = os.path.join(RESOURCE_DIR, "config.example.json")
STRATEGY_CATALOG_PATH = os.path.join(RESOURCE_DIR, "strategy_presets.json")
CONFIG_PATH = os.path.join(DATA_DIR, "config.example.json")
STRATEGY_OVERRIDES_PATH = os.path.join(DATA_DIR, "strategy_overrides.json")
ALERT_RUNTIME_PATH = os.path.join(DATA_DIR, "alert_runtime.json")
ensure_runtime_file(CONFIG_PATH, CONFIG_TEMPLATE_PATH, "{}\n")
ensure_runtime_file(STRATEGY_OVERRIDES_PATH, "", '{"strategies":{}}\n')
ensure_runtime_file(
    ALERT_RUNTIME_PATH,
    "",
    '{"watchlist":{"items":[]},"strategy":"liu_core_v2","source":"auto","webhook":{"url":"","enabled_symbols":[],"alert_states":{},"logs":[]}}\n',
)
STRATEGY_CONFIG_LOCK = Lock()
RESPONSE_CACHE: Dict[str, Dict[str, Any]] = {}
RESPONSE_CACHE_LOCK = Lock()
RESPONSE_CACHE_MAX_ITEMS = 1024
CHART_CACHE_TTL = 3.0
SNAPSHOT_CACHE_TTL = 2.0
STRATEGY_SIGNAL_CACHE_TTL = 3.0
DASHBOARD_PULSE_CACHE_TTL = 2.0
WATCHLIST_STREAK_CACHE_TTL = 20.0
RESPONSE_CACHE_MISS = object()
ALERT_RUNTIME_LOG_LIMIT = 80
ALERT_WORKER_INTERVAL_SECONDS = 8.0
ALERT_RUNTIME_LOCK = Lock()
ALERT_WORKER_STATE_LOCK = Lock()
ALERT_WORKER_STOP = Event()
ALERT_WORKER_THREAD: Optional[Thread] = None
ALERT_WORKER_STATE: Dict[str, Any] = {
    "running": False,
    "started_at": None,
    "last_run_at": None,
    "last_success_at": None,
    "last_error": "",
    "last_sent_at": None,
    "last_sent_count": 0,
}

APP_RUNTIME_ID = "SignalDeck"
APP_RUNTIME_LABEL = "Signal Deck"
DEFAULT_SYMBOL = "sh000001"
DEFAULT_TIMEFRAME = "1d"
DEFAULT_ADJUST = "qfq"
DEFAULT_SOURCE = os.getenv("APP_SOURCE", "auto")
DEFAULT_HOST = os.getenv("APP_HOST", "127.0.0.1")
DEFAULT_PORT = int(os.getenv("APP_PORT", "8000"))
DEFAULT_STRATEGY = "liu_core_v2"
STRATEGY_TIMEFRAMES = set(SUPPORTED_STRATEGY_TIMEFRAMES)
CUSTOM_VALUE_LABELS = {
    "DIF": "MACD DIF 快线",
    "DEA": "MACD DEA 慢线",
    "K": "KDJ K 值",
    "D": "KDJ D 值",
    "J": "KDJ J 值",
    "CLOSE": "最新 K 线收盘价",
    "OPEN": "最新 K 线开盘价",
    "HIGH": "最新 K 线最高价",
    "LOW": "最新 K 线最低价",
    "VOLUME": "最新 K 线成交量",
    "AMOUNT": "最新 K 线成交额",
}

STRATEGY_PRESETS = {
    "none": {
        "id": "none",
        "label": "不启用",
        "description": "关闭买卖提示。",
        "timeframe": None,
        "type": "builtin",
        "indicators": [],
        "buy_rules": [],
        "sell_rules": [],
        "notes": ["当前策略已关闭，不计算买入或卖出命中。"],
    },
    "rule1": {
        "id": "rule1",
        "label": "规则1 · 5m MACD/KDJ",
        "description": "5分钟 DIF>DEA 且 K>D 触发买入，反向触发卖出；J 值决定优先级。",
        "timeframe": "5m",
        "type": "builtin",
        "indicators": [
            {"name": "DIF", "type": "macd", "description": "MACD DIF 快线"},
            {"name": "DEA", "type": "macd", "description": "MACD DEA 慢线"},
            {"name": "K", "type": "kdj", "description": "KDJ K 值"},
            {"name": "D", "type": "kdj", "description": "KDJ D 值"},
            {"name": "J", "type": "kdj", "description": "KDJ J 值，用于估算优先级"},
        ],
        "buy_rules": ["5m DIF>DEA 且 K>D"],
        "sell_rules": ["5m DIF<DEA 且 K<D"],
        "notes": [
            "规则信号固定使用 5m 周期计算，不跟随主图周期切换。",
            "BUY 红色、SELL 绿色；J 值越接近极端区间，优先级越高。",
        ],
    },
}

app = Flask(
    __name__,
    template_folder=os.path.join(RESOURCE_DIR, "templates"),
    static_folder=os.path.join(RESOURCE_DIR, "static"),
)
app.json.ensure_ascii = False
client = MarketDataClient()
search_service = SecuritySearchService()


def build_response_cache_key(prefix: str, *parts: Any) -> str:
    normalized_parts: List[str] = [prefix]
    for part in parts:
        if isinstance(part, (dict, list, tuple, set)):
            normalized_parts.append(json.dumps(part, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        else:
            normalized_parts.append(str(part))
    return "|".join(normalized_parts)


def get_response_cache(key: str) -> Any:
    now = time.time()
    with RESPONSE_CACHE_LOCK:
        entry = RESPONSE_CACHE.get(key)
        if not entry:
            return RESPONSE_CACHE_MISS
        if float(entry.get("expires_at") or 0.0) <= now:
            RESPONSE_CACHE.pop(key, None)
            return RESPONSE_CACHE_MISS
        return copy.deepcopy(entry.get("value"))


def set_response_cache(key: str, value: Any, ttl: float) -> Any:
    now = time.time()
    stored = copy.deepcopy(value)
    with RESPONSE_CACHE_LOCK:
        RESPONSE_CACHE[key] = {
            "expires_at": now + max(ttl, 0.0),
            "value": stored,
            "updated_at": now,
        }
        if len(RESPONSE_CACHE) > RESPONSE_CACHE_MAX_ITEMS:
            stale_keys = sorted(
                RESPONSE_CACHE.keys(),
                key=lambda item: float(RESPONSE_CACHE[item].get("expires_at") or 0.0),
            )[: max(1, len(RESPONSE_CACHE) - RESPONSE_CACHE_MAX_ITEMS)]
            for stale_key in stale_keys:
                RESPONSE_CACHE.pop(stale_key, None)
    return copy.deepcopy(stored)


def get_or_set_response_cache(key: str, ttl: float, builder: Any) -> Any:
    cached = get_response_cache(key)
    if cached is not RESPONSE_CACHE_MISS:
        return cached
    value = builder()
    return set_response_cache(key, value, ttl)


def clear_response_cache(prefix: Optional[str] = None) -> None:
    with RESPONSE_CACHE_LOCK:
        if not prefix:
            RESPONSE_CACHE.clear()
            return
        cache_prefix = f"{prefix}|"
        keys = [key for key in RESPONSE_CACHE.keys() if key.startswith(cache_prefix)]
        for key in keys:
            RESPONSE_CACHE.pop(key, None)


def fetch_bars_with_source_cached(
    symbol: str,
    timeframe: str,
    max_bars: int,
    adjust: str,
    source: str,
    ttl: float,
) -> Tuple[str, List[Any], str]:
    requested_source = normalize_source_name(source)
    cache_key = build_response_cache_key("bars", symbol, timeframe, max_bars, adjust, requested_source)
    return get_or_set_response_cache(
        cache_key,
        ttl,
        lambda: client.fetch_bars_with_source(symbol, timeframe, max_bars, adjust, source=requested_source),
    )


def _combine_bar_bucket(bucket: List[Bar]) -> Bar:
    if not bucket:
        raise MarketDataError("Cannot aggregate an empty bar bucket")
    return Bar(
        timestamp=bucket[-1].timestamp,
        open=bucket[0].open,
        close=bucket[-1].close,
        high=max(bar.high for bar in bucket),
        low=min(bar.low for bar in bucket),
        volume=sum(bar.volume for bar in bucket),
        amount=sum(bar.amount for bar in bucket),
    )


def aggregate_120m_bars(bars: List[Bar]) -> List[Bar]:
    aggregated: List[Bar] = []
    bucket: List[Bar] = []
    current_day = ""
    for bar in bars:
        bar_day = str(bar.timestamp).split(" ", 1)[0]
        if bucket and (bar_day != current_day or len(bucket) >= 2):
            aggregated.append(_combine_bar_bucket(bucket))
            bucket = []
        current_day = bar_day
        bucket.append(bar)
        if len(bucket) >= 2:
            aggregated.append(_combine_bar_bucket(bucket))
            bucket = []
    if bucket:
        aggregated.append(_combine_bar_bucket(bucket))
    return aggregated


def _bar_datetime(value: str) -> datetime:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y-%m"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise MarketDataError(f"Unsupported bar timestamp: {value}")


def aggregate_quarterly_bars(bars: List[Bar]) -> List[Bar]:
    aggregated: List[Bar] = []
    bucket: List[Bar] = []
    current_key: Optional[Tuple[int, int]] = None
    for bar in bars:
        stamp = _bar_datetime(bar.timestamp)
        quarter_key = (stamp.year, ((stamp.month - 1) // 3) + 1)
        if bucket and quarter_key != current_key:
            aggregated.append(_combine_bar_bucket(bucket))
            bucket = []
        current_key = quarter_key
        bucket.append(bar)
    if bucket:
        aggregated.append(_combine_bar_bucket(bucket))
    return aggregated


def fetch_strategy_bars_with_source(
    symbol: str,
    timeframe: str,
    max_bars: int,
    source: str,
) -> Tuple[str, List[Bar], str]:
    requested_source = normalize_source_name(source)
    if timeframe == "120m":
        name, raw_bars, actual_source = fetch_bars_with_source_cached(
            symbol,
            "60m",
            max(max_bars * 2 + 12, 160),
            "none",
            requested_source,
            STRATEGY_SIGNAL_CACHE_TTL,
        )
        return name, aggregate_120m_bars(raw_bars)[-max_bars:], actual_source
    if timeframe == "1q":
        name, raw_bars, actual_source = fetch_bars_with_source_cached(
            symbol,
            "1M",
            max(max_bars * 3 + 6, 48),
            "none",
            requested_source,
            STRATEGY_SIGNAL_CACHE_TTL,
        )
        return name, aggregate_quarterly_bars(raw_bars)[-max_bars:], actual_source
    return fetch_bars_with_source_cached(
        symbol,
        timeframe,
        max_bars,
        "none",
        requested_source,
        STRATEGY_SIGNAL_CACHE_TTL,
    )


def fetch_chart_bars_with_source(
    symbol: str,
    timeframe: str,
    max_bars: int,
    adjust: str,
    source: str,
) -> Tuple[str, List[Bar], str]:
    requested_source = normalize_source_name(source)
    if timeframe == "120m":
        name, raw_bars, actual_source = fetch_bars_with_source_cached(
            symbol,
            "60m",
            max(max_bars * 2 + 12, 160),
            adjust,
            requested_source,
            CHART_CACHE_TTL,
        )
        bars = aggregate_120m_bars(raw_bars)[-max_bars:]
        if not bars:
            raise MarketDataError(f"{symbol} 120m 聚合后没有可用 K 线数据")
        return name, bars, actual_source
    if timeframe == "1q":
        name, raw_bars, actual_source = fetch_bars_with_source_cached(
            symbol,
            "1M",
            max(max_bars * 3 + 6, 48),
            adjust,
            requested_source,
            CHART_CACHE_TTL,
        )
        bars = aggregate_quarterly_bars(raw_bars)[-max_bars:]
        if not bars:
            raise MarketDataError(f"{symbol} 季线聚合后没有可用 K 线数据")
        return name, bars, actual_source
    return fetch_bars_with_source_cached(
        symbol,
        timeframe,
        max_bars,
        adjust,
        requested_source,
        CHART_CACHE_TTL,
    )


def fetch_snapshot_cached(symbol: str, source: str, ttl: float = SNAPSHOT_CACHE_TTL) -> MarketSnapshot:
    requested_source = normalize_source_name(source)
    cache_key = build_response_cache_key("snapshot", symbol, requested_source)
    return get_or_set_response_cache(
        cache_key,
        ttl,
        lambda: client.fetch_snapshot(symbol, source=requested_source),
    )


def build_strategy_signal_payload_cached(symbol: str, strategy_name: str, source: str) -> Dict[str, Any]:
    cache_key = build_response_cache_key("strategy", symbol, normalize_strategy_name(strategy_name), normalize_source_name(source))
    return get_or_set_response_cache(
        cache_key,
        STRATEGY_SIGNAL_CACHE_TTL,
        lambda: build_strategy_signal_payload(symbol, strategy_name, source),
    )


def build_chart_payload_cached(
    symbol: str,
    timeframe: str,
    adjust: str,
    history_bars: int,
    source: str,
) -> Dict[str, Any]:
    cache_key = build_response_cache_key("chart", symbol, timeframe, adjust, history_bars, normalize_source_name(source))
    return get_or_set_response_cache(
        cache_key,
        CHART_CACHE_TTL,
        lambda: build_chart_payload(symbol, timeframe, adjust, history_bars, source),
    )


def compute_watchlist_streak_cached(symbol: str, source: str) -> Dict[str, Any]:
    requested_source = normalize_source_name(source)
    cache_key = build_response_cache_key("watchlist-streak", symbol, requested_source)
    return get_or_set_response_cache(
        cache_key,
        WATCHLIST_STREAK_CACHE_TTL,
        lambda: compute_consecutive_trend(
            fetch_bars_with_source_cached(
                symbol,
                "1d",
                6,
                "none",
                requested_source,
                WATCHLIST_STREAK_CACHE_TTL,
            )[1]
        ),
    )


def normalize_symbol_request_list(raw_symbols: str, limit: int = 120) -> List[str]:
    tokens = [item.strip() for item in str(raw_symbols or "").split(",") if item.strip()]
    ordered_symbols: List[str] = []
    seen: set[str] = set()
    for token in tokens[:limit]:
        normalized = token.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        ordered_symbols.append(token)
    return ordered_symbols


def build_watchlist_quotes_payload(raw_symbols: str, source: str) -> Dict[str, Any]:
    requested_source = normalize_source_name(source)
    ordered_symbols = normalize_symbol_request_list(raw_symbols)
    if not ordered_symbols:
        return {"quotes": [], "errors": []}

    def fetch_one(raw_symbol: str) -> Dict[str, Any]:
        symbol = resolve_symbol(raw_symbol)
        snapshot = fetch_snapshot_cached(symbol, requested_source, ttl=SNAPSHOT_CACHE_TTL)
        try:
            streak = compute_watchlist_streak_cached(symbol, requested_source)
        except Exception:
            streak = {"direction": "", "days": 0, "label": ""}
        return {
            "requested_symbol": raw_symbol.lower(),
            "symbol": symbol,
            "name": snapshot.name,
            "source": build_source_info(requested_source, snapshot.source),
            "market": serialize_snapshot(snapshot),
            "streak": streak,
        }

    quotes: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    max_workers = min(6, len(ordered_symbols)) or 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(fetch_one, symbol): symbol for symbol in ordered_symbols}
        for future in as_completed(future_map):
            raw_symbol = future_map[future]
            try:
                quotes.append(future.result())
            except Exception as exc:  # noqa: BLE001
                errors.append({"symbol": raw_symbol, "error": str(exc)})

    order_index = {symbol.lower(): idx for idx, symbol in enumerate(ordered_symbols)}
    quotes.sort(key=lambda item: order_index.get(item.get("requested_symbol", ""), len(order_index)))
    for item in quotes:
        item.pop("requested_symbol", None)
    errors.sort(key=lambda item: order_index.get(item["symbol"].lower(), len(order_index)))
    return {"quotes": quotes, "errors": errors}


def build_watchlist_strategy_signals_payload(raw_symbols: str, strategy_name: str, source: str) -> Dict[str, Any]:
    strategy_id = normalize_strategy_name(strategy_name)
    if strategy_id == "none":
        return {"signals": [], "errors": []}

    normalize_source_name(source)
    ordered_symbols = normalize_symbol_request_list(raw_symbols)
    if not ordered_symbols:
        return {"signals": [], "errors": []}

    def fetch_one(raw_symbol: str) -> Dict[str, Any]:
        symbol = resolve_symbol(raw_symbol)
        payload = build_strategy_signal_payload_cached(symbol, strategy_id, source)
        payload["requested_symbol"] = raw_symbol.lower()
        return payload

    signals: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    max_workers = min(6, len(ordered_symbols)) or 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {executor.submit(fetch_one, symbol): symbol for symbol in ordered_symbols}
        for future in as_completed(future_map):
            raw_symbol = future_map[future]
            try:
                signals.append(future.result())
            except Exception as exc:  # noqa: BLE001
                errors.append({"symbol": raw_symbol, "error": str(exc)})

    order_index = {symbol.lower(): idx for idx, symbol in enumerate(ordered_symbols)}
    signals.sort(key=lambda item: order_index.get(item.get("requested_symbol", ""), len(order_index)))
    for item in signals:
        item.pop("requested_symbol", None)
    errors.sort(key=lambda item: order_index.get(item["symbol"].lower(), len(order_index)))
    return {"signals": signals, "errors": errors}


def build_dashboard_pulse_payload(
    symbol: str,
    timeframe: str,
    adjust: str,
    history_bars: int,
    source: str,
    strategy_name: str,
    raw_watchlist_symbols: str,
    include_chart: bool = False,
    include_watchlist_signals: bool = False,
) -> Dict[str, Any]:
    requested_source = normalize_source_name(source)
    strategy_id = normalize_strategy_name(strategy_name)
    watchlist_symbols = normalize_symbol_request_list(raw_watchlist_symbols)

    payload: Dict[str, Any] = {
        "symbol": symbol,
        "timeframe": timeframe,
        "adjust": adjust,
        "strategy": strategy_id,
        "source": requested_source,
        "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "chart": None,
        "quote": None,
        "strategy_signal": None,
        "watchlist_quotes": {"quotes": [], "errors": []},
        "watchlist_signals": {"signals": [], "errors": []},
        "includes": {
            "chart": include_chart,
            "watchlist_signals": include_watchlist_signals and strategy_id != "none",
        },
    }
    errors: Dict[str, str] = {}

    def fetch_chart() -> Dict[str, Any]:
        return build_chart_payload_cached(symbol, timeframe, adjust, history_bars, requested_source)

    def fetch_quote() -> Dict[str, Any]:
        snapshot = fetch_snapshot_cached(symbol, requested_source, ttl=SNAPSHOT_CACHE_TTL)
        return {
            "symbol": symbol,
            "source": build_source_info(requested_source, snapshot.source),
            "market": serialize_snapshot(snapshot),
        }

    jobs: Dict[Any, str] = {}
    max_workers = 2
    if strategy_id != "none":
        max_workers += 1
    if watchlist_symbols:
        max_workers += 1
        if include_watchlist_signals and strategy_id != "none":
            max_workers += 1

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        jobs[executor.submit(fetch_chart if include_chart else fetch_quote)] = "chart" if include_chart else "quote"
        if strategy_id != "none":
            jobs[executor.submit(build_strategy_signal_payload_cached, symbol, strategy_id, requested_source)] = "strategy_signal"
        if watchlist_symbols:
            jobs[executor.submit(build_watchlist_quotes_payload, ",".join(watchlist_symbols), requested_source)] = "watchlist_quotes"
            if include_watchlist_signals and strategy_id != "none":
                jobs[
                    executor.submit(
                        build_watchlist_strategy_signals_payload,
                        ",".join(watchlist_symbols),
                        strategy_id,
                        requested_source,
                    )
                ] = "watchlist_signals"

        for future in as_completed(jobs):
            key = jobs[future]
            try:
                result = future.result()
                if key == "chart":
                    payload["chart"] = result
                    payload["quote"] = {
                        "symbol": result["symbol"],
                        "source": result["source"],
                        "market": result["market"],
                    }
                else:
                    payload[key] = result
            except Exception as exc:  # noqa: BLE001
                errors[key] = str(exc)

    if errors:
        payload["errors"] = errors
    return payload


def build_dashboard_pulse_payload_cached(
    symbol: str,
    timeframe: str,
    adjust: str,
    history_bars: int,
    source: str,
    strategy_name: str,
    raw_watchlist_symbols: str,
    include_chart: bool = False,
    include_watchlist_signals: bool = False,
) -> Dict[str, Any]:
    requested_source = normalize_source_name(source)
    strategy_id = normalize_strategy_name(strategy_name)
    watchlist_key = ",".join(normalize_symbol_request_list(raw_watchlist_symbols))
    cache_key = build_response_cache_key(
        "dashboard-pulse",
        symbol,
        timeframe,
        adjust,
        history_bars,
        requested_source,
        strategy_id,
        watchlist_key,
        int(bool(include_chart)),
        int(bool(include_watchlist_signals)),
    )
    return get_or_set_response_cache(
        cache_key,
        DASHBOARD_PULSE_CACHE_TTL,
        lambda: build_dashboard_pulse_payload(
            symbol,
            timeframe,
            adjust,
            history_bars,
            requested_source,
            strategy_id,
            watchlist_key,
            include_chart=include_chart,
            include_watchlist_signals=include_watchlist_signals,
        ),
    )


def calc_kdj(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    window: int = 9,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    k_values: List[Optional[float]] = [None] * len(closes)
    d_values: List[Optional[float]] = [None] * len(closes)
    j_values: List[Optional[float]] = [None] * len(closes)
    prev_k = 50.0
    prev_d = 50.0

    for idx in range(len(closes)):
        start = max(0, idx - window + 1)
        window_high = max(highs[start : idx + 1])
        window_low = min(lows[start : idx + 1])
        if window_high == window_low:
            rsv = 50.0
        else:
            rsv = ((closes[idx] - window_low) / (window_high - window_low)) * 100.0
        current_k = (2.0 / 3.0) * prev_k + (1.0 / 3.0) * rsv
        current_d = (2.0 / 3.0) * prev_d + (1.0 / 3.0) * current_k
        current_j = (3.0 * current_k) - (2.0 * current_d)
        k_values[idx] = current_k
        d_values[idx] = current_d
        j_values[idx] = current_j
        prev_k = current_k
        prev_d = current_d

    return k_values, d_values, j_values


def round_series(values: List[Optional[float]], digits: int = 4) -> List[Optional[float]]:
    rounded: List[Optional[float]] = []
    for value in values:
        if value is None:
            rounded.append(None)
        else:
            rounded.append(round(float(value), digits))
    return rounded


def round_optional(value: Optional[float], digits: int = 4) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), digits)


def divergence_lookback_for_timeframe(timeframe: str) -> int:
    if timeframe in {"1w", "1M", "1q"}:
        return 48
    if timeframe in {"30m", "60m", "120m", "1d"}:
        return 60
    return 36


def build_divergence_annotations(
    timeframe: str,
    timestamps: List[str],
    closes: List[float],
    highs: List[float],
    lows: List[float],
    dif_values: List[Optional[float]],
) -> List[Dict[str, Any]]:
    lookback = divergence_lookback_for_timeframe(timeframe)
    bullish_pairs = collect_divergence_pairs(
        closes,
        dif_values,
        bullish=True,
        lookback=lookback,
        pivot_window=3,
        min_separation=4,
        max_pairs=6,
    )
    bearish_pairs = collect_divergence_pairs(
        closes,
        dif_values,
        bullish=False,
        lookback=lookback,
        pivot_window=3,
        min_separation=4,
        max_pairs=6,
    )

    annotations: List[Dict[str, Any]] = []
    for pair in bullish_pairs:
        index = int(pair["second_index"])
        if index < 0 or index >= len(timestamps):
            continue
        reference_index = int(pair["first_index"])
        annotations.append(
            {
                "type": "bottom",
                "label": "\u5e95\u80cc\u79bb",
                "short_label": "\u5e95\u80cc\u79bb",
                "time": timestamps[index],
                "price": round(lows[index], 4),
                "close": round(closes[index], 4),
                "indicator": round(pair["second_indicator"], 4),
                "reference_time": timestamps[reference_index] if 0 <= reference_index < len(timestamps) else None,
                "reference_price": round(pair["first_price"], 4),
                "reference_indicator": round(pair["first_indicator"], 4),
            }
        )

    for pair in bearish_pairs:
        index = int(pair["second_index"])
        if index < 0 or index >= len(timestamps):
            continue
        reference_index = int(pair["first_index"])
        annotations.append(
            {
                "type": "top",
                "label": "\u9876\u80cc\u79bb",
                "short_label": "\u9876\u80cc\u79bb",
                "time": timestamps[index],
                "price": round(highs[index], 4),
                "close": round(closes[index], 4),
                "indicator": round(pair["second_indicator"], 4),
                "reference_time": timestamps[reference_index] if 0 <= reference_index < len(timestamps) else None,
                "reference_price": round(pair["first_price"], 4),
                "reference_indicator": round(pair["first_indicator"], 4),
            }
        )

    annotations.sort(key=lambda item: str(item.get("time") or ""))
    return annotations


def load_builtin_strategy_presets() -> Dict[str, Dict[str, Any]]:
    try:
        return load_strategy_catalog(STRATEGY_CATALOG_PATH)
    except Exception:
        fallback = STRATEGY_PRESETS.get("none")
        if not isinstance(fallback, dict):
            return {}
        return {"none": normalize_strategy_record(copy.deepcopy(fallback))}


def load_runtime_config() -> Dict[str, Any]:
    return copy.deepcopy(load_config(CONFIG_PATH))


def iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def normalize_alert_runtime_watchlist_item(raw: Any) -> Optional[Dict[str, str]]:
    if not isinstance(raw, dict):
        return None
    symbol = str(raw.get("symbol") or "").strip().lower()
    if not symbol:
        return None
    item = {"symbol": symbol}
    name = str(raw.get("name") or "").strip()
    trade_cycle = str(raw.get("trade_cycle") or "").strip()
    if name:
        item["name"] = name[:80]
    if trade_cycle:
        item["trade_cycle"] = trade_cycle[:40]
    return item


def normalize_alert_runtime_watchlist_items(raw_items: Any) -> List[Dict[str, str]]:
    items = raw_items if isinstance(raw_items, list) else []
    seen: set[str] = set()
    cleaned: List[Dict[str, str]] = []
    for raw in items:
        item = normalize_alert_runtime_watchlist_item(raw)
        if not item:
            continue
        symbol = item["symbol"]
        if symbol in seen:
            continue
        seen.add(symbol)
        cleaned.append(item)
    return cleaned


def normalize_alert_runtime_enabled_symbols(raw_items: Any) -> List[str]:
    seen: set[str] = set()
    symbols: List[str] = []
    for raw in raw_items if isinstance(raw_items, list) else []:
        symbol = str(raw or "").strip().lower()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        symbols.append(symbol)
    return symbols


def normalize_alert_runtime_states(raw: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}
    cleaned: Dict[str, Dict[str, Any]] = {}
    for key, value in raw.items():
        symbol = str(key or "").strip().lower()
        if not symbol or not isinstance(value, dict):
            continue
        signal = str(value.get("signal") or "HOLD").strip().upper()
        if signal not in {"BUY", "SELL", "HOLD", "OFF"}:
            signal = "HOLD"
        cleaned[symbol] = {
            "signal": signal,
            "action": str(value.get("action") or "").strip().lower(),
            "actionLabel": str(value.get("actionLabel") or "").strip(),
            "dayKey": str(value.get("dayKey") or "").strip(),
            "lastAlertDayKey": str(value.get("lastAlertDayKey") or "").strip(),
            "updatedAt": str(value.get("updatedAt") or "").strip(),
        }
    return cleaned


def normalize_alert_runtime_logs(raw: Any) -> List[Dict[str, Any]]:
    items = raw if isinstance(raw, list) else []
    cleaned: List[Dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        cleaned.append(copy.deepcopy(item))
    return cleaned[:ALERT_RUNTIME_LOG_LIMIT]


def default_alert_runtime_state() -> Dict[str, Any]:
    return {
        "watchlist": {"items": []},
        "strategy": DEFAULT_STRATEGY,
        "source": DEFAULT_SOURCE,
        "webhook": {
            "url": "",
            "enabled_symbols": [],
            "alert_states": {},
            "logs": [],
        },
        "updated_at": "",
    }


def normalize_alert_runtime_state(raw: Any) -> Dict[str, Any]:
    state = default_alert_runtime_state()
    payload = raw if isinstance(raw, dict) else {}
    watchlist_raw = payload.get("watchlist")
    webhook_raw = payload.get("webhook")

    watchlist_items = []
    if isinstance(watchlist_raw, dict):
        watchlist_items = normalize_alert_runtime_watchlist_items(watchlist_raw.get("items"))
    elif isinstance(payload.get("items"), list):
        watchlist_items = normalize_alert_runtime_watchlist_items(payload.get("items"))
    state["watchlist"]["items"] = watchlist_items

    strategy_value = payload.get("strategy") or (webhook_raw or {}).get("strategy") or DEFAULT_STRATEGY
    try:
        state["strategy"] = normalize_strategy_name(strategy_value)
    except Exception:
        state["strategy"] = DEFAULT_STRATEGY

    source_value = payload.get("source") or (webhook_raw or {}).get("source") or DEFAULT_SOURCE
    try:
        state["source"] = normalize_source_name(source_value)
    except Exception:
        state["source"] = DEFAULT_SOURCE

    if not isinstance(webhook_raw, dict):
        webhook_raw = {}
    state["webhook"]["url"] = str(webhook_raw.get("url") or payload.get("webhook_url") or "").strip()
    state["webhook"]["enabled_symbols"] = normalize_alert_runtime_enabled_symbols(
        webhook_raw.get("enabled_symbols") or payload.get("enabled_symbols")
    )
    state["webhook"]["alert_states"] = normalize_alert_runtime_states(
        webhook_raw.get("alert_states") or payload.get("alert_states")
    )
    state["webhook"]["logs"] = normalize_alert_runtime_logs(webhook_raw.get("logs") or payload.get("logs"))
    state["updated_at"] = str(payload.get("updated_at") or "").strip()
    return state


def load_alert_runtime_state_unlocked() -> Dict[str, Any]:
    if not os.path.exists(ALERT_RUNTIME_PATH):
        return default_alert_runtime_state()
    try:
        with open(ALERT_RUNTIME_PATH, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return default_alert_runtime_state()
    return normalize_alert_runtime_state(payload)


def save_alert_runtime_state_unlocked(state: Dict[str, Any]) -> Dict[str, Any]:
    payload = normalize_alert_runtime_state(state)
    payload["updated_at"] = iso_now()
    tmp_path = f"{ALERT_RUNTIME_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    os.replace(tmp_path, ALERT_RUNTIME_PATH)
    return copy.deepcopy(payload)


def load_alert_runtime_state() -> Dict[str, Any]:
    with ALERT_RUNTIME_LOCK:
        return load_alert_runtime_state_unlocked()


def save_alert_runtime_state(state: Dict[str, Any]) -> Dict[str, Any]:
    with ALERT_RUNTIME_LOCK:
        return save_alert_runtime_state_unlocked(state)


def update_alert_runtime_state(mutator: Any) -> Dict[str, Any]:
    with ALERT_RUNTIME_LOCK:
        state = load_alert_runtime_state_unlocked()
        next_state = mutator(copy.deepcopy(state))
        if not isinstance(next_state, dict):
            next_state = state
        return save_alert_runtime_state_unlocked(next_state)


def snapshot_alert_worker_state() -> Dict[str, Any]:
    with ALERT_WORKER_STATE_LOCK:
        return copy.deepcopy(ALERT_WORKER_STATE)


def patch_alert_worker_state(**fields: Any) -> None:
    with ALERT_WORKER_STATE_LOCK:
        ALERT_WORKER_STATE.update(fields)


def build_alert_runtime_response(state: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = load_alert_runtime_state() if state is None else normalize_alert_runtime_state(state)
    payload["worker"] = snapshot_alert_worker_state()
    return payload


def append_alert_runtime_log(entry: Dict[str, Any]) -> Dict[str, Any]:
    def mutator(state: Dict[str, Any]) -> Dict[str, Any]:
        logs = list((state.get("webhook") or {}).get("logs") or [])
        logs.insert(0, copy.deepcopy(entry))
        state.setdefault("webhook", {})["logs"] = logs[:ALERT_RUNTIME_LOG_LIMIT]
        return state

    runtime = update_alert_runtime_state(mutator)
    logs = list((runtime.get("webhook") or {}).get("logs") or [])
    return copy.deepcopy(logs[0]) if logs else copy.deepcopy(entry)


def sanitize_strategy_record(strategy: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = copy.deepcopy(strategy)
    for key in ("editable", "is_overridden", "config_meta"):
        cleaned.pop(key, None)
    return cleaned


def load_strategy_overrides(
    builtin_strategies: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Dict[str, Any]]:
    if builtin_strategies is None:
        builtin_strategies = load_builtin_strategy_presets()
    if not os.path.exists(STRATEGY_OVERRIDES_PATH):
        return {}
    try:
        with open(STRATEGY_OVERRIDES_PATH, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {}

    raw_items = payload.get("strategies") if isinstance(payload, dict) else payload
    if not isinstance(raw_items, dict):
        return {}

    cleaned: Dict[str, Dict[str, Any]] = {}
    for key, value in raw_items.items():
        if not isinstance(value, dict):
            continue
        strategy_id = str(value.get("id") or key).strip().lower()
        if strategy_id == "none" or strategy_id not in builtin_strategies:
            continue
        cleaned[strategy_id] = normalize_strategy_record(
            sanitize_strategy_record({**value, "id": strategy_id})
        )
    return cleaned


def save_strategy_overrides(strategies: Dict[str, Dict[str, Any]]) -> None:
    payload = {
        "strategies": {
            strategy_id: sanitize_strategy_record(strategy)
            for strategy_id, strategy in strategies.items()
            if strategy_id and strategy_id != "none" and isinstance(strategy, dict)
        }
    }
    tmp_path = f"{STRATEGY_OVERRIDES_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    os.replace(tmp_path, STRATEGY_OVERRIDES_PATH)


def build_client_strategy_record(
    strategy: Dict[str, Any],
    overridden_ids: Optional[set[str]] = None,
) -> Dict[str, Any]:
    strategy_id = str(strategy.get("id") or "").strip().lower()
    record = sanitize_strategy_record(strategy)
    record["editable"] = strategy_id != "none"
    record["is_overridden"] = strategy_id in (overridden_ids or set())
    return record


def load_custom_strategies() -> Dict[str, Dict[str, Any]]:
    payload = load_strategy_store()
    strategies = payload.get("strategies") if isinstance(payload, dict) else payload
    if not isinstance(strategies, dict):
        return {}
    cleaned: Dict[str, Dict[str, Any]] = {}
    for key, value in strategies.items():
        if not isinstance(value, dict):
            continue
        strategy_id = str(value.get("id") or key).strip().lower()
        if not strategy_id.startswith("custom_"):
            continue
        cleaned[strategy_id] = normalize_custom_strategy_record({**value, "id": strategy_id})
    return cleaned


def load_strategy_store() -> Dict[str, Any]:
    if not os.path.exists(CUSTOM_STRATEGIES_PATH):
        return {"strategies": {}, "deleted": []}
    try:
        with open(CUSTOM_STRATEGIES_PATH, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return {"strategies": {}, "deleted": []}
    if not isinstance(payload, dict):
        return {"strategies": {}, "deleted": []}
    return {
        "strategies": payload.get("strategies") if isinstance(payload.get("strategies"), dict) else {},
        "deleted": payload.get("deleted") if isinstance(payload.get("deleted"), list) else [],
    }


def load_deleted_strategy_ids() -> set[str]:
    store = load_strategy_store()
    return {
        str(item or "").strip().lower()
        for item in store.get("deleted", [])
        if str(item or "").strip().lower() and str(item or "").strip().lower() != "none"
    }


def save_strategy_store(strategies: Dict[str, Dict[str, Any]], deleted: set[str]) -> None:
    payload = {
        "strategies": strategies,
        "deleted": sorted(item for item in deleted if item and item != "none"),
    }
    tmp_path = f"{CUSTOM_STRATEGIES_PATH}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CUSTOM_STRATEGIES_PATH)


def save_custom_strategies(strategies: Dict[str, Dict[str, Any]]) -> None:
    save_strategy_store(strategies, load_deleted_strategy_ids())


def normalize_custom_strategy_record(strategy: Dict[str, Any]) -> Dict[str, Any]:
    buy_rule = normalize_custom_condition(str(strategy.get("buy_rule") or ""))
    sell_rule = normalize_custom_condition(str(strategy.get("sell_rule") or ""))
    timeframe = normalize_strategy_timeframe(str(strategy.get("timeframe") or ""))
    label = str(strategy.get("label") or "自定义规则").strip()[:40] or "自定义规则"
    strategy_id = str(strategy.get("id") or "").strip().lower()
    indicators = build_custom_indicator_list(buy_rule, sell_rule)
    return {
        "id": strategy_id,
        "label": label,
        "description": f"{timeframe} 自定义规则 · BUY: {buy_rule} · SELL: {sell_rule}",
        "timeframe": timeframe,
        "type": "custom",
        "engine": "legacy",
        "buy_rule": buy_rule,
        "sell_rule": sell_rule,
        "indicators": indicators,
        "buy_rules": [f"{timeframe} {buy_rule}"],
        "sell_rules": [f"{timeframe} {sell_rule}"],
        "notes": [
            "自定义规则使用当前所选信息源计算。",
            "支持指标 DIF、DEA、K、D、J、OPEN、HIGH、LOW、CLOSE、VOLUME、AMOUNT。",
            "条件支持 >、<、>=、<=、==、!=，可用 AND/OR 或 且/或 连接。",
        ],
    }


def all_strategy_presets() -> Dict[str, Dict[str, Any]]:
    strategies = load_builtin_strategy_presets()
    strategies.update(load_strategy_overrides(strategies))
    return strategies


def get_strategy_preset(strategy_id: str) -> Dict[str, Any]:
    strategies = all_strategy_presets()
    if strategy_id not in strategies:
        raise MarketDataError(f"未知策略: {strategy_id}")
    return strategies[strategy_id]


def normalize_strategy_timeframe(raw: str) -> str:
    text = str(raw or "").strip()
    match = re.search(r"\b(120m|60m|30m|15m|5m|1m|1d|1w|1M|1q)\b", text)
    if not match:
        raise MarketDataError("周期必须是 1m、5m、15m、30m、60m、120m、1d、1w、1M 或 1q")
    timeframe = match.group(1)
    if timeframe not in STRATEGY_TIMEFRAMES:
        raise MarketDataError(f"暂不支持周期: {timeframe}")
    return timeframe


def normalize_custom_condition(raw: str) -> str:
    text = str(raw or "").strip()
    text = re.sub(r"^(buy|sell|买入|卖出)\s*[:：]\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"^(fixed\s*)?(120m|60m|30m|15m|5m|1m|1d|1w|1M|1q)\s+", "", text)
    replacements = {
        "＞": ">",
        "＜": "<",
        "＝": "=",
        "！": "!",
        "（": "(",
        "）": ")",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    text = re.sub(r"\s+", " ", text).strip()
    return text.upper()


def parse_custom_strategy_rule(raw: str) -> Dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        raise MarketDataError("请输入规则")
    parts = [part.strip() for part in text.split("|")]
    if len(parts) != 4:
        raise MarketDataError("格式应为：名称 | 周期 | BUY: 条件 | SELL: 条件")

    label = parts[0][:40].strip()
    if not label:
        raise MarketDataError("规则名称不能为空")
    timeframe = normalize_strategy_timeframe(parts[1])
    buy_rule = normalize_custom_condition(parts[2])
    sell_rule = normalize_custom_condition(parts[3])
    if not buy_rule or not sell_rule:
        raise MarketDataError("请同时填写 BUY 和 SELL 条件")
    validate_custom_condition(buy_rule)
    validate_custom_condition(sell_rule)
    digest = hashlib.sha1(f"{label}|{timeframe}|{buy_rule}|{sell_rule}".encode("utf-8")).hexdigest()[:10]
    return normalize_custom_strategy_record(
        {
            "id": f"custom_{digest}",
            "label": label,
            "timeframe": timeframe,
            "buy_rule": buy_rule,
            "sell_rule": sell_rule,
        }
    )


def build_custom_indicator_list(*conditions: str) -> List[Dict[str, Any]]:
    used: List[str] = []
    for condition in conditions:
        for token in re.findall(r"\b[A-Z_][A-Z0-9_]*\b", condition.upper()):
            if token in {"AND", "OR"} or token not in CUSTOM_VALUE_LABELS or token in used:
                continue
            used.append(token)
    return [
        {"name": token, "type": "custom", "description": CUSTOM_VALUE_LABELS[token]}
        for token in used
    ]


def validate_custom_condition(condition: str) -> None:
    for comparison in iter_condition_comparisons(condition):
        left, operator, right = parse_custom_comparison(comparison)
        if operator not in {">", "<", ">=", "<=", "==", "!="}:
            raise MarketDataError(f"不支持的比较符: {operator}")
        validate_custom_operand(left)
        validate_custom_operand(right)


def normalize_boolean_connectors(condition: str) -> str:
    text = normalize_custom_condition(condition)
    text = re.sub(r"\s*&&\s*", " AND ", text)
    text = re.sub(r"\s*\|\|\s*", " OR ", text)
    text = re.sub(r"\s*且\s*", " AND ", text)
    text = re.sub(r"\s*或\s*", " OR ", text)
    text = re.sub(r"\bAND\b", " AND ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bOR\b", " OR ", text, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", text).strip()


def iter_condition_comparisons(condition: str) -> List[str]:
    text = normalize_boolean_connectors(condition)
    if not text:
        raise MarketDataError("条件不能为空")
    comparisons: List[str] = []
    for or_group in re.split(r"\s+OR\s+", text):
        for comparison in re.split(r"\s+AND\s+", or_group):
            item = comparison.strip()
            if not item:
                raise MarketDataError("条件连接符附近缺少比较表达式")
            comparisons.append(item)
    return comparisons


def parse_custom_comparison(comparison: str) -> Tuple[str, str, str]:
    match = re.fullmatch(
        r"([A-Z_][A-Z0-9_]*|-?\d+(?:\.\d+)?)\s*(>=|<=|==|!=|>|<)\s*([A-Z_][A-Z0-9_]*|-?\d+(?:\.\d+)?)",
        comparison.strip(),
    )
    if not match:
        raise MarketDataError(f"无法解析条件: {comparison}")
    return match.group(1), match.group(2), match.group(3)


def validate_custom_operand(value: str) -> None:
    if re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return
    if value not in CUSTOM_VALUE_LABELS:
        raise MarketDataError(f"不支持的指标: {value}")


def custom_operand_value(value: str, values: Dict[str, Optional[float]]) -> Optional[float]:
    if re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return float(value)
    return values.get(value)


def evaluate_custom_comparison(comparison: str, values: Dict[str, Optional[float]]) -> bool:
    left, operator, right = parse_custom_comparison(comparison)
    left_value = custom_operand_value(left, values)
    right_value = custom_operand_value(right, values)
    if left_value is None or right_value is None:
        return False
    if operator == ">":
        return left_value > right_value
    if operator == "<":
        return left_value < right_value
    if operator == ">=":
        return left_value >= right_value
    if operator == "<=":
        return left_value <= right_value
    if operator == "==":
        return left_value == right_value
    if operator == "!=":
        return left_value != right_value
    return False


def evaluate_custom_condition(condition: str, values: Dict[str, Optional[float]]) -> bool:
    text = normalize_boolean_connectors(condition)
    for or_group in re.split(r"\s+OR\s+", text):
        and_results = [
            evaluate_custom_comparison(comparison.strip(), values)
            for comparison in re.split(r"\s+AND\s+", or_group)
            if comparison.strip()
        ]
        if and_results and all(and_results):
            return True
    return False


def build_source_info(requested: str, actual: str) -> Dict[str, str]:
    return {
        "requested": requested,
        "requested_label": source_label(requested),
        "actual": actual,
        "actual_label": source_label(actual),
    }


def build_snapshot_from_bars(
    symbol: str,
    name: str,
    bars: List[Any],
    source: str,
) -> MarketSnapshot:
    last_bar = bars[-1]
    prev_close = bars[-2].close if len(bars) >= 2 else last_bar.close
    change = last_bar.close - prev_close
    change_pct = (change / prev_close * 100.0) if prev_close else 0.0
    return MarketSnapshot(
        symbol=symbol,
        name=name,
        source=source,
        last_price=last_bar.close,
        prev_close=prev_close,
        open=last_bar.open,
        high=last_bar.high,
        low=last_bar.low,
        volume=last_bar.volume,
        amount=last_bar.amount,
        change=change,
        change_pct=change_pct,
        turnover_rate=None,
        amplitude_pct=((last_bar.high - last_bar.low) / prev_close * 100.0) if prev_close else None,
        pe_dynamic=None,
        pb=None,
        total_market_value=None,
        circulating_market_value=None,
        upper_limit=None,
        lower_limit=None,
        timestamp=last_bar.timestamp,
    )


def serialize_snapshot(snapshot: MarketSnapshot, fallback_timestamp: Optional[str] = None) -> Dict[str, Any]:
    return {
        "symbol": snapshot.symbol,
        "name": snapshot.name,
        "source": snapshot.source,
        "source_label": source_label(snapshot.source),
        "last_price": round_optional(snapshot.last_price, 3),
        "prev_close": round_optional(snapshot.prev_close, 3),
        "open": round_optional(snapshot.open, 3),
        "high": round_optional(snapshot.high, 3),
        "low": round_optional(snapshot.low, 3),
        "volume": round_optional(snapshot.volume, 2),
        "amount": round_optional(snapshot.amount, 2),
        "change": round_optional(snapshot.change, 4),
        "change_pct": round_optional(snapshot.change_pct, 4),
        "turnover_rate": round_optional(snapshot.turnover_rate, 4),
        "amplitude_pct": round_optional(snapshot.amplitude_pct, 4),
        "pe_dynamic": round_optional(snapshot.pe_dynamic, 4),
        "pb": round_optional(snapshot.pb, 4),
        "total_market_value": round_optional(snapshot.total_market_value, 2),
        "circulating_market_value": round_optional(snapshot.circulating_market_value, 2),
        "upper_limit": round_optional(snapshot.upper_limit, 3),
        "lower_limit": round_optional(snapshot.lower_limit, 3),
        "timestamp": snapshot.timestamp or fallback_timestamp,
    }


def compute_consecutive_trend(bars: List[Any]) -> Dict[str, Any]:
    if len(bars) < 3:
        return {"direction": "", "days": 0, "label": ""}

    direction = 0
    days = 0
    for index in range(len(bars) - 1, 0, -1):
        diff = float(bars[index].close) - float(bars[index - 1].close)
        current = 1 if diff > 0 else -1 if diff < 0 else 0
        if current == 0:
            break
        if direction == 0:
            direction = current
            days = 1
            continue
        if current != direction:
            break
        days += 1

    if days < 2:
        return {"direction": "", "days": days, "label": ""}

    label = f"连涨{days}天" if direction > 0 else f"连跌{days}天"
    return {"direction": "up" if direction > 0 else "down", "days": days, "label": label}


def describe_indicator(name: str, spec: Dict[str, Any]) -> str:
    indicator_type = str(spec.get("type", "")).lower()
    source_name = spec.get("source", "close")
    if indicator_type in {"sma", "ema", "rsi"}:
        return f"{indicator_type.upper()}({source_name}, {spec.get('window', '-')})"
    if indicator_type == "macd":
        return (
            f"MACD({source_name}, fast={spec.get('fast', 12)}, "
            f"slow={spec.get('slow', 26)}, signal={spec.get('signal', 9)})"
        )
    if indicator_type == "bollinger":
        return (
            f"BOLL({source_name}, window={spec.get('window', 20)}, "
            f"std={spec.get('stddev', 2)})"
        )
    if indicator_type == "atr":
        return f"ATR(window={spec.get('window', 14)})"
    return f"{name} ({indicator_type})"


def component_check_label(name: str) -> str:
    mapping = {
        "pass": "趋势通过",
        "buy": "买入条件",
        "sell": "卖出条件",
        "buy_ready": "买入就绪",
        "sell_ready": "卖出就绪",
        "low_zone": "周线低档",
        "high_zone": "周线高档",
        "double_gold": "双金",
        "double_gold_recent": "近期双金",
        "double_dead": "双死",
        "double_dead_recent": "近期双死",
        "bottom_div": "底背离",
        "top_div": "顶背离",
        "trend_long": "站上 60 日线",
        "pullback_zone": "回踩 20 日线企稳",
        "volume_ok": "量能确认",
        "break_5": "跌破 5 线",
        "break_20": "跌破 20 线",
        "break_60": "跌破 60 线",
    }
    return mapping.get(name, name.replace("_", " ").title())


def format_decision_entry_label(entry: Dict[str, Any]) -> str:
    component_label = str(entry.get("component_label") or entry.get("component_id") or "").strip()
    check_label = component_check_label(str(entry.get("check_id") or "").strip().lower())
    if component_label and check_label:
        return f"{component_label}·{check_label}"
    if component_label:
        return component_label
    if check_label:
        return check_label
    return str(entry.get("ref") or "").strip()


def summarize_decision_entries(entries: List[Dict[str, Any]]) -> str:
    labels = [format_decision_entry_label(entry) for entry in entries if format_decision_entry_label(entry)]
    return " + ".join(labels)


def resolve_strategy_decision_state(payload: Dict[str, Any]) -> Optional[Tuple[str, Dict[str, Any]]]:
    details = payload.get("details") if isinstance(payload, dict) else None
    decision = details.get("decision") if isinstance(details, dict) else None
    if not isinstance(decision, dict):
        return None

    side = str(decision.get("active_side") or "").strip().lower()
    signal = str(payload.get("signal") or "").strip().upper()
    if side not in {"buy", "sell"}:
        if signal == "BUY":
            side = "buy"
        elif signal == "SELL":
            side = "sell"
    if side not in {"buy", "sell"}:
        return None

    group = decision.get(side)
    if not isinstance(group, dict):
        return None
    return side, group


def build_strategy_decision_text(payload: Dict[str, Any]) -> str:
    resolved = resolve_strategy_decision_state(payload)
    if not resolved:
        return ""

    side, group = resolved
    title = "卖出组合" if side == "sell" else "买入组合"
    parts: List[str] = []
    if str(group.get("mode") or "").strip().lower() == "cases":
        focus_case = None
        for key in ("active_case", "candidate_case"):
            candidate = group.get(key)
            if isinstance(candidate, dict):
                focus_case = candidate
                break
        case_label = str((focus_case or {}).get("label") or "").strip()
        if case_label:
            case_title = "命中分支" if bool(group.get("triggered")) else "关注分支"
            parts.append(f"{case_title} [{case_label}]")
        action_label = str((focus_case or {}).get("action_label") or group.get("action_label") or "").strip()
        if action_label:
            parts.append(f"动作 [{action_label}]")
    matched_all = list(group.get("matched_all") or []) if isinstance(group, dict) else []
    matched_any = list(group.get("matched_any") or []) if isinstance(group, dict) else []
    missing_all = list(group.get("missing_all") or []) if isinstance(group, dict) else []

    all_entries = list(group.get("all") or []) if isinstance(group, dict) else []
    any_entries = list(group.get("any") or []) if isinstance(group, dict) else []
    if all_entries:
        if bool(group.get("triggered")) or bool(group.get("all_ok")):
            parts.append(f"全部满足 [{summarize_decision_entries(matched_all or all_entries)}]")
        elif missing_all:
            parts.append(f"待补条件 [{summarize_decision_entries(missing_all)}]")
    if any_entries:
        if matched_any:
            parts.append(f"任一命中 [{summarize_decision_entries(matched_any)}]")
        else:
            parts.append(f"候选其一 [{summarize_decision_entries(any_entries)}]")
    return f"{title}：{'；'.join(parts)}" if parts else ""


def unique_webhook_entries(entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    result: List[Dict[str, Any]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        ref = str(entry.get("ref") or f"{entry.get('component_id', '')}.{entry.get('check_id', '')}").strip().lower()
        if not ref or ref in seen:
            continue
        seen.add(ref)
        result.append(entry)
    return result


def build_fallback_webhook_entries(strategy_signal: Dict[str, Any], signal: str) -> List[Dict[str, Any]]:
    side = "sell" if signal == "SELL" else "buy" if signal == "BUY" else ""
    if not side:
        return []
    details = strategy_signal.get("details") if isinstance(strategy_signal, dict) else None
    components = details.get("components") if isinstance(details, dict) else None
    if not isinstance(components, dict):
        return []

    entries: List[Dict[str, Any]] = []
    for component in components.values():
        if not isinstance(component, dict):
            continue
        checks = component.get("checks")
        check = checks.get(side) if isinstance(checks, dict) else None
        if not isinstance(check, dict) or not bool(check.get("ok")):
            continue
        entries.append(
            {
                "ref": f"{component.get('id') or 'main'}.{side}",
                "component_id": str(component.get("id") or "main").strip().lower(),
                "component_label": str(component.get("label") or component.get("id") or "").strip(),
                "timeframe": str(component.get("timeframe") or "--").strip(),
                "check_id": side,
                "matched": True,
                "matched_rules": list(check.get("matched") or []),
                "rules": list(check.get("rules") or []),
                "warnings": list(check.get("warnings") or []),
            }
        )
    return entries


def collect_webhook_decision_entries(strategy_signal: Dict[str, Any], signal: str) -> Dict[str, Any]:
    resolved = resolve_strategy_decision_state(strategy_signal)
    decision_text = build_strategy_decision_text(strategy_signal)
    if not resolved:
        fallback_entries = unique_webhook_entries(build_fallback_webhook_entries(strategy_signal, signal))
        return {
            "side": "sell" if signal == "SELL" else "buy",
            "primary_entries": fallback_entries,
            "supporting_entries": [],
            "all_entries": fallback_entries,
            "decision_text": decision_text,
        }

    side, group = resolved
    matched_all = list(group.get("matched_all") or [])
    matched_any = list(group.get("matched_any") or [])
    primary_entries = unique_webhook_entries(matched_any or matched_all)
    supporting_entries = unique_webhook_entries(matched_all if matched_any else [])
    return {
        "side": side,
        "primary_entries": primary_entries,
        "supporting_entries": supporting_entries,
        "all_entries": unique_webhook_entries(primary_entries + supporting_entries),
        "decision_text": decision_text,
    }


def webhook_rule_priority(entry: Dict[str, Any], signal: str) -> int:
    check_id = str(entry.get("check_id") or "").strip().lower()
    if signal == "SELL":
        weights = {
            "top_div": 130,
            "break_60": 120,
            "break_20": 110,
            "double_dead": 100,
            "double_dead_recent": 100,
            "break_5": 90,
            "high_zone": 85,
            "sell": 80,
            "pass": 50,
            "volume_ok": 60,
        }
    else:
        weights = {
            "bottom_div": 120,
            "double_gold": 110,
            "double_gold_recent": 110,
            "buy": 90,
            "low_zone": 80,
            "pass": 70,
            "volume_ok": 60,
        }
    return int(weights.get(check_id, 10))


def build_webhook_rule_summary(entry: Dict[str, Any], strategy_signal: Dict[str, Any]) -> str:
    check_id = str(entry.get("check_id") or "").strip().lower()
    component_label = str(entry.get("component_label") or entry.get("component_id") or "").strip()
    strategy_id = normalize_strategy_name(
        (strategy_signal.get("strategy") or {}).get("id") or strategy_signal.get("strategy_id") or DEFAULT_STRATEGY
    )
    check_label = component_check_label(check_id)
    if check_id == "buy" and "divergence" in strategy_id:
        return f"{component_label}出现底背离" if component_label else "底背离"
    if check_id == "sell" and "divergence" in strategy_id:
        return f"{component_label}出现顶背离" if component_label else "顶背离"
    if check_id in {"bottom_div", "top_div", "double_gold", "double_dead", "double_gold_recent", "double_dead_recent"}:
        return f"{component_label}出现{check_label}" if component_label else check_label
    return format_decision_entry_label(entry)


def describe_webhook_rule_meta(entry: Optional[Dict[str, Any]], signal: str, strategy_signal: Dict[str, Any]) -> Dict[str, str]:
    check_id = str((entry or {}).get("check_id") or "").strip().lower()
    strategy_id = normalize_strategy_name(
        (strategy_signal.get("strategy") or {}).get("id") or strategy_signal.get("strategy_id") or DEFAULT_STRATEGY
    )
    if check_id == "bottom_div" or (check_id == "buy" and "divergence" in strategy_id):
        return {
            "family_id": "bottom_divergence",
            "family_label": "背离信号",
            "title_label": "底背离",
            "rule_label": "底背离",
            "action_hint": "分批观察，等待反弹确认，不追高。",
        }
    if check_id == "top_div" or (check_id == "sell" and "divergence" in strategy_id):
        return {
            "family_id": "top_divergence",
            "family_label": "背离信号",
            "title_label": "顶背离",
            "rule_label": "顶背离",
            "action_hint": "优先保护利润，观察是否继续转弱。",
        }
    if check_id in {"double_gold", "double_gold_recent"}:
        return {
            "family_id": "double_gold",
            "family_label": "双金双死",
            "title_label": "双金共振",
            "rule_label": component_check_label(check_id),
            "action_hint": "优先关注后续量能和回踩确认，避免追涨。",
        }
    if check_id in {"double_dead", "double_dead_recent"}:
        return {
            "family_id": "double_dead",
            "family_label": "双金双死",
            "title_label": "双死转弱",
            "rule_label": component_check_label(check_id),
            "action_hint": "优先收缩仓位，等待重新企稳。",
        }
    if check_id.startswith("break_"):
        hint_map = {
            "break_5": "短线转弱，先减仓观察。",
            "break_20": "波段转弱，优先减仓。",
            "break_60": "中期走弱，强风险离场。",
        }
        return {
            "family_id": "ma_break",
            "family_label": "均线破位",
            "title_label": component_check_label(check_id),
            "rule_label": component_check_label(check_id),
            "action_hint": hint_map.get(check_id, "均线破位，注意风险控制。"),
        }
    if check_id == "volume_ok":
        return {
            "family_id": "volume_confirm",
            "family_label": "量价确认",
            "title_label": "量能确认",
            "rule_label": component_check_label(check_id),
            "action_hint": "量价配合有效，仍需等待买点共振。",
        }
    if check_id == "pass":
        return {
            "family_id": "trend_filter",
            "family_label": "趋势过滤",
            "title_label": "趋势转弱" if signal == "SELL" else "多周期共振",
            "rule_label": component_check_label(check_id),
            "action_hint": "大周期条件已对齐，继续观察后续确认信号。",
        }
    if check_id in {"low_zone", "high_zone", "trend_long", "pullback_zone"}:
        return {
            "family_id": "stage_filter",
            "family_label": "阶段过滤",
            "title_label": component_check_label(check_id),
            "rule_label": component_check_label(check_id),
            "action_hint": "这类条件主要用于区分当前所处阶段，最好结合双金双死或背离一起看。",
        }
    if check_id == "buy":
        return {
            "family_id": "buy_signal",
            "family_label": "策略买点",
            "title_label": "策略买点",
            "rule_label": component_check_label(check_id),
            "action_hint": "可结合仓位计划分批执行。",
        }
    if check_id == "sell":
        return {
            "family_id": "sell_signal",
            "family_label": "策略卖点",
            "title_label": "策略卖点",
            "rule_label": component_check_label(check_id),
            "action_hint": "结合持仓和风险偏好，优先执行风控。",
        }
    return {
        "family_id": "sell_signal" if signal == "SELL" else "buy_signal",
        "family_label": "策略信号",
        "title_label": "策略卖点" if signal == "SELL" else "策略买点",
        "rule_label": component_check_label(check_id),
        "action_hint": "该信号已触发，请结合仓位与风险计划执行。",
    }


def build_runtime_webhook_payload(
    quote_payload: Dict[str, Any],
    strategy_signal: Dict[str, Any],
) -> Dict[str, Any]:
    signal = str(strategy_signal.get("signal") or "").strip().upper()
    symbol = str(strategy_signal.get("symbol") or quote_payload.get("symbol") or "").strip().lower()
    decision_state = collect_webhook_decision_entries(strategy_signal, signal)
    primary_entries = sorted(
        list(decision_state.get("primary_entries") or []),
        key=lambda entry: webhook_rule_priority(entry, signal),
        reverse=True,
    )
    all_entries = list(decision_state.get("all_entries") or [])
    primary_entry = primary_entries[0] if primary_entries else (all_entries[0] if all_entries else None)
    primary_ref = str((primary_entry or {}).get("ref") or "").strip()
    secondary_entries = [
        entry
        for entry in unique_webhook_entries(primary_entries[1:] + list(decision_state.get("supporting_entries") or []))
        if str(entry.get("ref") or "").strip() != primary_ref
    ]
    meta = describe_webhook_rule_meta(primary_entry, signal, strategy_signal)
    reason_summary = (
        build_webhook_rule_summary(primary_entry, strategy_signal)
        if primary_entry
        else str(strategy_signal.get("reason") or f"{signal} 信号已触发").strip()
    )
    reason_details = [
        build_webhook_rule_summary(entry, strategy_signal)
        for entry in unique_webhook_entries(all_entries)
        if build_webhook_rule_summary(entry, strategy_signal)
    ]
    supporting_reasons: List[str] = []
    seen_support: set[str] = set()
    for entry in secondary_entries:
        summary = build_webhook_rule_summary(entry, strategy_signal)
        if not summary or summary in seen_support:
            continue
        seen_support.add(summary)
        supporting_reasons.append(summary)
        if len(supporting_reasons) >= 4:
            break

    source_info = quote_payload.get("source") if isinstance(quote_payload.get("source"), dict) else {}
    signal_action = str(strategy_signal.get("action") or signal.lower()).strip().lower() or signal.lower()
    action_label = str(strategy_signal.get("action_label") or action_label_for_value(signal_action, signal)).strip()
    payload = {
        "event": "signal_state_change",
        "category": "signal",
        "signal": signal,
        "signal_type": signal.lower(),
        "signal_action": signal_action,
        "action": signal_action,
        "action_label": action_label,
        "symbol": symbol,
        "name": str(strategy_signal.get("name") or quote_payload.get("name") or symbol.upper()).strip(),
        "strategy": (strategy_signal.get("strategy") or {}).get("id") or DEFAULT_STRATEGY,
        "strategy_label": (strategy_signal.get("strategy") or {}).get("label") or DEFAULT_STRATEGY,
        "price": quote_payload.get("last_price"),
        "change": quote_payload.get("change"),
        "change_pct": quote_payload.get("change_pct"),
        "reason": str(strategy_signal.get("reason") or "").strip(),
        "priority": copy.deepcopy(strategy_signal.get("priority") or {}),
        "timestamp": strategy_signal.get("timestamp") or quote_payload.get("timestamp") or iso_now(),
        "source": source_info.get("actual") or quote_payload.get("source"),
        "source_label": source_info.get("actual_label") or quote_payload.get("source_label"),
        "rule_family": meta["family_id"],
        "rule_family_label": meta["family_label"],
        "rule_name": primary_ref or meta["family_id"],
        "rule_label": meta["rule_label"],
        "rule_names": [str(entry.get("ref") or "").strip() for entry in unique_webhook_entries(all_entries) if str(entry.get("ref") or "").strip()],
        "reason_summary": reason_summary,
        "reason_details": reason_details,
        "supporting_reasons": supporting_reasons,
        "decision_text": str(decision_state.get("decision_text") or "").strip(),
        "message_title": f"{'卖出' if signal == 'SELL' else '买入'} | {action_label or meta['title_label']}",
        "action_hint": meta["action_hint"],
    }
    return payload


def build_strategy_components_payload(strategy: Dict[str, Any]) -> List[Dict[str, Any]]:
    mode = str(strategy.get("mode") or "simple").strip().lower()
    if mode != "composite":
        checks: List[Dict[str, Any]] = []
        buy_rules = list(strategy.get("buy_rules") or [])
        sell_rules = list(strategy.get("sell_rules") or [])
        if buy_rules:
            checks.append({"id": "buy", "label": component_check_label("buy"), "rules": buy_rules})
        if sell_rules:
            checks.append({"id": "sell", "label": component_check_label("sell"), "rules": sell_rules})
        return [
            {
                "id": str(strategy.get("primary_component") or "main").strip().lower() or "main",
                "label": strategy.get("label") or strategy.get("id") or "Strategy",
                "timeframe": strategy.get("timeframe") or "--",
                "checks": checks,
            }
        ]

    components: List[Dict[str, Any]] = []
    for component in strategy.get("components") or []:
        raw_checks = component.get("checks") or {}
        checks = [
            {
                "id": str(check_id).strip().lower(),
                "label": component_check_label(str(check_id).strip().lower()),
                "rules": [str(rule).strip() for rule in rules if str(rule).strip()],
            }
            for check_id, rules in raw_checks.items()
        ]
        components.append(
            {
                "id": str(component.get("id") or "").strip().lower(),
                "label": component.get("label") or component.get("id") or "Component",
                "timeframe": component.get("timeframe") or "--",
                "checks": checks,
            }
        )
    return components


def strategy_health_status_label(status: str) -> str:
    mapping = {
        "ok": "正常",
        "warn": "警告",
        "insufficient": "缺失",
        "error": "错误",
        "pending": "等待",
    }
    return mapping.get(str(status or "").strip().lower(), "未知")


def _collect_component_check_warnings(component_result: Dict[str, Any]) -> List[str]:
    warnings: List[str] = []
    for check in (component_result.get("checks") or {}).values():
        for warning in check.get("warnings") or []:
            text = str(warning or "").strip()
            if text and text not in warnings:
                warnings.append(text)
    return warnings


def build_strategy_health_payload(
    symbol: str,
    strategy: Dict[str, Any],
    requested_source: str,
    component_results: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    entries: List[Dict[str, Any]] = []
    component_results = component_results or {}

    for component in strategy.get("components") or []:
        component_id = str(component.get("id") or "").strip().lower()
        label = str(component.get("label") or component_id or "组件").strip() or "组件"
        timeframe = str(component.get("timeframe") or "--").strip() or "--"
        min_bars = max(35, int(component.get("min_bars") or 60))
        lookback_bars = max(int(component.get("lookback_bars") or 160), min_bars)
        result = component_results.get(component_id) or {}
        warnings = _collect_component_check_warnings(result)

        entry: Dict[str, Any] = {
            "id": component_id,
            "label": label,
            "timeframe": timeframe,
            "requested_source": requested_source,
            "requested_source_label": source_label(requested_source),
            "actual_source": str(result.get("actual_source") or requested_source).strip() or requested_source,
            "actual_source_label": source_label(str(result.get("actual_source") or requested_source).strip() or requested_source),
            "status": "pending",
            "status_label": strategy_health_status_label("pending"),
            "message": "",
            "timestamp": result.get("timestamp"),
            "bars": int(result.get("bar_count") or 0),
            "min_bars": int(result.get("min_bars") or min_bars),
            "warnings": warnings,
        }

        if result:
            entry["status"] = "warn" if warnings else "ok"
            entry["status_label"] = strategy_health_status_label(entry["status"])
            entry["message"] = warnings[0] if warnings else "数据正常"
            entries.append(entry)
            continue

        try:
            _, bars, actual_source = fetch_strategy_bars_with_source(symbol, timeframe, lookback_bars, requested_source)
            entry["actual_source"] = actual_source
            entry["actual_source_label"] = source_label(actual_source)
            entry["bars"] = len(bars)
            entry["timestamp"] = bars[-1].timestamp if bars else None
            if len(bars) < min_bars:
                entry["status"] = "insufficient"
                entry["message"] = f"数据不足 {len(bars)}/{min_bars}"
            else:
                entry["status"] = "ok"
                entry["message"] = "数据正常"
        except Exception as exc:  # noqa: BLE001
            entry["status"] = "error"
            entry["message"] = str(exc)

        entry["status_label"] = strategy_health_status_label(str(entry.get("status") or "pending"))
        entries.append(entry)

    degraded_count = sum(1 for entry in entries if entry.get("status") in {"insufficient", "error"})
    warning_count = sum(1 for entry in entries if entry.get("status") == "warn")
    healthy_count = sum(1 for entry in entries if entry.get("status") == "ok")

    summary_status = "ok"
    summary_message = "当前策略周期数据正常"
    if not entries:
        summary_status = "pending"
        summary_message = "等待策略刷新"
    elif degraded_count > 0:
        summary_status = "error"
        summary_message = f"{degraded_count} 个周期缺失或异常，当前规则预判可能失真"
    elif warning_count > 0:
        summary_status = "warn"
        summary_message = f"{warning_count} 个周期存在规则告警，建议结合盘面复核"

    return {
        "status": summary_status,
        "status_label": strategy_health_status_label(summary_status),
        "summary": summary_message,
        "is_reliable": degraded_count == 0 and bool(entries),
        "counts": {
            "total": len(entries),
            "healthy": healthy_count,
            "warn": warning_count,
            "degraded": degraded_count,
        },
        "items": entries,
    }


def build_rules_payload(strategy_name: str = DEFAULT_STRATEGY) -> Dict[str, Any]:
    config = load_runtime_config()
    strategy_id = normalize_strategy_name(strategy_name)
    strategy = get_strategy_preset(strategy_id)
    overridden_ids = set(load_strategy_overrides().keys())
    strategy_record = build_client_strategy_record(strategy, overridden_ids)
    return {
        "strategy": strategy_record,
        "timeframe": strategy.get("timeframe") or "--",
        "adjust": config.get("adjust", DEFAULT_ADJUST),
        "indicators": list(strategy.get("indicators") or []),
        "buy_rules": list(strategy.get("buy_rules") or []),
        "sell_rules": list(strategy.get("sell_rules") or []),
        "notes": list(strategy.get("notes") or []),
        "components": build_strategy_components_payload(strategy),
        "config": sanitize_strategy_record(strategy),
        "config_meta": {
            "editable": bool(strategy_record.get("editable")),
            "is_overridden": bool(strategy_record.get("is_overridden")),
            "source": "override" if strategy_record.get("is_overridden") else "builtin",
        },
    }


def normalize_strategy_name(raw: str) -> str:
    strategy = str(raw or DEFAULT_STRATEGY).strip().lower()
    if strategy in all_strategy_presets():
        return strategy
    raise MarketDataError(f"未知策略: {raw}")


def build_strategy_list_payload() -> Dict[str, Any]:
    strategies = all_strategy_presets()
    overridden_ids = set(load_strategy_overrides().keys())
    return {
        "default": DEFAULT_STRATEGY,
        "strategies": [build_client_strategy_record(item, overridden_ids) for item in strategies.values()],
        "notes": [
            "策略信号独立于主图周期，按各自规则的固定周期计算。",
            "刘昌松策略的本地修改会保存到 strategy_overrides.json。",
        ],
    }


def last_valid_value(values: List[Optional[float]]) -> Optional[float]:
    for value in reversed(values):
        if value is None:
            continue
        return float(value)
    return None


def build_strategy_signal_payload(
    symbol: str,
    strategy_name: str,
    source: str,
) -> Dict[str, Any]:
    strategy_id = normalize_strategy_name(strategy_name)
    strategy = get_strategy_preset(strategy_id)
    overridden_ids = set(load_strategy_overrides().keys())
    strategy_record = build_client_strategy_record(strategy, overridden_ids)

    if strategy_id == "none":
        return {
            "symbol": symbol,
            "strategy": strategy_record,
            "signal": "OFF",
            "triggered": False,
            "timestamp": None,
            "source": build_source_info(source, source),
            "priority": {"score": None, "label": "--"},
            "indicators": {},
            "reason": "策略已关闭",
            "alert_key": None,
        }

    requested_source = normalize_source_name(source)
    if strategy.get("engine") == "advanced":
        component_cache: Dict[Tuple[str, int], Tuple[str, List[Bar], str]] = {}

        def fetch_for_strategy(timeframe: str, max_bars: int) -> Tuple[str, List[Bar], str]:
            cache_key = (timeframe, max_bars)
            cached = component_cache.get(cache_key)
            if cached:
                return cached
            payload = fetch_strategy_bars_with_source(symbol, timeframe, max_bars, requested_source)
            component_cache[cache_key] = payload
            return payload

        payload = evaluate_strategy_record(symbol, strategy, requested_source, fetch_for_strategy)
        actual_source = str(payload.pop("actual_source") or requested_source)
        payload["strategy"] = strategy_record
        payload["source"] = build_source_info(requested_source, actual_source)
        return payload

    if strategy_id != "rule1" and strategy.get("type") != "custom":
        raise MarketDataError(f"暂不支持策略: {strategy_name}")

    timeframe = strategy["timeframe"] or "5m"
    name, bars, actual_source = fetch_bars_with_source_cached(
        symbol,
        timeframe,
        120,
        "none",
        requested_source,
        STRATEGY_SIGNAL_CACHE_TTL,
    )
    if len(bars) < 35:
        raise MarketDataError(f"{symbol} 的 {timeframe} 数据不足，无法计算策略")

    closes = [bar.close for bar in bars]
    highs = [bar.high for bar in bars]
    lows = [bar.low for bar in bars]
    dif_series, dea_series, _ = macd(closes)
    k_series, d_series, j_series = calc_kdj(highs, lows, closes)

    dif = last_valid_value(dif_series)
    dea = last_valid_value(dea_series)
    k_value = last_valid_value(k_series)
    d_value = last_valid_value(d_series)
    j_value = last_valid_value(j_series)
    if None in (dif, dea, k_value, d_value, j_value):
        raise MarketDataError(f"{symbol} 的策略指标计算失败")

    latest = bars[-1]
    values: Dict[str, Optional[float]] = {
        "DIF": dif,
        "DEA": dea,
        "K": k_value,
        "D": d_value,
        "J": j_value,
        "OPEN": latest.open,
        "HIGH": latest.high,
        "LOW": latest.low,
        "CLOSE": latest.close,
        "VOLUME": latest.volume,
        "AMOUNT": latest.amount,
    }

    if strategy.get("type") == "custom":
        buy_rule = str(strategy.get("buy_rule") or "")
        sell_rule = str(strategy.get("sell_rule") or "")
        buy_hit = evaluate_custom_condition(buy_rule, values)
        sell_hit = evaluate_custom_condition(sell_rule, values)
        buy_reason = f"{timeframe} {buy_rule}"
        sell_reason = f"{timeframe} {sell_rule}"
        hold_reason = f"{timeframe} 自定义规则未命中"
    else:
        buy_hit = bool(dif > dea and k_value > d_value)
        sell_hit = bool(dif < dea and k_value < d_value)
        buy_reason = "5m DIF>DEA 且 K>D"
        sell_reason = "5m DIF<DEA 且 K<D"
        hold_reason = "5m MACD / KDJ 未同时满足同向条件"

    if buy_hit and not sell_hit:
        signal = "BUY"
        priority_score = float(j_value)
        priority_label = "高" if j_value >= 80 else "中" if j_value >= 50 else "低"
        reason = buy_reason
    elif sell_hit and not buy_hit:
        signal = "SELL"
        priority_score = float(100 - j_value)
        priority_label = "高" if j_value <= 20 else "中" if j_value <= 50 else "低"
        reason = sell_reason
    elif buy_hit and sell_hit:
        signal = "HOLD"
        priority_score = None
        priority_label = "--"
        reason = f"{timeframe} 买入和卖出条件同时命中，保持观望"
    else:
        signal = "HOLD"
        priority_score = None
        priority_label = "--"
        reason = hold_reason

    timestamp = bars[-1].timestamp
    component_id = str(strategy.get("primary_component") or "main").strip().lower() or "main"
    return {
        "symbol": symbol,
        "name": name,
        "strategy": strategy,
        "signal": signal,
        "triggered": signal in {"BUY", "SELL"},
        "timestamp": timestamp,
        "source": build_source_info(requested_source, actual_source),
        "priority": {
            "score": round_optional(priority_score, 2),
            "label": priority_label,
        },
        "indicators": {
            "dif": round_optional(dif, 4),
            "dea": round_optional(dea, 4),
            "k": round_optional(k_value, 2),
            "d": round_optional(d_value, 2),
            "j": round_optional(j_value, 2),
        },
        "reason": reason,
        "details": {
            "components": {
                component_id: {
                    "id": component_id,
                    "label": strategy.get("label") or strategy.get("id") or "Strategy",
                    "timeframe": timeframe,
                    "name": name,
                    "timestamp": timestamp,
                    "actual_source": actual_source,
                    "checks": {
                        "buy": {
                            "ok": buy_hit,
                            "rules": [buy_reason] if buy_reason else [],
                            "matched": [buy_reason] if buy_hit and buy_reason else [],
                            "warnings": [],
                        },
                        "sell": {
                            "ok": sell_hit,
                            "rules": [sell_reason] if sell_reason else [],
                            "matched": [sell_reason] if sell_hit and sell_reason else [],
                            "warnings": [],
                        },
                    },
                    "indicator_payload": {
                        "dif": round_optional(dif, 4),
                        "dea": round_optional(dea, 4),
                        "k": round_optional(k_value, 2),
                        "d": round_optional(d_value, 2),
                        "j": round_optional(j_value, 2),
                    },
                }
            }
        },
        "alert_key": f"{strategy_id}:{symbol}:{signal}:{timestamp}",
    }


def build_strategy_signal_payload(
    symbol: str,
    strategy_name: str,
    source: str,
) -> Dict[str, Any]:
    strategy_id = normalize_strategy_name(strategy_name)
    strategy = get_strategy_preset(strategy_id)
    overridden_ids = set(load_strategy_overrides().keys())
    strategy_record = build_client_strategy_record(strategy, overridden_ids)

    if strategy_id == "none":
        return {
            "symbol": symbol,
            "strategy": strategy_record,
            "signal": "OFF",
            "triggered": False,
            "timestamp": None,
            "source": build_source_info(source, source),
            "priority": {"score": None, "label": "--"},
            "indicators": {},
            "reason": "当前策略已关闭。",
            "details": {
                "health": {
                    "status": "pending",
                    "status_label": strategy_health_status_label("pending"),
                    "summary": "当前策略已关闭",
                    "is_reliable": False,
                    "counts": {"total": 0, "healthy": 0, "warn": 0, "degraded": 0},
                    "items": [],
                }
            },
            "alert_key": None,
        }

    requested_source = normalize_source_name(source)
    if strategy.get("engine") != "advanced":
        raise MarketDataError("旧版 5m 兼容策略已移除，请改用刘昌松配置化策略。")

    component_cache: Dict[Tuple[str, int], Tuple[str, List[Bar], str]] = {}

    def fetch_for_strategy(timeframe: str, max_bars: int) -> Tuple[str, List[Bar], str]:
        cache_key = (timeframe, max_bars)
        cached = component_cache.get(cache_key)
        if cached:
            return cached
        payload = fetch_strategy_bars_with_source(symbol, timeframe, max_bars, requested_source)
        component_cache[cache_key] = payload
        return payload

    try:
        payload = evaluate_strategy_record(symbol, strategy, requested_source, fetch_for_strategy)
    except MarketDataError as exc:
        message = str(exc)
        health_payload = build_strategy_health_payload(symbol, strategy, requested_source)
        warning_type = "insufficient_bars" if "Not enough bars for" in message else "data_error"
        reason = (
            f"数据不足，暂不触发：{message}"
            if warning_type == "insufficient_bars"
            else f"策略数据异常，暂不触发：{message}"
        )
        return {
            "symbol": symbol,
            "strategy": strategy_record,
            "signal": "HOLD",
            "triggered": False,
            "timestamp": None,
            "source": build_source_info(requested_source, requested_source),
            "priority": {"score": None, "label": "--"},
            "indicators": {},
            "reason": reason,
            "details": {
                "warning_type": warning_type,
                "warning_message": message,
                "components": {},
                "health": health_payload,
            },
            "alert_key": None,
        }
    actual_source = str(payload.pop("actual_source") or requested_source)
    details = payload.get("details") if isinstance(payload.get("details"), dict) else {}
    component_results = details.get("components") if isinstance(details.get("components"), dict) else {}
    details["health"] = build_strategy_health_payload(symbol, strategy, requested_source, component_results)
    payload["details"] = details
    payload["strategy"] = strategy_record
    payload["source"] = build_source_info(requested_source, actual_source)
    return payload


def normalize_query_symbol(raw: str) -> Optional[str]:
    return normalize_query_symbol_value(raw)


def warm_search_cache() -> None:
    search_service.warm_cache()


def search_securities(query: str, limit: int = 12) -> List[Dict[str, Any]]:
    return search_service.search(query, limit=limit)


def resolve_symbol(raw: str) -> str:
    return search_service.resolve_symbol(raw)


def normalize_import_query(raw: Any) -> str:
    return normalize_import_query_value(raw)


def resolve_watchlist_import_item(raw_item: Dict[str, Any]) -> Dict[str, Any]:
    query = normalize_import_query(
        raw_item.get("raw")
        or raw_item.get("symbol")
        or raw_item.get("code")
        or raw_item.get("name")
    )
    if not query:
        raise MarketDataError("Missing security code")

    provided_name = str(raw_item.get("name") or "").strip()
    search_match: Optional[Dict[str, Any]] = None

    try:
        search_results = search_securities(query, limit=6)
    except Exception:
        search_results = []

    if search_results:
        normalized_query = normalize_query_symbol(query)
        if normalized_query:
            search_match = next(
                (item for item in search_results if str(item.get("symbol") or "").lower() == normalized_query),
                None,
            )
        elif re.fullmatch(r"\d{6}", query):
            search_match = next(
                (item for item in search_results if str(item.get("code") or "").strip() == query),
                None,
            )
        if search_match is None:
            search_match = search_results[0]

    if search_match:
        symbol = str(search_match.get("symbol") or "").lower()
        name = provided_name or str(search_match.get("name") or "").strip()
        security_type = str(search_match.get("security_type") or "").strip()
    else:
        symbol = resolve_symbol(query)
        name = provided_name
        security_type = ""

    if not name:
        try:
            snapshot = client.fetch_snapshot(symbol, source=normalize_source_name(DEFAULT_SOURCE))
            name = snapshot.name or symbol.upper()
        except Exception:
            name = symbol.upper()

    return {
        "query": query,
        "symbol": symbol,
        "code": symbol[2:] if len(symbol) > 2 else symbol,
        "name": name,
        "security_type": security_type,
    }


def load_signal_summary(
    symbol: str,
    timeframe: str,
    adjust: str,
    history_bars: int,
    source: str,
) -> Dict[str, Any]:
    config = build_signal_config(timeframe, adjust, history_bars, source)
    result = SignalEngine(config).run([symbol])[0]
    return {
        "signal": result.signal,
        "buy_hits": result.buy_hits,
        "buy_total": result.buy_total,
        "sell_hits": result.sell_hits,
        "sell_total": result.sell_total,
        "buy_matched": result.buy_matched,
        "sell_matched": result.sell_matched,
        "warnings": result.warnings,
    }


def build_signal_config(
    timeframe: str,
    adjust: str,
    history_bars: int,
    source: str,
) -> Dict[str, Any]:
    config = load_runtime_config()
    config["timeframe"] = timeframe
    config["adjust"] = adjust
    config["data_source"] = source
    config["history_bars"] = max(int(config.get("history_bars", 250)), history_bars)
    return config


def build_signal_summary_from_bars(bars: List[Any], config: Dict[str, Any]) -> Dict[str, Any]:
    if len(bars) < 3:
        raise MarketDataError("Not enough bars to evaluate signal rules")

    warnings: List[str] = []
    series = {
        "open": [bar.open for bar in bars],
        "close": [bar.close for bar in bars],
        "high": [bar.high for bar in bars],
        "low": [bar.low for bar in bars],
        "volume": [bar.volume for bar in bars],
        "amount": [bar.amount for bar in bars],
    }

    engine = SignalEngine(config)
    context = engine._build_context(series, warnings)
    rule_context = engine._build_rule_context(context)

    buy_rules = list(config.get("rules", {}).get("buy", []))
    sell_rules = list(config.get("rules", {}).get("sell", []))

    buy_matched, buy_warnings = engine._evaluate_rules(buy_rules, rule_context, side="buy")
    sell_matched, sell_warnings = engine._evaluate_rules(sell_rules, rule_context, side="sell")
    warnings.extend(buy_warnings)
    warnings.extend(sell_warnings)

    all_buy = bool(buy_rules) and len(buy_matched) == len(buy_rules)
    all_sell = bool(sell_rules) and len(sell_matched) == len(sell_rules)

    if all_buy and not all_sell:
        signal = "BUY"
    elif all_sell and not all_buy:
        signal = "SELL"
    elif all_buy and all_sell:
        signal = "CONFLICT"
    else:
        signal = "HOLD"

    return {
        "signal": signal,
        "buy_hits": len(buy_matched),
        "buy_total": len(buy_rules),
        "sell_hits": len(sell_matched),
        "sell_total": len(sell_rules),
        "buy_matched": buy_matched,
        "sell_matched": sell_matched,
        "warnings": warnings,
    }


def build_chart_payload(
    symbol: str,
    timeframe: str,
    adjust: str,
    history_bars: int,
    source: str,
) -> Dict[str, Any]:
    requested_source = normalize_source_name(source)
    name, bars, actual_source = fetch_chart_bars_with_source(
        symbol,
        timeframe,
        history_bars,
        adjust,
        requested_source,
    )
    timestamps = [bar.timestamp for bar in bars]
    closes = [bar.close for bar in bars]
    highs = [bar.high for bar in bars]
    lows = [bar.low for bar in bars]
    volumes = [bar.volume for bar in bars]
    amounts = [bar.amount for bar in bars]

    macd_line, signal_line, hist_line = macd(closes)
    k_line, d_line, j_line = calc_kdj(highs, lows, closes)
    ma5 = sma(closes, 5)
    ma20 = sma(closes, 20)
    divergence_annotations = build_divergence_annotations(timeframe, timestamps, closes, highs, lows, macd_line)

    previous_close = closes[-2] if len(closes) >= 2 else closes[-1]
    change = closes[-1] - previous_close
    change_pct = (change / previous_close * 100.0) if previous_close else 0.0

    try:
        snapshot = fetch_snapshot_cached(symbol, actual_source, ttl=SNAPSHOT_CACHE_TTL)
    except MarketDataError:
        snapshot = build_snapshot_from_bars(symbol, name, bars, actual_source)

    signal_config = build_signal_config(timeframe, adjust, history_bars, actual_source)
    signal_summary = build_signal_summary_from_bars(bars, signal_config)

    return {
        "symbol": symbol,
        "name": name,
        "timeframe": timeframe,
        "adjust": adjust,
        "source": build_source_info(requested_source, actual_source),
        "last_timestamp": timestamps[-1],
        "last_price": round(closes[-1], 3),
        "change": round(change, 4),
        "change_pct": round(change_pct, 4),
        "market": serialize_snapshot(snapshot, fallback_timestamp=timestamps[-1]),
        "signal": signal_summary,
        "chart": {
            "timestamps": timestamps,
            "candles": [
                [round(bar.open, 4), round(bar.close, 4), round(bar.low, 4), round(bar.high, 4)]
                for bar in bars
            ],
            "volumes": [round(value, 2) for value in volumes],
            "amounts": [round(value, 2) for value in amounts],
        },
        "indicators": {
            "ma5": round_series(ma5),
            "ma20": round_series(ma20),
            "macd": {
                "dif": round_series(macd_line),
                "dea": round_series(signal_line),
                "hist": round_series(hist_line),
            },
            "kdj": {
                "k": round_series(k_line),
                "d": round_series(d_line),
                "j": round_series(j_line),
            },
        },
        "annotations": {
            "divergences": divergence_annotations,
        },
    }


@app.get("/")
def index() -> str:
    return render_template(
        "index.html",
        default_symbol=DEFAULT_SYMBOL,
        default_timeframe=DEFAULT_TIMEFRAME,
        default_source=DEFAULT_SOURCE,
        default_strategy=DEFAULT_STRATEGY,
    )


@app.get("/api/health")
def health() -> Any:
    with RESPONSE_CACHE_LOCK:
        cache_entries = len(RESPONSE_CACHE)
    return jsonify(
        {
            "status": "ok",
            "app": APP_RUNTIME_ID,
            "app_label": APP_RUNTIME_LABEL,
            "cache_entries": cache_entries,
            "source_health": SOURCE_HEALTH_TRACKER.snapshot(),
        }
    )


@app.get("/api/sources")
def api_sources() -> Any:
    sources = []
    for key, item in SOURCE_METADATA.items():
        sources.append(
            {
                "value": key,
                "label": item["label"],
                "description": item["description"],
                "supports_bars": item["supports_bars"],
                "supports_snapshot": item["supports_snapshot"],
            }
        )
    return jsonify({"default": DEFAULT_SOURCE, "sources": sources})


@app.get("/api/rules")
def api_rules() -> Any:
    strategy = request.args.get("strategy", DEFAULT_STRATEGY)
    try:
        return jsonify(build_rules_payload(strategy))
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400


@app.get("/api/strategies")
def api_strategies() -> Any:
    return jsonify(build_strategy_list_payload())


@app.post("/api/custom-strategy")
def api_custom_strategy() -> Any:
    try:
        payload = request.get_json(silent=True) or {}
        strategy = parse_custom_strategy_rule(str(payload.get("rule") or ""))
        with CUSTOM_STRATEGY_LOCK:
            strategies = load_custom_strategies()
            strategies[strategy["id"]] = strategy
            save_custom_strategies(strategies)
        clear_response_cache("strategy")
        return jsonify(
            {
                "strategy": strategy,
                "strategies": build_strategy_list_payload()["strategies"],
                "rules": build_rules_payload(strategy["id"]),
            }
        )
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.delete("/api/custom-strategy/<strategy_id>")
def api_delete_custom_strategy(strategy_id: str) -> Any:
    strategy_id = str(strategy_id or "").strip().lower()
    if strategy_id == "none":
        return jsonify({"error": "不启用不能删除"}), 400
    try:
        with CUSTOM_STRATEGY_LOCK:
            strategies = load_custom_strategies()
            deleted = load_deleted_strategy_ids()
            if strategy_id in strategies:
                removed = strategies.pop(strategy_id)
            elif strategy_id in STRATEGY_PRESETS:
                removed = copy.deepcopy(STRATEGY_PRESETS[strategy_id])
                deleted.add(strategy_id)
            else:
                return jsonify({"error": "规则不存在"}), 404
            save_strategy_store(strategies, deleted)
        clear_response_cache("strategy")
        return jsonify(
            {
                "ok": True,
                "removed": removed,
                "default": DEFAULT_STRATEGY,
                "strategies": build_strategy_list_payload()["strategies"],
                "rules": build_rules_payload(DEFAULT_STRATEGY),
            }
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


def deprecated_custom_strategy() -> Any:
    return jsonify({"error": "旧版字符串策略录入已移除，请使用策略配置编辑器。"}), 410


def deprecated_delete_custom_strategy(strategy_id: str) -> Any:
    return jsonify({"error": "旧版字符串策略删除已移除，请使用策略配置恢复默认。"}), 410


app.view_functions["api_custom_strategy"] = deprecated_custom_strategy
app.view_functions["api_delete_custom_strategy"] = deprecated_delete_custom_strategy


@app.put("/api/strategy-config/<strategy_id>")
def api_strategy_config_update(strategy_id: str) -> Any:
    strategy_id = str(strategy_id or "").strip().lower()
    try:
        builtin = load_builtin_strategy_presets()
        if strategy_id not in builtin:
            raise MarketDataError(f"未知策略: {strategy_id}")
        if strategy_id == "none":
            raise MarketDataError("关闭策略不可编辑")

        payload = request.get_json(silent=True) or {}
        raw_config = payload.get("config") if isinstance(payload, dict) and "config" in payload else payload
        if not isinstance(raw_config, dict):
            raise MarketDataError("策略配置必须是 JSON 对象")

        strategy = normalize_strategy_record(sanitize_strategy_record({**raw_config, "id": strategy_id}))
        with STRATEGY_CONFIG_LOCK:
            overrides = load_strategy_overrides(builtin)
            overrides[strategy_id] = strategy
            save_strategy_overrides(overrides)

        clear_response_cache("strategy")
        rules = build_rules_payload(strategy_id)
        strategies = build_strategy_list_payload()["strategies"]
        return jsonify(
            {
                "ok": True,
                "strategy": rules["strategy"],
                "strategies": strategies,
                "rules": rules,
            }
        )
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.delete("/api/strategy-config/<strategy_id>")
def api_strategy_config_reset(strategy_id: str) -> Any:
    strategy_id = str(strategy_id or "").strip().lower()
    try:
        builtin = load_builtin_strategy_presets()
        if strategy_id not in builtin:
            raise MarketDataError(f"未知策略: {strategy_id}")
        if strategy_id == "none":
            raise MarketDataError("关闭策略不可重置")

        with STRATEGY_CONFIG_LOCK:
            overrides = load_strategy_overrides(builtin)
            overrides.pop(strategy_id, None)
            save_strategy_overrides(overrides)

        clear_response_cache("strategy")
        rules = build_rules_payload(strategy_id)
        strategies = build_strategy_list_payload()["strategies"]
        return jsonify(
            {
                "ok": True,
                "strategy": rules["strategy"],
                "strategies": strategies,
                "rules": rules,
            }
        )
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.get("/api/search")
def api_search() -> Any:
    query = request.args.get("q", "").strip()
    try:
        return jsonify({"results": search_securities(query)})
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc), "results": []}), 400


@app.post("/api/watchlist-import")
def api_watchlist_import() -> Any:
    try:
        payload = request.get_json(silent=True) or {}
        raw_items = payload.get("items") or []
        if not isinstance(raw_items, list):
            raise MarketDataError("items must be a list")

        ordered_requests: List[Dict[str, Any]] = []
        seen_queries: set[str] = set()
        for raw_item in raw_items[:200]:
            item = raw_item if isinstance(raw_item, dict) else {"raw": raw_item}
            query = normalize_import_query(
                item.get("raw")
                or item.get("symbol")
                or item.get("code")
                or item.get("name")
            )
            if not query:
                continue
            lowered = query.lower()
            if lowered in seen_queries:
                continue
            seen_queries.add(lowered)
            ordered_requests.append(
                {
                    "raw": query,
                    "name": str(item.get("name") or "").strip(),
                }
            )

        if not ordered_requests:
            return jsonify({"items": [], "errors": [], "summary": {"total": 0, "resolved": 0, "failed": 0}})

        def resolve_one(item: Dict[str, Any]) -> Dict[str, Any]:
            result = resolve_watchlist_import_item(item)
            result["requested_query"] = str(item.get("raw") or "").lower()
            return result

        items: List[Dict[str, Any]] = []
        errors: List[Dict[str, str]] = []
        max_workers = min(6, len(ordered_requests)) or 1
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_map = {executor.submit(resolve_one, item): item for item in ordered_requests}
            for future in as_completed(future_map):
                item = future_map[future]
                try:
                    items.append(future.result())
                except Exception as exc:  # noqa: BLE001
                    errors.append({"query": str(item.get("raw") or ""), "error": str(exc)})

        order_index = {
            str(item.get("raw") or "").lower(): index for index, item in enumerate(ordered_requests)
        }
        items.sort(key=lambda item: order_index.get(str(item.get("requested_query") or ""), len(order_index)))
        for item in items:
            item.pop("requested_query", None)
        errors.sort(key=lambda item: order_index.get(str(item.get("query") or "").lower(), len(order_index)))
        return jsonify(
            {
                "items": items,
                "errors": errors,
                "summary": {
                    "total": len(ordered_requests),
                    "resolved": len(items),
                    "failed": len(errors),
                },
            }
        )
    except MarketDataError as exc:
        return jsonify({"error": str(exc), "items": [], "errors": []}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc), "items": [], "errors": []}), 500


@app.get("/api/chart")
def api_chart() -> Any:
    raw_symbol = request.args.get("symbol", DEFAULT_SYMBOL)
    timeframe = request.args.get("timeframe", DEFAULT_TIMEFRAME)
    adjust = request.args.get("adjust", DEFAULT_ADJUST)
    source = request.args.get("source", DEFAULT_SOURCE)
    bars = int(request.args.get("bars", "240"))
    bars = max(80, min(bars, 1200))

    try:
        symbol = resolve_symbol(raw_symbol)
        payload = build_chart_payload_cached(symbol, timeframe, adjust, bars, source)
        return jsonify(payload)
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.get("/api/quote")
def api_quote() -> Any:
    raw_symbol = request.args.get("symbol", DEFAULT_SYMBOL)
    source = request.args.get("source", DEFAULT_SOURCE)
    try:
        requested_source = normalize_source_name(source)
        symbol = resolve_symbol(raw_symbol)
        snapshot = fetch_snapshot_cached(symbol, requested_source, ttl=SNAPSHOT_CACHE_TTL)
        return jsonify(
            {
                "symbol": symbol,
                "source": build_source_info(requested_source, snapshot.source),
                "market": serialize_snapshot(snapshot),
            }
        )
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.get("/api/strategy-signal")
def api_strategy_signal() -> Any:
    raw_symbol = request.args.get("symbol", DEFAULT_SYMBOL)
    strategy_name = request.args.get("strategy", DEFAULT_STRATEGY)
    source = request.args.get("source", DEFAULT_SOURCE)
    try:
        symbol = resolve_symbol(raw_symbol)
        return jsonify(build_strategy_signal_payload_cached(symbol, strategy_name, source))
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.get("/api/watchlist-quotes")
def api_watchlist_quotes() -> Any:
    raw_symbols = request.args.get("symbols", "")
    source = request.args.get("source", DEFAULT_SOURCE)
    try:
        return jsonify(build_watchlist_quotes_payload(raw_symbols, source))
    except MarketDataError as exc:
        return jsonify({"error": str(exc), "quotes": [], "errors": []}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc), "quotes": [], "errors": []}), 500


@app.get("/api/watchlist-strategy-signals")
def api_watchlist_strategy_signals() -> Any:
    raw_symbols = request.args.get("symbols", "")
    strategy_name = request.args.get("strategy", DEFAULT_STRATEGY)
    source = request.args.get("source", DEFAULT_SOURCE)
    try:
        return jsonify(build_watchlist_strategy_signals_payload(raw_symbols, strategy_name, source))
    except MarketDataError as exc:
        return jsonify({"error": str(exc), "signals": [], "errors": []}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc), "signals": [], "errors": []}), 500


@app.get("/api/dashboard-pulse")
def api_dashboard_pulse() -> Any:
    raw_symbol = request.args.get("symbol", DEFAULT_SYMBOL)
    timeframe = request.args.get("timeframe", DEFAULT_TIMEFRAME)
    adjust = request.args.get("adjust", DEFAULT_ADJUST)
    source = request.args.get("source", DEFAULT_SOURCE)
    strategy_name = request.args.get("strategy", DEFAULT_STRATEGY)
    raw_watchlist_symbols = request.args.get("symbols", "")
    include_chart = request.args.get("include_chart", "0") == "1"
    include_watchlist_signals = request.args.get("include_watchlist_signals", "0") == "1"
    bars = int(request.args.get("bars", "260"))
    bars = max(80, min(bars, 1200))

    try:
        symbol = resolve_symbol(raw_symbol)
        payload = build_dashboard_pulse_payload_cached(
            symbol,
            timeframe,
            adjust,
            bars,
            source,
            strategy_name,
            raw_watchlist_symbols,
            include_chart=include_chart,
            include_watchlist_signals=include_watchlist_signals,
        )
        return jsonify(payload)
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.get("/api/alert-runtime")
def api_alert_runtime() -> Any:
    return jsonify(build_alert_runtime_response())


@app.put("/api/alert-runtime")
def api_alert_runtime_update() -> Any:
    data = request.get_json(silent=True) or {}

    def mutator(state: Dict[str, Any]) -> Dict[str, Any]:
        watchlist_changed = False
        strategy_changed = False
        source_changed = False

        if "watchlist" in data:
            watchlist_payload = data.get("watchlist")
            items = normalize_alert_runtime_watchlist_items(
                watchlist_payload.get("items") if isinstance(watchlist_payload, dict) else None
            )
            if items != list((state.get("watchlist") or {}).get("items") or []):
                watchlist_changed = True
            state["watchlist"] = {"items": items}

        if "strategy" in data:
            next_strategy = normalize_strategy_name(data.get("strategy"))
            if next_strategy != str(state.get("strategy") or DEFAULT_STRATEGY):
                strategy_changed = True
            state["strategy"] = next_strategy

        if "source" in data:
            next_source = normalize_source_name(data.get("source"))
            if next_source != str(state.get("source") or DEFAULT_SOURCE):
                source_changed = True
            state["source"] = next_source

        if "webhook" in data and isinstance(data.get("webhook"), dict):
            webhook_payload = data.get("webhook") or {}
            webhook = dict(state.get("webhook") or {})
            if "url" in webhook_payload:
                webhook["url"] = str(webhook_payload.get("url") or "").strip()
            if "enabled_symbols" in webhook_payload:
                webhook["enabled_symbols"] = normalize_alert_runtime_enabled_symbols(webhook_payload.get("enabled_symbols"))
            state["webhook"] = webhook

        webhook = dict(state.get("webhook") or {})
        watchlist_symbols = [
            str(item.get("symbol") or "").strip().lower()
            for item in list((state.get("watchlist") or {}).get("items") or [])
            if isinstance(item, dict)
        ]
        enabled_symbols = normalize_alert_runtime_enabled_symbols(webhook.get("enabled_symbols"))
        if watchlist_changed:
            enabled_symbols = [symbol for symbol in enabled_symbols if symbol in set(watchlist_symbols)]
            webhook["enabled_symbols"] = enabled_symbols

        if strategy_changed or source_changed:
            webhook["alert_states"] = {}
        else:
            webhook["alert_states"] = prune_alert_runtime_states(
                normalize_alert_runtime_states(webhook.get("alert_states")),
                watchlist_symbols=watchlist_symbols,
                enabled_symbols=enabled_symbols,
            )
        state["webhook"] = webhook
        return state

    try:
        runtime = update_alert_runtime_state(mutator)
        return jsonify(build_alert_runtime_response(runtime))
    except MarketDataError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


def webhook_provider_for_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    path = parsed.path.lower()
    if "qyapi.weixin.qq.com" in host and "/cgi-bin/webhook/send" in path:
        return "wecom"
    return "generic"


def format_webhook_number(value: Any, digits: int = 3, signed: bool = False, suffix: str = "") -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    sign = "+" if signed and number > 0 else ""
    return f"{sign}{number:.{digits}f}{suffix}"


def format_webhook_timestamp(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return time.strftime("%Y-%m-%d %H:%M:%S")
    return text.replace("T", " ").replace("Z", "")


def normalize_webhook_text_items(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if text:
            items.append(text)
    return items


def build_wecom_text_content(payload: Dict[str, Any]) -> str:
    message_text = str(payload.get("message_text") or "").strip()
    if message_text:
        return message_text

    category = str(payload.get("category") or "").strip().lower()
    signal = str(payload.get("signal") or "TEST").strip().upper() or "TEST"
    symbol = str(payload.get("symbol") or "").strip().upper()
    name = str(payload.get("name") or "").strip()
    strategy = str(payload.get("strategy_label") or payload.get("strategy") or "").strip()
    source = str(payload.get("source_label") or payload.get("source") or "").strip()
    reason = str(payload.get("reason") or "").strip()
    reason_summary = str(payload.get("reason_summary") or reason).strip()
    decision_text = str(payload.get("decision_text") or "").strip()
    action_hint = str(payload.get("action_hint") or "").strip()
    action_label = str(payload.get("action_label") or "").strip()
    message_title = str(payload.get("message_title") or "").strip()
    timestamp = format_webhook_timestamp(payload.get("timestamp"))
    price = format_webhook_number(payload.get("price"), digits=3)
    change_value = format_webhook_number(payload.get("change"), digits=3, signed=True)
    change_pct = format_webhook_number(payload.get("change_pct"), digits=2, signed=True, suffix="%")
    reason_details = normalize_webhook_text_items(payload.get("reason_details"))
    supporting_reasons = normalize_webhook_text_items(payload.get("supporting_reasons"))

    if message_title:
        headline = message_title
    elif category == "test":
        headline = "TEST"
    else:
        headline = signal

    lines = [f"Signal Deck {headline}"]
    if symbol or name:
        lines.append(f"Symbol: {' '.join(part for part in [symbol, name] if part)}")
    if strategy:
        lines.append(f"Strategy: {strategy}")
    if action_label:
        lines.append(f"Action Level: {action_label}")
    if reason_summary:
        lines.append(f"Summary: {reason_summary}")
    if supporting_reasons:
        lines.append(f"Support: {' ; '.join(supporting_reasons[:3])}")
    elif len(reason_details) > 1:
        lines.append(f"Support: {' ; '.join(reason_details[1:4])}")
    if decision_text:
        lines.append(f"Decision: {decision_text}")
    if price or change_value or change_pct:
        change_parts = [part for part in [change_value, change_pct] if part]
        line_parts = []
        if price:
            line_parts.append(f"Price: {price}")
        if change_parts:
            line_parts.append(f"Change: {' / '.join(change_parts)}")
        lines.append(" | ".join(line_parts))
    if source:
        lines.append(f"Source: {source}")
    lines.append(f"Time: {timestamp}")
    if action_hint:
        lines.append(f"Action: {action_hint}")
    elif reason and reason != reason_summary:
        lines.append(f"Reason: {reason}")
    return "\n".join(lines)


def prepare_webhook_request_payload(url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = webhook_provider_for_url(url)
    if provider == "wecom":
        if isinstance(payload.get("msgtype"), str) and payload.get("msgtype"):
            return payload
        return {
            "msgtype": "text",
            "text": {
                "content": build_wecom_text_content(payload),
            },
        }
    return payload


def build_webhook_log_entry(
    payload: Dict[str, Any],
    *,
    ok: bool,
    response_status: Optional[int],
    message: str,
    provider: str,
    record_type: str,
) -> Dict[str, Any]:
    return {
        "id": uuid4().hex[:12],
        "createdAt": iso_now(),
        "ok": bool(ok),
        "type": record_type,
        "signal": str(payload.get("signal") or "TEST").strip().upper() or "TEST",
        "symbol": str(payload.get("symbol") or "").strip().lower(),
        "name": str(payload.get("name") or payload.get("reason_summary") or payload.get("reason") or "").strip(),
        "strategyLabel": str(payload.get("strategy_label") or payload.get("strategy") or "").strip(),
        "responseStatus": response_status,
        "message": str(message or ("发送成功" if ok else "发送失败")).strip()[:120],
        "reason": str(payload.get("reason_summary") or payload.get("reason") or "").strip(),
        "provider": provider,
        "recordType": record_type,
    }


def perform_webhook_request(
    url: str,
    payload: Dict[str, Any],
    *,
    record_type: str = "signal",
    persist_log: bool = True,
) -> Tuple[Dict[str, Any], int]:
    provider = webhook_provider_for_url(url)
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return {"error": "Webhook URL 无效"}, 400
    if not isinstance(payload, dict):
        return {"error": "Webhook payload 无效"}, 400

    request_payload = prepare_webhook_request_payload(url, payload)
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    req = Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "SignalDeckWebhook/1.0",
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=10) as resp:
            response_body = resp.read(2048).decode("utf-8", errors="ignore")
            response_error = extract_webhook_response_error(response_body)
            if response_error:
                result = {"error": response_error, "status": resp.status, "body": response_body, "provider": provider}
                status_code = 502
                log_entry = build_webhook_log_entry(
                    payload,
                    ok=False,
                    response_status=resp.status,
                    message=response_error,
                    provider=provider,
                    record_type=record_type,
                )
            else:
                result = {"ok": True, "status": resp.status, "body": response_body, "provider": provider}
                status_code = 200
                log_entry = build_webhook_log_entry(
                    payload,
                    ok=True,
                    response_status=resp.status,
                    message=response_body or "发送成功",
                    provider=provider,
                    record_type=record_type,
                )
    except HTTPError as exc:
        response_body = exc.read(2048).decode("utf-8", errors="ignore")
        response_error = extract_webhook_response_error(response_body)
        result = {
            "error": response_error or response_body or str(exc),
            "status": exc.code,
            "body": response_body,
            "provider": provider,
        }
        status_code = 502
        log_entry = build_webhook_log_entry(
            payload,
            ok=False,
            response_status=exc.code,
            message=response_error or response_body or str(exc),
            provider=provider,
            record_type=record_type,
        )
    except URLError as exc:
        result = {"error": str(exc.reason or exc), "provider": provider}
        status_code = 502
        log_entry = build_webhook_log_entry(
            payload,
            ok=False,
            response_status=None,
            message=str(exc.reason or exc),
            provider=provider,
            record_type=record_type,
        )
    except Exception as exc:  # noqa: BLE001
        result = {"error": str(exc), "provider": provider}
        status_code = 502
        log_entry = build_webhook_log_entry(
            payload,
            ok=False,
            response_status=None,
            message=str(exc),
            provider=provider,
            record_type=record_type,
        )

    if persist_log:
        result["log_entry"] = append_alert_runtime_log(log_entry)
    else:
        result["log_entry"] = log_entry
    return result, status_code


def alert_signal_for_payload(strategy_signal: Dict[str, Any]) -> str:
    signal = str(strategy_signal.get("signal") or "").strip().upper()
    return signal if bool(strategy_signal.get("triggered")) and signal in {"BUY", "SELL"} else "HOLD"


def alert_action_for_payload(strategy_signal: Dict[str, Any]) -> str:
    signal = alert_signal_for_payload(strategy_signal)
    if signal not in {"BUY", "SELL"}:
        return ""
    action = str(strategy_signal.get("action") or "").strip().lower()
    return action or signal.lower()


def alert_day_key_from_value(value: Any) -> str:
    text = str(value or "").strip()
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 8:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    if not text:
        return datetime.now().strftime("%Y-%m-%d")
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y-%m"):
        try:
            parsed = datetime.strptime(text, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return datetime.now().strftime("%Y-%m-%d")


def build_runtime_quote_payload(symbol: str, requested_source: str) -> Dict[str, Any]:
    snapshot = fetch_snapshot_cached(symbol, requested_source, ttl=SNAPSHOT_CACHE_TTL)
    payload = serialize_snapshot(snapshot)
    payload["source"] = build_source_info(requested_source, snapshot.source)
    return payload


def prune_alert_runtime_states(
    states: Dict[str, Dict[str, Any]],
    *,
    watchlist_symbols: List[str],
    enabled_symbols: List[str],
) -> Dict[str, Dict[str, Any]]:
    keep = set(watchlist_symbols) | set(enabled_symbols)
    if not keep:
        return {}
    return {symbol: value for symbol, value in states.items() if symbol in keep}


def run_alert_worker_cycle() -> int:
    runtime = load_alert_runtime_state()
    webhook = runtime.get("webhook") if isinstance(runtime.get("webhook"), dict) else {}
    url = str(webhook.get("url") or "").strip()
    strategy_id = normalize_strategy_name(runtime.get("strategy") or DEFAULT_STRATEGY)
    requested_source = normalize_source_name(runtime.get("source") or DEFAULT_SOURCE)
    watchlist_items = list((runtime.get("watchlist") or {}).get("items") or [])
    enabled_symbols = normalize_alert_runtime_enabled_symbols(webhook.get("enabled_symbols"))
    watchlist_symbols = [str(item.get("symbol") or "").strip().lower() for item in watchlist_items if isinstance(item, dict)]

    patch_alert_worker_state(last_run_at=iso_now(), last_error="")

    if not url or strategy_id == "none" or not enabled_symbols:
        update_alert_runtime_state(
            lambda state: {
                **state,
                "webhook": {
                    **(state.get("webhook") or {}),
                    "alert_states": prune_alert_runtime_states(
                        normalize_alert_runtime_states((state.get("webhook") or {}).get("alert_states") or {}),
                        watchlist_symbols=watchlist_symbols,
                        enabled_symbols=enabled_symbols,
                    ),
                },
            }
        )
        patch_alert_worker_state(last_success_at=iso_now(), last_sent_count=0)
        return 0

    item_map = {
        str(item.get("symbol") or "").strip().lower(): item
        for item in watchlist_items
        if isinstance(item, dict) and str(item.get("symbol") or "").strip()
    }
    symbols = [symbol for symbol in enabled_symbols if symbol in item_map]
    if not symbols:
        patch_alert_worker_state(last_success_at=iso_now(), last_sent_count=0)
        return 0

    states = normalize_alert_runtime_states(webhook.get("alert_states"))
    changed = False
    sent_count = 0
    for symbol in symbols:
        try:
            quote_payload = build_runtime_quote_payload(symbol, requested_source)
            strategy_signal = build_strategy_signal_payload_cached(symbol, strategy_id, requested_source)
        except Exception as exc:  # noqa: BLE001
            patch_alert_worker_state(last_error=f"{symbol}: {exc}")
            continue

        next_signal = alert_signal_for_payload(strategy_signal)
        next_action = alert_action_for_payload(strategy_signal)
        next_action_label = str(
            strategy_signal.get("action_label") or action_label_for_value(next_action, next_signal)
        ).strip()
        day_key = alert_day_key_from_value(strategy_signal.get("timestamp") or quote_payload.get("timestamp"))
        previous_entry = states.get(symbol) or {}
        previous_signal = str(previous_entry.get("signal") or "").strip().upper()
        previous_action = str(previous_entry.get("action") or "").strip().lower()
        last_alert_day_key = str(previous_entry.get("lastAlertDayKey") or "").strip()
        is_alert_signal = next_signal in {"BUY", "SELL"}

        if not previous_signal:
            states[symbol] = {
                "signal": next_signal,
                "action": next_action,
                "actionLabel": next_action_label,
                "dayKey": day_key,
                "lastAlertDayKey": day_key if is_alert_signal else "",
                "updatedAt": iso_now(),
            }
            changed = True
            continue

        should_send = False
        if previous_signal == next_signal and previous_action == next_action:
            if str(previous_entry.get("dayKey") or "") != day_key:
                states[symbol] = {
                    **previous_entry,
                    "signal": next_signal,
                    "action": next_action,
                    "actionLabel": next_action_label,
                    "dayKey": day_key,
                    "updatedAt": iso_now(),
                }
                changed = True
                if is_alert_signal and last_alert_day_key != day_key:
                    states[symbol]["lastAlertDayKey"] = day_key
                    should_send = True
        else:
            states[symbol] = {
                **previous_entry,
                "signal": next_signal,
                "action": next_action,
                "actionLabel": next_action_label,
                "dayKey": day_key,
                "lastAlertDayKey": day_key if is_alert_signal else str(previous_entry.get("lastAlertDayKey") or ""),
                "updatedAt": iso_now(),
            }
            changed = True
            if is_alert_signal:
                should_send = True

        if should_send:
            webhook_payload = build_runtime_webhook_payload(quote_payload, strategy_signal)
            perform_webhook_request(url, webhook_payload, record_type="background", persist_log=True)
            sent_count += 1

    pruned_states = prune_alert_runtime_states(states, watchlist_symbols=watchlist_symbols, enabled_symbols=enabled_symbols)
    if pruned_states != states:
        states = pruned_states
        changed = True

    if changed:
        update_alert_runtime_state(
            lambda state: {
                **state,
                "webhook": {
                    **(state.get("webhook") or {}),
                    "alert_states": states,
                },
            }
        )

    worker_patch = {
        "last_success_at": iso_now(),
        "last_sent_count": sent_count,
        "last_error": "",
    }
    if sent_count > 0:
        worker_patch["last_sent_at"] = iso_now()
    patch_alert_worker_state(**worker_patch)
    return sent_count


def alert_worker_loop() -> None:
    patch_alert_worker_state(running=True, started_at=iso_now(), last_error="")
    while not ALERT_WORKER_STOP.is_set():
        try:
            run_alert_worker_cycle()
        except Exception as exc:  # noqa: BLE001
            patch_alert_worker_state(last_error=str(exc))
        ALERT_WORKER_STOP.wait(ALERT_WORKER_INTERVAL_SECONDS)
    patch_alert_worker_state(running=False)


def ensure_alert_worker_started() -> None:
    global ALERT_WORKER_THREAD
    if ALERT_WORKER_THREAD and ALERT_WORKER_THREAD.is_alive():
        return
    ALERT_WORKER_STOP.clear()
    ALERT_WORKER_THREAD = Thread(target=alert_worker_loop, name="signaldeck-alert-worker", daemon=True)
    ALERT_WORKER_THREAD.start()


def extract_webhook_response_error(response_body: str) -> Optional[str]:
    text = str(response_body or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return None

    errcode = data.get("errcode")
    if errcode in {None, 0, "0", ""}:
        return None

    errmsg = str(data.get("errmsg") or data.get("error") or "Webhook returned an error").strip()
    return f"{errmsg} (errcode {errcode})"


@app.post("/api/webhook-alert")
def api_webhook_alert() -> Any:
    data = request.get_json(silent=True) or {}
    url = str(data.get("url") or "").strip()
    payload = data.get("payload")
    result, status_code = perform_webhook_request(url, payload, record_type="manual", persist_log=True)
    if "log_entry" in result:
        result["runtime"] = build_alert_runtime_response()
    return jsonify(result), status_code

ensure_alert_worker_started()


if __name__ == "__main__":
    warm_search_cache()
    try:
        from waitress import serve
    except ImportError:
        app.run(host=DEFAULT_HOST, port=DEFAULT_PORT, debug=False)
    else:
        serve(app, host=DEFAULT_HOST, port=DEFAULT_PORT, threads=8)
