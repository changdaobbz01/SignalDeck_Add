#!/usr/bin/env python3
from __future__ import annotations

import copy
import json
import os
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from market_signal_tool import Bar, MarketDataError, atr, bollinger, ema, macd, rsi, sma


SUPPORTED_STRATEGY_TIMEFRAMES = {
    "1m",
    "5m",
    "15m",
    "30m",
    "60m",
    "120m",
    "1d",
    "1w",
    "1M",
    "1q",
}


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


def load_strategy_catalog(path: str) -> Dict[str, Dict[str, Any]]:
    if not os.path.exists(path):
        raise MarketDataError(f"Strategy catalog not found: {path}")
    with open(path, "r", encoding="utf-8") as file:
        payload = json.load(file)

    raw_items = payload.get("strategies") if isinstance(payload, dict) else payload
    if not isinstance(raw_items, list):
        raise MarketDataError("Strategy catalog must contain a strategy list")

    strategies: Dict[str, Dict[str, Any]] = {}
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        strategy = normalize_strategy_record(raw)
        strategies[strategy["id"]] = strategy
    return strategies


def normalize_strategy_record(raw: Dict[str, Any]) -> Dict[str, Any]:
    strategy = copy.deepcopy(raw)
    strategy_id = str(strategy.get("id") or "").strip().lower()
    if not strategy_id:
        raise MarketDataError("Strategy id is required")

    mode = str(strategy.get("mode") or ("composite" if strategy.get("components") else "simple")).strip().lower()
    if mode not in {"simple", "composite"}:
        raise MarketDataError(f"Unsupported strategy mode: {mode}")

    strategy["id"] = strategy_id
    strategy["mode"] = mode
    strategy["engine"] = "advanced"
    strategy["type"] = str(strategy.get("type") or "builtin").strip().lower() or "builtin"
    strategy["label"] = str(strategy.get("label") or strategy_id).strip() or strategy_id
    strategy["description"] = str(strategy.get("description") or strategy["label"]).strip()
    strategy["timeframe"] = str(strategy.get("timeframe") or "").strip()
    strategy["lookback_bars"] = max(60, int(strategy.get("lookback_bars") or 160))
    strategy["indicators"] = [item for item in strategy.get("indicators") or [] if isinstance(item, dict)]
    strategy["buy_rules"] = [str(item).strip() for item in strategy.get("buy_rules") or [] if str(item).strip()]
    strategy["sell_rules"] = [str(item).strip() for item in strategy.get("sell_rules") or [] if str(item).strip()]
    strategy["notes"] = [str(item).strip() for item in strategy.get("notes") or [] if str(item).strip()]
    strategy["primary_component"] = str(strategy.get("primary_component") or "").strip().lower()
    strategy["priority_component"] = str(strategy.get("priority_component") or "").strip().lower()
    strategy["priority_indicator"] = str(strategy.get("priority_indicator") or "j").strip().lower() or "j"

    if mode == "simple":
        timeframe = _normalize_timeframe(strategy.get("timeframe") or "5m")
        strategy["timeframe"] = timeframe
        strategy["indicator_specs"] = _normalize_indicator_specs(strategy.get("indicator_specs") or {})
        strategy["buy_rules_eval"] = [
            str(item).strip() for item in strategy.get("buy_rules_eval") or [] if str(item).strip()
        ]
        strategy["sell_rules_eval"] = [
            str(item).strip() for item in strategy.get("sell_rules_eval") or [] if str(item).strip()
        ]
        if not strategy["primary_component"]:
            strategy["primary_component"] = "main"
        if not strategy["priority_component"]:
            strategy["priority_component"] = strategy["primary_component"]
        return strategy

    components = []
    for raw_component in strategy.get("components") or []:
        if not isinstance(raw_component, dict):
            continue
        components.append(_normalize_component(raw_component))
    if not components:
        raise MarketDataError(f"Composite strategy {strategy_id} must define components")

    strategy["components"] = components
    strategy["buy_all"] = [str(item).strip() for item in strategy.get("buy_all") or [] if str(item).strip()]
    strategy["buy_any"] = [str(item).strip() for item in strategy.get("buy_any") or [] if str(item).strip()]
    strategy["sell_all"] = [str(item).strip() for item in strategy.get("sell_all") or [] if str(item).strip()]
    strategy["sell_any"] = [str(item).strip() for item in strategy.get("sell_any") or [] if str(item).strip()]

    if not strategy["primary_component"]:
        strategy["primary_component"] = components[0]["id"]
    if not strategy["priority_component"]:
        strategy["priority_component"] = strategy["primary_component"]
    return strategy


