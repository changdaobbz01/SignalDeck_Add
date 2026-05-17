#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen


HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://quote.eastmoney.com/",
}

TENCENT_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://gu.qq.com/",
}

TIMEFRAME_TO_KLT = {
    "1m": 1,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "60m": 60,
    "1d": 101,
    "1w": 102,
    "1M": 103,
}

FQT_MAP = {
    "none": 0,
    "qfq": 1,
    "hfq": 2,
}

TENCENT_PERIOD_MAP = {
    "1d": "day",
    "1w": "week",
    "1M": "month",
}

TENCENT_INTRADAY_MAP = {
    "1m": "m1",
    "5m": "m5",
    "15m": "m15",
    "30m": "m30",
    "60m": "m60",
}

TENCENT_ADJUST_MAP = {
    "none": "",
    "qfq": "qfq",
    "hfq": "hfq",
}

SOURCE_METADATA = {
    "auto": {
        "label": "自动选择",
        "description": "优先使用腾讯，异常时回退到东方财富。",
        "supports_bars": True,
        "supports_snapshot": True,
    },
    "eastmoney": {
        "label": "东方财富",
        "description": "K 线与快照字段更完整，适合默认研究场景。",
        "supports_bars": True,
        "supports_snapshot": True,
    },
    "tencent": {
        "label": "腾讯",
        "description": "分钟线与盘口快照稳定性较好，可作为备选信息源。",
        "supports_bars": True,
        "supports_snapshot": True,
    },
}

SOURCE_BASE_ORDER = {
    "bars": ["tencent", "eastmoney"],
    "snapshot": ["tencent", "eastmoney"],
}


@dataclass
class Bar:
    timestamp: str
    open: float
    close: float
    high: float
    low: float
    volume: float
    amount: float


@dataclass
class SignalResult:
    symbol: str
    name: str
    timeframe: str
    last_timestamp: str
    last_price: float
    signal: str
    buy_hits: int
    sell_hits: int
    buy_total: int
    sell_total: int
    buy_matched: List[str]
    sell_matched: List[str]
    warnings: List[str]
    context: Dict[str, Any]


@dataclass
class MarketSnapshot:
    symbol: str
    name: str
    source: str
    last_price: Optional[float]
    prev_close: Optional[float]
    open: Optional[float]
    high: Optional[float]
    low: Optional[float]
    volume: Optional[float]
    amount: Optional[float]
    change: Optional[float]
    change_pct: Optional[float]
    turnover_rate: Optional[float]
    amplitude_pct: Optional[float]
    pe_dynamic: Optional[float]
    pb: Optional[float]
    total_market_value: Optional[float]
    circulating_market_value: Optional[float]
    upper_limit: Optional[float]
    lower_limit: Optional[float]
    timestamp: Optional[str]


class MarketDataError(RuntimeError):
    pass


@dataclass
class SourceHealthRecord:
    source: str
    category: str
    success_count: int = 0
    failure_count: int = 0
    consecutive_failures: int = 0
    avg_latency_ms: float = 0.0
    last_success_at: float = 0.0
    last_failure_at: float = 0.0
    cooldown_until: float = 0.0
    last_error: str = ""

    def score(self, now: float, priority_index: int) -> float:
        score = 100.0 - (priority_index * 2.0)
        if self.avg_latency_ms > 0:
            score -= min(self.avg_latency_ms / 45.0, 24.0)
        if self.consecutive_failures > 0:
            score -= min(self.consecutive_failures * 18.0, 54.0)
        if now < self.cooldown_until:
            score -= 40.0
        if self.last_success_at and self.last_success_at >= self.last_failure_at:
            score += 4.0
        return score


