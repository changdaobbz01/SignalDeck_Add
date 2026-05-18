#!/usr/bin/env python3
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlencode

from market_signal_tool import MarketDataError, http_get_json


def normalize_query_symbol(raw: str) -> Optional[str]:
    query = str(raw or "").strip().lower()
    if re.fullmatch(r"(sh|sz)\d{6}", query):
        return query
    return None


def normalize_import_query(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""

    direct_match = re.search(r"\b(sh|sz)\s*(\d{6})\b", text, flags=re.IGNORECASE)
    if direct_match:
        return f"{direct_match.group(1).lower()}{direct_match.group(2)}"

    code_match = re.search(r"(?<!\d)(\d{6})(?!\d)", text)
    if code_match:
        return code_match.group(1)

    return text[:64]


@dataclass(frozen=True)
class SecuritySearchItem:
    symbol: str
    code: str
    name: str
    security_type: str

    def to_payload(self) -> Dict[str, Any]:
        market = self.symbol[:2].upper() if len(self.symbol) >= 2 else ""
        return {
            "symbol": self.symbol,
            "code": self.code,
            "name": self.name,
            "market": market,
            "security_type": self.security_type,
            "display": f"{self.symbol.upper()} · {self.name}",
        }


def score_search_result(query: str, item: SecuritySearchItem) -> int:
    q = query.strip().lower()
    symbol = item.symbol.lower()
    code = item.code.lower()
    name = item.name.lower()
    security_type = item.security_type.lower()

    score = 0
    if q == code:
        score += 300
    elif code.startswith(q):
        score += 220
    elif q in code:
        score += 140

    if q == symbol:
        score += 280
    elif symbol.startswith(q):
        score += 180
    elif q in symbol:
        score += 120

    if q == name:
        score += 260
    elif name.startswith(q):
        score += 200
    elif q in name:
        score += 150

    if q and q in security_type:
        score += 30
    return score


class SearchProvider:
    provider_id = ""

    def search(self, query: str, limit: int = 12) -> List[SecuritySearchItem]:
        raise NotImplementedError

    def warm_cache(self) -> None:
        return None


class EastMoneySearchProvider(SearchProvider):
    provider_id = "eastmoney"

    search_token = "D43BF722C8E33BDC906FB84D85E326E8"
    search_base = "https://searchapi.eastmoney.com/api/suggest/get"
    clist_base = "https://push2.eastmoney.com/api/qt/clist/get"
    clist_ut = "bd1d9ddb04089700cf9c27f6f7426281"
    clist_page_size = 100
    search_universe_ttl = 6 * 60 * 60
    search_universe_segments = [
        ("b:MK0021,b:MK0022,b:MK0023,b:MK0024", "ETF"),
    ]

    def __init__(self) -> None:
        self._universe_cache: Dict[str, Any] = {"items": [], "loaded_at": 0.0}
        self._universe_lock = Lock()
        self._prefix_segment_cache: Dict[str, Any] = {}
        self._prefix_lock = Lock()

    def search(self, query: str, limit: int = 12) -> List[SecuritySearchItem]:
        query = query.strip()
        if not query:
            return []

        direct_symbol = normalize_query_symbol(query)
        is_exact_code = bool(re.fullmatch(r"\d{6}", query))
        is_exact_symbol = bool(direct_symbol)
        fallback_item = (
            SecuritySearchItem(
                symbol=direct_symbol,
                code=direct_symbol[2:],
                name=direct_symbol.upper(),
                security_type="Direct",
            )
            if direct_symbol
            else None
        )

        query_variants = [query]
        if direct_symbol and direct_symbol[2:] not in query_variants:
            query_variants.append(direct_symbol[2:])

        seen: set[str] = set()
        results: List[SecuritySearchItem] = []
        for query_text in query_variants:
            params = {
                "input": query_text,
                "type": 14,
                "token": self.search_token,
            }
            payload = http_get_json(f"{self.search_base}?{urlencode(params)}")
            rows = (payload.get("QuotationCodeTable") or {}).get("Data") or []

            for item in rows:
                code = str(item.get("Code") or "").strip()
                quote_id = str(item.get("QuoteID") or "").strip()
                symbol = self._quote_id_to_symbol(quote_id, code)
                if not symbol or symbol in seen:
                    continue
                seen.add(symbol)
                results.append(
                    SecuritySearchItem(
                        symbol=symbol,
                        code=code,
                        name=str(item.get("Name") or symbol),
                        security_type=str(item.get("SecurityTypeName") or item.get("Classify") or ""),
                    )
                )
                if len(results) >= max(limit * 2, limit):
                    break
            if len(results) >= max(limit * 2, limit):
                break

        if fallback_item and fallback_item.symbol not in seen:
            results.insert(0, fallback_item)

        if len(results) < limit and query.isdigit() and len(query) < 6:
            seen_symbols = {item.symbol.lower() for item in results}
            for item in self._prefix_search_candidates(query, limit=max(limit * 2, limit)):
                if item.symbol.lower() in seen_symbols:
                    continue
                seen_symbols.add(item.symbol.lower())
                results.append(item)
                if len(results) >= limit:
                    break

        fuzzy_keywords = (
            "etf",
            "lof",
            "指数",
            "黄金",
            "300",
            "500",
            "1000",
            "中证",
            "沪深",
            "上证",
            "深证",
            "创业板",
            "科创",
        )
        should_use_fuzzy = (
            not (is_exact_code or is_exact_symbol or (query.isdigit() and len(query) < 6))
            and (len(results) == 0 or any(keyword in query.lower() for keyword in fuzzy_keywords))
        )
        if len(results) < limit and should_use_fuzzy:
            seen_symbols = {item.symbol.lower() for item in results}
            for item in self._fuzzy_search_universe(query, limit=max(limit * 2, limit)):
                if item.symbol.lower() in seen_symbols:
                    continue
                seen_symbols.add(item.symbol.lower())
                results.append(item)
                if len(results) >= max(limit * 2, limit):
                    break

        ranked = sorted(results, key=lambda item: (-score_search_result(query, item), item.code))
        return ranked[:limit]

    def warm_cache(self) -> None:
        try:
            self._get_prefix_segment_items("m:1+t:2,m:1+t:23", "A股", page_count=4)
        except Exception:
            pass
        try:
            self._get_prefix_segment_items("m:0+t:6", "A股", page_count=4)
        except Exception:
            pass
        try:
            self._get_prefix_segment_items("m:0+t:80", "A股", page_count=4)
        except Exception:
            pass
        try:
            self._get_search_universe()
        except Exception:
            pass

    def _fetch_clist_page(self, fs: str, page: int, fid: str = "f3") -> Tuple[int, List[Dict[str, Any]]]:
        params = {
            "pn": page,
            "pz": self.clist_page_size,
            "po": 1,
            "np": 1,
            "ut": self.clist_ut,
            "fltt": 2,
            "invt": 2,
            "fid": fid,
            "fs": fs,
            "fields": "f12,f13,f14",
        }
        payload = http_get_json(f"{self.clist_base}?{urlencode(params)}")
        data = payload.get("data") or {}
        total = int(data.get("total") or 0)
        rows = data.get("diff") or []
        return total, rows

    def _build_search_universe(self) -> List[SecuritySearchItem]:
        items: List[SecuritySearchItem] = []
        seen: set[str] = set()

        for fs, security_type in self.search_universe_segments:
            total, first_rows = self._fetch_clist_page(fs, 1)
            total_pages = max(1, (total + self.clist_page_size - 1) // self.clist_page_size)
            all_rows = list(first_rows)

            if total_pages > 1:
                for page in range(2, total_pages + 1):
                    try:
                        _, rows = self._fetch_clist_page(fs, page)
                    except Exception:
                        continue
                    all_rows.extend(rows)

            for row in all_rows:
                code = str(row.get("f12") or "").strip()
                symbol = self._market_field_to_symbol(code, row.get("f13"))
                if not code or not symbol or symbol in seen:
                    continue
                seen.add(symbol)
                items.append(
                    SecuritySearchItem(
                        symbol=symbol,
                        code=code,
                        name=str(row.get("f14") or symbol).strip(),
                        security_type=security_type,
                    )
                )
        return items

    def _get_search_universe(self) -> List[SecuritySearchItem]:
        now = time.time()
        with self._universe_lock:
            cached_items = self._universe_cache.get("items") or []
            loaded_at = float(self._universe_cache.get("loaded_at") or 0.0)
            if cached_items and (now - loaded_at) < self.search_universe_ttl:
                return list(cached_items)

        items = self._build_search_universe()
        with self._universe_lock:
            self._universe_cache["items"] = items
            self._universe_cache["loaded_at"] = now
        return list(items)

    def _fuzzy_search_universe(self, query: str, limit: int = 12) -> List[SecuritySearchItem]:
        try:
            universe = self._get_search_universe()
        except Exception:
            return []

        scored: List[Tuple[int, SecuritySearchItem]] = []
        for item in universe:
            score = score_search_result(query, item)
            if score <= 0:
                continue
            scored.append((score, item))

        scored.sort(key=lambda pair: (-pair[0], pair[1].code))
        return [item for _, item in scored[:limit]]

    def _get_prefix_segment_items(self, fs: str, security_type: str, page_count: int = 4) -> List[SecuritySearchItem]:
        cache_key = f"{fs}|{security_type}|{page_count}"
        now = time.time()
        with self._prefix_lock:
            cached = self._prefix_segment_cache.get(cache_key)
            if cached and (now - float(cached.get("loaded_at") or 0.0)) < self.search_universe_ttl:
                return list(cached.get("items") or [])

        rows: List[Dict[str, Any]] = []
        for page in range(1, page_count + 1):
            try:
                _, page_rows = self._fetch_clist_page(fs, page, fid="f12")
            except Exception:
                continue
            rows.extend(page_rows)

        seen: set[str] = set()
        items: List[SecuritySearchItem] = []
        for row in rows:
            code = str(row.get("f12") or "").strip()
            symbol = self._market_field_to_symbol(code, row.get("f13"))
            if not code or not symbol or symbol in seen:
                continue
            seen.add(symbol)
            items.append(
                SecuritySearchItem(
                    symbol=symbol,
                    code=code,
                    name=str(row.get("f14") or symbol).strip(),
                    security_type=security_type,
                )
            )

        items.sort(key=lambda item: item.code)
        with self._prefix_lock:
            self._prefix_segment_cache[cache_key] = {"items": items, "loaded_at": now}
        return list(items)

    def _prefix_search_candidates(self, query: str, limit: int = 12) -> List[SecuritySearchItem]:
        q = query.strip()
        if not q.isdigit() or len(q) >= 6:
            return []

        if q.startswith("6"):
            fs = "m:1+t:2,m:1+t:23"
            page_count = 4
        elif q.startswith("3"):
            fs = "m:0+t:80"
            page_count = 4
        elif q.startswith("0"):
            fs = "m:0+t:6"
            page_count = 4
        elif q.startswith(("1", "5")):
            return [item for item in self._fuzzy_search_universe(q, limit=max(limit * 2, limit)) if item.code.startswith(q)][
                :limit
            ]
        else:
            return []

        items = self._get_prefix_segment_items(fs, "A股", page_count=page_count)
        return [item for item in items if item.code.startswith(q)][:limit]

    @staticmethod
    def _quote_id_to_symbol(quote_id: str, code: str) -> Optional[str]:
        if quote_id.startswith("1."):
            return f"sh{code}"
        if quote_id.startswith("0."):
            return f"sz{code}"
        return None

    @staticmethod
    def _market_field_to_symbol(code: str, market_field: Any) -> Optional[str]:
        market = str(market_field)
        if market == "1":
            return f"sh{code}"
        if market == "0":
            return f"sz{code}"
        return None


class SearchProviderRouter:
    def __init__(self, providers: Dict[str, SearchProvider]) -> None:
        self.providers = providers

    def search(self, query: str, limit: int = 12, provider_id: str = "auto") -> List[SecuritySearchItem]:
        provider_items: List[SearchProvider]
        if provider_id == "auto":
            provider_items = list(self.providers.values())
        else:
            provider = self.providers.get(provider_id)
            if provider is None:
                raise MarketDataError(f"Unsupported search provider: {provider_id}")
            provider_items = [provider]

        errors: List[str] = []
        for provider in provider_items:
            try:
                results = provider.search(query, limit=limit)
                if results:
                    return results[:limit]
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{provider.provider_id}: {exc}")
        if provider_id != "auto" and errors:
            raise MarketDataError("; ".join(errors))
        return []

    def warm_cache(self) -> None:
        for provider in self.providers.values():
            try:
                provider.warm_cache()
            except Exception:
                continue


class SecuritySearchService:
    def __init__(self, providers: Optional[Iterable[SearchProvider]] = None) -> None:
        provider_items = list(providers or [EastMoneySearchProvider()])
        self.providers: Dict[str, SearchProvider] = {provider.provider_id: provider for provider in provider_items}
        self.router = SearchProviderRouter(self.providers)

    def search(self, query: str, limit: int = 12) -> List[Dict[str, Any]]:
        return [item.to_payload() for item in self.router.search(query, limit=limit)]

    def resolve_symbol(self, raw: str) -> str:
        direct = normalize_query_symbol(raw)
        if direct:
            return direct

        query = str(raw or "").strip()
        if re.fullmatch(r"\d{6}", query):
            results = self.search(query, limit=1)
            if results:
                return str(results[0]["symbol"])
            if query.startswith(("5", "6", "9")):
                return f"sh{query}"
            return f"sz{query}"

        results = self.search(query, limit=1)
        if results:
            return str(results[0]["symbol"])
        raise MarketDataError(f"Could not resolve symbol from query: {raw}")

    def warm_cache(self) -> None:
        self.router.warm_cache()