def evaluate_strategy_record(
    symbol: str,
    strategy: Dict[str, Any],
    source: str,
    fetch_bars: Callable[[str, int], Tuple[str, List[Bar], str]],
) -> Dict[str, Any]:
    mode = str(strategy.get("mode") or "simple").strip().lower()
    if mode == "simple":
        return _evaluate_simple_strategy(symbol, strategy, source, fetch_bars)
    return _evaluate_composite_strategy(symbol, strategy, source, fetch_bars)


def _normalize_component(raw: Dict[str, Any]) -> Dict[str, Any]:
    component = copy.deepcopy(raw)
    component_id = str(component.get("id") or "").strip().lower()
    if not component_id:
        raise MarketDataError("Strategy component id is required")

    component["id"] = component_id
    component["label"] = str(component.get("label") or component_id).strip() or component_id
    component["timeframe"] = _normalize_timeframe(component.get("timeframe") or "5m")
    component["lookback_bars"] = max(60, int(component.get("lookback_bars") or 160))
    component["min_bars"] = max(35, int(component.get("min_bars") or 60))
    component["indicator_specs"] = _normalize_indicator_specs(component.get("indicator_specs") or {})

    checks: Dict[str, List[str]] = {}
    for key, value in (component.get("checks") or {}).items():
        rules = [str(item).strip() for item in value or [] if str(item).strip()]
        checks[str(key).strip().lower()] = rules
    component["checks"] = checks
    return component


def _normalize_indicator_specs(raw: Any) -> List[Dict[str, Any]]:
    specs: List[Dict[str, Any]] = []
    if isinstance(raw, dict):
        for key, value in raw.items():
            if not isinstance(value, dict):
                continue
            specs.append({"name": str(key).strip(), **copy.deepcopy(value)})
    elif isinstance(raw, list):
        for value in raw:
            if not isinstance(value, dict):
                continue
            specs.append(copy.deepcopy(value))
    return specs


def _normalize_timeframe(value: Any) -> str:
    timeframe = str(value or "").strip()
    if timeframe not in SUPPORTED_STRATEGY_TIMEFRAMES:
        raise MarketDataError(f"Unsupported strategy timeframe: {timeframe}")
    return timeframe