class SourceHealthTracker:
    def __init__(self) -> None:
        self._lock = Lock()
        self._stats: Dict[str, Dict[str, SourceHealthRecord]] = {
            category: {
                source: SourceHealthRecord(source=source, category=category)
                for source in sources
            }
            for category, sources in SOURCE_BASE_ORDER.items()
        }

    def record_success(self, category: str, source: str, latency_ms: float) -> None:
        with self._lock:
            record = self._record_for(category, source)
            record.success_count += 1
            record.consecutive_failures = 0
            record.last_success_at = time.time()
            record.cooldown_until = 0.0
            record.last_error = ""
            if latency_ms > 0:
                if record.avg_latency_ms <= 0:
                    record.avg_latency_ms = latency_ms
                else:
                    record.avg_latency_ms = (record.avg_latency_ms * 0.72) + (latency_ms * 0.28)

    def record_failure(self, category: str, source: str, latency_ms: float, error: str = "") -> None:
        with self._lock:
            record = self._record_for(category, source)
            record.failure_count += 1
            record.consecutive_failures += 1
            record.last_failure_at = time.time()
            record.last_error = str(error or "")
            if latency_ms > 0 and record.avg_latency_ms <= 0:
                record.avg_latency_ms = latency_ms
            if record.consecutive_failures >= 2:
                cooldown_seconds = min(18.0, 2.5 * (2 ** min(record.consecutive_failures - 2, 3)))
                record.cooldown_until = record.last_failure_at + cooldown_seconds

    def ordered_sources(self, category: str) -> List[str]:
        default_sources = list(SOURCE_BASE_ORDER.get(category) or [])
        if not default_sources:
            return []
        priority_lookup = {source: index for index, source in enumerate(default_sources)}
        with self._lock:
            now = time.time()
            records = [
                self._stats.get(category, {}).get(source) or SourceHealthRecord(source=source, category=category)
                for source in default_sources
            ]
            records.sort(
                key=lambda record: (
                    -record.score(now, priority_lookup.get(record.source, len(default_sources))),
                    priority_lookup.get(record.source, len(default_sources)),
                    record.source,
                )
            )
            return [record.source for record in records]

    def snapshot(self) -> Dict[str, Dict[str, Dict[str, Any]]]:
        with self._lock:
            now = time.time()
            result: Dict[str, Dict[str, Dict[str, Any]]] = {}
            for category, items in self._stats.items():
                priority_lookup = {source: index for index, source in enumerate(SOURCE_BASE_ORDER.get(category, []))}
                result[category] = {}
                for source, record in items.items():
                    result[category][source] = {
                        "score": round(record.score(now, priority_lookup.get(source, 0)), 2),
                        "success_count": record.success_count,
                        "failure_count": record.failure_count,
                        "consecutive_failures": record.consecutive_failures,
                        "avg_latency_ms": round(record.avg_latency_ms, 2),
                        "last_success_at": record.last_success_at,
                        "last_failure_at": record.last_failure_at,
                        "cooldown_until": record.cooldown_until,
                        "last_error": record.last_error,
                    }
            return result

    def _record_for(self, category: str, source: str) -> SourceHealthRecord:
        category_items = self._stats.setdefault(category, {})
        if source not in category_items:
            category_items[source] = SourceHealthRecord(source=source, category=category)
        return category_items[source]


SOURCE_HEALTH_TRACKER = SourceHealthTracker()


def http_get_text(url: str, headers: Optional[Dict[str, str]] = None) -> str:
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            req = Request(url, headers=headers or HEADERS)
            with urlopen(req, timeout=15) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < 2:
                time.sleep(0.6 * (attempt + 1))
    if last_error is not None:
        raise last_error
    raise RuntimeError("unexpected http_get_text state")


def http_get_bytes(url: str, headers: Optional[Dict[str, str]] = None) -> bytes:
    last_error: Optional[Exception] = None
    for attempt in range(3):
        try:
            req = Request(url, headers=headers or HEADERS)
            with urlopen(req, timeout=15) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < 2:
                time.sleep(0.6 * (attempt + 1))
    if last_error is not None:
        raise last_error
    raise RuntimeError("unexpected http_get_bytes state")


def http_get_json(url: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    text = http_get_text(url, headers=headers)
    return json.loads(text)


def to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    value = str(value).strip()
    if not value or value == "-":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def scaled_float(value: Any, divisor: float = 1.0) -> Optional[float]:
    parsed = to_float(value)
    if parsed is None:
        return None
    return parsed / divisor


def normalize_source_name(source: Optional[str]) -> str:
    normalized = str(source or "auto").strip().lower()
    if normalized not in SOURCE_METADATA:
        raise MarketDataError(f"不支持的信息源: {source}")
    return normalized


def source_label(source: str) -> str:
    return SOURCE_METADATA[source]["label"]


def _compute_change(last_price: Optional[float], prev_close: Optional[float]) -> Optional[float]:
    if last_price is None or prev_close is None:
        return None
    return last_price - prev_close


def _compute_change_pct(last_price: Optional[float], prev_close: Optional[float]) -> Optional[float]:
    if last_price is None or prev_close in (None, 0):
        return None
    return ((last_price - prev_close) / prev_close) * 100.0


def _format_tencent_timestamp(value: Any) -> Optional[str]:
    raw = str(value or "").strip()
    if len(raw) != 14 or not raw.isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]} {raw[8:10]}:{raw[10:12]}:{raw[12:14]}"