def _evaluate_simple_strategy(
    symbol: str,
    strategy: Dict[str, Any],
    source: str,
    fetch_bars: Callable[[str, int], Tuple[str, List[Bar], str]],
) -> Dict[str, Any]:
    component = {
        "id": str(strategy.get("primary_component") or "main").strip().lower() or "main",
        "label": strategy.get("label") or strategy.get("id") or "strategy",
        "timeframe": strategy["timeframe"],
        "lookback_bars": max(60, int(strategy.get("lookback_bars") or 160)),
        "min_bars": max(35, int(strategy.get("lookback_bars") or 160) // 2),
        "indicator_specs": _normalize_indicator_specs(strategy.get("indicator_specs") or {}),
        "checks": {
            "buy": [str(item).strip() for item in strategy.get("buy_rules_eval") or [] if str(item).strip()],
            "sell": [str(item).strip() for item in strategy.get("sell_rules_eval") or [] if str(item).strip()],
        },
    }
    component_result = _evaluate_component(component, fetch_bars)
    buy_hit = component_result["checks"].get("buy", {}).get("ok", False)
    sell_hit = component_result["checks"].get("sell", {}).get("ok", False)
    reason = _build_simple_reason(strategy, component_result, buy_hit, sell_hit)
    signal, priority_score, priority_label = _resolve_signal_and_priority(
        buy_hit,
        sell_hit,
        component_result["indicator_payload"],
        strategy.get("priority_indicator") or "j",
    )

    timestamp = component_result["timestamp"]
    return {
        "symbol": symbol,
        "name": component_result["name"],
        "strategy": copy.deepcopy(strategy),
        "signal": signal,
        "triggered": signal in {"BUY", "SELL"},
        "timestamp": timestamp,
        "actual_source": component_result["actual_source"],
        "priority": {
            "score": _round_optional(priority_score, 2),
            "label": priority_label,
        },
        "indicators": component_result["indicator_payload"],
        "reason": reason,
        "details": {
            "components": {
                component_result["id"]: component_result,
            }
        },
        "alert_key": f"{strategy['id']}:{symbol}:{signal}:{timestamp}",
    }


def _evaluate_composite_strategy(
    symbol: str,
    strategy: Dict[str, Any],
    source: str,
    fetch_bars: Callable[[str, int], Tuple[str, List[Bar], str]],
) -> Dict[str, Any]:
    component_results: Dict[str, Dict[str, Any]] = {}
    for component in strategy.get("components") or []:
        component_results[component["id"]] = _evaluate_component(component, fetch_bars)

    buy_hit = _refs_all_true(strategy.get("buy_all") or [], component_results) and _refs_any_true(
        strategy.get("buy_any") or [],
        component_results,
    )
    sell_hit = _refs_all_true(strategy.get("sell_all") or [], component_results) and _refs_any_true(
        strategy.get("sell_any") or [],
        component_results,
    )
    decision = _build_composite_decision_logic(strategy, component_results, buy_hit, sell_hit)
    reason = _build_composite_reason(strategy, component_results, buy_hit, sell_hit, decision)

    primary_id = str(strategy.get("primary_component") or "").strip().lower()
    priority_id = str(strategy.get("priority_component") or primary_id).strip().lower()
    primary_component = component_results.get(primary_id) or next(iter(component_results.values()))
    priority_component = component_results.get(priority_id) or primary_component
    signal, priority_score, priority_label = _resolve_signal_and_priority(
        buy_hit,
        sell_hit,
        priority_component["indicator_payload"],
        strategy.get("priority_indicator") or "j",
    )

    timestamp = primary_component["timestamp"]
    return {
        "symbol": symbol,
        "name": primary_component["name"],
        "strategy": copy.deepcopy(strategy),
        "signal": signal,
        "triggered": signal in {"BUY", "SELL"},
        "timestamp": timestamp,
        "actual_source": primary_component["actual_source"],
        "priority": {
            "score": _round_optional(priority_score, 2),
            "label": priority_label,
        },
        "indicators": priority_component["indicator_payload"],
        "reason": reason,
        "details": {
            "components": component_results,
            "buy_all": list(strategy.get("buy_all") or []),
            "buy_any": list(strategy.get("buy_any") or []),
            "sell_all": list(strategy.get("sell_all") or []),
            "sell_any": list(strategy.get("sell_any") or []),
            "decision": decision,
        },
        "alert_key": f"{strategy['id']}:{symbol}:{signal}:{timestamp}",
    }


def _evaluate_component(
    component: Dict[str, Any],
    fetch_bars: Callable[[str, int], Tuple[str, List[Bar], str]],
) -> Dict[str, Any]:
    timeframe = component["timeframe"]
    lookback_bars = max(component.get("lookback_bars") or 160, component.get("min_bars") or 60)
    name, bars, actual_source = fetch_bars(timeframe, lookback_bars)
    if len(bars) < int(component.get("min_bars") or 35):
        raise MarketDataError(f"Not enough bars for {component['label']} ({timeframe})")

    rule_context, series_context, indicator_payload = _build_rule_contexts(bars, component.get("indicator_specs") or [])
    checks: Dict[str, Dict[str, Any]] = {}
    for check_name, rules in (component.get("checks") or {}).items():
        matched: List[str] = []
        warnings: List[str] = []
        for rule in rules:
            ok, warning = _safe_eval(rule, rule_context)
            if warning:
                warnings.append(warning)
            if ok:
                matched.append(rule)
        checks[check_name] = {
            "ok": bool(rules) and len(matched) == len(rules),
            "rules": list(rules),
            "matched": matched,
            "warnings": warnings,
        }

    return {
        "id": component["id"],
        "label": component["label"],
        "timeframe": timeframe,
        "name": name,
        "timestamp": bars[-1].timestamp,
        "actual_source": actual_source,
        "checks": checks,
        "indicator_payload": indicator_payload,
    }


def _build_rule_contexts(
    bars: List[Bar],
    indicator_specs: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, List[Optional[float]]], Dict[str, Optional[float]]]:
    series_context: Dict[str, List[Optional[float]]] = {}
    rule_context: Dict[str, Any] = {}

    base_series = {
        "open": [bar.open for bar in bars],
        "close": [bar.close for bar in bars],
        "high": [bar.high for bar in bars],
        "low": [bar.low for bar in bars],
        "volume": [bar.volume for bar in bars],
        "amount": [bar.amount for bar in bars],
    }
    for name, values in base_series.items():
        _register_series(rule_context, series_context, name, values)

    for spec in indicator_specs:
        indicator_type = str(spec.get("type") or "").strip().lower()
        source_name = str(spec.get("source") or "close").strip().lower()
        source_values = _context_series(series_context, source_name)
        if not source_values and indicator_type not in {"atr", "kdj"}:
            raise MarketDataError(f"Unknown indicator source: {source_name}")

        if indicator_type == "sma":
            _register_series(
                rule_context,
                series_context,
                str(spec.get("name") or "").strip(),
                sma(_require_float_series(source_values), int(spec.get("window") or 20)),
            )
        elif indicator_type == "ema":
            _register_series(
                rule_context,
                series_context,
                str(spec.get("name") or "").strip(),
                ema(_context_series(series_context, source_name), int(spec.get("window") or 20)),
            )
        elif indicator_type == "rsi":
            _register_series(
                rule_context,
                series_context,
                str(spec.get("name") or "").strip(),
                rsi(_require_float_series(source_values), int(spec.get("window") or 14)),
            )
        elif indicator_type == "macd":
            dif_values, dea_values, hist_values = macd(
                _require_float_series(source_values),
                fast=int(spec.get("fast") or 12),
                slow=int(spec.get("slow") or 26),
                signal=int(spec.get("signal") or 9),
            )
            main_name = str(spec.get("name") or "macd").strip()
            signal_name = str(spec.get("signal_name") or f"{main_name}_signal").strip()
            hist_name = str(spec.get("hist_name") or f"{main_name}_hist").strip()
            _register_series(rule_context, series_context, main_name, dif_values)
            _register_series(rule_context, series_context, signal_name, dea_values)
            _register_series(rule_context, series_context, hist_name, hist_values)
        elif indicator_type == "bollinger":
            upper_values, mid_values, lower_values = bollinger(
                _require_float_series(source_values),
                window=int(spec.get("window") or 20),
                stddev=float(spec.get("stddev") or 2.0),
            )
            base_name = str(spec.get("name") or "boll").strip()
            _register_series(rule_context, series_context, f"{base_name}_upper", upper_values)
            _register_series(rule_context, series_context, f"{base_name}_mid", mid_values)
            _register_series(rule_context, series_context, f"{base_name}_lower", lower_values)
        elif indicator_type == "atr":
            atr_values = atr(
                _require_float_series(_context_series(series_context, "high")),
                _require_float_series(_context_series(series_context, "low")),
                _require_float_series(_context_series(series_context, "close")),
                window=int(spec.get("window") or 14),
            )
            _register_series(rule_context, series_context, str(spec.get("name") or "atr").strip(), atr_values)
        elif indicator_type == "kdj":
            k_values, d_values, j_values = calc_kdj(
                _require_float_series(_context_series(series_context, "high")),
                _require_float_series(_context_series(series_context, "low")),
                _require_float_series(_context_series(series_context, "close")),
                window=int(spec.get("window") or 9),
            )
            _register_series(rule_context, series_context, str(spec.get("k_name") or "k").strip(), k_values)
            _register_series(rule_context, series_context, str(spec.get("d_name") or "d").strip(), d_values)
            _register_series(rule_context, series_context, str(spec.get("j_name") or "j").strip(), j_values)
        else:
            raise MarketDataError(f"Unsupported indicator type: {indicator_type}")

    def cross_over(left: str, right: str) -> bool:
        return _cross_compare(rule_context, left, right, direction="over")

    def cross_under(left: str, right: str) -> bool:
        return _cross_compare(rule_context, left, right, direction="under")

    def bullish_divergence(
        price_name: str = "close",
        indicator_name: str = "dif",
        lookback: int = 60,
        pivot_window: int = 3,
        min_separation: int = 4,
    ) -> bool:
        return _detect_divergence(
            series_context,
            price_name,
            indicator_name,
            bullish=True,
            lookback=lookback,
            pivot_window=pivot_window,
            min_separation=min_separation,
        )

    def bearish_divergence(
        price_name: str = "close",
        indicator_name: str = "dif",
        lookback: int = 60,
        pivot_window: int = 3,
        min_separation: int = 4,
    ) -> bool:
        return _detect_divergence(
            series_context,
            price_name,
            indicator_name,
            bullish=False,
            lookback=lookback,
            pivot_window=pivot_window,
            min_separation=min_separation,
        )

    def near(left: str, right: str, pct: float = 0.015) -> bool:
        left_value = _context_value(rule_context, left)
        right_value = _context_value(rule_context, right)
        if left_value is None or right_value in (None, 0):
            return False
        return abs(float(left_value) - float(right_value)) / abs(float(right_value)) <= float(pct)

    rule_context["cross_over"] = cross_over
    rule_context["cross_under"] = cross_under
    rule_context["bullish_divergence"] = bullish_divergence
    rule_context["bearish_divergence"] = bearish_divergence
    rule_context["near"] = near
    rule_context["abs"] = abs
    rule_context["min"] = min
    rule_context["max"] = max
    rule_context["round"] = round

    indicator_payload = {
        name: _round_optional(_context_value(rule_context, name), 4 if name in {"dif", "dea"} else 2)
        for name in ("dif", "dea", "k", "d", "j", "ma5", "ma20", "ma60", "vol_ma5")
        if _context_value(rule_context, name) is not None
    }
    return rule_context, series_context, indicator_payload


def _register_series(
    rule_context: Dict[str, Any],
    series_context: Dict[str, List[Optional[float]]],
    name: str,
    values: Iterable[Optional[float]],
) -> None:
    cleaned_name = str(name or "").strip()
    if not cleaned_name:
        raise MarketDataError("Indicator name is required")

    series = [None if value is None else float(value) for value in values]
    latest = _last_valid_value(series)
    prev = _last_valid_value(series[:-1]) if len(series) >= 2 else None

    for alias in _aliases_for_name(cleaned_name):
        series_context[alias] = series
        rule_context[alias] = latest
        rule_context[f"prev_{alias}"] = prev


def _aliases_for_name(name: str) -> List[str]:
    aliases = [name]
    lower_name = name.lower()
    upper_name = name.upper()
    if lower_name not in aliases:
        aliases.append(lower_name)
    if upper_name not in aliases:
        aliases.append(upper_name)
    return aliases


def _context_series(series_context: Dict[str, List[Optional[float]]], name: str) -> List[Optional[float]]:
    lookup_key = _lookup_key(series_context, name)
    return list(series_context.get(lookup_key) or [])


def _context_value(rule_context: Dict[str, Any], name: str) -> Optional[float]:
    lookup_key = _lookup_key(rule_context, name)
    value = rule_context.get(lookup_key)
    if value is None:
        return None
    return float(value)