def tail(values: List[Any], count: int) -> List[Any]:
    if count <= 0:
        return values
    return values[-count:]


def sma(values: List[float], window: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    if window <= 0:
        return result
    running = 0.0
    for idx, value in enumerate(values):
        running += value
        if idx >= window:
            running -= values[idx - window]
        if idx >= window - 1:
            result[idx] = running / window
    return result


def ema(values: List[Optional[float]], window: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    if window <= 0:
        return result
    alpha = 2.0 / (window + 1.0)
    prev: Optional[float] = None
    for idx, value in enumerate(values):
        if value is None:
            continue
        if prev is None:
            prev = float(value)
        else:
            prev = (float(value) * alpha) + (prev * (1.0 - alpha))
        result[idx] = prev
    return result


def rsi(values: List[float], window: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(values)
    if window <= 0 or len(values) <= window:
        return result
    gains = 0.0
    losses = 0.0
    for idx in range(1, window + 1):
        change = values[idx] - values[idx - 1]
        gains += max(change, 0.0)
        losses += max(-change, 0.0)
    avg_gain = gains / window
    avg_loss = losses / window
    if avg_loss == 0:
        result[window] = 100.0
    else:
        rs = avg_gain / avg_loss
        result[window] = 100.0 - (100.0 / (1.0 + rs))
    for idx in range(window + 1, len(values)):
        change = values[idx] - values[idx - 1]
        gain = max(change, 0.0)
        loss = max(-change, 0.0)
        avg_gain = ((avg_gain * (window - 1)) + gain) / window
        avg_loss = ((avg_loss * (window - 1)) + loss) / window
        if avg_loss == 0:
            result[idx] = 100.0
        else:
            rs = avg_gain / avg_loss
            result[idx] = 100.0 - (100.0 / (1.0 + rs))
    return result


def macd(
    values: List[float],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    fast_line = ema([float(v) for v in values], fast)
    slow_line = ema([float(v) for v in values], slow)
    macd_line: List[Optional[float]] = [None] * len(values)
    for idx, (fast_value, slow_value) in enumerate(zip(fast_line, slow_line)):
        if fast_value is None or slow_value is None:
            continue
        macd_line[idx] = fast_value - slow_value
    signal_line = ema(macd_line, signal)
    hist: List[Optional[float]] = [None] * len(values)
    for idx, (macd_value, signal_value) in enumerate(zip(macd_line, signal_line)):
        if macd_value is None or signal_value is None:
            continue
        hist[idx] = macd_value - signal_value
    return macd_line, signal_line, hist


def bollinger(
    values: List[float],
    window: int = 20,
    stddev: float = 2.0,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    mid = sma(values, window)
    upper: List[Optional[float]] = [None] * len(values)
    lower: List[Optional[float]] = [None] * len(values)
    if window <= 0:
        return upper, mid, lower
    for idx in range(window - 1, len(values)):
        subset = values[idx - window + 1 : idx + 1]
        mean = mid[idx]
        if mean is None:
            continue
        variance = sum((value - mean) ** 2 for value in subset) / window
        sd = math.sqrt(variance)
        upper[idx] = mean + (sd * stddev)
        lower[idx] = mean - (sd * stddev)
    return upper, mid, lower


def atr(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    window: int = 14,
) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * len(closes)
    if window <= 0 or len(closes) <= 1:
        return result
    true_ranges: List[float] = [0.0]
    for idx in range(1, len(closes)):
        tr = max(
            highs[idx] - lows[idx],
            abs(highs[idx] - closes[idx - 1]),
            abs(lows[idx] - closes[idx - 1]),
        )
        true_ranges.append(tr)
    if len(true_ranges) <= window:
        return result
    initial = sum(true_ranges[1 : window + 1]) / window
    result[window] = initial
    prev = initial
    for idx in range(window + 1, len(true_ranges)):
        prev = ((prev * (window - 1)) + true_ranges[idx]) / window
        result[idx] = prev
    return result


class EastMoneyClient:
    history_base = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
    quote_base = "https://push2.eastmoney.com/api/qt/stock/get"
    tencent_history_base = "https://ifzq.gtimg.cn/appstock/app/fqkline/get"
    tencent_minute_base = "https://ifzq.gtimg.cn/appstock/app/kline/mkline"
    tencent_quote_base = "https://qt.gtimg.cn/q="

    @staticmethod
    def symbol_to_secid(symbol: str) -> str:
        if len(symbol) < 3:
            raise MarketDataError(f"不支持的代码格式: {symbol}")
        market = symbol[:2].lower()
        code = symbol[2:]
        if market == "sh":
            return f"1.{code}"
        if market == "sz":
            return f"0.{code}"
        raise MarketDataError(
            f"当前版本仅支持 A 股/指数代码，例如 sh600519、sz300750、sh000001，收到: {symbol}"
        )

    def fetch_bars(
        self,
        symbol: str,
        timeframe: str,
        max_bars: int,
        adjust: str,
        source: str = "auto",
    ) -> Tuple[str, List[Bar]]:
        name, bars, _ = self.fetch_bars_with_source(symbol, timeframe, max_bars, adjust, source=source)
        return name, bars

    def fetch_bars_with_source(
        self,
        symbol: str,
        timeframe: str,
        max_bars: int,
        adjust: str,
        source: str = "auto",
    ) -> Tuple[str, List[Bar], str]:
        requested_source = normalize_source_name(source)
        errors: List[str] = []
        for source_name in self._bar_source_sequence(requested_source):
            started_at = time.perf_counter()
            try:
                if source_name == "eastmoney":
                    name, bars = self._fetch_bars_eastmoney(symbol, timeframe, max_bars, adjust)
                elif source_name == "tencent":
                    name, bars = self._fetch_bars_tencent(symbol, timeframe, max_bars, adjust)
                else:
                    raise MarketDataError(f"unsupported bar source: {source_name}")
                SOURCE_HEALTH_TRACKER.record_success(
                    "bars",
                    source_name,
                    (time.perf_counter() - started_at) * 1000.0,
                )
                return name, bars, source_name
            except Exception as exc:  # noqa: BLE001
                SOURCE_HEALTH_TRACKER.record_failure(
                    "bars",
                    source_name,
                    (time.perf_counter() - started_at) * 1000.0,
                    error=str(exc),
                )
                errors.append(f"{source_name}: {exc}")
                if requested_source != "auto":
                    break
        raise MarketDataError("; ".join(errors) or f"{symbol} {timeframe} K 线获取失败")

    def fetch_snapshot(self, symbol: str, source: str = "auto") -> MarketSnapshot:
        requested_source = normalize_source_name(source)
        errors: List[str] = []
        for source_name in self._snapshot_source_sequence(requested_source):
            started_at = time.perf_counter()
            try:
                if source_name == "eastmoney":
                    snapshot = self._fetch_snapshot_eastmoney(symbol)
                elif source_name == "tencent":
                    snapshot = self._fetch_snapshot_tencent(symbol)
                else:
                    raise MarketDataError(f"unsupported snapshot source: {source_name}")
                SOURCE_HEALTH_TRACKER.record_success(
                    "snapshot",
                    source_name,
                    (time.perf_counter() - started_at) * 1000.0,
                )
                return snapshot
            except Exception as exc:  # noqa: BLE001
                SOURCE_HEALTH_TRACKER.record_failure(
                    "snapshot",
                    source_name,
                    (time.perf_counter() - started_at) * 1000.0,
                    error=str(exc),
                )
                errors.append(f"{source_name}: {exc}")
                if requested_source != "auto":
                    break
        raise MarketDataError("; ".join(errors) or f"{symbol} 行情快照获取失败")

    @staticmethod
    def _bar_source_sequence(source: str) -> List[str]:
        if source == "auto":
            return SOURCE_HEALTH_TRACKER.ordered_sources("bars")
        return [source]

    @staticmethod
    def _snapshot_source_sequence(source: str) -> List[str]:
        if source == "auto":
            return SOURCE_HEALTH_TRACKER.ordered_sources("snapshot")
        return [source]

    def _fetch_bars_eastmoney(
        self,
        symbol: str,
        timeframe: str,
        max_bars: int,
        adjust: str,
    ) -> Tuple[str, List[Bar]]:
        if timeframe not in TIMEFRAME_TO_KLT:
            raise MarketDataError(f"不支持的周期: {timeframe}")
        if adjust not in FQT_MAP:
            raise MarketDataError(f"不支持的复权类型: {adjust}")
        params = {
            "secid": self.symbol_to_secid(symbol),
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58",
            "klt": TIMEFRAME_TO_KLT[timeframe],
            "fqt": FQT_MAP[adjust],
            "beg": "0",
            "end": "20500101",
        }
        url = f"{self.history_base}?{urlencode(params)}"
        payload = http_get_json(url)
        data = payload.get("data") or {}
        name = data.get("name") or symbol
        raw_klines = data.get("klines") or []
        if not raw_klines:
            raise MarketDataError(f"{symbol} 未返回任何 K 线数据")
        bars: List[Bar] = []
        for raw in tail(raw_klines, max_bars):
            parts = raw.split(",")
            if len(parts) < 7:
                continue
            open_price = to_float(parts[1])
            close_price = to_float(parts[2])
            high_price = to_float(parts[3])
            low_price = to_float(parts[4])
            volume = to_float(parts[5])
            amount = to_float(parts[6])
            if None in (open_price, close_price, high_price, low_price, volume, amount):
                continue
            bars.append(
                Bar(
                    timestamp=parts[0],
                    open=open_price or 0.0,
                    close=close_price or 0.0,
                    high=high_price or 0.0,
                    low=low_price or 0.0,
                    volume=volume or 0.0,
                    amount=amount or 0.0,
                )
            )
        if not bars:
            raise MarketDataError(f"{symbol} 的 K 线解析失败")
        return name, bars

    def _fetch_bars_tencent(
        self,
        symbol: str,
        timeframe: str,
        max_bars: int,
        adjust: str,
    ) -> Tuple[str, List[Bar]]:
        if adjust not in TENCENT_ADJUST_MAP:
            raise MarketDataError(f"unsupported adjust for Tencent fallback: {adjust}")
        if timeframe in TENCENT_PERIOD_MAP:
            return self._fetch_tencent_period_bars(symbol, timeframe, max_bars, adjust)
        if timeframe in TENCENT_INTRADAY_MAP:
            return self._fetch_tencent_intraday_bars(symbol, timeframe, max_bars)
        raise MarketDataError(f"unsupported timeframe for Tencent fallback: {timeframe}")

    def _fetch_tencent_period_bars(
        self,
        symbol: str,
        timeframe: str,
        max_bars: int,
        adjust: str,
    ) -> Tuple[str, List[Bar]]:
        period = TENCENT_PERIOD_MAP[timeframe]
        adjust_key = TENCENT_ADJUST_MAP[adjust]
        params = {"param": f"{symbol},{period},,,{max_bars},{adjust_key}"}
        payload = http_get_json(f"{self.tencent_history_base}?{urlencode(params)}", headers=TENCENT_HEADERS)
        data = (payload.get("data") or {}).get(symbol) or {}
        field_name = f"{adjust_key}{period}" if adjust_key else period
        # Tencent period bars still commonly use the plain period key (`day` / `week` / `month`)
        # even when qfq/hfq is requested, so fall back to the raw period key.
        rows = data.get(field_name) or data.get(period) or []
        return self._parse_tencent_rows(symbol, rows, data, max_bars)

    def _fetch_tencent_intraday_bars(
        self,
        symbol: str,
        timeframe: str,
        max_bars: int,
    ) -> Tuple[str, List[Bar]]:
        period = TENCENT_INTRADAY_MAP[timeframe]
        params = {"param": f"{symbol},{period},,{max_bars}"}
        payload = http_get_json(f"{self.tencent_minute_base}?{urlencode(params)}", headers=TENCENT_HEADERS)
        data = (payload.get("data") or {}).get(symbol) or {}
        rows = data.get(period) or []
        return self._parse_tencent_rows(symbol, rows, data, max_bars)

    def _parse_tencent_rows(
        self,
        symbol: str,
        rows: List[Any],
        data: Dict[str, Any],
        max_bars: int,
    ) -> Tuple[str, List[Bar]]:
        name = symbol
        quote_data = (data.get("qt") or {}).get(symbol) or []
        if len(quote_data) > 1 and quote_data[1]:
            name = str(quote_data[1])

        if not rows:
            raise MarketDataError(f"{symbol} fallback source returned no kline data")

        bars: List[Bar] = []
        for raw in tail(list(rows), max_bars):
            if len(raw) < 6:
                continue
            open_price = to_float(raw[1])
            close_price = to_float(raw[2])
            high_price = to_float(raw[3])
            low_price = to_float(raw[4])
            volume = to_float(raw[5])
            if None in (open_price, close_price, high_price, low_price, volume):
                continue
            bars.append(
                Bar(
                    timestamp=str(raw[0]),
                    open=open_price or 0.0,
                    close=close_price or 0.0,
                    high=high_price or 0.0,
                    low=low_price or 0.0,
                    volume=volume or 0.0,
                    amount=0.0,
                )
            )
        if not bars:
            raise MarketDataError(f"{symbol} fallback kline parse failed")
        return name, bars

    def _fetch_snapshot_eastmoney(self, symbol: str) -> MarketSnapshot:
        params = {
            "secid": self.symbol_to_secid(symbol),
            "fields": "f43,f44,f45,f46,f47,f48,f57,f58,f60,f116,f117,f164,f165,f168,f169,f170,f171",
        }
        payload = http_get_json(f"{self.quote_base}?{urlencode(params)}")
        data = payload.get("data") or {}
        name = str(data.get("f58") or symbol)
        last_price = scaled_float(data.get("f43"), 100.0)
        prev_close = scaled_float(data.get("f60"), 100.0)
        change = scaled_float(data.get("f169"), 100.0)
        change_pct = scaled_float(data.get("f170"), 100.0)
        return MarketSnapshot(
            symbol=symbol,
            name=name,
            source="eastmoney",
            last_price=last_price,
            prev_close=prev_close,
            open=scaled_float(data.get("f46"), 100.0),
            high=scaled_float(data.get("f44"), 100.0),
            low=scaled_float(data.get("f45"), 100.0),
            volume=to_float(data.get("f47")),
            amount=to_float(data.get("f48")),
            change=change if change is not None else _compute_change(last_price, prev_close),
            change_pct=change_pct if change_pct is not None else _compute_change_pct(last_price, prev_close),
            turnover_rate=scaled_float(data.get("f168"), 100.0),
            amplitude_pct=scaled_float(data.get("f171"), 100.0),
            pe_dynamic=scaled_float(data.get("f164"), 100.0),
            pb=scaled_float(data.get("f165"), 100.0),
            total_market_value=to_float(data.get("f116")),
            circulating_market_value=to_float(data.get("f117")),
            upper_limit=None,
            lower_limit=None,
            timestamp=None,
        )

    def _fetch_snapshot_tencent(self, symbol: str) -> MarketSnapshot:
        url = f"{self.tencent_quote_base}{symbol}"
        raw_bytes = http_get_bytes(url, headers=TENCENT_HEADERS)
        try:
            text = raw_bytes.decode("gbk")
        except UnicodeDecodeError:
            text = raw_bytes.decode("utf-8", errors="ignore")
        raw = text.split('"', maxsplit=2)
        if len(raw) < 2:
            raise MarketDataError(f"{symbol} 腾讯快照响应异常")
        parts = raw[1].split("~")
        if len(parts) < 49:
            raise MarketDataError(f"{symbol} 腾讯快照字段不足")

        last_price = to_float(parts[3])
        prev_close = to_float(parts[4])
        change = to_float(parts[31])
        change_pct = to_float(parts[32])
        amount_wan = to_float(parts[37])
        total_value_yi = to_float(parts[44])
        circulating_value_yi = to_float(parts[45])

        return MarketSnapshot(
            symbol=symbol,
            name=parts[1] or symbol,
            source="tencent",
            last_price=last_price,
            prev_close=prev_close,
            open=to_float(parts[5]),
            high=to_float(parts[33]),
            low=to_float(parts[34]),
            volume=to_float(parts[6]),
            amount=(amount_wan * 10000.0) if amount_wan is not None else None,
            change=change if change is not None else _compute_change(last_price, prev_close),
            change_pct=change_pct if change_pct is not None else _compute_change_pct(last_price, prev_close),
            turnover_rate=to_float(parts[38]),
            amplitude_pct=to_float(parts[43]),
            pe_dynamic=to_float(parts[39]),
            pb=to_float(parts[46]),
            total_market_value=(total_value_yi * 100000000.0) if total_value_yi is not None else None,
            circulating_market_value=(
                circulating_value_yi * 100000000.0 if circulating_value_yi is not None else None
            ),
            upper_limit=to_float(parts[47]),
            lower_limit=to_float(parts[48]),
            timestamp=_format_tencent_timestamp(parts[30]),
        )


class SignalEngine:
    def __init__(self, config: Dict[str, Any]) -> None:
        self.config = config
        self.client = EastMoneyClient()

    def run(self, symbols: List[str]) -> List[SignalResult]:
        results: List[SignalResult] = []
        timeframe = self.config.get("timeframe", "1d")
        adjust = self.config.get("adjust", "qfq")
        source = self.config.get("data_source", "auto")
        history_bars = int(self.config.get("history_bars", 250))
        for symbol in symbols:
            result = self._analyze_symbol(symbol, timeframe, history_bars, adjust, source)
            results.append(result)
        return results

    def _analyze_symbol(
        self,
        symbol: str,
        timeframe: str,
        history_bars: int,
        adjust: str,
        source: str,
    ) -> SignalResult:
        warnings: List[str] = []
        name, bars = self.client.fetch_bars(symbol, timeframe, history_bars, adjust, source=source)
        if len(bars) < 3:
            raise MarketDataError(f"{symbol} 数据条数不足，至少需要 3 根 K 线")

        series = {
            "open": [bar.open for bar in bars],
            "close": [bar.close for bar in bars],
            "high": [bar.high for bar in bars],
            "low": [bar.low for bar in bars],
            "volume": [bar.volume for bar in bars],
            "amount": [bar.amount for bar in bars],
        }
        context = self._build_context(series, warnings)
        rule_context = self._build_rule_context(context)

        buy_rules = list(self.config.get("rules", {}).get("buy", []))
        sell_rules = list(self.config.get("rules", {}).get("sell", []))

        buy_matched, buy_warnings = self._evaluate_rules(buy_rules, rule_context, side="buy")
        sell_matched, sell_warnings = self._evaluate_rules(sell_rules, rule_context, side="sell")
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

        last_bar = bars[-1]
        return SignalResult(
            symbol=symbol,
            name=name,
            timeframe=timeframe,
            last_timestamp=last_bar.timestamp,
            last_price=last_bar.close,
            signal=signal,
            buy_hits=len(buy_matched),
            sell_hits=len(sell_matched),
            buy_total=len(buy_rules),
            sell_total=len(sell_rules),
            buy_matched=buy_matched,
            sell_matched=sell_matched,
            warnings=warnings,
            context=rule_context,
        )

    def _build_context(self, series: Dict[str, List[float]], warnings: List[str]) -> Dict[str, Any]:
        context: Dict[str, Any] = {}
        for field_name, values in series.items():
            context[field_name] = values[-1]
            context[f"prev_{field_name}"] = values[-2]

        indicators = self.config.get("indicators", {})
        for name, spec in indicators.items():
            indicator_type = spec.get("type")
            source_name = spec.get("source", "close")
            if source_name not in series:
                warnings.append(f"指标 {name} 使用了未知源字段 {source_name}")
                continue
            values = series[source_name]

            if indicator_type == "sma":
                output = sma(values, int(spec.get("window", 20)))
                self._register_series(context, name, output)
            elif indicator_type == "ema":
                output = ema(values, int(spec.get("window", 20)))
                self._register_series(context, name, output)
            elif indicator_type == "rsi":
                output = rsi(values, int(spec.get("window", 14)))
                self._register_series(context, name, output)
            elif indicator_type == "macd":
                macd_line, signal_line, hist_line = macd(
                    values,
                    fast=int(spec.get("fast", 12)),
                    slow=int(spec.get("slow", 26)),
                    signal=int(spec.get("signal", 9)),
                )
                self._register_series(context, name, macd_line)
                self._register_series(context, f"{name}_signal", signal_line)
                self._register_series(context, f"{name}_hist", hist_line)
            elif indicator_type == "bollinger":
                upper, mid, lower = bollinger(
                    values,
                    window=int(spec.get("window", 20)),
                    stddev=float(spec.get("stddev", 2.0)),
                )
                self._register_series(context, f"{name}_upper", upper)
                self._register_series(context, f"{name}_mid", mid)
                self._register_series(context, f"{name}_lower", lower)
            elif indicator_type == "atr":
                output = atr(
                    series["high"],
                    series["low"],
                    series["close"],
                    window=int(spec.get("window", 14)),
                )
                self._register_series(context, name, output)
            else:
                warnings.append(f"未知指标类型: {indicator_type} ({name})")
        return context

    @staticmethod
    def _register_series(
        context: Dict[str, Any],
        name: str,
        values: List[Optional[float]],
    ) -> None:
        latest = values[-1] if values else None
        prev = values[-2] if len(values) >= 2 else None
        context[name] = latest
        context[f"prev_{name}"] = prev

    @staticmethod
    def _build_rule_context(context: Dict[str, Any]) -> Dict[str, Any]:
        local_context = dict(context)

        def cross_over(left: str, right: str) -> bool:
            return _cross_compare(local_context, left, right, direction="over")

        def cross_under(left: str, right: str) -> bool:
            return _cross_compare(local_context, left, right, direction="under")

        local_context["cross_over"] = cross_over
        local_context["cross_under"] = cross_under
        local_context["abs"] = abs
        local_context["min"] = min
        local_context["max"] = max
        local_context["round"] = round
        return local_context

    def _evaluate_rules(
        self,
        rules: List[str],
        context: Dict[str, Any],
        side: str,
    ) -> Tuple[List[str], List[str]]:
        matched: List[str] = []
        warnings: List[str] = []
        for rule in rules:
            ok, warning = evaluate_rule(rule, context)
            if warning:
                warnings.append(f"{side} 规则 `{rule}`: {warning}")
            if ok:
                matched.append(rule)
        return matched, warnings


def _cross_compare(context: Dict[str, Any], left: str, right: str, direction: str) -> bool:
    left_now = context.get(left)
    right_now = context.get(right)
    left_prev = context.get(f"prev_{left}")
    right_prev = context.get(f"prev_{right}")
    if None in (left_now, right_now, left_prev, right_prev):
        return False
    if direction == "over":
        return left_now > right_now and left_prev <= right_prev
    return left_now < right_now and left_prev >= right_prev


def evaluate_rule(rule: str, context: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    try:
        result = eval(rule, {"__builtins__": {}}, context)
        return bool(result), None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def load_config(config_path: str) -> Dict[str, Any]:
    with open(config_path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def format_table(results: List[SignalResult]) -> str:
    rows = [
        [
            "Symbol",
            "Name",
            "Timeframe",
            "Last Time",
            "Last Price",
            "Signal",
            "Buy",
            "Sell",
        ]
    ]
    for result in results:
        rows.append(
            [
                result.symbol,
                result.name,
                result.timeframe,
                result.last_timestamp,
                f"{result.last_price:.4f}",
                result.signal,
                f"{result.buy_hits}/{result.buy_total}",
                f"{result.sell_hits}/{result.sell_total}",
            ]
        )

    widths = [max(len(str(row[idx])) for row in rows) for idx in range(len(rows[0]))]
    lines = []
    for idx, row in enumerate(rows):
        line = " | ".join(str(cell).ljust(widths[col]) for col, cell in enumerate(row))
        lines.append(line)
        if idx == 0:
            lines.append("-+-".join("-" * width for width in widths))

    for result in results:
        lines.append("")
        lines.append(f"[{result.symbol}] {result.name} -> {result.signal}")
        lines.append(
            f"  buy matched: {result.buy_hits}/{result.buy_total} | sell matched: {result.sell_hits}/{result.sell_total}"
        )
        if result.buy_matched:
            lines.append(f"  buy reasons : {'; '.join(result.buy_matched)}")
        if result.sell_matched:
            lines.append(f"  sell reasons: {'; '.join(result.sell_matched)}")
        if result.warnings:
            lines.append(f"  warnings    : {'; '.join(result.warnings)}")
    return "\n".join(lines)


def format_json(results: List[SignalResult]) -> str:
    payload = []
    for result in results:
        payload.append(
            {
                "symbol": result.symbol,
                "name": result.name,
                "timeframe": result.timeframe,
                "last_timestamp": result.last_timestamp,
                "last_price": result.last_price,
                "signal": result.signal,
                "buy_hits": result.buy_hits,
                "buy_total": result.buy_total,
                "sell_hits": result.sell_hits,
                "sell_total": result.sell_total,
                "buy_matched": result.buy_matched,
                "sell_matched": result.sell_matched,
                "warnings": result.warnings,
            }
        )
    return json.dumps(payload, ensure_ascii=False, indent=2)


def parse_symbols(config: Dict[str, Any], raw_override: Optional[str]) -> List[str]:
    if raw_override:
        symbols = [part.strip() for part in raw_override.split(",") if part.strip()]
    else:
        symbols = list(config.get("symbols", []))
    if not symbols:
        raise MarketDataError("没有可分析的代码，请在配置文件或 --symbols 中提供代码")
    return symbols


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="根据自定义指标规则输出买卖信号")
    parser.add_argument(
        "--config",
        default="config.example.json",
        help="JSON 配置文件路径，默认读取 config.example.json",
    )
    parser.add_argument(
        "--symbols",
        help="覆盖配置文件里的代码列表，多个代码用逗号分隔，例如 sh600519,sh000001",
    )
    parser.add_argument(
        "--output",
        choices=("table", "json"),
        default="table",
        help="输出格式",
    )
    parser.add_argument(
        "--watch",
        type=int,
        default=0,
        help="轮询秒数，0 表示只执行一次",
    )
    return parser


def print_output(results: List[SignalResult], output_format: str) -> None:
    if output_format == "json":
        print(format_json(results))
    else:
        print(format_table(results))


def main() -> int:
    parser = build_arg_parser()
    args = parser.parse_args()

    try:
        config = load_config(args.config)
        symbols = parse_symbols(config, args.symbols)
        engine = SignalEngine(config)

        while True:
            results = engine.run(symbols)
            print_output(results, args.output)
            if args.watch <= 0:
                break
            print("")
            print(f"next refresh in {args.watch}s")
            time.sleep(args.watch)
        return 0
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