def _lookup_key(container: Dict[str, Any], name: str) -> str:
    raw = str(name or "").strip()
    if raw in container:
        return raw
    lowered = raw.lower()
    if lowered in container:
        return lowered
    uppered = raw.upper()
    if uppered in container:
        return uppered
    return raw


def _safe_eval(rule: str, context: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    try:
        result = eval(rule, {"__builtins__": {}}, context)
        return bool(result), None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def _cross_compare(context: Dict[str, Any], left: str, right: str, direction: str) -> bool:
    left_key = _lookup_key(context, left)
    right_key = _lookup_key(context, right)
    left_now = context.get(left_key)
    right_now = context.get(right_key)
    left_prev = context.get(f"prev_{left_key}")
    right_prev = context.get(f"prev_{right_key}")
    if None in (left_now, right_now, left_prev, right_prev):
        return False
    if direction == "over":
        return float(left_now) > float(right_now) and float(left_prev) <= float(right_prev)
    return float(left_now) < float(right_now) and float(left_prev) >= float(right_prev)


def _detect_divergence(
    series_context: Dict[str, List[Optional[float]]],
    price_name: str,
    indicator_name: str,
    bullish: bool,
    lookback: int,
    pivot_window: int,
    min_separation: int,
) -> bool:
    prices = _context_series(series_context, price_name)
    indicators = _context_series(series_context, indicator_name)
    if not prices or not indicators:
        return False

    count = min(len(prices), len(indicators), max(lookback, 10))
    price_window = prices[-count:]
    indicator_window = indicators[-count:]
    pivot_indices = _pivot_indices(
        price_window,
        pivot_window=max(1, int(pivot_window)),
        bullish=bullish,
    )
    if len(pivot_indices) < 2:
        return False

    selected: List[int] = []
    for index in reversed(pivot_indices):
        if not selected:
            selected.append(index)
            continue
        if selected[0] - index >= max(1, int(min_separation)):
            selected.append(index)
            break
    if len(selected) < 2:
        return False

    second_index, first_index = sorted(selected)
    price_first = price_window[first_index]
    price_second = price_window[second_index]
    indicator_first = indicator_window[first_index]
    indicator_second = indicator_window[second_index]
    if None in (price_first, price_second, indicator_first, indicator_second):
        return False

    if bullish:
        return float(price_second) < float(price_first) and float(indicator_second) > float(indicator_first)
    return float(price_second) > float(price_first) and float(indicator_second) < float(indicator_first)


def collect_divergence_pairs(
    prices: List[Optional[float]],
    indicators: List[Optional[float]],
    bullish: bool,
    lookback: Optional[int] = None,
    pivot_window: int = 3,
    min_separation: int = 4,
    max_pairs: int = 6,
) -> List[Dict[str, Any]]:
    if not prices or not indicators:
        return []

    count = min(len(prices), len(indicators))
    if lookback is not None:
        count = min(count, max(int(lookback), 10))
    if count < (max(1, int(pivot_window)) * 2) + 1:
        return []

    offset = len(prices) - count
    price_window = prices[-count:]
    indicator_window = indicators[-count:]
    pivot_indices = _pivot_indices(
        price_window,
        pivot_window=max(1, int(pivot_window)),
        bullish=bullish,
    )
    if len(pivot_indices) < 2:
        return []

    pairs: List[Dict[str, Any]] = []
    separation = max(1, int(min_separation))
    for current_pos, second_index in enumerate(pivot_indices):
        price_second = price_window[second_index]
        indicator_second = indicator_window[second_index]
        if price_second is None or indicator_second is None:
            continue

        matched_pair: Optional[Dict[str, Any]] = None
        for first_index in reversed(pivot_indices[:current_pos]):
            if second_index - first_index < separation:
                continue
            price_first = price_window[first_index]
            indicator_first = indicator_window[first_index]
            if None in (price_first, indicator_first):
                continue

            if bullish:
                matched = float(price_second) < float(price_first) and float(indicator_second) > float(indicator_first)
            else:
                matched = float(price_second) > float(price_first) and float(indicator_second) < float(indicator_first)
            if not matched:
                continue

            matched_pair = {
                "first_index": offset + first_index,
                "second_index": offset + second_index,
                "first_price": float(price_first),
                "second_price": float(price_second),
                "first_indicator": float(indicator_first),
                "second_indicator": float(indicator_second),
            }
            break

        if matched_pair:
            pairs.append(matched_pair)

    if max_pairs > 0 and len(pairs) > max_pairs:
        return pairs[-max_pairs:]
    return pairs


def _pivot_indices(values: List[Optional[float]], pivot_window: int, bullish: bool) -> List[int]:
    result: List[int] = []
    if len(values) < (pivot_window * 2) + 1:
        return result
    for index in range(pivot_window, len(values) - pivot_window):
        current = values[index]
        if current is None:
            continue
        left = values[index - pivot_window : index]
        right = values[index + 1 : index + pivot_window + 1]
        neighbors = [item for item in left + right if item is not None]
        if len(neighbors) < pivot_window * 2:
            continue
        if bullish and all(float(current) <= float(item) for item in neighbors):
            result.append(index)
        if not bullish and all(float(current) >= float(item) for item in neighbors):
            result.append(index)
    return result


def _refs_all_true(refs: List[str], component_results: Dict[str, Dict[str, Any]]) -> bool:
    if not refs:
        return True
    return all(_ref_result(ref, component_results) for ref in refs)


def _refs_any_true(refs: List[str], component_results: Dict[str, Dict[str, Any]]) -> bool:
    if not refs:
        return True
    return any(_ref_result(ref, component_results) for ref in refs)


def _ref_result(ref: str, component_results: Dict[str, Dict[str, Any]]) -> bool:
    component_id, check_name = _split_ref(ref)
    component = component_results.get(component_id)
    if not component:
        return False
    return bool(component.get("checks", {}).get(check_name, {}).get("ok"))


def _split_ref(ref: str) -> Tuple[str, str]:
    raw = str(ref or "").strip().lower()
    if "." not in raw:
        return raw, "pass"
    component_id, check_name = raw.split(".", 1)
    return component_id, check_name


def _build_simple_reason(
    strategy: Dict[str, Any],
    component_result: Dict[str, Any],
    buy_hit: bool,
    sell_hit: bool,
) -> str:
    if buy_hit and not sell_hit:
        return " + ".join(strategy.get("buy_rules") or component_result["checks"].get("buy", {}).get("matched") or [])
    if sell_hit and not buy_hit:
        return " + ".join(strategy.get("sell_rules") or component_result["checks"].get("sell", {}).get("matched") or [])
    if buy_hit and sell_hit:
        return "Buy and sell conditions matched at the same time"
    return f"{strategy.get('label') or strategy.get('id')} conditions not met"


def _build_composite_reason(
    strategy: Dict[str, Any],
    component_results: Dict[str, Dict[str, Any]],
    buy_hit: bool,
    sell_hit: bool,
    decision: Optional[Dict[str, Any]] = None,
) -> str:
    if buy_hit and not sell_hit:
        entries = _decision_entries(decision, "buy")
        if entries:
            return _summarize_decision_entries(entries)
        refs = list(strategy.get("buy_all") or [])
        refs.extend([ref for ref in strategy.get("buy_any") or [] if _ref_result(ref, component_results)])
        return _summarize_refs(refs, component_results)
    if sell_hit and not buy_hit:
        entries = _decision_entries(decision, "sell")
        if entries:
            return _summarize_decision_entries(entries)
        refs = list(strategy.get("sell_all") or [])
        refs.extend([ref for ref in strategy.get("sell_any") or [] if _ref_result(ref, component_results)])
        return _summarize_refs(refs, component_results)
    if buy_hit and sell_hit:
        return "Buy and sell conditions matched at the same time"
    return f"{strategy.get('label') or strategy.get('id')} conditions not met"


def _build_composite_decision_logic(
    strategy: Dict[str, Any],
    component_results: Dict[str, Dict[str, Any]],
    buy_hit: bool,
    sell_hit: bool,
) -> Dict[str, Any]:
    if buy_hit and not sell_hit:
        active_side = "buy"
    elif sell_hit and not buy_hit:
        active_side = "sell"
    elif buy_hit and sell_hit:
        active_side = "both"
    else:
        active_side = "none"

    return {
        "active_side": active_side,
        "buy": _build_ref_group_logic(
            strategy.get("buy_all") or [],
            strategy.get("buy_any") or [],
            component_results,
            buy_hit,
        ),
        "sell": _build_ref_group_logic(
            strategy.get("sell_all") or [],
            strategy.get("sell_any") or [],
            component_results,
            sell_hit,
        ),
    }


def _build_ref_group_logic(
    all_refs: List[str],
    any_refs: List[str],
    component_results: Dict[str, Dict[str, Any]],
    triggered: bool,
) -> Dict[str, Any]:
    all_entries = [_build_ref_detail(ref, component_results) for ref in all_refs]
    any_entries = [_build_ref_detail(ref, component_results) for ref in any_refs]
    matched_all = [entry for entry in all_entries if entry.get("matched")]
    matched_any = [entry for entry in any_entries if entry.get("matched")]
    missing_all = [entry for entry in all_entries if not entry.get("matched")]
    return {
        "all": all_entries,
        "any": any_entries,
        "all_ok": not all_refs or not missing_all,
        "any_ok": not any_refs or bool(matched_any),
        "triggered": triggered,
        "matched_all": matched_all,
        "matched_any": matched_any,
        "missing_all": missing_all,
    }


def _build_ref_detail(ref: str, component_results: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    component_id, check_name = _split_ref(ref)
    component = component_results.get(component_id) or {}
    checks = component.get("checks") or {}
    check = checks.get(check_name) or {}
    return {
        "ref": ref,
        "component_id": component_id,
        "component_label": component.get("label") or component_id,
        "timeframe": component.get("timeframe") or "--",
        "check_id": check_name,
        "matched": bool(check.get("ok")),
        "matched_rules": list(check.get("matched") or []),
        "rules": list(check.get("rules") or []),
        "warnings": list(check.get("warnings") or []),
    }


def _decision_entries(decision: Optional[Dict[str, Any]], side: str) -> List[Dict[str, Any]]:
    if not decision:
        return []
    side_state = decision.get(side) or {}
    matched_all = list(side_state.get("matched_all") or [])
    matched_any = list(side_state.get("matched_any") or [])
    return matched_all + matched_any


def _summarize_refs(refs: List[str], component_results: Dict[str, Dict[str, Any]]) -> str:
    parts: List[str] = []
    for ref in refs:
        component_id, check_name = _split_ref(ref)
        component = component_results.get(component_id)
        if not component:
            continue
        label = component.get("label") or component_id
        parts.append(f"{label}:{check_name}")
    return " + ".join(parts) or "Strategy conditions met"


def _summarize_decision_entries(entries: List[Dict[str, Any]]) -> str:
    parts: List[str] = []
    for entry in entries:
        component_label = str(entry.get("component_label") or entry.get("component_id") or "").strip()
        check_name = str(entry.get("check_id") or "pass").strip()
        if component_label:
            parts.append(f"{component_label}:{check_name}")
        else:
            parts.append(str(entry.get("ref") or "").strip())
    return " + ".join([part for part in parts if part]) or "Strategy conditions met"


def _resolve_signal_and_priority(
    buy_hit: bool,
    sell_hit: bool,
    indicator_payload: Dict[str, Optional[float]],
    priority_indicator: str,
) -> Tuple[str, Optional[float], str]:
    raw_priority = indicator_payload.get(str(priority_indicator or "j").strip().lower())
    if buy_hit and not sell_hit:
        if raw_priority is None:
            return "BUY", None, "--"
        return "BUY", float(raw_priority), _priority_label_high(float(raw_priority))
    if sell_hit and not buy_hit:
        if raw_priority is None:
            return "SELL", None, "--"
        score = 100.0 - float(raw_priority)
        return "SELL", score, _priority_label_low(float(raw_priority))
    if buy_hit and sell_hit:
        return "HOLD", None, "--"
    return "HOLD", None, "--"


def _priority_label_high(value: float) -> str:
    if value >= 80:
        return "高"
    if value >= 50:
        return "中"
    return "低"


def _priority_label_low(value: float) -> str:
    if value <= 20:
        return "高"
    if value <= 50:
        return "中"
    return "低"


def _last_valid_value(values: Iterable[Optional[float]]) -> Optional[float]:
    for value in reversed(list(values)):
        if value is None:
            continue
        return float(value)
    return None


def _require_float_series(values: List[Optional[float]]) -> List[float]:
    result: List[float] = []
    for value in values:
        if value is None:
            result.append(0.0)
        else:
            result.append(float(value))
    return result


def _round_optional(value: Optional[float], digits: int = 4) -> Optional[float]:
    if value is None:
        return None
    return round(float(value), digits)
