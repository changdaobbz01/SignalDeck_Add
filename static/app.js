const FALLBACK_SOURCES = [
  {
    value: "auto",
    label: "自动选择",
    description: "优先使用腾讯，异常时回退到东方财富。",
  },
  {
    value: "eastmoney",
    label: "东方财富",
    description: "K 线与快照字段更完整，适合默认研究场景。",
  },
  {
    value: "tencent",
    label: "腾讯",
    description: "分钟线与盘口快照稳定性较好，可作为备选信息源。",
  },
];

const DEFAULT_GROUP_NAME = "核心";

const WATCHLIST_SORT_MODES = ["manual", "change_desc", "trend_up"];
const T0_SYMBOL_OVERRIDES = new Set(["sz162719"]);
const WATCHLIST_IMPORT_CODE_HEADERS = ["代码", "证券代码", "股票代码", "基金代码", "code", "symbol", "ticker"];
const WATCHLIST_IMPORT_NAME_HEADERS = ["名称", "证券名称", "股票名称", "基金名称", "证券简称", "股票简称", "基金简称", "name"];

const AUTO_REFRESH_INTERVAL_MS = 3000;
const AUTO_REFRESH_CHART_INTERVAL_MS = 9000;
const AUTO_REFRESH_WATCHLIST_SIGNAL_INTERVAL_MS = 6000;

const state = {
  symbol: window.APP_DEFAULTS.symbol,
  timeframe: window.APP_DEFAULTS.timeframe,
  source: loadSourcePreference(window.APP_DEFAULTS.source),
  strategy: loadStrategyPreference(window.APP_DEFAULTS.strategy),
  watchlistSortMode: loadWatchlistSortPreference("manual"),
  watchlistFilter: "",
  chart: null,
  chartResizeObserver: null,
  currentPayload: null,
  strategySignal: null,
  refreshTimer: null,
  quoteTimer: null,
  strategyTimer: null,
  watchlistQuoteTimer: null,
  searchTimer: null,
  searchRequestId: 0,
  searchResults: [],
  activeSuggestionIndex: -1,
  watchlistModel: loadWatchlistModel(),
  watchlistQuotes: {},
  watchlistStrategySignals: {},
  webhookUrl: loadWebhookUrlPreference(),
  webhookLogs: loadWebhookLogs(),
  webhookAlertSymbols: loadWebhookAlertSymbols(),
  webhookAlertStates: loadWebhookAlertStates(),
  availableSources: [...FALLBACK_SOURCES],
  availableStrategies: [],
  rulesPayload: null,
  strategyConfigSeed: "",
  strategyConfigStrategyId: "",
  strategyConfigDirty: false,
  strategyConfigHelpOpen: false,
  rulesModalOpen: false,
  webhookModalOpen: false,
  signalDrawerOpen: false,
  isRefreshingPulse: false,
  isLoadingChart: false,
  isLoadingQuote: false,
  isLoadingStrategy: false,
  isLoadingWatchlistQuotes: false,
  isLoadingWatchlistStrategySignals: false,
  pulseRequestId: 0,
  marketRequestId: 0,
  quoteRequestId: 0,
  strategyRequestId: 0,
  watchlistQuoteRequestId: 0,
  watchlistStrategyRequestId: 0,
  lastStrategyAlertKey: "",
  lastChartRefreshAt: 0,
  lastWatchlistSignalRefreshAt: 0,
  watchlistStrategyTimer: null,
  watchlistScrollTimer: null,
  alertRuntimeSyncTimer: null,
  alertRuntimeSnapshot: null,
  alertRuntimeUpdatedAt: "",
  alertWorkerState: {},
  alertRuntimeSyncError: "",
  isLoadingAlertRuntime: false,
  isApplyingAlertRuntime: false,
  hasLoadedAlertRuntime: false,
  signalDrawerActionFilters: {
    BUY: "",
    SELL: "",
  },
};

const dom = {
  chart: document.getElementById("chart"),
  searchInput: document.getElementById("searchInput"),
  searchButton: document.getElementById("searchButton"),
  searchSuggestions: document.getElementById("searchSuggestions"),
  watchlistButton: document.getElementById("watchlistButton"),
  refreshStatus: document.getElementById("refreshStatus"),
  activeSourceLabel: document.getElementById("activeSourceLabel"),
  strategyHealthStrip: document.getElementById("strategyHealthStrip"),
  sourceSelect: document.getElementById("sourceSelect"),
  strategySelect: document.getElementById("strategySelect"),
  rulesButton: document.getElementById("rulesButton"),
  webhookButton: document.getElementById("webhookButton"),
  webhookInput: document.getElementById("webhookInput"),
  webhookSaveButton: document.getElementById("webhookSaveButton"),
  webhookTestButton: document.getElementById("webhookTestButton"),
  webhookStatusMessage: document.getElementById("webhookStatusMessage"),
  strategySignalBadge: document.getElementById("strategySignalBadge"),
  strategySignalMeta: document.getElementById("strategySignalMeta"),
  toastStack: document.getElementById("toastStack"),
  metricName: document.getElementById("metricName"),
  metricSymbol: document.getElementById("metricSymbol"),
  metricPrice: document.getElementById("metricPrice"),
  metricChange: document.getElementById("metricChange"),
  metricSignal: document.getElementById("metricSignal"),
  metricTime: document.getElementById("metricTime"),
  metricSource: document.getElementById("metricSource"),
  metricSourceMeta: document.getElementById("metricSourceMeta"),
  marketOpen: document.getElementById("marketOpen"),
  marketPrevClose: document.getElementById("marketPrevClose"),
  marketHigh: document.getElementById("marketHigh"),
  marketLow: document.getElementById("marketLow"),
  marketVolume: document.getElementById("marketVolume"),
  marketAmount: document.getElementById("marketAmount"),
  marketTurnover: document.getElementById("marketTurnover"),
  marketAmplitude: document.getElementById("marketAmplitude"),
  watchlistGroups: document.getElementById("watchlistGroups"),
  watchlist: document.getElementById("watchlist"),
  watchlistCount: document.getElementById("watchlistCount"),
  watchlistSortSelect: document.getElementById("watchlistSortSelect"),
  watchlistSearchInput: document.getElementById("watchlistSearchInput"),
  watchlistImportButton: document.getElementById("watchlistImportButton"),
  watchlistImportInput: document.getElementById("watchlistImportInput"),
  buyCount: document.getElementById("buyCount"),
  sellCount: document.getElementById("sellCount"),
  buyActionSummary: document.getElementById("buyActionSummary"),
  sellActionSummary: document.getElementById("sellActionSummary"),
  buyReasons: document.getElementById("buyReasons"),
  sellReasons: document.getElementById("sellReasons"),
  warnings: document.getElementById("warnings"),
  macdDifLabel: document.getElementById("macdDifLabel"),
  macdDeaLabel: document.getElementById("macdDeaLabel"),
  macdHistLabel: document.getElementById("macdHistLabel"),
  kdjKLabel: document.getElementById("kdjKLabel"),
  kdjDLabel: document.getElementById("kdjDLabel"),
  kdjJLabel: document.getElementById("kdjJLabel"),
  signalDrawerToggle: document.getElementById("signalDrawerToggle"),
  signalDrawerBackdrop: document.getElementById("signalDrawerBackdrop"),
  signalDrawer: document.getElementById("signalDrawer"),
  signalDrawerClose: document.getElementById("signalDrawerClose"),
  signalDrawerStrategyLabel: document.getElementById("signalDrawerStrategyLabel"),
  timeframeButtons: document.getElementById("timeframeButtons"),
  rulesBackdrop: document.getElementById("rulesBackdrop"),
  rulesModal: document.getElementById("rulesModal"),
  rulesModalTitle: document.getElementById("rulesModalTitle"),
  rulesModalClose: document.getElementById("rulesModalClose"),
  webhookBackdrop: document.getElementById("webhookBackdrop"),
  webhookModal: document.getElementById("webhookModal"),
  webhookModalClose: document.getElementById("webhookModalClose"),
  webhookSavedUrl: document.getElementById("webhookSavedUrl"),
  webhookSelectedCount: document.getElementById("webhookSelectedCount"),
  webhookLastResult: document.getElementById("webhookLastResult"),
  webhookRuntimeSyncValue: document.getElementById("webhookRuntimeSyncValue"),
  webhookRuntimeWorkerValue: document.getElementById("webhookRuntimeWorkerValue"),
  webhookRuntimeLastScanValue: document.getElementById("webhookRuntimeLastScanValue"),
  webhookRuntimeLastSentValue: document.getElementById("webhookRuntimeLastSentValue"),
  webhookRuntimeHint: document.getElementById("webhookRuntimeHint"),
  webhookLogCount: document.getElementById("webhookLogCount"),
  webhookLogList: document.getElementById("webhookLogList"),
  rulesTimeframe: document.getElementById("rulesTimeframe"),
  rulesAdjust: document.getElementById("rulesAdjust"),
  rulesCurrentSource: document.getElementById("rulesCurrentSource"),
  strategyConfigMeta: document.getElementById("strategyConfigMeta"),
  strategyConfigInput: document.getElementById("strategyConfigInput"),
  strategyConfigHelpButton: document.getElementById("strategyConfigHelpButton"),
  strategyConfigHelpPanel: document.getElementById("strategyConfigHelpPanel"),
  strategyConfigHelpContent: document.getElementById("strategyConfigHelpContent"),
  strategyConfigFormatButton: document.getElementById("strategyConfigFormatButton"),
  strategyConfigResetButton: document.getElementById("strategyConfigResetButton"),
  strategyConfigSaveButton: document.getElementById("strategyConfigSaveButton"),
  strategyConfigMessage: document.getElementById("strategyConfigMessage"),
  strategyComponentsList: document.getElementById("strategyComponentsList"),
  strategyComponentStatusList: document.getElementById("strategyComponentStatusList"),
  indicatorList: document.getElementById("indicatorList"),
  buyRulesList: document.getElementById("buyRulesList"),
  sellRulesList: document.getElementById("sellRulesList"),
  rulesNotes: document.getElementById("rulesNotes"),
};

function defaultWatchlistItems() {
  return [
    { symbol: "sh000001", name: "上证指数" },
    { symbol: "sh000300", name: "沪深300" },
  ];
}

function createDefaultWatchlistModel() {
  return {
    selectedGroup: DEFAULT_GROUP_NAME,
    groups: {
      [DEFAULT_GROUP_NAME]: defaultWatchlistItems(),
      观察: [],
    },
  };
}

function sanitizeGroupName(name) {
  return String(name || "").trim().slice(0, 12);
}

function dedupeWatchlist(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const symbol = String(item?.symbol || "").trim().toLowerCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    result.push({
      symbol,
      name: String(item?.name || symbol).trim(),
      trade_cycle: normalizeTradeCycle(item?.trade_cycle),
    });
  }
  return result;
}

function normalizeTradeCycle(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized === "T0" || normalized === "T1" ? normalized : "";
}

function inferTradeCycle(item) {
  const forcedSymbol = String(item?.symbol || "").trim().toLowerCase();
  if (T0_SYMBOL_OVERRIDES.has(forcedSymbol)) {
    return "T0";
  }

  const explicit = normalizeTradeCycle(item?.trade_cycle);
  if (explicit) {
    return explicit;
  }

  const symbol = String(item?.symbol || "").trim().toLowerCase();
  const name = String(item?.name || "").trim().toLowerCase();
  const securityType = String(item?.security_type || item?.securityType || "").trim().toLowerCase();
  const code = symbol.slice(2);
  const text = `${name} ${securityType}`;

  const isIndex =
    text.includes("指数") ||
    securityType.includes("index") ||
    /^(sh000|sh880|sz399)/.test(symbol);
  if (isIndex) {
    return "";
  }

  if (T0_SYMBOL_OVERRIDES.has(symbol)) {
    return "T0";
  }

  if (/^(110|111|113|118|123|127|128)\d{3}$/.test(code)) {
    return "T0";
  }

  const t0Keywords = [
    "黄金",
    "商品",
    "原油",
    "油气",
    "纳指",
    "纳斯达克",
    "标普",
    "恒生",
    "港股",
    "日经",
    "德国",
    "法国",
    "沙特",
    "跨境",
    "qdii",
    "货币",
    "现金",
    "债",
    "国债",
    "政金债",
    "可转债",
    "同业存单",
  ];
  if (t0Keywords.some((keyword) => text.includes(keyword))) {
    return "T0";
  }

  const isFundLike =
    text.includes("etf") ||
    text.includes("lof") ||
    text.includes("基金") ||
    /^(1|5|16)\d{5}$/.test(code);
  if (isFundLike) {
    if (/^(511|513|518)\d{3}$/.test(code)) {
      return "T0";
    }
    return "T1";
  }

  if (/^(000|001|002|003|300|301|600|601|603|605|688)\d{3}$/.test(code)) {
    return "T1";
  }

  return "T1";
}

function tradeCycleClass(value) {
  const normalized = normalizeTradeCycle(value);
  if (normalized === "T0") return "t0";
  if (normalized === "T1") return "t1";
  return "neutral";
}

function normalizeWatchlistStreak(streak) {
  const direction = String(streak?.direction || "").trim().toLowerCase();
  const days = Number(streak?.days || 0);
  const label = String(streak?.label || "").trim();
  if (!label || days < 2 || !["up", "down"].includes(direction)) {
    return { direction: "", days: 0, label: "" };
  }
  return { direction, days, label };
}

function buildWatchlistQuote(symbol, name, market, source = null, streak = null) {
  if (!symbol || !market) {
    return null;
  }
  return {
    symbol: String(symbol).trim().toLowerCase(),
    name: name || market.name || symbol,
    last_price: market.last_price,
    change: market.change,
    change_pct: market.change_pct,
    timestamp: market.timestamp || null,
    source: source || market.source || null,
    streak: normalizeWatchlistStreak(streak),
  };
}

function normalizeWatchlistStrategySignal(payload) {
  const symbol = String(payload?.symbol || "").trim().toLowerCase();
  if (!symbol) {
    return null;
  }

  const signal = String(payload?.signal || "").trim().toUpperCase();
  return {
    symbol,
    name: String(payload?.name || "").trim(),
    signal,
    action: String(payload?.action || "").trim().toLowerCase(),
    action_label: String(payload?.action_label || "").trim(),
    triggered: Boolean(payload?.triggered),
    strategy_id: normalizeStrategyValue(payload?.strategy?.id),
    strategy: payload?.strategy && typeof payload.strategy === "object" ? payload.strategy : null,
    source: payload?.source && typeof payload.source === "object" ? payload.source : null,
    priority: payload?.priority && typeof payload.priority === "object" ? payload.priority : {},
    priority_label: String(payload?.priority?.label || "").trim(),
    priority_score: Number(payload?.priority?.score),
    indicators: payload?.indicators && typeof payload.indicators === "object" ? payload.indicators : {},
    timestamp: payload?.timestamp || null,
    reason: String(payload?.reason || "").trim(),
    details: payload?.details && typeof payload.details === "object" ? payload.details : {},
    alert_key: payload?.alert_key || null,
  };
}

function cacheWatchlistQuote(symbol, name, market, source = null, streak = null) {
  const entry = buildWatchlistQuote(symbol, name, market, source, streak);
  if (!entry) {
    return;
  }
  const existing = state.watchlistQuotes[entry.symbol];
  if ((!entry.streak || !entry.streak.label) && existing?.streak?.label) {
    entry.streak = existing.streak;
  }
  state.watchlistQuotes = {
    ...state.watchlistQuotes,
    [entry.symbol]: entry,
  };
}

function cacheWatchlistStrategySignal(payload) {
  const entry = normalizeWatchlistStrategySignal(payload);
  if (!entry) {
    return;
  }

  state.watchlistStrategySignals = {
    ...state.watchlistStrategySignals,
    [entry.symbol]: entry,
  };
}

function currentGroupSymbols() {
  return [...new Set(currentGroupItems().map((item) => String(item?.symbol || "").trim().toLowerCase()).filter(Boolean))];
}

function getWatchlistQuote(item) {
  const symbol = String(item?.symbol || "").trim().toLowerCase();
  if (!symbol) {
    return null;
  }
  if (state.watchlistQuotes[symbol]) {
    return state.watchlistQuotes[symbol];
  }
  if (state.currentPayload?.symbol === symbol && state.currentPayload?.market) {
    return buildWatchlistQuote(symbol, state.currentPayload.name, state.currentPayload.market, state.currentPayload.source?.actual);
  }
  return null;
}

function getWatchlistStrategySignal(item) {
  if (normalizeStrategyValue(state.strategy) === "none") {
    return null;
  }

  const symbol = String(item?.symbol || "").trim().toLowerCase();
  if (!symbol) {
    return null;
  }

  const cached = state.watchlistStrategySignals[symbol];
  if (cached && normalizeStrategyValue(cached.strategy_id) === normalizeStrategyValue(state.strategy)) {
    return cached;
  }

  if (
    state.strategySignal &&
    state.currentPayload?.symbol === symbol &&
    normalizeStrategyValue(state.strategySignal?.strategy?.id) === normalizeStrategyValue(state.strategy)
  ) {
    return normalizeWatchlistStrategySignal(state.strategySignal);
  }

  return null;
}

function watchlistChangeClass(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "neutral";
  if (num > 0) return "up";
  if (num < 0) return "down";
  return "flat";
}

function watchlistStreakClass(streak) {
  const direction = String(streak?.direction || "").trim().toLowerCase();
  if (direction === "up") return "up";
  if (direction === "down") return "down";
  return "neutral";
}

function watchlistStrategySignalClass(signal) {
  const normalized = String(signal || "").trim().toLowerCase();
  if (normalized === "buy") return "buy";
  if (normalized === "sell") return "sell";
  if (normalized === "hold") return "hold";
  return "neutral";
}

function strategyActionLabel(strategySignal) {
  const explicit = String(strategySignal?.action_label || "").trim();
  if (explicit) {
    return explicit;
  }
  const action = String(strategySignal?.action || "").trim().toLowerCase();
  const signal = String(strategySignal?.signal || "").trim().toUpperCase();
  const labels = {
    buy: "买入",
    build: "布局",
    add: "加仓",
    reduce: "减仓",
    exit: "离场",
    clear: "清仓",
    hold: "观望",
    sell: "卖出",
  };
  if (labels[action]) {
    return labels[action];
  }
  if (signal === "BUY") return "买入";
  if (signal === "SELL") return "卖出";
  if (signal === "HOLD") return "观望";
  return "";
}

function watchlistStrategySignalLabel(strategySignal) {
  const rawTimeframe = String(strategySignal?.strategy?.timeframe || "").trim();
  const prefix = rawTimeframe && !rawTimeframe.includes("·") && !rawTimeframe.includes("/") ? rawTimeframe : "STRAT";
  const actionLabel = strategyActionLabel(strategySignal);
  if (actionLabel) {
    return `${prefix} ${actionLabel}`;
  }
  return `${prefix} ${String(strategySignal?.signal || "--").toUpperCase()}`;
}

function finiteOrFallback(value, fallback = -Infinity) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function strategyTrendRank(signal) {
  const normalized = String(signal || "").trim().toUpperCase();
  if (normalized === "BUY") return 0;
  if (normalized === "HOLD") return 1;
  if (normalized === "SELL") return 2;
  return 3;
}

function watchlistMatchesFilter(item, quote, strategySignal) {
  const keyword = String(state.watchlistFilter || "")
    .trim()
    .toLowerCase();
  if (!keyword) {
    return true;
  }

  const tradeCycle = inferTradeCycle(item);
  const searchText = [
    item?.symbol,
    item?.name,
    quote?.name,
    tradeCycle,
    strategySignal?.signal,
    strategySignal?.reason,
    quote?.streak?.label,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return searchText.includes(keyword);
}

function getRenderedWatchlistItems() {
  const baseItems = currentGroupItems();
  const mode = normalizeWatchlistSortMode(state.watchlistSortMode);
  const rows = baseItems
    .map((item, index) => ({
      item,
      index,
      quote: getWatchlistQuote(item),
      strategySignal: getWatchlistStrategySignal(item),
    }))
    .filter((row) => watchlistMatchesFilter(row.item, row.quote, row.strategySignal));

  if (mode === "manual") {
    return rows.map((row) => row.item);
  }

  if (mode === "change_desc") {
    rows.sort((left, right) => {
      const changeDiff = finiteOrFallback(right.quote?.change_pct) - finiteOrFallback(left.quote?.change_pct);
      if (changeDiff !== 0) return changeDiff;
      return left.index - right.index;
    });
    return rows.map((row) => row.item);
  }

  if (mode === "trend_up" && normalizeStrategyValue(state.strategy) !== "none") {
    rows.sort((left, right) => {
      const rankDiff =
        strategyTrendRank(left.strategySignal?.signal) - strategyTrendRank(right.strategySignal?.signal);
      if (rankDiff !== 0) return rankDiff;

      const leftPriority =
        String(left.strategySignal?.signal || "").toUpperCase() === "BUY"
          ? finiteOrFallback(left.strategySignal?.priority_score)
          : -Infinity;
      const rightPriority =
        String(right.strategySignal?.signal || "").toUpperCase() === "BUY"
          ? finiteOrFallback(right.strategySignal?.priority_score)
          : -Infinity;
      if (rightPriority !== leftPriority) return rightPriority - leftPriority;

      const changeDiff = finiteOrFallback(right.quote?.change_pct) - finiteOrFallback(left.quote?.change_pct);
      if (changeDiff !== 0) return changeDiff;

      return left.index - right.index;
    });
  }

  return rows.map((row) => row.item);
}

function normalizeWatchlistModel(raw) {
  if (Array.isArray(raw)) {
    return {
      selectedGroup: DEFAULT_GROUP_NAME,
      groups: {
        [DEFAULT_GROUP_NAME]: dedupeWatchlist(raw),
      },
    };
  }

  if (!raw || typeof raw !== "object" || typeof raw.groups !== "object") {
    return createDefaultWatchlistModel();
  }

  const groups = {};
  Object.entries(raw.groups || {}).forEach(([name, items]) => {
    const safeName = sanitizeGroupName(name);
    if (!safeName) return;
    groups[safeName] = dedupeWatchlist(items);
  });

  if (Object.keys(groups).length === 0) {
    groups[DEFAULT_GROUP_NAME] = defaultWatchlistItems();
  }

  const preferred = sanitizeGroupName(raw.selectedGroup);
  const selectedGroup = groups[preferred] ? preferred : Object.keys(groups)[0];
  return { selectedGroup, groups };
}

function loadWatchlistModel() {
  try {
    const raw = localStorage.getItem("signal-deck-watchlist");
    if (!raw) {
      return createDefaultWatchlistModel();
    }
    return normalizeWatchlistModel(JSON.parse(raw));
  } catch (error) {
    console.error(error);
    return createDefaultWatchlistModel();
  }
}

function saveWatchlistModel() {
  localStorage.setItem("signal-deck-watchlist", JSON.stringify(state.watchlistModel));
  scheduleAlertRuntimeSync({ delayMs: 250, silent: true });
}

function currentGroupName() {
  return state.watchlistModel.selectedGroup;
}

function currentGroupItems() {
  return state.watchlistModel.groups[currentGroupName()] || [];
}

function totalWatchlistCount() {
  return Object.values(state.watchlistModel.groups).reduce((sum, items) => sum + items.length, 0);
}

function symbolExistsInGroup(symbol, groupName = currentGroupName()) {
  return (state.watchlistModel.groups[groupName] || []).some((item) => item.symbol === symbol);
}

function symbolExistsAnywhere(symbol) {
  return Object.values(state.watchlistModel.groups).some((items) => items.some((item) => item.symbol === symbol));
}

function flattenLegacyWatchlistItems(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw?.items)) {
    return raw.items;
  }
  if (raw && typeof raw.groups === "object" && raw.groups) {
    return Object.values(raw.groups).flatMap((items) => (Array.isArray(items) ? items : []));
  }
  return [];
}

function createDefaultWatchlistModel() {
  return {
    items: defaultWatchlistItems(),
  };
}

function normalizeWatchlistModel(raw) {
  const items = dedupeWatchlist(flattenLegacyWatchlistItems(raw));
  if (items.length > 0) {
    return { items };
  }
  return createDefaultWatchlistModel();
}

function loadWatchlistModel() {
  try {
    const raw = localStorage.getItem("signal-deck-watchlist");
    if (!raw) {
      return createDefaultWatchlistModel();
    }
    return normalizeWatchlistModel(JSON.parse(raw));
  } catch (error) {
    console.error(error);
    return createDefaultWatchlistModel();
  }
}

function currentGroupName() {
  return "自选池";
}

function currentGroupItems() {
  return Array.isArray(state.watchlistModel?.items) ? state.watchlistModel.items : [];
}

function totalWatchlistCount() {
  return currentGroupItems().length;
}

function symbolExistsInGroup(symbol) {
  return currentGroupItems().some((item) => item.symbol === symbol);
}

function symbolExistsAnywhere(symbol) {
  return currentGroupItems().some((item) => item.symbol === symbol);
}

function loadWebhookUrlPreference() {
  try {
    return localStorage.getItem("signal-deck-webhook-url") || "";
  } catch (error) {
    console.error(error);
    return "";
  }
}

function saveWebhookUrlPreference() {
  try {
    localStorage.setItem("signal-deck-webhook-url", state.webhookUrl || "");
  } catch (error) {
    console.error(error);
  }
  scheduleAlertRuntimeSync({ delayMs: 0, silent: true });
}

function loadWebhookLogs() {
  try {
    const raw = JSON.parse(localStorage.getItem("signal-deck-webhook-logs") || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch (error) {
    console.error(error);
    return [];
  }
}

function saveWebhookLogs() {
  try {
    localStorage.setItem("signal-deck-webhook-logs", JSON.stringify((state.webhookLogs || []).slice(0, 80)));
  } catch (error) {
    console.error(error);
  }
}

function commitWebhookUrlPreference() {
  if (dom.webhookInput) {
    state.webhookUrl = dom.webhookInput.value.trim();
    dom.webhookInput.classList.remove("unsaved");
  }
  saveWebhookUrlPreference();
  renderWebhookPanel();
  setWebhookStatusMessage(state.webhookUrl ? "WebHook 地址已保存。" : "WebHook 地址已清空。", state.webhookUrl ? "success" : "neutral");
  setRefreshStatus(state.webhookUrl ? "WebHook 已保存" : "WebHook 已清空");
}

function loadWebhookAlertSymbols() {
  try {
    const raw = JSON.parse(localStorage.getItem("signal-deck-webhook-symbols") || "[]");
    return new Set((Array.isArray(raw) ? raw : []).map((symbol) => String(symbol || "").trim().toLowerCase()).filter(Boolean));
  } catch (error) {
    console.error(error);
    return new Set();
  }
}

function saveWebhookAlertSymbols() {
  try {
    localStorage.setItem("signal-deck-webhook-symbols", JSON.stringify([...state.webhookAlertSymbols]));
  } catch (error) {
    console.error(error);
  }
  scheduleAlertRuntimeSync({ delayMs: 150, silent: true });
}

function loadWebhookAlertStates() {
  try {
    const raw = JSON.parse(localStorage.getItem("signal-deck-webhook-states") || "{}");
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

function saveWebhookAlertStates() {
  try {
    localStorage.setItem("signal-deck-webhook-states", JSON.stringify(state.webhookAlertStates || {}));
  } catch (error) {
    console.error(error);
  }
}

function buildAlertRuntimeRequestPayload() {
  return {
    watchlist: {
      items: currentGroupItems().map((item) => ({
        symbol: String(item?.symbol || "").trim().toLowerCase(),
        name: String(item?.name || "").trim(),
        trade_cycle: String(item?.trade_cycle || "").trim(),
      })),
    },
    strategy: normalizeStrategyValue(state.strategy),
    source: state.source,
    webhook: {
      url: String(state.webhookUrl || "").trim(),
      enabled_symbols: [...state.webhookAlertSymbols].map((symbol) => String(symbol || "").trim().toLowerCase()).filter(Boolean),
    },
  };
}

function normalizeAlertRuntimeSnapshot(raw) {
  const payload = raw && typeof raw === "object" ? raw : {};
  const watchlist = payload.watchlist && typeof payload.watchlist === "object" ? payload.watchlist : {};
  const webhook = payload.webhook && typeof payload.webhook === "object" ? payload.webhook : {};
  const items = Array.isArray(watchlist.items) ? watchlist.items : [];
  const enabledSymbols = Array.isArray(webhook.enabled_symbols) ? webhook.enabled_symbols : [];
  return {
    watchlist: {
      items: items.map((item) => ({
        symbol: String(item?.symbol || "").trim().toLowerCase(),
        name: String(item?.name || "").trim(),
        trade_cycle: String(item?.trade_cycle || "").trim(),
      })),
    },
    strategy: normalizeStrategyValue(payload.strategy),
    source: String(payload.source || "").trim() || "auto",
    webhook: {
      url: String(webhook.url || "").trim(),
      enabled_symbols: enabledSymbols
        .map((symbol) => String(symbol || "").trim().toLowerCase())
        .filter(Boolean)
        .sort(),
    },
  };
}

function alertRuntimeSnapshotsMatch(left, right) {
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isAlertRuntimeSynced() {
  if (!state.hasLoadedAlertRuntime || !state.alertRuntimeSnapshot) {
    return false;
  }
  return alertRuntimeSnapshotsMatch(
    normalizeAlertRuntimeSnapshot(buildAlertRuntimeRequestPayload()),
    state.alertRuntimeSnapshot
  );
}

function persistAlertRuntimeLocally() {
  try {
    localStorage.setItem("signal-deck-watchlist", JSON.stringify(state.watchlistModel));
    localStorage.setItem("signal-deck-webhook-url", state.webhookUrl || "");
    localStorage.setItem("signal-deck-webhook-symbols", JSON.stringify([...state.webhookAlertSymbols]));
    localStorage.setItem("signal-deck-webhook-states", JSON.stringify(state.webhookAlertStates || {}));
    localStorage.setItem("signal-deck-webhook-logs", JSON.stringify((state.webhookLogs || []).slice(0, 80)));
    localStorage.setItem("signal-deck-source", state.source || "auto");
    localStorage.setItem("signal-deck-strategy", normalizeStrategyValue(state.strategy));
  } catch (error) {
    console.error(error);
  }
}

function applyAlertRuntimePayload(payload) {
  if (!payload || typeof payload !== "object") return;
  const webhook = payload?.webhook && typeof payload.webhook === "object" ? payload.webhook : {};
  state.isApplyingAlertRuntime = true;
  try {
    if (payload.watchlist) {
      state.watchlistModel = normalizeWatchlistModel(payload.watchlist);
    }
    if (payload.source) {
      state.source = String(payload.source || "").trim() || state.source;
    }
    if (payload.strategy) {
      state.strategy = normalizeStrategyValue(payload.strategy);
    }
    state.webhookUrl = String(webhook.url || "").trim();
    state.webhookAlertSymbols = new Set(
      (Array.isArray(webhook.enabled_symbols) ? webhook.enabled_symbols : [])
        .map((symbol) => String(symbol || "").trim().toLowerCase())
        .filter(Boolean)
    );
    state.webhookAlertStates =
      webhook.alert_states && typeof webhook.alert_states === "object" && !Array.isArray(webhook.alert_states)
        ? webhook.alert_states
        : {};
    state.webhookLogs = Array.isArray(webhook.logs) ? webhook.logs : [];
    state.alertRuntimeSnapshot = normalizeAlertRuntimeSnapshot(payload);
    state.alertRuntimeUpdatedAt = String(payload.updated_at || "").trim();
    state.alertWorkerState = payload.worker && typeof payload.worker === "object" ? payload.worker : {};
    state.alertRuntimeSyncError = "";
    persistAlertRuntimeLocally();
    state.hasLoadedAlertRuntime = true;
  } finally {
    state.isApplyingAlertRuntime = false;
  }
}

function alertRuntimeHasRemoteData(payload) {
  if (!payload || typeof payload !== "object") return false;
  const webhook = payload?.webhook && typeof payload.webhook === "object" ? payload.webhook : {};
  const items = Array.isArray(payload?.watchlist?.items) ? payload.watchlist.items : [];
  return Boolean(
    items.length ||
      String(webhook.url || "").trim() ||
      (Array.isArray(webhook.enabled_symbols) && webhook.enabled_symbols.length > 0) ||
      (Array.isArray(webhook.logs) && webhook.logs.length > 0) ||
      normalizeStrategyValue(payload.strategy) !== normalizeStrategyValue(window.APP_DEFAULTS.strategy) ||
      String(payload.source || "").trim() !== String(window.APP_DEFAULTS.source || "auto").trim()
  );
}

async function syncAlertRuntimeState(options = {}) {
  const { silent = true } = options;
  if (state.isApplyingAlertRuntime) {
    return null;
  }
  const response = await fetch("/api/alert-runtime", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAlertRuntimeRequestPayload()),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    state.alertRuntimeSyncError = payload.error || "Alert runtime sync failed";
    throw new Error(payload.error || "Alert runtime sync failed");
  }
  applyAlertRuntimePayload(payload);
  state.alertRuntimeSyncError = "";
  if (!silent) {
    setRefreshStatus("后台预警配置已同步");
  }
  if (state.webhookModalOpen) {
    renderWebhookPanel({ syncInput: true });
  }
  return payload;
}

function scheduleAlertRuntimeSync(options = {}) {
  const { delayMs = 300, silent = true } = options;
  if (state.isApplyingAlertRuntime) {
    return;
  }
  if (state.webhookModalOpen) {
    renderWebhookPanel({ syncInput: false });
  }
  if (state.alertRuntimeSyncTimer) {
    clearTimeout(state.alertRuntimeSyncTimer);
  }
  state.alertRuntimeSyncTimer = window.setTimeout(() => {
    state.alertRuntimeSyncTimer = null;
    syncAlertRuntimeState({ silent }).catch((error) => {
      console.error(error);
      state.alertRuntimeSyncError = error.message || "Alert runtime sync failed";
      if (state.webhookModalOpen) {
        renderWebhookPanel({ syncInput: false });
      }
      if (!silent) {
        setRefreshStatus(error.message || "后台预警配置同步失败");
      }
    });
  }, Math.max(0, Number(delayMs) || 0));
}

async function loadAlertRuntimeState() {
  if (state.isLoadingAlertRuntime) {
    return null;
  }
  state.isLoadingAlertRuntime = true;
  try {
    const response = await fetch("/api/alert-runtime");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      state.alertRuntimeSyncError = payload.error || "Load alert runtime failed";
      throw new Error(payload.error || "Load alert runtime failed");
    }
    if (alertRuntimeHasRemoteData(payload)) {
      applyAlertRuntimePayload(payload);
      return payload;
    }
    await syncAlertRuntimeState({ silent: true });
    return payload;
  } catch (error) {
    console.error(error);
    state.alertRuntimeSyncError = error.message || "Load alert runtime failed";
    return null;
  } finally {
    state.isLoadingAlertRuntime = false;
  }
}

function loadSourcePreference(fallback) {
  try {
    return localStorage.getItem("signal-deck-source") || fallback || "auto";
  } catch (error) {
    console.error(error);
    return fallback || "auto";
  }
}

function saveSourcePreference() {
  localStorage.setItem("signal-deck-source", state.source);
  scheduleAlertRuntimeSync({ delayMs: 0, silent: true });
}

function normalizeStrategyValue(value) {
  return String(value || "").trim().toLowerCase() || "none";
}

function loadStrategyPreference(fallback) {
  try {
    return normalizeStrategyValue(localStorage.getItem("signal-deck-strategy") || fallback || "none");
  } catch (error) {
    console.error(error);
    return normalizeStrategyValue(fallback || "none");
  }
}

function saveStrategyPreference() {
  localStorage.setItem("signal-deck-strategy", normalizeStrategyValue(state.strategy));
  scheduleAlertRuntimeSync({ delayMs: 0, silent: true });
}

function normalizeWatchlistSortMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return WATCHLIST_SORT_MODES.includes(normalized) ? normalized : "manual";
}

function loadWatchlistSortPreference(fallback) {
  try {
    return normalizeWatchlistSortMode(localStorage.getItem("signal-deck-watchlist-sort") || fallback || "manual");
  } catch (error) {
    console.error(error);
    return normalizeWatchlistSortMode(fallback || "manual");
  }
}

function saveWatchlistSortPreference() {
  localStorage.setItem("signal-deck-watchlist-sort", normalizeWatchlistSortMode(state.watchlistSortMode));
}

function normalizeImportCellText(value) {
  return String(value ?? "")
    .replace(/\u3000/g, " ")
    .trim();
}

function normalizeImportHeader(value) {
  return normalizeImportCellText(value).toLowerCase().replace(/\s+/g, "");
}

function normalizeImportCodeCandidate(value) {
  const text = normalizeImportCellText(value).replace(/['"]/g, "");
  if (!text) {
    return "";
  }

  const directMatch = text.match(/\b(?:sh|sz)\s*\d{6}\b/i);
  if (directMatch) {
    return directMatch[0].replace(/\s+/g, "").toLowerCase();
  }

  const codeMatch = text.match(/(?<!\d)\d{6}(?!\d)/);
  if (codeMatch) {
    return codeMatch[0];
  }

  return "";
}

function detectWatchlistImportColumns(rows) {
  let bestMatch = { headerRow: -1, codeIndex: -1, nameIndex: -1, score: -1 };

  rows.slice(0, 6).forEach((row, rowIndex) => {
    if (!Array.isArray(row)) return;
    let codeIndex = -1;
    let nameIndex = -1;

    row.forEach((cell, cellIndex) => {
      const normalized = normalizeImportHeader(cell);
      if (codeIndex === -1 && WATCHLIST_IMPORT_CODE_HEADERS.includes(normalized)) {
        codeIndex = cellIndex;
      }
      if (nameIndex === -1 && WATCHLIST_IMPORT_NAME_HEADERS.includes(normalized)) {
        nameIndex = cellIndex;
      }
    });

    const score = (codeIndex >= 0 ? 2 : 0) + (nameIndex >= 0 ? 1 : 0);
    if (score > bestMatch.score) {
      bestMatch = { headerRow: rowIndex, codeIndex, nameIndex, score };
    }
  });

  return bestMatch;
}

function pickImportNameFromRow(cells, codeIndex, nameIndex) {
  if (nameIndex >= 0) {
    const explicitName = normalizeImportCellText(cells[nameIndex]);
    if (explicitName) {
      return explicitName;
    }
  }

  return (
    cells.find((cell, index) => {
      if (index === codeIndex) return false;
      const text = normalizeImportCellText(cell);
      if (!text) return false;
      if (normalizeImportCodeCandidate(text)) return false;
      return true;
    }) || ""
  );
}

function extractWatchlistImportItemsFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const { headerRow, codeIndex, nameIndex } = detectWatchlistImportColumns(rows);
  const startIndex = headerRow >= 0 && codeIndex >= 0 ? headerRow + 1 : 0;
  const items = [];
  const seen = new Set();

  rows.slice(startIndex).forEach((row) => {
    if (!Array.isArray(row) || row.length === 0) {
      return;
    }

    const cells = row.map((cell) => normalizeImportCellText(cell));
    let raw = codeIndex >= 0 ? normalizeImportCodeCandidate(cells[codeIndex]) : "";
    if (!raw) {
      raw = cells.map((cell) => normalizeImportCodeCandidate(cell)).find(Boolean) || "";
    }
    if (!raw) {
      return;
    }

    const normalizedRaw = raw.toLowerCase();
    if (seen.has(normalizedRaw)) {
      return;
    }
    seen.add(normalizedRaw);

    items.push({
      raw,
      name: pickImportNameFromRow(cells, codeIndex, nameIndex),
    });
  });

  return items;
}

function extractWatchlistImportItemsFromWorkbook(workbook) {
  if (!workbook || !Array.isArray(workbook.SheetNames)) {
    return [];
  }

  const allItems = [];
  const seen = new Set();

  workbook.SheetNames.forEach((sheetName) => {
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) {
      return;
    }
    const rows = window.XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });

    extractWatchlistImportItemsFromRows(rows).forEach((item) => {
      const key = String(item.raw || "").toLowerCase();
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      allItems.push(item);
    });
  });

  return allItems;
}

async function parseWatchlistImportFile(file) {
  if (!file) {
    return [];
  }
  if (!window.XLSX) {
    throw new Error("XLSX parser is not ready");
  }

  const buffer = await file.arrayBuffer();
  const workbook = window.XLSX.read(buffer, { type: "array" });
  const items = extractWatchlistImportItemsFromWorkbook(workbook);
  if (items.length === 0) {
    throw new Error("No security codes found in workbook");
  }
  return items.slice(0, 200);
}

async function resolveWatchlistImportItems(items) {
  const response = await fetch("/api/watchlist-import", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ items }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Import resolve failed");
  }
  return payload;
}

function mergeImportedWatchlistItems(items) {
  const currentItems = [...currentGroupItems()];
  const existingSymbols = new Set(currentItems.map((item) => String(item?.symbol || "").trim().toLowerCase()).filter(Boolean));
  const added = [];
  const skipped = [];

  items.forEach((item) => {
    const symbol = String(item?.symbol || "").trim().toLowerCase();
    if (!symbol) {
      return;
    }
    if (existingSymbols.has(symbol)) {
      skipped.push(item);
      return;
    }

    existingSymbols.add(symbol);
    added.push(item);
    currentItems.push({
      symbol,
      name: String(item?.name || symbol).trim(),
      security_type: String(item?.security_type || "").trim(),
      trade_cycle: inferTradeCycle(item),
    });
  });

  state.watchlistModel.items = dedupeWatchlist(currentItems);
  saveWatchlistModel();
  renderWatchlist();
  updateWatchlistButtonState();

  if (added.length > 0) {
    runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  }

  return { added, skipped };
}

async function handleWatchlistImport(file) {
  if (!file) {
    return;
  }

  setRefreshStatus(`Importing ${file.name}...`);
  const parsedItems = await parseWatchlistImportFile(file);
  const resolvedPayload = await resolveWatchlistImportItems(parsedItems);
  const resolvedItems = Array.isArray(resolvedPayload.items) ? resolvedPayload.items : [];
  const failedItems = Array.isArray(resolvedPayload.errors) ? resolvedPayload.errors : [];
  const { added, skipped } = mergeImportedWatchlistItems(resolvedItems);

  const summaryParts = [];
  if (added.length > 0) summaryParts.push(`added ${added.length}`);
  if (skipped.length > 0) summaryParts.push(`skipped ${skipped.length}`);
  if (failedItems.length > 0) summaryParts.push(`failed ${failedItems.length}`);
  const summaryText = summaryParts.join(", ") || "no new items";

  setRefreshStatus(`Import done: ${summaryText}`);
  showToast({
    tone: added.length > 0 ? "buy" : "neutral",
    title: "Watchlist import complete",
    body: summaryText,
    meta: `Watchlist | ${file.name}`,
  });
}

function getSourceMeta(value) {
  return state.availableSources.find((item) => item.value === value) || FALLBACK_SOURCES.find((item) => item.value === value);
}

function getStrategyMeta(value) {
  const normalized = normalizeStrategyValue(value);
  return state.availableStrategies.find((item) => normalizeStrategyValue(item.id) === normalized) || null;
}

function isCustomStrategy(value = state.strategy) {
  return getStrategyMeta(value)?.type === "custom";
}

function updateStrategyDeleteButtonState(nextStrategy = null) {
  if (!dom.strategyDeleteButton) return;
  const currentValue = nextStrategy ?? dom.strategySelect?.value ?? state.strategy;
  const strategy = getStrategyMeta(currentValue);
  const canDelete = Boolean(strategy && normalizeStrategyValue(strategy.id) !== "none");
  dom.strategyDeleteButton.disabled = !canDelete;
  dom.strategyDeleteButton.title = canDelete ? `删除 ${strategy.label || strategy.id}` : "不启用不能删除";
}

function setRefreshStatus(message) {
  dom.refreshStatus.textContent = message;
}

function isStrategyEditable(value = state.strategy) {
  const strategy = getStrategyMeta(value);
  return Boolean(strategy?.editable && normalizeStrategyValue(strategy.id) !== "none");
}

function updateStrategyDeleteButtonState() {
  return;
}

function setStrategyConfigMessage(message, tone = "neutral") {
  if (!dom.strategyConfigMessage) return;
  dom.strategyConfigMessage.textContent = message || "";
  dom.strategyConfigMessage.classList.toggle("error", tone === "error");
  dom.strategyConfigMessage.classList.toggle("success", tone === "success");
}

function setStrategyConfigControlsDisabled(disabled) {
  [dom.strategyConfigInput, dom.strategyConfigFormatButton, dom.strategyConfigResetButton, dom.strategyConfigSaveButton].forEach((node) => {
    if (node) {
      node.disabled = Boolean(disabled);
    }
  });
}

function strategyConfigModeLabel(mode) {
  return String(mode || "").trim().toLowerCase() === "simple" ? "单周期策略" : "组合策略";
}

function formatStrategyConfigHelpRefs(refs = []) {
  const items = Array.isArray(refs) ? refs.filter(Boolean) : [];
  return items.length ? items.join(" / ") : "当前未配置";
}

function setStrategyConfigHelpOpen(open) {
  state.strategyConfigHelpOpen = Boolean(open);
  if (dom.strategyConfigHelpPanel) {
    dom.strategyConfigHelpPanel.classList.toggle("hidden", !state.strategyConfigHelpOpen);
    dom.strategyConfigHelpPanel.setAttribute("aria-hidden", state.strategyConfigHelpOpen ? "false" : "true");
  }
  if (dom.strategyConfigHelpButton) {
    dom.strategyConfigHelpButton.classList.toggle("active", state.strategyConfigHelpOpen);
    dom.strategyConfigHelpButton.setAttribute("aria-expanded", state.strategyConfigHelpOpen ? "true" : "false");
    dom.strategyConfigHelpButton.textContent = state.strategyConfigHelpOpen ? "收起说明" : "参数说明";
  }
}

function createStrategyConfigHelpCard(item = {}) {
  const card = document.createElement("article");
  card.className = "strategy-config-help-card";

  const header = document.createElement("header");
  const title = document.createElement("strong");
  title.textContent = item.title || "--";
  header.appendChild(title);

  if (item.tag) {
    const tag = document.createElement("span");
    tag.className = "strategy-config-help-tag";
    tag.textContent = item.tag;
    header.appendChild(tag);
  }
  card.appendChild(header);

  const description = document.createElement("p");
  description.textContent = item.description || "";
  card.appendChild(description);

  if (item.example) {
    const example = document.createElement("p");
    example.className = "strategy-config-help-example";
    example.append("示例：");
    const code = document.createElement("code");
    code.textContent = item.example;
    example.appendChild(code);
    card.appendChild(example);
  }

  if (item.note) {
    const note = document.createElement("p");
    note.className = "strategy-config-help-note";
    note.textContent = item.note;
    card.appendChild(note);
  }

  return card;
}

function buildStrategyConfigHelpSections(payload) {
  const config = payload?.config && typeof payload.config === "object" ? payload.config : {};
  const strategy = payload?.strategy || {};
  const mode = String(config.mode || strategy.mode || (Array.isArray(config.components) ? "composite" : "simple")).trim().toLowerCase() || "simple";
  const components = Array.isArray(config.components) ? config.components : [];
  const topLevelKeys = Object.keys(config);
  const componentIds = components.map((item) => String(item?.id || "").trim()).filter(Boolean);
  const currentStrategyName = String(config.label || strategy.label || config.id || strategy.id || "--").trim();
  const currentStrategyId = String(config.id || strategy.id || "--").trim();
  const bannerText = mode === "composite"
    ? "先看组合逻辑，再改阈值。通常把趋势过滤写进 buy_all / sell_all，把真正的买卖触发写进 buy_any / sell_any。"
    : "先确认指标和公式，再改阈值。单周期策略直接在当前周期里用表达式判断买卖。";

  const sections = [
    {
      title: "先看整体",
      description: "这一层决定策略叫什么、属于哪种模式，以及最后如何把多个条件拼成买卖信号。",
      items: [
        {
          title: "id",
          tag: "root",
          description: "策略内部唯一标识。保存本机覆盖配置、切换策略和 WebHook 输出时都会用到它。",
          example: currentStrategyId,
        },
        {
          title: "label",
          tag: "root",
          description: "页面上展示给用户看的名称，可以写成更易懂的中文名字。",
          example: currentStrategyName,
        },
        {
          title: "description",
          tag: "root",
          description: "一句话介绍这套策略的核心思想，适合写给使用者看。",
          example: String(config.description || strategy.description || "周线定方向，日线定波段，60/120 分钟找买卖点"),
        },
        {
          title: "mode",
          tag: "root",
          description: "simple 表示单周期直接判断；composite 表示由多个组件组合成最终信号。",
          example: mode,
          note: `当前是 ${strategyConfigModeLabel(mode)}。`,
        },
        {
          title: "timeframe",
          tag: "root",
          description: "给用户看的策略周期说明。组合策略通常会写成多个周期的概览文字。",
          example: String(config.timeframe || strategy.timeframe || "--"),
        },
        {
          title: "notes",
          tag: "root",
          description: "补充说明区，适合写这套策略的适用场景、风险提示和调参建议。",
          example: "notes: [\"适合强势行情\", \"跌破 20 日线先减仓\"]",
        },
      ],
    },
  ];

  if (mode === "composite") {
    sections.push({
      title: "组合逻辑",
      description: "组合策略不是直接写 BUY/SELL 公式，而是先定义组件和检查项，再通过 buy_all / buy_any / sell_all / sell_any 来拼装。",
      items: [
        {
          title: "components",
          tag: "combo",
          description: "组件列表。每个组件通常对应一个周期或一个独立观察角度，比如周线趋势、日线波段、60 分钟买点。",
          example: componentIds.length ? componentIds.join(", ") : "weekly_trend, daily_wave, intraday_60m",
          note: `当前共 ${components.length || 0} 个组件。`,
        },
        {
          title: "buy_all",
          tag: "combo",
          description: "买入时必须全部满足的条件，适合放趋势过滤、环境过滤这类硬门槛。",
          example: formatStrategyConfigHelpRefs(config.buy_all),
        },
        {
          title: "buy_any",
          tag: "combo",
          description: "买入时命中任意一个即可，适合放具体触发器，比如双金、底背离、放量突破。",
          example: formatStrategyConfigHelpRefs(config.buy_any),
        },
        {
          title: "sell_all / sell_any",
          tag: "combo",
          description: "卖出逻辑同理。sell_all 是必须同时满足，sell_any 是任意一个命中就触发风险或卖出。",
          example: `sell_all: ${formatStrategyConfigHelpRefs(config.sell_all)} | sell_any: ${formatStrategyConfigHelpRefs(config.sell_any)}`,
        },
        {
          title: "primary_component",
          tag: "combo",
          description: "最终信号默认取哪个组件的时间戳和行情名片，通常选最核心的触发组件。",
          example: String(config.primary_component || strategy.primary_component || "main"),
        },
        {
          title: "priority_component / priority_indicator",
          tag: "combo",
          description: "优先级评分从哪个组件、哪个指标取值。常用来决定列表排序和信号强弱展示。",
          example: `${String(config.priority_component || strategy.priority_component || "main")} + ${String(config.priority_indicator || strategy.priority_indicator || "j")}`,
        },
      ],
    });
  } else {
    sections.push({
      title: "单周期写法",
      description: "simple 模式没有组件引用，直接在当前周期里配置指标和买卖表达式。",
      items: [
        {
          title: "indicator_specs",
          tag: "simple",
          description: "先定义会用到的指标，后面的表达式才能引用这些名字。",
          example: "indicator_specs: [{\"name\":\"ma20\",\"type\":\"sma\",\"source\":\"close\",\"window\":20}]",
        },
        {
          title: "buy_rules_eval",
          tag: "simple",
          description: "买入表达式列表。每一条都会被计算，通常写价格位置、金叉、放量等条件。",
          example: "buy_rules_eval: [\"close >= ma20\", \"cross_over('dif', 'dea')\"]",
        },
        {
          title: "sell_rules_eval",
          tag: "simple",
          description: "卖出表达式列表，写法和 buy_rules_eval 相同。",
          example: "sell_rules_eval: [\"close < ma20\", \"cross_under('k', 'd')\"]",
        },
        {
          title: "priority_indicator",
          tag: "simple",
          description: "决定信号面板里优先显示哪个指标的分数或数值。",
          example: String(config.priority_indicator || strategy.priority_indicator || "j"),
        },
      ],
    });
  }

  sections.push(
    {
      title: "组件字段",
      description: "组件内部的字段主要用来指定周期、回看长度、指标定义和检查项命名。",
      items: [
        {
          title: "components[].id",
          tag: "component",
          description: "组件唯一名字。后面在 buy_all / buy_any 里会用 组件id.检查id 的格式引用它。",
          example: componentIds[0] ? `${componentIds[0]}.pass` : "weekly_trend.pass",
        },
        {
          title: "components[].label",
          tag: "component",
          description: "展示给用户看的组件名，建议写成易懂的中文，比如“日线波段”“60 分钟买点”。",
          example: String(components[0]?.label || "60分钟买点"),
        },
        {
          title: "components[].timeframe",
          tag: "component",
          description: "这个组件实际拉取哪个周期的数据。当前引擎支持 1m/5m/15m/30m/60m/120m/1d/1w/1M/1q。",
          example: String(components[0]?.timeframe || "60m"),
        },
        {
          title: "components[].lookback_bars",
          tag: "component",
          description: "为了计算指标和背离，需要往前取多少根 K 线。值越大越稳，但计算会更慢。",
          example: String(components[0]?.lookback_bars || 180),
          note: "建议不要低于 60，否则均线、背离和交叉更容易失真。",
        },
        {
          title: "components[].indicator_specs",
          tag: "component",
          description: "这个组件会先算哪些指标。这里定义的名字，后面的 checks 才能直接引用。",
          example: "indicator_specs: {\"ma20\":{\"type\":\"sma\",\"source\":\"close\",\"window\":20}}",
        },
        {
          title: "components[].checks",
          tag: "component",
          description: "检查项集合。每个检查项里可以放多条表达式，全部为 true 才算这个检查项通过。",
          example: "checks: {\"pass\": [\"close > ma20\"], \"double_gold\": [\"cross_over('dif', 'dea')\", \"cross_over('k', 'd')\"]}",
        },
      ],
    },
    {
      title: "常用指标参数",
      description: "指标定义写在 indicator_specs 里。最关键的是 type、name/source 和不同指标自己的窗口参数。",
      items: [
        {
          title: "SMA / EMA",
          tag: "indicator",
          description: "均线最常用。source 通常是 close，window 是周期长度。",
          example: "{\"name\":\"ma20\",\"type\":\"sma\",\"source\":\"close\",\"window\":20}",
        },
        {
          title: "MACD",
          tag: "indicator",
          description: "会同时产出主线、信号线和柱体。可以自定义 fast / slow / signal 以及输出名字。",
          example: "{\"name\":\"dif\",\"type\":\"macd\",\"source\":\"close\",\"signal_name\":\"dea\",\"hist_name\":\"macd_hist\"}",
        },
        {
          title: "KDJ",
          tag: "indicator",
          description: "window 是 RSV 窗口，k_name / d_name / j_name 是输出变量名。",
          example: "{\"type\":\"kdj\",\"window\":9,\"k_name\":\"k\",\"d_name\":\"d\",\"j_name\":\"j\"}",
        },
        {
          title: "RSI / ATR",
          tag: "indicator",
          description: "RSI 适合强弱过滤，ATR 适合波动率过滤或止损线。",
          example: "{\"name\":\"rsi14\",\"type\":\"rsi\",\"source\":\"close\",\"window\":14}",
        },
        {
          title: "Bollinger",
          tag: "indicator",
          description: "布林带会自动生成 upper / mid / lower 三条线，适合看通道突破或回踩。",
          example: "{\"name\":\"boll\",\"type\":\"bollinger\",\"source\":\"close\",\"window\":20,\"stddev\":2}",
        },
        {
          title: "source / name",
          tag: "indicator",
          description: "source 指指标基于哪条序列计算，name 或 k_name/d_name/j_name 决定后面公式里怎么引用。",
          example: "source 可用 close/open/high/low/volume/amount",
        },
      ],
    },
    {
      title: "表达式怎么写",
      description: "规则表达式使用 Python 风格写法。运算符请用 and / or / not，不要写成 && / ||。",
      items: [
        {
          title: "基础变量",
          tag: "expr",
          description: "开高低收量额会自动注入到规则里，指标名字也会自动成为变量。",
          example: "close >= ma20 and volume >= vol_ma5 * 0.9",
        },
        {
          title: "上一根值 prev_xxx",
          tag: "expr",
          description: "系统会自动生成上一根的值，比如 prev_close、prev_dif、prev_k，可以拿来做拐点或延续判断。",
          example: "close > ma20 and prev_close <= prev_ma20",
        },
        {
          title: "cross_over(left, right)",
          tag: "expr",
          description: "判断 left 是否刚刚向上金叉 right，本质是“当前在上、上一根还没在上”。",
          example: "cross_over('dif', 'dea')",
        },
        {
          title: "cross_under(left, right)",
          tag: "expr",
          description: "判断 left 是否刚刚向下死叉 right，常用于风险提示或卖出。",
          example: "cross_under('k', 'd')",
        },
        {
          title: "near(left, right, pct)",
          tag: "expr",
          description: "判断两个值是否足够接近。常用来描述“回踩 20 日线附近”。pct 填 0.02 就代表 2% 以内。",
          example: "near('low', 'ma20', 0.02)",
        },
        {
          title: "bullish_divergence(...)",
          tag: "expr",
          description: "底背离检测。参数依次是价格序列、指标序列、回看根数、拐点窗口、两个低点最小间隔。",
          example: "bullish_divergence('close', 'dif', 60, 3, 4)",
          note: "lookback 越大看得越远；pivot_window 越大越保守；min_separation 越大越不容易把两个太近的低点当成背离。",
        },
        {
          title: "bearish_divergence(...)",
          tag: "expr",
          description: "顶背离检测，参数意义和底背离相同，只是比较的是两个高点。",
          example: "bearish_divergence('close', 'dif', 60, 3, 4)",
        },
        {
          title: "辅助函数",
          tag: "expr",
          description: "当前还支持 abs / min / max / round，可以配合数值过滤一起使用。",
          example: "abs(dif - dea) <= 0.03",
        },
      ],
    }
  );

  if (topLevelKeys.length || componentIds.length) {
    sections.push({
      title: "当前策略对照",
      description: "下面这些示例直接取自你当前打开的策略，适合边看边改。",
      items: [
        {
          title: "顶层键",
          tag: "current",
          description: "这是当前这份 JSON 已经存在的顶层字段，新增字段时最好先确认是否真的被引擎支持。",
          example: topLevelKeys.length ? topLevelKeys.join(", ") : "id, label, mode, components",
        },
        {
          title: "当前组件",
          tag: "current",
          description: "这些组件名可以直接用于 buy_all / buy_any / sell_all / sell_any 的引用。",
          example: componentIds.length ? componentIds.join(" / ") : "main",
        },
        {
          title: "当前买入组合",
          tag: "current",
          description: "如果你想让策略更严格，优先调整 buy_all；想增加新的触发器，就往 buy_any 里加引用。",
          example: `buy_all: ${formatStrategyConfigHelpRefs(config.buy_all)} | buy_any: ${formatStrategyConfigHelpRefs(config.buy_any)}`,
        },
        {
          title: "当前卖出组合",
          tag: "current",
          description: "卖出通常建议保持更直接，尤其是破位、双死、顶背离这类风险项。",
          example: `sell_all: ${formatStrategyConfigHelpRefs(config.sell_all)} | sell_any: ${formatStrategyConfigHelpRefs(config.sell_any)}`,
        },
      ],
    });
  }

  return {
    bannerText,
    badges: [
      { label: "当前策略", value: currentStrategyName },
      { label: "模式", value: strategyConfigModeLabel(mode) },
      { label: "组件数", value: String(components.length || (mode === "simple" ? 1 : 0)) },
    ],
    sections,
  };
}

function renderStrategyConfigHelp(payload) {
  if (!dom.strategyConfigHelpContent) return;

  const help = buildStrategyConfigHelpSections(payload);
  dom.strategyConfigHelpContent.innerHTML = "";

  const banner = document.createElement("section");
  banner.className = "strategy-config-help-banner";
  const intro = document.createElement("p");
  intro.textContent = help.bannerText;
  banner.appendChild(intro);

  const badges = document.createElement("div");
  badges.className = "strategy-config-help-badges";
  help.badges.forEach((item) => {
    const badge = document.createElement("span");
    badge.className = "strategy-config-help-badge";
    const label = document.createElement("span");
    label.textContent = `${item.label}`;
    const value = document.createElement("strong");
    value.textContent = item.value;
    badge.appendChild(label);
    badge.appendChild(value);
    badges.appendChild(badge);
  });
  banner.appendChild(badges);
  dom.strategyConfigHelpContent.appendChild(banner);

  help.sections.forEach((section) => {
    const wrapper = document.createElement("section");
    wrapper.className = "strategy-config-help-section";

    const heading = document.createElement("div");
    heading.className = "strategy-config-help-heading";
    const title = document.createElement("h4");
    title.textContent = section.title || "--";
    heading.appendChild(title);
    if (section.description) {
      const description = document.createElement("p");
      description.textContent = section.description;
      heading.appendChild(description);
    }
    wrapper.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "strategy-config-help-grid";
    (section.items || []).forEach((item) => {
      grid.appendChild(createStrategyConfigHelpCard(item));
    });
    wrapper.appendChild(grid);
    dom.strategyConfigHelpContent.appendChild(wrapper);
  });

  setStrategyConfigHelpOpen(state.strategyConfigHelpOpen);
}

function renderStrategyConfigEditor(payload) {
  if (!dom.strategyConfigInput || !dom.strategyConfigMeta) return;

  const config = payload?.config || {};
  const meta = payload?.config_meta || {};
  const strategyId = normalizeStrategyValue(payload?.strategy?.id);
  const nextText = JSON.stringify(config, null, 2);
  const strategyChanged = state.strategyConfigStrategyId !== strategyId;
  const configChanged = state.strategyConfigSeed !== nextText;
  const editable = Boolean(meta.editable && normalizeStrategyValue(payload?.strategy?.id) !== "none");
  const sourceText = meta.is_overridden ? "当前使用本机覆盖配置。" : "当前使用内置基础配置。";
  dom.strategyConfigMeta.textContent = editable
    ? `${sourceText} 你可以直接修改 JSON 并保存，恢复默认会回到内置刘昌松策略。`
    : "当前策略不支持编辑。";
  if (strategyChanged || configChanged || !state.strategyConfigDirty) {
    dom.strategyConfigInput.value = nextText;
    state.strategyConfigSeed = nextText;
    state.strategyConfigStrategyId = strategyId;
    state.strategyConfigDirty = false;
  }
  setStrategyConfigControlsDisabled(!editable);

  if (!editable) {
    setStrategyConfigMessage("请选择可编辑的刘昌松策略。");
    return;
  }
  if (!dom.strategyConfigMessage.classList.contains("error")) {
    setStrategyConfigMessage(meta.is_overridden ? "已启用本机覆盖配置。" : "当前显示内置基础配置。");
  }
}

function formatSigned(value, digits = 2) {
  const num = Number(value || 0);
  const sign = num > 0 ? "+" : "";
  return `${sign}${num.toFixed(digits)}`;
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return `${formatSigned(value, digits)}%`;
}

function formatFixed(value, digits = 3) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  return Number(value).toFixed(digits);
}

function formatCompactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "--";
  }
  const abs = Math.abs(num);
  if (abs >= 1e12) return `${(num / 1e12).toFixed(2)}万亿`;
  if (abs >= 1e8) return `${(num / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${(num / 1e4).toFixed(2)}万`;
  return num.toFixed(2);
}

function normalizeTimestampDigits(value) {
  return String(value ?? "")
    .trim()
    .replace(/\D/g, "");
}

function formatTimestampLabel(value, timeframe = state.timeframe, compact = false) {
  const raw = String(value ?? "").trim();
  const digits = normalizeTimestampDigits(raw);
  if (!digits) {
    return raw || "--";
  }

  const formatQuarterLabel = (year, month) => {
    const monthNumber = Number(month);
    if (!Number.isFinite(monthNumber) || monthNumber < 1) {
      return `${year}-Q?`;
    }
    const quarter = Math.min(4, Math.max(1, Math.floor((monthNumber - 1) / 3) + 1));
    return compact ? `${year}-Q${quarter}` : `${year} Q${quarter}`;
  };

  if (digits.length >= 12) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    const hour = digits.slice(8, 10);
    const minute = digits.slice(10, 12);
    if (compact) {
      return `${month}-${day}\n${hour}:${minute}`;
    }
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }

  if (digits.length >= 8) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    if (timeframe === "1q") {
      return formatQuarterLabel(year, month);
    }
    if (compact) {
      if (timeframe === "1w" || timeframe === "1M") {
        return `${year}-${month}`;
      }
      return `${month}-${day}`;
    }
    return `${year}-${month}-${day}`;
  }

  if (digits.length >= 6) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    if (timeframe === "1q") {
      return formatQuarterLabel(year, month);
    }
    return `${year}-${month}`;
  }

  return raw;
}

function formatTooltipValue(seriesName, value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "--";
  }
  if (seriesName === "VOL") {
    return formatCompactNumber(value);
  }
  if (["MACD Hist", "DIF", "DEA", "K", "D", "J"].includes(seriesName)) {
    return formatFixed(value, 4);
  }
  return formatFixed(value, 3);
}

function getLastFiniteValue(values) {
  if (!Array.isArray(values)) return null;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = Number(values[index]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function renderIndicatorHeaders(payload) {
  const macd = payload?.indicators?.macd || {};
  const kdj = payload?.indicators?.kdj || {};

  dom.macdDifLabel.textContent = `DIF:${formatFixed(getLastFiniteValue(macd.dif), 2)}`;
  dom.macdDeaLabel.textContent = `DEA:${formatFixed(getLastFiniteValue(macd.dea), 2)}`;
  dom.macdHistLabel.textContent = `MACD:${formatFixed(getLastFiniteValue(macd.hist), 2)}`;

  dom.kdjKLabel.textContent = `K:${formatFixed(getLastFiniteValue(kdj.k), 2)}`;
  dom.kdjDLabel.textContent = `D:${formatFixed(getLastFiniteValue(kdj.d), 2)}`;
  dom.kdjJLabel.textContent = `J:${formatFixed(getLastFiniteValue(kdj.j), 2)}`;
}

function scheduleChartResize() {
  if (!state.chart) return;

  const runResize = () => {
    if (!state.chart) return;
    try {
      state.chart.resize();
    } catch (error) {
      console.error(error);
    }
  };

  window.requestAnimationFrame(runResize);
  window.setTimeout(runResize, 80);
  window.setTimeout(runResize, 220);
}

function ensureChartReady() {
  if (!state.chart) {
    state.chart = echarts.init(dom.chart);
    window.addEventListener("resize", scheduleChartResize);
  }

  if (!state.chartResizeObserver && typeof ResizeObserver !== "undefined") {
    state.chartResizeObserver = new ResizeObserver(() => {
      scheduleChartResize();
    });
    state.chartResizeObserver.observe(dom.chart);
  }
}

function signalClass(signal) {
  const normalized = String(signal || "").toLowerCase();
  if (normalized === "buy") return "buy";
  if (normalized === "sell") return "sell";
  if (normalized === "hold") return "hold";
  if (normalized === "conflict") return "conflict";
  return "neutral";
}

function setActiveTimeframeButton() {
  dom.timeframeButtons.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("active", button.dataset.timeframe === state.timeframe);
  });
}

function renderChipList(container, items, emptyText) {
  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }
  items.forEach((item) => {
    const node = document.createElement("div");
    node.className = "modal-chip";
    node.textContent = item;
    container.appendChild(node);
  });
}

function isStrategyRiskCheck(checkId) {
  const normalized = String(checkId || "").trim().toLowerCase();
  return normalized.includes("dead") || normalized.includes("top_div") || normalized.startsWith("break_") || normalized === "sell";
}

function summarizeStrategyRules(rules = []) {
  const list = Array.isArray(rules) ? rules.filter(Boolean) : [];
  if (list.length === 0) return "无规则";
  return list.join(" + ");
}

function strategyCheckLabel(checkId) {
  const normalized = String(checkId || "").trim().toLowerCase();
  const mapping = {
    pass: "趋势通过",
    buy: "买入条件",
    sell: "卖出条件",
    buy_ready: "买入就绪",
    sell_ready: "卖出就绪",
    double_gold: "双金",
    double_dead: "双死",
    bottom_div: "底背离",
    top_div: "顶背离",
    volume_ok: "量能确认",
    break_5: "跌破 5 日线",
    break_20: "跌破 20 日线",
    break_60: "跌破 60 日线",
  };
  return mapping[normalized] || normalized.replace(/_/g, " ");
}

function formatDecisionEntryLabel(entry) {
  const componentLabel = String(entry?.component_label || entry?.component_id || "").trim();
  const checkLabel = strategyCheckLabel(entry?.check_id);
  if (componentLabel && checkLabel) {
    return `${componentLabel}·${checkLabel}`;
  }
  if (componentLabel) {
    return componentLabel;
  }
  if (checkLabel) {
    return checkLabel;
  }
  return String(entry?.ref || "").trim();
}

function summarizeDecisionEntries(entries = []) {
  const labels = (Array.isArray(entries) ? entries : [])
    .map((entry) => formatDecisionEntryLabel(entry))
    .filter(Boolean);
  return labels.join(" + ");
}

function strategyDisplayTimeframe(payload) {
  const strategyTimeframe = String(payload?.strategy?.timeframe || "").trim();
  if (!strategyTimeframe) {
    return state.timeframe;
  }
  if (strategyTimeframe.includes("路") || strategyTimeframe.includes("/") || strategyTimeframe.includes("·")) {
    return state.timeframe;
  }
  return strategyTimeframe;
}

function resolveStrategyDecisionState(payload) {
  const decision = payload?.details?.decision;
  if (!decision || typeof decision !== "object") {
    return null;
  }

  let side = String(decision.active_side || "").trim().toLowerCase();
  const signal = String(payload?.signal || "").trim().toUpperCase();
  if (!["buy", "sell"].includes(side)) {
    if (signal === "BUY") side = "buy";
    if (signal === "SELL") side = "sell";
  }
  if (!["buy", "sell"].includes(side)) {
    return null;
  }

  const group = decision?.[side];
  if (!group || typeof group !== "object") {
    return null;
  }

  return { side, group };
}

function buildStrategyDecisionText(payload) {
  const resolved = resolveStrategyDecisionState(payload);
  if (!resolved) {
    return "";
  }

  const { side, group } = resolved;
  const title = side === "sell" ? "卖出组合" : "买入组合";
  const parts = [];
  if (String(group.mode || "").trim().toLowerCase() === "cases") {
    let focusCase = null;
    for (const key of ["active_case", "candidate_case"]) {
      const candidate = group?.[key];
      if (candidate && typeof candidate === "object") {
        focusCase = candidate;
        break;
      }
    }
    const caseLabel = String((focusCase || {}).label || "").trim();
    if (caseLabel) {
      const caseTitle = Boolean(group.triggered) ? "命中分支" : "关注分支";
      parts.push(`${caseTitle} [${caseLabel}]`);
    }
    const actionLabel = String((focusCase || {}).action_label || group.action_label || "").trim();
    if (actionLabel) {
      parts.push(`动作 [${actionLabel}]`);
    }
  }
  const matchedAll = Array.isArray(group.matched_all) ? group.matched_all : [];
  const matchedAny = Array.isArray(group.matched_any) ? group.matched_any : [];
  const missingAll = Array.isArray(group.missing_all) ? group.missing_all : [];

  if (Array.isArray(group.all) && group.all.length > 0) {
    if (group.triggered || group.all_ok) {
      parts.push(`全部满足 [${summarizeDecisionEntries(matchedAll.length ? matchedAll : group.all)}]`);
    } else if (missingAll.length > 0) {
      parts.push(`待补条件 [${summarizeDecisionEntries(missingAll)}]`);
    }
  }

  if (Array.isArray(group.any) && group.any.length > 0) {
    if (matchedAny.length > 0) {
      parts.push(`任一命中 [${summarizeDecisionEntries(matchedAny)}]`);
    } else {
      parts.push(`候选任一 [${summarizeDecisionEntries(group.any)}]`);
    }
  }

  if (parts.length === 0) {
    return "";
  }
  return `${title}：${parts.join("；")}`;
}

function webhookSignalLabel(signal) {
  const normalized = String(signal || "").trim().toUpperCase();
  const mapping = {
    BUY: "\u4e70\u5165",
    SELL: "\u5356\u51fa",
    HOLD: "\u89c2\u671b",
    TEST: "\u6d4b\u8bd5",
  };
  return mapping[normalized] || normalized || "\u901a\u77e5";
}

function uniqueWebhookEntries(entries = []) {
  const seen = new Set();
  const result = [];
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const ref = String(entry.ref || `${entry.component_id || ""}.${entry.check_id || ""}`)
      .trim()
      .toLowerCase();
    if (!ref || seen.has(ref)) return;
    seen.add(ref);
    result.push(entry);
  });
  return result;
}

function buildFallbackWebhookEntries(strategySignal, signal) {
  const normalizedSignal = String(signal || "").trim().toUpperCase();
  const side = normalizedSignal === "SELL" ? "sell" : normalizedSignal === "BUY" ? "buy" : "";
  if (!side) {
    return [];
  }

  const components = strategySignal?.details?.components;
  if (!components || typeof components !== "object") {
    return [];
  }

  const entries = [];
  Object.values(components).forEach((component) => {
    if (!component || typeof component !== "object") return;
    const checks = component.checks;
    const check = checks && typeof checks === "object" ? checks[side] : null;
    if (!check?.ok) return;
    entries.push({
      ref: `${component.id || "main"}.${side}`,
      component_id: String(component.id || "main").trim().toLowerCase(),
      component_label: String(component.label || component.id || "").trim(),
      timeframe: String(component.timeframe || "--").trim(),
      check_id: side,
      matched: true,
      matched_rules: Array.isArray(check.matched) ? check.matched : [],
      rules: Array.isArray(check.rules) ? check.rules : [],
      warnings: Array.isArray(check.warnings) ? check.warnings : [],
    });
  });
  return entries;
}

function collectWebhookDecisionEntries(strategySignal, signal) {
  const resolved = resolveStrategyDecisionState(strategySignal);
  const decisionText = buildStrategyDecisionText(strategySignal);
  if (!resolved) {
    const fallbackEntries = uniqueWebhookEntries(buildFallbackWebhookEntries(strategySignal, signal));
    return {
      side: String(signal || "").trim().toUpperCase() === "SELL" ? "sell" : "buy",
      primaryEntries: fallbackEntries,
      supportingEntries: [],
      allEntries: fallbackEntries,
      decisionText,
    };
  }

  const { side, group } = resolved;
  const matchedAll = Array.isArray(group.matched_all) ? group.matched_all : [];
  const matchedAny = Array.isArray(group.matched_any) ? group.matched_any : [];
  const primaryEntries = uniqueWebhookEntries(matchedAny.length ? matchedAny : matchedAll);
  const supportingEntries = uniqueWebhookEntries(matchedAny.length ? matchedAll : []);
  return {
    side,
    primaryEntries,
    supportingEntries,
    allEntries: uniqueWebhookEntries([...primaryEntries, ...supportingEntries]),
    decisionText,
  };
}

function webhookRulePriority(entry, signal) {
  const normalizedSignal = String(signal || "").trim().toUpperCase();
  const checkId = String(entry?.check_id || "").trim().toLowerCase();
  const buyWeights = {
    bottom_div: 120,
    double_gold: 110,
    buy: 90,
    pass: 70,
    volume_ok: 60,
  };
  const sellWeights = {
    top_div: 130,
    break_60: 120,
    break_20: 110,
    double_dead: 100,
    break_5: 90,
    sell: 80,
  };
  const sharedWeights = {
    volume_ok: 60,
    pass: 50,
  };
  if (normalizedSignal === "SELL") {
    return sellWeights[checkId] ?? sharedWeights[checkId] ?? 10;
  }
  return buyWeights[checkId] ?? sharedWeights[checkId] ?? 10;
}

function buildWebhookRuleSummary(entry, strategySignal = null) {
  const checkId = String(entry?.check_id || "").trim().toLowerCase();
  const componentLabel = String(entry?.component_label || entry?.component_id || "").trim();
  const strategyId = normalizeStrategyValue(strategySignal?.strategy?.id || strategySignal?.strategy_id);
  const checkLabel = strategyCheckLabel(checkId);
  if (checkId === "buy" && strategyId.includes("divergence")) {
    return componentLabel ? `${componentLabel}\u51fa\u73b0\u5e95\u80cc\u79bb` : "\u5e95\u80cc\u79bb";
  }
  if (checkId === "sell" && strategyId.includes("divergence")) {
    return componentLabel ? `${componentLabel}\u51fa\u73b0\u9876\u80cc\u79bb` : "\u9876\u80cc\u79bb";
  }
  if (["bottom_div", "top_div", "double_gold", "double_dead"].includes(checkId)) {
    return componentLabel ? `${componentLabel}\u51fa\u73b0${checkLabel}` : checkLabel;
  }
  return formatDecisionEntryLabel(entry);
}

function describeWebhookRuleMeta(entry, signal, strategySignal) {
  const normalizedSignal = String(signal || "").trim().toUpperCase();
  const checkId = String(entry?.check_id || "").trim().toLowerCase();
  const strategyId = normalizeStrategyValue(strategySignal?.strategy?.id || strategySignal?.strategy_id);

  if (checkId === "bottom_div" || (checkId === "buy" && strategyId.includes("divergence"))) {
    return {
      familyId: "bottom_divergence",
      familyLabel: "\u80cc\u79bb\u4fe1\u53f7",
      titleLabel: "\u5e95\u80cc\u79bb",
      ruleLabel: "\u5e95\u80cc\u79bb",
      actionHint: "\u5206\u6279\u89c2\u5bdf\uff0c\u7b49\u5f85\u53cd\u5f39\u786e\u8ba4\uff0c\u4e0d\u8ffd\u9ad8\u3002",
    };
  }
  if (checkId === "top_div" || (checkId === "sell" && strategyId.includes("divergence"))) {
    return {
      familyId: "top_divergence",
      familyLabel: "\u80cc\u79bb\u4fe1\u53f7",
      titleLabel: "\u9876\u80cc\u79bb",
      ruleLabel: "\u9876\u80cc\u79bb",
      actionHint: "\u4f18\u5148\u4fdd\u62a4\u5229\u6da6\uff0c\u89c2\u5bdf\u662f\u5426\u7ee7\u7eed\u8f6c\u5f31\u3002",
    };
  }
  if (checkId === "double_gold") {
    return {
      familyId: "double_gold",
      familyLabel: "\u53cc\u91d1\u53cc\u6b7b",
      titleLabel: "\u53cc\u91d1\u5171\u632f",
      ruleLabel: strategyCheckLabel(checkId),
      actionHint: "\u4f18\u5148\u5173\u6ce8\u540e\u7eed\u91cf\u80fd\u548c\u56de\u8e29\u786e\u8ba4\uff0c\u907f\u514d\u8ffd\u6da8\u3002",
    };
  }
  if (checkId === "double_dead") {
    return {
      familyId: "double_dead",
      familyLabel: "\u53cc\u91d1\u53cc\u6b7b",
      titleLabel: "\u53cc\u6b7b\u8f6c\u5f31",
      ruleLabel: strategyCheckLabel(checkId),
      actionHint: "\u4f18\u5148\u6536\u7f29\u4ed3\u4f4d\uff0c\u7b49\u5f85\u91cd\u65b0\u4f01\u7a33\u3002",
    };
  }
  if (checkId.startsWith("break_")) {
    const hintMap = {
      break_5: "\u77ed\u7ebf\u8f6c\u5f31\uff0c\u5148\u51cf\u4ed3\u89c2\u5bdf\u3002",
      break_20: "\u6ce2\u6bb5\u8f6c\u5f31\uff0c\u4f18\u5148\u51cf\u4ed3\u3002",
      break_60: "\u4e2d\u671f\u8d70\u5f31\uff0c\u5f3a\u98ce\u9669\u79bb\u573a\u3002",
    };
    return {
      familyId: "ma_break",
      familyLabel: "\u5747\u7ebf\u7834\u4f4d",
      titleLabel: strategyCheckLabel(checkId),
      ruleLabel: strategyCheckLabel(checkId),
      actionHint: hintMap[checkId] || "\u5747\u7ebf\u7834\u4f4d\uff0c\u6ce8\u610f\u98ce\u9669\u63a7\u5236\u3002",
    };
  }
  if (checkId === "volume_ok") {
    return {
      familyId: "volume_confirm",
      familyLabel: "\u91cf\u4ef7\u786e\u8ba4",
      titleLabel: "\u91cf\u80fd\u786e\u8ba4",
      ruleLabel: strategyCheckLabel(checkId),
      actionHint: "\u91cf\u4ef7\u914d\u5408\u6709\u6548\uff0c\u4ecd\u9700\u7b49\u5f85\u4e70\u70b9\u5171\u632f\u3002",
    };
  }
  if (checkId === "pass") {
    return {
      familyId: "trend_filter",
      familyLabel: "\u8d8b\u52bf\u8fc7\u6ee4",
      titleLabel: normalizedSignal === "SELL" ? "\u8d8b\u52bf\u8f6c\u5f31" : "\u591a\u5468\u671f\u5171\u632f",
      ruleLabel: strategyCheckLabel(checkId),
      actionHint:
        normalizedSignal === "SELL"
          ? "\u5927\u5468\u671f\u4ecd\u9700\u7ee7\u7eed\u8ddf\u8e2a\uff0c\u82e5\u540c\u65f6\u51fa\u73b0\u8f6c\u5f31\u4fe1\u53f7\u9700\u4f18\u5148\u9632\u5b88\u3002"
          : "\u8d8b\u52bf\u6761\u4ef6\u5df2\u5bf9\u9f50\uff0c\u53ef\u7ee7\u7eed\u7b49\u5f85\u66f4\u4f18\u4e70\u70b9\u3002",
    };
  }
  if (checkId === "buy") {
    return {
      familyId: "buy_signal",
      familyLabel: "\u7b56\u7565\u4e70\u70b9",
      titleLabel: "\u7b56\u7565\u4e70\u70b9",
      ruleLabel: strategyCheckLabel(checkId),
      actionHint: "\u53ef\u7ed3\u5408\u4ed3\u4f4d\u8ba1\u5212\u5206\u6279\u6267\u884c\u3002",
    };
  }
  if (checkId === "sell") {
    return {
      familyId: "sell_signal",
      familyLabel: "\u7b56\u7565\u5356\u70b9",
      titleLabel: "\u7b56\u7565\u5356\u70b9",
      ruleLabel: strategyCheckLabel(checkId),
      actionHint: "\u7ed3\u5408\u6301\u4ed3\u548c\u98ce\u9669\u504f\u597d\uff0c\u4f18\u5148\u6267\u884c\u98ce\u63a7\u3002",
    };
  }
  return {
    familyId: normalizedSignal === "SELL" ? "sell_signal" : "buy_signal",
    familyLabel: "\u7b56\u7565\u4fe1\u53f7",
    titleLabel: normalizedSignal === "SELL" ? "\u7b56\u7565\u5356\u70b9" : "\u7b56\u7565\u4e70\u70b9",
    ruleLabel: strategyCheckLabel(checkId),
    actionHint: "\u8be5\u4fe1\u53f7\u5df2\u89e6\u53d1\uff0c\u8bf7\u7ed3\u5408\u4ed3\u4f4d\u4e0e\u98ce\u9669\u8ba1\u5212\u6267\u884c\u3002",
  };
}

function buildWebhookReasonContext(row, signal) {
  const strategySignal = row?.strategySignal || {};
  const normalizedSignal = String(signal || "").trim().toUpperCase();
  const action = String(strategySignal?.action || normalizedSignal.toLowerCase())
    .trim()
    .toLowerCase();
  const actionLabel = String(strategySignal?.action_label || "").trim();
  const decisionState = collectWebhookDecisionEntries(strategySignal, normalizedSignal);
  const primaryEntries = [...decisionState.primaryEntries].sort(
    (left, right) => webhookRulePriority(right, normalizedSignal) - webhookRulePriority(left, normalizedSignal)
  );
  const primaryEntry = primaryEntries[0] || decisionState.allEntries[0] || null;
  const secondaryEntries = uniqueWebhookEntries([
    ...primaryEntries.slice(1),
    ...decisionState.supportingEntries,
  ]).filter((entry) => String(entry.ref || "").trim() !== String(primaryEntry?.ref || "").trim());
  const meta = describeWebhookRuleMeta(primaryEntry, normalizedSignal, strategySignal);
  const reasonSummary = primaryEntry
    ? buildWebhookRuleSummary(primaryEntry, strategySignal)
    : strategySignal?.reason || `${webhookSignalLabel(normalizedSignal)}\u4fe1\u53f7\u5df2\u89e6\u53d1`;
  const reasonDetails = uniqueWebhookEntries(decisionState.allEntries)
    .map((entry) => buildWebhookRuleSummary(entry, strategySignal))
    .filter(Boolean);
  const supportingReasons = secondaryEntries
    .map((entry) => buildWebhookRuleSummary(entry, strategySignal))
    .filter((text, index, list) => text && list.indexOf(text) === index)
    .slice(0, 4);
  return {
    category: "signal",
    signal_type: normalizedSignal.toLowerCase(),
    signal_action: action,
    action,
    action_label: actionLabel,
    rule_family: meta.familyId,
    rule_family_label: meta.familyLabel,
    rule_name: primaryEntry?.ref || meta.familyId,
    rule_label: meta.ruleLabel,
    rule_names: uniqueWebhookEntries(decisionState.allEntries)
      .map((entry) => String(entry.ref || "").trim())
      .filter(Boolean),
    reason_summary: reasonSummary,
    reason_details: reasonDetails,
    supporting_reasons: supportingReasons,
    decision_text: decisionState.decisionText || "",
    message_title: `${webhookSignalLabel(normalizedSignal)} | ${actionLabel || meta.titleLabel}`,
    action_hint: meta.actionHint,
  };
}

function buildWebhookMessageText(payload) {
  const title = String(payload?.message_title || "").trim() || `${webhookSignalLabel(payload?.signal)} | \u7b56\u7565\u901a\u77e5`;
  const symbol = String(payload?.symbol || "").trim().toUpperCase();
  const name = String(payload?.name || "").trim();
  const strategy = String(payload?.strategy_label || payload?.strategy || "").trim();
  const actionLabel = String(payload?.action_label || "").trim();
  const source = String(payload?.source_label || payload?.source || "").trim();
  const timestamp = String(payload?.timestamp || "").trim().replace("T", " ").replace("Z", "");
  const reasonSummary = String(payload?.reason_summary || payload?.reason || "").trim();
  const decisionText = String(payload?.decision_text || "").trim();
  const actionHint = String(payload?.action_hint || "").trim();
  const reasonDetails = Array.isArray(payload?.reason_details) ? payload.reason_details.filter(Boolean) : [];
  const supportingReasons = Array.isArray(payload?.supporting_reasons)
    ? payload.supporting_reasons.filter(Boolean)
    : [];
  const lines = [`Signal Deck ${title}`];

  if (symbol || name) {
    lines.push(`\u6807\u7684\uff1a${[symbol, name].filter(Boolean).join(" ")}`);
  }
  if (strategy) {
    lines.push(`\u7b56\u7565\uff1a${strategy}`);
  }
  if (actionLabel) {
    lines.push(`\u52a8\u4f5c\uff1a${actionLabel}`);
  }
  if (reasonSummary) {
    lines.push(`\u4e3b\u56e0\uff1a${reasonSummary}`);
  }
  if (supportingReasons.length > 0) {
    lines.push(`\u8f85\u52a9\uff1a${supportingReasons.slice(0, 3).join("\uff1b")}`);
  } else if (reasonDetails.length > 1) {
    lines.push(`\u8f85\u52a9\uff1a${reasonDetails.slice(1, 4).join("\uff1b")}`);
  }
  if (decisionText) {
    lines.push(`\u5224\u5b9a\uff1a${decisionText}`);
  }

  const hasPrice = payload?.price !== null && payload?.price !== undefined && !Number.isNaN(Number(payload.price));
  const hasChange = payload?.change !== null && payload?.change !== undefined && !Number.isNaN(Number(payload.change));
  const hasChangePct =
    payload?.change_pct !== null && payload?.change_pct !== undefined && !Number.isNaN(Number(payload.change_pct));
  if (hasPrice || hasChange || hasChangePct) {
    const parts = [];
    if (hasPrice) {
      parts.push(`\u4ef7\u683c\uff1a${formatFixed(payload.price, 3)}`);
    }
    if (hasChange || hasChangePct) {
      const changeParts = [];
      if (hasChange) {
        changeParts.push(formatSigned(payload.change, 3));
      }
      if (hasChangePct) {
        changeParts.push(formatPercent(payload.change_pct, 2));
      }
      parts.push(`\u6da8\u8dcc\uff1a${changeParts.join(" / ")}`);
    }
    lines.push(parts.join(" | "));
  }

  if (source) {
    lines.push(`\u6570\u636e\u6e90\uff1a${source}`);
  }
  if (timestamp) {
    lines.push(`\u65f6\u95f4\uff1a${timestamp}`);
  }
  if (actionHint) {
    lines.push(`\u5efa\u8bae\uff1a${actionHint}`);
  }
  return lines.join("\n");
}

function buildStrategyToastMeta(payload) {
  const parts = [];
  const actualSource = String(payload?.source?.actual_label || payload?.source?.actual || "").trim();
  if (actualSource) {
    parts.push(actualSource);
  }

  if (payload?.priority?.label && payload.priority.label !== "--") {
    const score = Number(payload.priority.score);
    const scoreText = Number.isFinite(score) ? ` (${formatFixed(score, 2)})` : "";
    parts.push(`优先级 ${payload.priority.label}${scoreText}`);
  }

  if (payload?.timestamp) {
    parts.push(formatTimestampLabel(payload.timestamp, strategyDisplayTimeframe(payload) || "5m", false));
  }

  if (payload?.reason) {
    parts.push(`命中项 ${payload.reason}`);
  }

  return parts.join(" | ");
}

function ensureSignalDrawerStrategyLabel() {
  if (dom.signalDrawerStrategyLabel) {
    return dom.signalDrawerStrategyLabel;
  }
  const container = dom.signalDrawer?.querySelector(".drawer-header > div");
  if (!container) {
    return null;
  }
  const node = document.createElement("p");
  node.id = "signalDrawerStrategyLabel";
  node.className = "signal-drawer-current-rule";
  node.textContent = "当前规则：--";
  container.appendChild(node);
  dom.signalDrawerStrategyLabel = node;
  return node;
}

function renderStrategyBlueprint(container, components = []) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(components) || components.length === 0) {
    container.innerHTML = `<div class="empty-state">当前策略没有组件化说明。</div>`;
    return;
  }

  components.forEach((component) => {
    const card = document.createElement("article");
    card.className = "strategy-component-card";

    const header = document.createElement("div");
    header.className = "strategy-component-top";
    header.innerHTML = `
      <div>
        <strong>${component.label || component.id || "组件"}</strong>
        <span class="strategy-component-id">${component.id || "--"}</span>
      </div>
      <span class="strategy-component-timeframe">${component.timeframe || "--"}</span>
    `;
    card.appendChild(header);

    const list = document.createElement("div");
    list.className = "strategy-check-list";
    (component.checks || []).forEach((check) => {
      const node = document.createElement("div");
      node.className = `strategy-check-chip ${isStrategyRiskCheck(check.id) ? "pass" : "risk"}`;
      node.innerHTML = `
        <span class="strategy-check-title">${check.label || check.id || "检查"}</span>
        <span class="strategy-check-body">${summarizeStrategyRules(check.rules)}</span>
      `;
      list.appendChild(node);
    });
    if (!list.childNodes.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "当前组件没有显式检查项。";
      list.appendChild(empty);
    }
    card.appendChild(list);
    container.appendChild(card);
  });
}

function strategyCheckStateTone(checkId, checkState) {
  if (!checkState) return "pending";
  if (Array.isArray(checkState.warnings) && checkState.warnings.length > 0) return "warn";
  if (checkState.ok) {
    return isStrategyRiskCheck(checkId) ? "risk" : "pass";
  }
  return "pending";
}

function strategyCheckStateText(checkId, checkState) {
  if (!checkState) return "等待刷新";
  if (checkState.ok) {
    return isStrategyRiskCheck(checkId) ? "风险命中" : "条件通过";
  }
  if (Array.isArray(checkState.warnings) && checkState.warnings.length > 0) {
    return "规则告警";
  }
  return "未命中";
}

function formatComponentIndicatorSummary(indicators = {}) {
  const parts = [];
  ["dif", "dea", "k", "d", "j", "ma5", "ma20", "ma60", "vol_ma5"].forEach((key) => {
    const value = Number(indicators?.[key]);
    if (!Number.isFinite(value)) return;
    const digits = ["k", "d", "j"].includes(key) ? 2 : 2;
    parts.push(`${key.toUpperCase()} ${formatFixed(value, digits)}`);
  });
  return parts.join(" | ");
}

function renderStrategyComponentStatuses(container, components = [], details = {}) {
  if (!container) return;
  container.innerHTML = "";
  if (!Array.isArray(components) || components.length === 0) {
    container.innerHTML = `<div class="empty-state">当前策略没有组件状态。</div>`;
    return;
  }

  const componentStates = details?.components || {};
  components.forEach((component) => {
    const stateItem = componentStates?.[component.id];
    const card = document.createElement("article");
    card.className = "strategy-component-card live";

    const header = document.createElement("div");
    header.className = "strategy-component-top";
    header.innerHTML = `
      <div>
        <strong>${component.label || component.id || "组件"}</strong>
        <span class="strategy-component-id">${stateItem?.name || component.id || "--"}</span>
      </div>
      <span class="strategy-component-timeframe">${component.timeframe || stateItem?.timeframe || "--"}</span>
    `;
    card.appendChild(header);

    const meta = document.createElement("div");
    meta.className = "strategy-component-meta";
    meta.textContent = stateItem?.timestamp
      ? `${formatTimestampLabel(stateItem.timestamp, component.timeframe || stateItem.timeframe || "1d", false)}`
      : "打开策略后会显示组件实时状态";
    card.appendChild(meta);

    const list = document.createElement("div");
    list.className = "strategy-check-list";
    (component.checks || []).forEach((check) => {
      const checkState = stateItem?.checks?.[check.id];
      const node = document.createElement("div");
      node.className = `strategy-check-chip ${strategyCheckStateTone(check.id, checkState)}`;
      const matchedCount = Array.isArray(checkState?.matched) ? checkState.matched.length : 0;
      const ruleCount = Array.isArray(checkState?.rules) ? checkState.rules.length : Array.isArray(check.rules) ? check.rules.length : 0;
      node.innerHTML = `
        <span class="strategy-check-title">${check.label || check.id || "检查"}</span>
        <span class="strategy-check-state">${strategyCheckStateText(check.id, checkState)}${ruleCount ? ` · ${matchedCount}/${ruleCount}` : ""}</span>
        <span class="strategy-check-body">${summarizeStrategyRules(checkState?.rules || check.rules)}</span>
      `;
      list.appendChild(node);
    });
    card.appendChild(list);

    const summary = formatComponentIndicatorSummary(stateItem?.indicator_payload || {});
    if (summary) {
      const footer = document.createElement("div");
      footer.className = "strategy-component-meta";
      footer.textContent = summary;
      card.appendChild(footer);
    }
    container.appendChild(card);
  });
}

function renderReasons(container, items, emptyText) {
  container.innerHTML = "";
  if (!items || items.length === 0) {
    container.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }
  items.forEach((item) => {
    const symbol = String(item?.symbol || "").trim().toLowerCase();
    const node = document.createElement(symbol ? "button" : "div");
    node.className = `reason-chip ${symbol && symbol === state.symbol ? "active" : ""}`;
    node.textContent = item?.text || String(item || "");
    if (symbol) {
      node.type = "button";
      node.addEventListener("click", () => {
        selectSignalDrawerSymbol(symbol);
      });
    }
    container.appendChild(node);
  });
}

function normalizeSignalDrawerSide(signal) {
  return String(signal || "").trim().toUpperCase() === "BUY" ? "BUY" : "SELL";
}

function currentSignalDrawerActionFilter(signal) {
  const side = normalizeSignalDrawerSide(signal);
  return String(state.signalDrawerActionFilters?.[side] || "").trim().toLowerCase();
}

function setSignalDrawerActionFilter(signal, action) {
  const side = normalizeSignalDrawerSide(signal);
  const normalizedAction = String(action || "").trim().toLowerCase();
  const current = currentSignalDrawerActionFilter(side);
  state.signalDrawerActionFilters = {
    ...(state.signalDrawerActionFilters || {}),
    [side]: current === normalizedAction ? "" : normalizedAction,
  };
  renderSignalDrawerFromWatchlist();
}

function signalActionSummaryConfig(signal) {
  if (String(signal || "").trim().toUpperCase() === "BUY") {
    return [
      { action: "build", label: "布局" },
      { action: "add", label: "加仓" },
      { action: "buy", label: "买入" },
    ];
  }
  return [
    { action: "reduce", label: "减仓" },
    { action: "exit", label: "离场" },
    { action: "clear", label: "清仓" },
  ];
}

function renderSignalActionSummary(container, rows, signal) {
  if (!container) return;
  container.innerHTML = "";
  const normalizedSignal = String(signal || "").trim().toUpperCase();
  const selectedAction = currentSignalDrawerActionFilter(normalizedSignal);
  const counts = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const action = String(row?.strategySignal?.action || "").trim().toLowerCase();
    if (!action) return;
    counts.set(action, (counts.get(action) || 0) + 1);
  });

  signalActionSummaryConfig(normalizedSignal).forEach((item) => {
    const count = Number(counts.get(item.action) || 0);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `signal-action-chip ${normalizedSignal === "BUY" ? "buy" : "sell"}${count === 0 ? " zero" : ""}${selectedAction === item.action ? " active" : ""}`;
    chip.setAttribute("aria-pressed", selectedAction === item.action ? "true" : "false");
    chip.textContent = `${item.label} ${count}`;
    chip.title = count > 0 ? `点击只看${item.label}` : `当前没有${item.label}命中`;
    chip.addEventListener("click", () => {
      if (count <= 0 && selectedAction !== item.action) return;
      setSignalDrawerActionFilter(normalizedSignal, item.action);
    });
    container.appendChild(chip);
  });
}

function filterSignalDrawerRowsByAction(rows, signal) {
  const selectedAction = currentSignalDrawerActionFilter(signal);
  if (!selectedAction) {
    return Array.isArray(rows) ? rows : [];
  }
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const action = String(row?.strategySignal?.action || "").trim().toLowerCase();
    return action === selectedAction;
  });
}

function signalActionLabelByValue(signal, action) {
  return (
    signalActionSummaryConfig(signal).find((item) => item.action === String(action || "").trim().toLowerCase())?.label || ""
  );
}

function signalDrawerEmptyText(signal, action) {
  const sideLabel = normalizeSignalDrawerSide(signal) === "BUY" ? "买入" : "卖出";
  const actionLabel = signalActionLabelByValue(signal, action);
  if (actionLabel) {
    return `当前自选池没有${actionLabel}命中。`;
  }
  return `当前自选池没有${sideLabel}命中。`;
}

function buildWatchlistSignalItem(row) {
  const { item, quote, strategySignal } = row;
  const symbol = String(item?.symbol || strategySignal?.symbol || "").trim().toLowerCase();
  const labelSymbol = symbol.toUpperCase();
  const name = quote?.name || item?.name || labelSymbol;
  const price = quote ? formatFixed(quote.last_price, 3) : "--";
  const change = quote ? formatPercent(quote.change_pct) : "--";
  const signal = String(strategySignal?.signal || "--").toUpperCase();
  const actionLabel = strategyActionLabel(strategySignal);
  const priorityLabel = String(strategySignal?.priority?.label || strategySignal?.priority_label || "").trim();
  const priority = priorityLabel && priorityLabel !== "--"
    ? ` | ${priorityLabel}`
    : "";
  const jValue = Number(strategySignal?.indicators?.j);
  const jText = Number.isFinite(jValue) ? ` | J ${formatFixed(jValue, 2)}` : "";
  const decisionText = buildStrategyDecisionText(strategySignal);
  const reasonText = decisionText || (strategySignal?.reason ? `依据：${strategySignal.reason}` : "");
  const signalText = actionLabel ? `${signal} · ${actionLabel}` : signal;
  const header = `${labelSymbol} ${name} | ${price} | ${change} | ${signalText}${priority}${jText}`;
  return {
    symbol,
    text: reasonText ? `${header}\n${reasonText}` : header,
  };
}

function scrollActiveWatchlistItemIntoView() {
  const active = dom.watchlist?.querySelector(".watchlist-item.active");
  if (active) {
    active.scrollIntoView({ block: "nearest" });
  }
}

function selectSignalDrawerSymbol(symbol) {
  const normalized = String(symbol || "").trim().toLowerCase();
  if (!normalized) return;
  state.symbol = normalized;
  state.watchlistFilter = "";
  if (dom.watchlistSearchInput) {
    dom.watchlistSearchInput.value = "";
  }
  dom.searchInput.value = normalized;
  renderWatchlist();
  renderSignalDrawerFromWatchlist();
  scrollActiveWatchlistItemIntoView();
  loadMarket(normalized).then(() => {
    scrollActiveWatchlistItemIntoView();
    renderSignalDrawerFromWatchlist();
  });
}

function watchlistAlertStateForRow(row) {
  const signal = String(row.strategySignal?.signal || "").toUpperCase();
  return row.strategySignal?.triggered && ["BUY", "SELL"].includes(signal) ? signal : "HOLD";
}

function padDayKeyPart(value) {
  return String(value).padStart(2, "0");
}

function currentWebhookDayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${padDayKeyPart(now.getMonth() + 1)}-${padDayKeyPart(now.getDate())}`;
}

function webhookDayKeyFromValue(value) {
  const digits = normalizeTimestampDigits(value);
  if (digits.length >= 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }

  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return `${parsed.getFullYear()}-${padDayKeyPart(parsed.getMonth() + 1)}-${padDayKeyPart(parsed.getDate())}`;
}

function webhookDayKeyForRow(row) {
  return (
    webhookDayKeyFromValue(row.quote?.timestamp) ||
    webhookDayKeyFromValue(row.strategySignal?.timestamp) ||
    currentWebhookDayKey()
  );
}

function setWebhookStatusMessage(message, tone = "neutral") {
  if (!dom.webhookStatusMessage) return;
  dom.webhookStatusMessage.textContent = message || "保存后会持久化到本地；测试发送使用当前输入地址。";
  dom.webhookStatusMessage.classList.toggle("success", tone === "success");
  dom.webhookStatusMessage.classList.toggle("error", tone === "error");
}

function appendWebhookLogEntry(entry) {
  const nextEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...entry,
  };
  state.webhookLogs = [nextEntry, ...(state.webhookLogs || [])].slice(0, 80);
  saveWebhookLogs();
  renderWebhookPanel();
}

function formatWebhookLogTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function setWebhookRuntimeCardTone(node, tone = "") {
  if (!node) return;
  node.classList.remove("is-good", "is-warn", "is-danger");
  if (tone) {
    node.classList.add(tone);
  }
}

function renderWebhookRuntimeStatus() {
  const syncNode = dom.webhookRuntimeSyncValue;
  const workerNode = dom.webhookRuntimeWorkerValue;
  const lastScanNode = dom.webhookRuntimeLastScanValue;
  const lastSentNode = dom.webhookRuntimeLastSentValue;
  const hintNode = dom.webhookRuntimeHint;
  if (!syncNode || !workerNode || !lastScanNode || !lastSentNode || !hintNode) {
    return;
  }

  const syncCard = syncNode.closest(".webhook-runtime-card");
  const workerCard = workerNode.closest(".webhook-runtime-card");
  const scanCard = lastScanNode.closest(".webhook-runtime-card");
  const sentCard = lastSentNode.closest(".webhook-runtime-card");
  const worker = state.alertWorkerState && typeof state.alertWorkerState === "object" ? state.alertWorkerState : {};
  const synced = isAlertRuntimeSynced();
  const hasSnapshot = Boolean(state.alertRuntimeSnapshot);
  const syncPending = Boolean(state.alertRuntimeSyncTimer);
  const lastScanText = formatWebhookLogTime(worker.last_run_at || worker.last_success_at);
  const lastSentText = formatWebhookLogTime(worker.last_sent_at);
  const sentCount = Number(worker.last_sent_count || 0);

  syncNode.textContent = synced ? "已同步" : "未同步";
  if (!hasSnapshot) {
    syncNode.textContent = "等待同步";
  } else if (syncPending && !synced) {
    syncNode.textContent = "同步中";
  }
  setWebhookRuntimeCardTone(syncCard, synced ? "is-good" : syncPending ? "is-warn" : "is-danger");

  if (worker.running) {
    workerNode.textContent = "运行中";
  } else if (worker.started_at || worker.last_run_at || worker.last_success_at) {
    workerNode.textContent = "未运行";
  } else {
    workerNode.textContent = "未知";
  }
  setWebhookRuntimeCardTone(workerCard, worker.running ? "is-good" : worker.last_error ? "is-danger" : "is-warn");

  lastScanNode.textContent = lastScanText;
  setWebhookRuntimeCardTone(scanCard, lastScanText === "--" ? "is-warn" : "is-good");
/*

  lastSentNode.textContent = lastSentText === "--" ? "尚未发送" : `${lastSentText}${sentCount > 0 ? ` · 最近 ${sentCount} 条` : ""}`;
  setWebhookRuntimeCardTone(sentCard, lastSentText === "--" ? "is-warn" : "is-good");

  hintNode.classList.toggle("error", Boolean(state.alertRuntimeSyncError || worker.last_error));
  if (state.alertRuntimeSyncError) {
    hintNode.textContent = `同步异常：${state.alertRuntimeSyncError}`;
    return;
  }
  if (worker.last_error) {
    hintNode.textContent = `Worker 异常：${worker.last_error}`;
    return;
  }
  if (!hasSnapshot) {
    hintNode.textContent = "尚未拿到后台运行时状态，打开弹窗后会自动尝试同步。";
    return;
  }
  if (!synced) {
    hintNode.textContent = syncPending
      ? "本地配置正在推送到后台，请稍候刷新状态。"
      : "本地配置和后台运行时还不一致，后台预警可能还在使用上一版设置。";
    return;
  }

  const updatedAtText = formatWebhookLogTime(state.alertRuntimeUpdatedAt);
  hintNode.textContent =
    updatedAtText === "--"
      ? "后台运行时已和当前页面保持一致。"
      : `后台运行时最近同步时间：${updatedAtText}`;
}

*/
  lastSentNode.textContent = lastSentText === "--" ? "尚未发送" : `${lastSentText}${sentCount > 0 ? ` | 最近 ${sentCount} 条` : ""}`;
  setWebhookRuntimeCardTone(sentCard, lastSentText === "--" ? "is-warn" : "is-good");

  hintNode.classList.toggle("error", Boolean(state.alertRuntimeSyncError || worker.last_error));
  if (state.alertRuntimeSyncError) {
    hintNode.textContent = `同步异常：${state.alertRuntimeSyncError}`;
    return;
  }
  if (worker.last_error) {
    hintNode.textContent = `Worker 异常：${worker.last_error}`;
    return;
  }
  if (!hasSnapshot) {
    hintNode.textContent = "尚未拿到后台运行时状态，打开弹窗后会自动尝试同步。";
    return;
  }
  if (!synced) {
    hintNode.textContent = syncPending
      ? "本地配置正在推送到后台，请稍候刷新状态。"
      : "本地配置和后台运行时还不一致，后台预警可能还在使用上一版设置。";
    return;
  }

  const updatedAtText = formatWebhookLogTime(state.alertRuntimeUpdatedAt);
  hintNode.textContent =
    updatedAtText === "--"
      ? "后台运行时已和当前页面保持一致。"
      : `后台运行时最近同步时间：${updatedAtText}`;
}

function renderWebhookLogList() {
  if (!dom.webhookLogList) return;
  const logs = Array.isArray(state.webhookLogs) ? state.webhookLogs : [];
  if (dom.webhookLogCount) {
    dom.webhookLogCount.textContent = `${logs.length}`;
  }
  dom.webhookLogList.innerHTML = "";
  if (logs.length === 0) {
    dom.webhookLogList.innerHTML = `<div class="empty-state">还没有 WebHook 发送记录。</div>`;
    return;
  }

  logs.forEach((entry) => {
    const item = document.createElement("article");
    item.className = `webhook-log-item ${entry.ok ? "success" : "error"}`;
    const signal = String(entry.signal || "TEST").toUpperCase();
    const resultText = entry.ok ? "成功" : "失败";
    const statusText = entry.responseStatus ? `HTTP ${entry.responseStatus}` : resultText;
    item.innerHTML = `
      <div class="webhook-log-top">
        <div class="webhook-log-title">
          <span class="webhook-log-signal ${signal.toLowerCase()}">${signal}</span>
          <strong>${entry.symbol ? String(entry.symbol).toUpperCase() : "TEST"}</strong>
        </div>
        <span class="webhook-log-time">${formatWebhookLogTime(entry.createdAt)}</span>
      </div>
      <div class="webhook-log-body">${entry.name || entry.reason || "WebHook 记录"}</div>
      <div class="webhook-log-meta">
        <span>${statusText}</span>
        <span>${entry.strategyLabel || "--"}</span>
        <span>${entry.message || resultText}</span>
      </div>
    `;
    dom.webhookLogList.appendChild(item);
  });
}

function renderWebhookPanel(options = {}) {
  const { syncInput = false } = options;
  if (syncInput && dom.webhookInput) {
    dom.webhookInput.value = state.webhookUrl || "";
    dom.webhookInput.classList.remove("unsaved");
  }
  if (dom.webhookSavedUrl) {
    dom.webhookSavedUrl.textContent = state.webhookUrl || "--";
    dom.webhookSavedUrl.title = state.webhookUrl || "";
  }
  if (dom.webhookSelectedCount) {
    dom.webhookSelectedCount.textContent = `${state.webhookAlertSymbols?.size || 0}`;
  }
  if (dom.webhookLastResult) {
    const latest = Array.isArray(state.webhookLogs) && state.webhookLogs.length > 0 ? state.webhookLogs[0] : null;
    dom.webhookLastResult.textContent = latest
      ? `${String(latest.signal || "TEST").toUpperCase()} · ${latest.ok ? "成功" : "失败"}`
      : "--";
  }
  renderWebhookRuntimeStatus();
  renderWebhookLogList();
  if (dom.webhookStatusMessage && !dom.webhookStatusMessage.textContent.trim()) {
    setWebhookStatusMessage("");
  }
}

async function testWebhookConnection() {
  const inputUrl = dom.webhookInput?.value.trim() || "";
  const targetUrl = inputUrl || state.webhookUrl || "";
  if (!targetUrl) {
    setWebhookStatusMessage("请先输入 WebHook URL。", "error");
    return;
  }
  if (dom.webhookTestButton) {
    dom.webhookTestButton.disabled = true;
  }
  setWebhookStatusMessage("正在发送测试请求...", "neutral");
  const payload = {
    event: "webhook_test",
    signal: "TEST",
    category: "test",
    signal_type: "test",
    rule_family: "test",
    rule_family_label: "测试消息",
    rule_name: "webhook.connectivity",
    rule_label: "WebHook 连通性",
    reason_summary: "手动测试 WebHook 连通性",
    reason_details: ["仅用于验证 WebHook 是否能够正常接收消息。"],
    supporting_reasons: [],
    decision_text: "",
    message_title: "测试 | WebHook 连通性",
    action_hint: "若收到本消息，说明当前 WebHook 已经可以正常接收通知。",
    symbol: state.symbol || "",
    name: state.currentPayload?.name || "手动测试",
    strategy: state.strategy,
    strategy_label: getStrategyMeta(state.strategy)?.label || state.strategy,
    reason: "手动测试 WebHook 连通性",
    timestamp: new Date().toISOString(),
    source: state.currentPayload?.source?.actual || state.source,
    source_label: state.currentPayload?.source?.actual_label || getSourceMeta(state.source)?.label || state.source,
  };
  payload.message_text = buildWebhookMessageText(payload);
  const result = await sendWebhookAlert(payload, {
    urlOverride: targetUrl,
    recordType: "test",
    quietStatus: true,
  });
  if (result.ok) {
    setWebhookStatusMessage(`测试发送成功 · HTTP ${result.status || 200}`, "success");
  } else {
    setWebhookStatusMessage(result.error || "测试发送失败", "error");
  }
  if (dom.webhookTestButton) {
    dom.webhookTestButton.disabled = false;
  }
}

function openWebhookModal() {
  if (state.rulesModalOpen) {
    closeRulesModal();
  }
  setSignalDrawerOpen(false);
  state.webhookModalOpen = true;
  renderWebhookPanel({ syncInput: true });
  setWebhookStatusMessage("");
  dom.webhookBackdrop.classList.remove("hidden");
  dom.webhookModal.classList.remove("hidden");
  dom.webhookModal.setAttribute("aria-hidden", "false");
  loadAlertRuntimeState()
    .then(() => {
      if (state.webhookModalOpen) {
        renderWebhookPanel({ syncInput: true });
      }
    })
    .catch((error) => {
      console.error(error);
    });
}

function closeWebhookModal() {
  state.webhookModalOpen = false;
  dom.webhookBackdrop.classList.add("hidden");
  dom.webhookModal.classList.add("hidden");
  dom.webhookModal.setAttribute("aria-hidden", "true");
}

function buildWebhookPayload(row, signal) {
  const symbol = String(row.item?.symbol || row.strategySignal?.symbol || "").trim().toLowerCase();
  const quote = row.quote;
  const strategySignal = row.strategySignal;
  const payload = {
    event: "signal_state_change",
    signal,
    symbol,
    name: quote?.name || row.item?.name || symbol.toUpperCase(),
    strategy: strategySignal?.strategy_id || state.strategy,
    strategy_label: getStrategyMeta(state.strategy)?.label || state.strategy,
    price: quote?.last_price ?? null,
    change: quote?.change ?? null,
    change_pct: quote?.change_pct ?? null,
    reason: strategySignal?.reason || "",
    priority: strategySignal?.priority || null,
    timestamp: strategySignal?.timestamp || new Date().toISOString(),
    source: strategySignal?.source?.actual || state.source,
    source_label: strategySignal?.source?.actual_label || getSourceMeta(state.source)?.label || state.source,
    ...buildWebhookReasonContext(row, signal),
  };
  payload.message_text = buildWebhookMessageText(payload);
  return payload;
}

function renderWebhookRuntimeStatus() {
  const syncNode = dom.webhookRuntimeSyncValue;
  const workerNode = dom.webhookRuntimeWorkerValue;
  const lastScanNode = dom.webhookRuntimeLastScanValue;
  const lastSentNode = dom.webhookRuntimeLastSentValue;
  const hintNode = dom.webhookRuntimeHint;
  if (!syncNode || !workerNode || !lastScanNode || !lastSentNode || !hintNode) {
    return;
  }

  const syncCard = syncNode.closest(".webhook-runtime-card");
  const workerCard = workerNode.closest(".webhook-runtime-card");
  const scanCard = lastScanNode.closest(".webhook-runtime-card");
  const sentCard = lastSentNode.closest(".webhook-runtime-card");
  const worker = state.alertWorkerState && typeof state.alertWorkerState === "object" ? state.alertWorkerState : {};
  const synced = isAlertRuntimeSynced();
  const hasSnapshot = Boolean(state.alertRuntimeSnapshot);
  const syncPending = Boolean(state.alertRuntimeSyncTimer);
  const lastScanText = formatWebhookLogTime(worker.last_run_at || worker.last_success_at);
  const lastSentText = formatWebhookLogTime(worker.last_sent_at);
  const sentCount = Number(worker.last_sent_count || 0);

  syncNode.textContent = synced ? "\u5df2\u540c\u6b65" : "\u672a\u540c\u6b65";
  if (!hasSnapshot) {
    syncNode.textContent = "\u7b49\u5f85\u540c\u6b65";
  } else if (syncPending && !synced) {
    syncNode.textContent = "\u540c\u6b65\u4e2d";
  }
  setWebhookRuntimeCardTone(syncCard, synced ? "is-good" : syncPending ? "is-warn" : "is-danger");

  if (worker.running) {
    workerNode.textContent = "\u8fd0\u884c\u4e2d";
  } else if (worker.started_at || worker.last_run_at || worker.last_success_at) {
    workerNode.textContent = "\u672a\u8fd0\u884c";
  } else {
    workerNode.textContent = "\u672a\u77e5";
  }
  setWebhookRuntimeCardTone(workerCard, worker.running ? "is-good" : worker.last_error ? "is-danger" : "is-warn");

  lastScanNode.textContent = lastScanText;
  setWebhookRuntimeCardTone(scanCard, lastScanText === "--" ? "is-warn" : "is-good");

  lastSentNode.textContent =
    lastSentText === "--" ? "\u5c1a\u672a\u53d1\u9001" : `${lastSentText}${sentCount > 0 ? ` | \u6700\u8fd1 ${sentCount} \u6761` : ""}`;
  setWebhookRuntimeCardTone(sentCard, lastSentText === "--" ? "is-warn" : "is-good");

  hintNode.classList.toggle("error", Boolean(state.alertRuntimeSyncError || worker.last_error));
  if (state.alertRuntimeSyncError) {
    hintNode.textContent = `\u540c\u6b65\u5f02\u5e38\uff1a${state.alertRuntimeSyncError}`;
    return;
  }
  if (worker.last_error) {
    hintNode.textContent = `Worker \u5f02\u5e38\uff1a${worker.last_error}`;
    return;
  }
  if (!hasSnapshot) {
    hintNode.textContent = "\u5c1a\u672a\u62ff\u5230\u540e\u53f0\u8fd0\u884c\u65f6\u72b6\u6001\uff0c\u6253\u5f00\u5f39\u7a97\u540e\u4f1a\u81ea\u52a8\u5c1d\u8bd5\u540c\u6b65\u3002";
    return;
  }
  if (!synced) {
    hintNode.textContent = syncPending
      ? "\u672c\u5730\u914d\u7f6e\u6b63\u5728\u63a8\u9001\u5230\u540e\u53f0\uff0c\u8bf7\u7a0d\u5019\u5237\u65b0\u72b6\u6001\u3002"
      : "\u672c\u5730\u914d\u7f6e\u548c\u540e\u53f0\u8fd0\u884c\u65f6\u8fd8\u4e0d\u4e00\u81f4\uff0c\u540e\u53f0\u9884\u8b66\u53ef\u80fd\u8fd8\u5728\u4f7f\u7528\u4e0a\u4e00\u7248\u8bbe\u7f6e\u3002";
    return;
  }

  const updatedAtText = formatWebhookLogTime(state.alertRuntimeUpdatedAt);
  hintNode.textContent =
    updatedAtText === "--"
      ? "\u540e\u53f0\u8fd0\u884c\u65f6\u5df2\u548c\u5f53\u524d\u9875\u9762\u4fdd\u6301\u4e00\u81f4\u3002"
      : `\u540e\u53f0\u8fd0\u884c\u65f6\u6700\u8fd1\u540c\u6b65\u65f6\u95f4\uff1a${updatedAtText}`;
}

async function sendWebhookAlert(payload, options = {}) {
  const { urlOverride = "", recordType = "signal", quietStatus = false } = options;
  const targetUrl = String(urlOverride || state.webhookUrl || "").trim();
  if (!targetUrl) {
    return { ok: false, error: "请先录入 WebHook URL", skipped: true };
  }
  try {
    const response = await fetch("/api/webhook-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        payload,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || "Webhook send failed");
    }
    appendWebhookLogEntry({
      ok: true,
      type: recordType,
      signal: payload.signal || "TEST",
      symbol: payload.symbol || "",
      name: payload.name || payload.reason || "",
      strategyLabel: payload.strategy_label || payload.strategy || "",
      responseStatus: result.status || response.status,
      message: (result.body || "发送成功").toString().slice(0, 80),
      reason: payload.reason || "",
    });
    if (!quietStatus) {
      setRefreshStatus(`Webhook 已发送 · ${String(payload.symbol || "test").toUpperCase()} ${payload.signal}`);
    }
    return { ok: true, status: result.status || response.status, body: result.body || "" };
  } catch (error) {
    console.error(error);
    appendWebhookLogEntry({
      ok: false,
      type: recordType,
      signal: payload.signal || "TEST",
      symbol: payload.symbol || "",
      name: payload.name || payload.reason || "",
      strategyLabel: payload.strategy_label || payload.strategy || "",
      responseStatus: null,
      message: (error.message || "Webhook send failed").toString().slice(0, 80),
      reason: payload.reason || "",
    });
    if (!quietStatus) {
      setRefreshStatus(error.message || "Webhook send failed");
    }
    return { ok: false, error: error.message || "Webhook send failed" };
  }
}

function seedWebhookAlertState(symbol) {
  const normalized = String(symbol || "").trim().toLowerCase();
  if (!normalized) return;
  const item = currentGroupItems().find((entry) => String(entry.symbol || "").trim().toLowerCase() === normalized);
  if (!item) return;
  const row = {
    item,
    quote: getWatchlistQuote(item),
    strategySignal: getWatchlistStrategySignal(item),
  };
  const seededSignal = watchlistAlertStateForRow(row);
  const dayKey = webhookDayKeyForRow(row);
  state.webhookAlertStates[normalized] = {
    signal: seededSignal,
    dayKey,
    lastAlertDayKey: ["BUY", "SELL"].includes(seededSignal) ? dayKey : "",
    updatedAt: Date.now(),
  };
  saveWebhookAlertStates();
}

function processWebhookAlerts() {
  return;
}

function renderSignalDrawerFromWatchlist() {
  const items = currentGroupItems();
  const total = items.length;
  const strategyOff = normalizeStrategyValue(state.strategy) === "none";
  const strategyMeta = getStrategyMeta(state.strategy);
  const strategyLabelNode = ensureSignalDrawerStrategyLabel();

  if (strategyLabelNode) {
    strategyLabelNode.textContent = `当前规则：${strategyMeta?.label || state.strategy || "--"}`;
  }

  if (strategyOff) {
    dom.buyCount.textContent = `0 / ${total}`;
    dom.sellCount.textContent = `0 / ${total}`;
    renderSignalActionSummary(dom.buyActionSummary, [], "BUY");
    renderSignalActionSummary(dom.sellActionSummary, [], "SELL");
    renderReasons(dom.buyReasons, [], "当前未启用策略，选择规则后显示自选池买入命中。");
    renderReasons(dom.sellReasons, [], "当前未启用策略，选择规则后显示自选池卖出命中。");
    renderWarnings([]);
    return;
  }

  const rows = items.map((item) => ({
    item,
    quote: getWatchlistQuote(item),
    strategySignal: getWatchlistStrategySignal(item),
  }));

  const buyRows = rows.filter((row) => {
    const signal = String(row.strategySignal?.signal || "").toUpperCase();
    return row.strategySignal?.triggered && signal === "BUY";
  });
  const sellRows = rows.filter((row) => {
    const signal = String(row.strategySignal?.signal || "").toUpperCase();
    return row.strategySignal?.triggered && signal === "SELL";
  });
  const filteredBuyRows = filterSignalDrawerRowsByAction(buyRows, "BUY");
  const filteredSellRows = filterSignalDrawerRowsByAction(sellRows, "SELL");

  dom.buyCount.textContent = `${buyRows.length} / ${total}`;
  dom.sellCount.textContent = `${sellRows.length} / ${total}`;
  renderSignalActionSummary(dom.buyActionSummary, buyRows, "BUY");
  renderSignalActionSummary(dom.sellActionSummary, sellRows, "SELL");
  renderReasons(
    dom.buyReasons,
    filteredBuyRows.map(buildWatchlistSignalItem),
    signalDrawerEmptyText("BUY", currentSignalDrawerActionFilter("BUY"))
  );
  renderReasons(
    dom.sellReasons,
    filteredSellRows.map(buildWatchlistSignalItem),
    signalDrawerEmptyText("SELL", currentSignalDrawerActionFilter("SELL"))
  );
  renderWarnings([]);
}

async function refreshSignalDrawerData() {
  if (!state.signalDrawerOpen) return;
  renderSignalDrawerFromWatchlist();
  await runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  renderSignalDrawerFromWatchlist();
}

function renderWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    dom.warnings.classList.add("hidden");
    dom.warnings.innerHTML = "";
    return;
  }
  dom.warnings.classList.remove("hidden");
  dom.warnings.innerHTML = warnings.map((warning) => `<div>${warning}</div>`).join("");
}

function updateWatchlistButtonState() {
  if (!state.currentPayload) return;
  const symbol = state.currentPayload.symbol;
  dom.watchlistButton.textContent = symbolExistsInGroup(symbol) ? "已在当前组" : "加入当前组";
}

function renderSourceOptions() {
  dom.sourceSelect.innerHTML = "";
  state.availableSources.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    dom.sourceSelect.appendChild(option);
  });

  if (!getSourceMeta(state.source)) {
    state.source = window.APP_DEFAULTS.source || "auto";
  }
  dom.sourceSelect.value = state.source;
}

function renderSourcePanels(sourcePayload) {
  const source = sourcePayload || {
    requested: state.source,
    requested_label: getSourceMeta(state.source)?.label || state.source,
    actual: state.source,
    actual_label: getSourceMeta(state.source)?.label || state.source,
  };
  const requestedMeta = getSourceMeta(source.requested);
  const actualMeta = getSourceMeta(source.actual);

  dom.activeSourceLabel.textContent = source.actual_label;
  dom.metricSource.textContent = source.actual_label;
  dom.metricSourceMeta.textContent =
    source.requested === source.actual ? `请求: ${source.requested_label}` : `${source.requested_label} → ${source.actual_label}`;
  dom.sourceRequested.textContent = source.requested_label;
  dom.sourceActual.textContent = source.actual_label;
  dom.sourceActualBadge.textContent = source.actual_label;

  if (source.requested === source.actual) {
    dom.sourceDescription.textContent = actualMeta?.description || "当前信息源可用于 K 线与快照查询。";
  } else {
    dom.sourceDescription.textContent = `当前为自动切源，实际使用 ${source.actual_label}。${requestedMeta?.description || ""}`;
  }
}

function renderSummary(payload) {
  dom.metricName.textContent = payload.name;
  dom.metricSymbol.textContent = `${payload.symbol.toUpperCase()} · ${payload.timeframe}`;
  dom.metricPrice.textContent = formatFixed(payload.last_price, 3);
  dom.metricChange.textContent = `${formatSigned(payload.change)} / ${formatPercent(payload.change_pct)}`;
  dom.metricChange.style.color = payload.change >= 0 ? "var(--buy)" : "var(--sell)";
  dom.metricSignal.textContent = payload.signal.signal;
  dom.metricSignal.className = `metric-value signal-pill ${signalClass(payload.signal.signal)}`;
  dom.metricTime.textContent = `更新于 ${payload.market.timestamp || payload.last_timestamp}`;
  renderSignalDrawerFromWatchlist();
  renderSourcePanels(payload.source);
  renderIndicatorHeaders(payload);
  updateWatchlistButtonState();
}

function renderMarketStats(market) {
  dom.marketOpen.textContent = formatFixed(market.open, 3);
  dom.marketPrevClose.textContent = formatFixed(market.prev_close, 3);
  dom.marketHigh.textContent = formatFixed(market.high, 3);
  dom.marketLow.textContent = formatFixed(market.low, 3);
  dom.marketVolume.textContent = formatCompactNumber(market.volume);
  dom.marketAmount.textContent = formatCompactNumber(market.amount);
  dom.marketTurnover.textContent = formatPercent(market.turnover_rate, 2);
  dom.marketAmplitude.textContent = formatPercent(market.amplitude_pct, 2);
}

function setCurrentGroup(name) {
  if (!state.watchlistModel.groups[name]) return;
  state.watchlistModel.selectedGroup = name;
  saveWatchlistModel();
  renderWatchlist();
  runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  updateWatchlistButtonState();
}

function createGroup() {
  const groupName = sanitizeGroupName(dom.groupNameInput.value);
  if (!groupName) {
    setRefreshStatus("请输入分组名称");
    return;
  }
  if (state.watchlistModel.groups[groupName]) {
    setRefreshStatus("这个分组已经存在");
    return;
  }
  state.watchlistModel.groups[groupName] = [];
  state.watchlistModel.selectedGroup = groupName;
  dom.groupNameInput.value = "";
  saveWatchlistModel();
  renderWatchlist();
  runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  updateWatchlistButtonState();
}

function deleteCurrentGroup() {
  const groupName = currentGroupName();
  if (groupName === DEFAULT_GROUP_NAME) {
    setRefreshStatus("默认分组不能删除");
    return;
  }
  const count = currentGroupItems().length;
  const confirmed = window.confirm(`确定删除分组“${groupName}”吗？${count > 0 ? "该组自选也会一起移除。" : ""}`);
  if (!confirmed) return;
  delete state.watchlistModel.groups[groupName];
  state.watchlistModel.selectedGroup = Object.keys(state.watchlistModel.groups)[0] || DEFAULT_GROUP_NAME;
  if (!state.watchlistModel.groups[state.watchlistModel.selectedGroup]) {
    state.watchlistModel.groups[state.watchlistModel.selectedGroup] = [];
  }
  saveWatchlistModel();
  renderWatchlist();
  runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  updateWatchlistButtonState();
}

function renderWatchlistGroups() {
  dom.watchlistGroups.innerHTML = "";
  Object.entries(state.watchlistModel.groups).forEach(([name, items]) => {
    const button = document.createElement("button");
    button.className = `group-chip ${name === currentGroupName() ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <span>${name}</span>
      <span class="group-chip-count">${items.length}</span>
    `;
    button.addEventListener("click", () => {
      setCurrentGroup(name);
    });
    dom.watchlistGroups.appendChild(button);
  });
}

function renderWatchlist() {
  dom.watchlist.innerHTML = "";
  const baseItems = currentGroupItems();
  const items = getRenderedWatchlistItems();
  const hasFilter = Boolean(String(state.watchlistFilter || "").trim());
  dom.watchlistCount.textContent = hasFilter ? `${items.length}/${totalWatchlistCount()}` : `${totalWatchlistCount()}`;
  if (dom.watchlistSortSelect) {
    dom.watchlistSortSelect.value = normalizeWatchlistSortMode(state.watchlistSortMode);
  }
  if (dom.watchlistSearchInput && dom.watchlistSearchInput.value !== state.watchlistFilter) {
    dom.watchlistSearchInput.value = state.watchlistFilter;
  }

  if (baseItems.length === 0) {
    dom.watchlist.innerHTML = `<div class="empty-state">当前分组还没有自选，先查一个标的再加入。</div>`;
    return;
  }

  items.forEach((item) => {
    const itemSymbol = String(item.symbol || "").trim().toLowerCase();
    const tradeCycle = inferTradeCycle(item);
    const quote = getWatchlistQuote(item);
    const strategySignal = getWatchlistStrategySignal(item);
    const changeClass = watchlistChangeClass(quote?.change_pct);
    const streak = quote?.streak;
    const wrapper = document.createElement("div");
    wrapper.className = `watchlist-item ${item.symbol === state.symbol ? "active" : ""}`;
    wrapper.dataset.symbol = item.symbol;

    const alertToggle = document.createElement("button");
    const alertEnabled = state.webhookAlertSymbols.has(item.symbol);
    alertToggle.className = `watchlist-alert-toggle ${alertEnabled ? "active" : ""}`;
    alertToggle.type = "button";
    alertToggle.setAttribute("aria-pressed", alertEnabled ? "true" : "false");
    alertToggle.setAttribute("aria-label", alertEnabled ? "关闭 WebHook 提醒" : "开启 WebHook 提醒");
    alertToggle.title = alertEnabled ? "已开启 WebHook 提醒" : "开启 WebHook 提醒";
    alertToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.webhookAlertSymbols.has(item.symbol)) {
        state.webhookAlertSymbols.delete(item.symbol);
      } else {
        state.webhookAlertSymbols.add(item.symbol);
        seedWebhookAlertState(item.symbol);
      }
      saveWebhookAlertSymbols();
      renderWatchlist();
    });

    const main = document.createElement("button");
    main.className = "watchlist-main";
    main.type = "button";
    main.innerHTML = `
      <span class="watchlist-topline">
        <span class="watchlist-identity">
          <span class="watchlist-symbol">${item.symbol.toUpperCase()}</span>
          <span class="watchlist-name">${quote?.name || item.name || item.symbol}</span>
        </span>
        <span class="watchlist-price ${changeClass}">${quote ? formatFixed(quote.last_price, 3) : "--"}</span>
      </span>
      <span class="watchlist-bottomline">
        <span class="watchlist-tags">
          <span class="watchlist-cycle ${tradeCycleClass(tradeCycle)}">${tradeCycle || "--"}</span>
          ${
            strategySignal?.triggered && ["BUY", "SELL"].includes(strategySignal.signal)
              ? `<span class="watchlist-signal ${watchlistStrategySignalClass(strategySignal.signal)}">${watchlistStrategySignalLabel(strategySignal)}</span>`
              : ""
          }
          ${streak?.label ? `<span class="watchlist-streak ${watchlistStreakClass(streak)}">${streak.label}</span>` : ""}
        </span>
        <span class="watchlist-change ${changeClass}">${quote ? `${formatSigned(quote.change)} / ${formatPercent(quote.change_pct)}` : "-- / --"}</span>
      </span>
    `;
    main.addEventListener("click", () => {
      state.symbol = item.symbol;
      dom.searchInput.value = item.symbol;
      loadMarket(item.symbol);
    });

    const remove = document.createElement("button");
    remove.className = "watchlist-remove";
    remove.type = "button";
    remove.textContent = "";
    remove.setAttribute("aria-label", "移除自选");
    remove.title = "移除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.watchlistModel.groups[currentGroupName()] = currentGroupItems().filter((entry) => entry.symbol !== item.symbol);
      saveWatchlistModel();
      renderWatchlist();
      runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
      updateWatchlistButtonState();
    });

    wrapper.appendChild(alertToggle);
    wrapper.appendChild(main);
    wrapper.appendChild(remove);
    dom.watchlist.appendChild(wrapper);
  });
}

function renderWatchlist() {
  dom.watchlist.innerHTML = "";

  const baseItems = currentGroupItems();
  const items = getRenderedWatchlistItems();
  const hasFilter = Boolean(String(state.watchlistFilter || "").trim());

  if (dom.watchlistSortSelect) {
    dom.watchlistSortSelect.value = normalizeWatchlistSortMode(state.watchlistSortMode);
  }
  if (dom.watchlistSearchInput && dom.watchlistSearchInput.value !== state.watchlistFilter) {
    dom.watchlistSearchInput.value = state.watchlistFilter;
  }

  dom.watchlistCount.textContent = hasFilter ? `${items.length}/${totalWatchlistCount()}` : `${totalWatchlistCount()}`;

  if (baseItems.length === 0) {
    dom.watchlist.innerHTML = `<div class="empty-state">当前还没有自选项，先查询一个标的再加入。</div>`;
    return;
  }

  if (items.length === 0) {
    dom.watchlist.innerHTML = `<div class="empty-state">未找到匹配的自选项，换个关键词试试。</div>`;
    return;
  }

  items.forEach((item) => {
    const itemSymbol = String(item.symbol || "").trim().toLowerCase();
    const tradeCycle = inferTradeCycle(item);
    const quote = getWatchlistQuote(item);
    const strategySignal = getWatchlistStrategySignal(item);
    const changeClass = watchlistChangeClass(quote?.change_pct);
    const streak = quote?.streak;
    const wrapper = document.createElement("div");
    wrapper.className = `watchlist-item ${itemSymbol === String(state.symbol || "").trim().toLowerCase() ? "active" : ""}`;
    wrapper.dataset.symbol = itemSymbol;

    const alertToggle = document.createElement("button");
    const alertEnabled = state.webhookAlertSymbols.has(itemSymbol);
    alertToggle.className = `watchlist-alert-toggle ${alertEnabled ? "active" : ""}`;
    alertToggle.type = "button";
    alertToggle.setAttribute("aria-pressed", alertEnabled ? "true" : "false");
    alertToggle.setAttribute("aria-label", alertEnabled ? "Disable WebHook alert" : "Enable WebHook alert");
    alertToggle.title = alertEnabled ? "WebHook alert on" : "WebHook alert off";
    alertToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.webhookAlertSymbols.has(itemSymbol)) {
        state.webhookAlertSymbols.delete(itemSymbol);
      } else {
        state.webhookAlertSymbols.add(itemSymbol);
        seedWebhookAlertState(itemSymbol);
      }
      saveWebhookAlertSymbols();
      renderWatchlist();
    });

    const main = document.createElement("button");
    main.className = "watchlist-main";
    main.type = "button";
    main.innerHTML = `
      <span class="watchlist-topline">
        <span class="watchlist-identity">
          <span class="watchlist-symbol">${item.symbol.toUpperCase()}</span>
          <span class="watchlist-name">${quote?.name || item.name || item.symbol}</span>
        </span>
        <span class="watchlist-price ${changeClass}">${quote ? formatFixed(quote.last_price, 3) : "--"}</span>
      </span>
      <span class="watchlist-bottomline">
        <span class="watchlist-tags">
          <span class="watchlist-cycle ${tradeCycleClass(tradeCycle)}">${tradeCycle || "--"}</span>
          ${
            strategySignal?.triggered && ["BUY", "SELL"].includes(strategySignal.signal)
              ? `<span class="watchlist-signal ${watchlistStrategySignalClass(strategySignal.signal)}">${watchlistStrategySignalLabel(strategySignal)}</span>`
              : ""
          }
          ${streak?.label ? `<span class="watchlist-streak ${watchlistStreakClass(streak)}">${streak.label}</span>` : ""}
        </span>
        <span class="watchlist-change ${changeClass}">${quote ? `${formatSigned(quote.change)} / ${formatPercent(quote.change_pct)}` : "-- / --"}</span>
      </span>
    `;
    main.addEventListener("click", () => {
      state.symbol = item.symbol;
      dom.searchInput.value = item.symbol;
      loadMarket(item.symbol);
    });

    const remove = document.createElement("button");
    remove.className = "watchlist-remove";
    remove.type = "button";
    remove.textContent = "";
    remove.setAttribute("aria-label", "移除自选");
    remove.title = "移除";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      state.watchlistModel.items = currentGroupItems().filter((entry) => entry.symbol !== item.symbol);
      delete state.webhookAlertStates[itemSymbol];
      state.webhookAlertSymbols.delete(itemSymbol);
      saveWatchlistModel();
      saveWebhookAlertSymbols();
      saveWebhookAlertStates();
      renderWatchlist();
      runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
      updateWatchlistButtonState();
    });

    wrapper.appendChild(alertToggle);
    wrapper.appendChild(main);
    wrapper.appendChild(remove);
    dom.watchlist.appendChild(wrapper);
  });
}

function renderChart(payload) {
  ensureChartReady();

  const colorUp = "#11855e";
  const colorDown = "#c85243";
  const axisColor = "rgba(22, 33, 42, 0.55)";
  const splitColor = "rgba(22, 33, 42, 0.08)";

  state.chart.setOption(
    {
      animation: false,
      backgroundColor: "transparent",
      color: [colorUp, "#ffb347", "#125e78", "#1a8fca", "#8964d8"],
      legend: {
        top: 8,
        left: 12,
        textStyle: {
          color: axisColor,
          fontFamily: "IBM Plex Mono",
        },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(21, 27, 33, 0.94)",
        borderWidth: 0,
        textStyle: { color: "#f4f7fa" },
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        label: { backgroundColor: "#17232e" },
      },
      grid: [
        { left: 58, right: 18, top: 42, height: "38%" },
        { left: 58, right: 18, top: "50%", height: "10%" },
        { left: 58, right: 18, top: "64%", height: "12%" },
        { left: 58, right: 18, top: "80%", height: "10%" },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1, 2, 3], start: 72, end: 100 },
        {
          type: "slider",
          xAxisIndex: [0, 1, 2, 3],
          bottom: 8,
          height: 18,
          borderColor: "transparent",
          backgroundColor: "rgba(22, 33, 42, 0.06)",
          fillerColor: "rgba(15, 122, 109, 0.18)",
          handleSize: "110%",
        },
      ],
      xAxis: [
        {
          type: "category",
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: { show: false },
          min: "dataMin",
          max: "dataMax",
        },
        {
          type: "category",
          gridIndex: 1,
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: "category",
          gridIndex: 2,
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: "category",
          gridIndex: 3,
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: { color: axisColor, hideOverlap: true },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitNumber: 4,
          axisLine: { show: false },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: splitColor } },
        },
        {
          gridIndex: 1,
          scale: true,
          splitNumber: 2,
          axisLine: { show: false },
          axisLabel: { color: axisColor, formatter: (value) => formatCompactNumber(value) },
          splitLine: { show: false },
        },
        {
          gridIndex: 2,
          scale: true,
          splitNumber: 3,
          axisLine: { show: false },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: splitColor } },
        },
        {
          gridIndex: 3,
          scale: true,
          splitNumber: 3,
          axisLine: { show: false },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: splitColor } },
        },
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          data: payload.chart.candles,
          itemStyle: {
            color: colorUp,
            color0: colorDown,
            borderColor: colorUp,
            borderColor0: colorDown,
          },
        },
        {
          name: `${payload.timeframe} MA5`,
          type: "line",
          data: payload.indicators.ma5,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 1.4, color: "#ffb347" },
        },
        {
          name: `${payload.timeframe} MA20`,
          type: "line",
          data: payload.indicators.ma20,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 1.4, color: "#125e78" },
        },
        {
          name: "VOL",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: payload.chart.volumes,
          itemStyle: {
            color: (params) => {
              const candle = payload.chart.candles[params.dataIndex] || [0, 0];
              return candle[1] >= candle[0] ? colorUp : colorDown;
            },
          },
        },
        {
          name: "MACD Hist",
          type: "bar",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: payload.indicators.macd.hist,
          itemStyle: {
            color: (params) => (params.value >= 0 ? colorUp : colorDown),
          },
        },
        {
          name: "DIF",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: payload.indicators.macd.dif,
          showSymbol: false,
          lineStyle: { width: 1.4, color: "#125e78" },
        },
        {
          name: "DEA",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: payload.indicators.macd.dea,
          showSymbol: false,
          lineStyle: { width: 1.4, color: "#d9974d" },
        },
        {
          name: "K",
          type: "line",
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: payload.indicators.kdj.k,
          showSymbol: false,
          lineStyle: { width: 1.4, color: "#11855e" },
        },
        {
          name: "D",
          type: "line",
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: payload.indicators.kdj.d,
          showSymbol: false,
          lineStyle: { width: 1.4, color: "#125e78" },
        },
        {
          name: "J",
          type: "line",
          xAxisIndex: 3,
          yAxisIndex: 3,
          data: payload.indicators.kdj.j,
          showSymbol: false,
          lineStyle: { width: 1.4, color: "#8f5ad6" },
        },
      ],
    },
    true
  );

  scheduleChartResize();
}

function hideSuggestions() {
  state.activeSuggestionIndex = -1;
  dom.searchSuggestions.classList.add("hidden");
  dom.searchSuggestions.innerHTML = "";
}

function isSuggestionsOpen() {
  return !dom.searchSuggestions.classList.contains("hidden");
}

function setActiveSuggestionIndex(index) {
  const buttons = [...dom.searchSuggestions.querySelectorAll("button")];
  if (buttons.length === 0) {
    state.activeSuggestionIndex = -1;
    return;
  }

  const safeIndex = Math.max(0, Math.min(index, buttons.length - 1));
  state.activeSuggestionIndex = safeIndex;
  buttons.forEach((button, buttonIndex) => {
    button.classList.toggle("active", buttonIndex === safeIndex);
  });
  buttons[safeIndex]?.scrollIntoView({ block: "nearest" });
}

async function selectSuggestion(item) {
  if (!item?.symbol) {
    return;
  }
  state.symbol = item.symbol;
  dom.searchInput.value = item.symbol;
  hideSuggestions();
  await loadMarket(item.symbol);
}

function renderSuggestions(items) {
  state.searchResults = Array.isArray(items) ? items : [];
  if (!items || items.length === 0) {
    hideSuggestions();
    return;
  }

  dom.searchSuggestions.classList.remove("hidden");
  dom.searchSuggestions.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-item";
    button.dataset.index = String(index);

    const title = document.createElement("div");
    title.className = "suggestion-title";

    const strong = document.createElement("strong");
    strong.textContent = item.display || item.symbol;
    title.appendChild(strong);

    const market = document.createElement("span");
    market.textContent = item.market || "--";
    title.appendChild(market);

    const meta = document.createElement("div");
    meta.className = "suggestion-meta";
    meta.textContent = `${item.security_type || "证券"} · ${item.code}`;

    button.appendChild(title);
    button.appendChild(meta);
    button.addEventListener("mouseenter", () => {
      setActiveSuggestionIndex(index);
    });
    button.addEventListener("click", async () => {
      await selectSuggestion(item);
    });
    dom.searchSuggestions.appendChild(button);
  });
  setActiveSuggestionIndex(0);
}

async function fetchSuggestions(query) {
  const keyword = query.trim();
  if (!keyword) {
    state.searchResults = [];
    hideSuggestions();
    return;
  }

  const requestId = ++state.searchRequestId;
  const response = await fetch(`/api/search?q=${encodeURIComponent(keyword)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Search failed");
  }
  if (requestId !== state.searchRequestId) {
    return;
  }
  renderSuggestions(payload.results || []);
}

async function resolveAndLoadInput() {
  const query = dom.searchInput.value.trim();
  if (!query) return;

  if (isSuggestionsOpen() && state.searchResults[state.activeSuggestionIndex]) {
    await selectSuggestion(state.searchResults[state.activeSuggestionIndex]);
    return;
  }

  hideSuggestions();
  state.symbol = query;
  await loadMarket(query);
}

function syncWatchlistName(symbol, name) {
  let touched = false;
  state.watchlistModel.items = currentGroupItems().map((item) => {
    if (item.symbol !== symbol) return item;
    touched = true;
    return {
      ...item,
      name,
      trade_cycle: inferTradeCycle({ ...item, symbol, name }),
    };
  });
  if (touched) {
    saveWatchlistModel();
  }
}

function strategyPillClass(signal) {
  const normalized = String(signal || "").trim().toLowerCase();
  if (normalized === "buy") return "buy";
  if (normalized === "sell") return "sell";
  if (normalized === "hold") return "hold";
  if (normalized === "off") return "off";
  return "neutral";
}

function renderStrategyOptions() {
  const strategies =
    Array.isArray(state.availableStrategies) && state.availableStrategies.length > 0
      ? state.availableStrategies
      : [{ id: "none", label: "Off", description: "Disable strategy alerts" }];

  dom.strategySelect.innerHTML = "";
  strategies.forEach((item) => {
    const option = document.createElement("option");
    option.value = normalizeStrategyValue(item.id);
    option.textContent = item.is_overridden ? `${item.label || item.id} *` : (item.label || item.id);
    dom.strategySelect.appendChild(option);
  });

  if (!getStrategyMeta(state.strategy)) {
    const fallback = normalizeStrategyValue(window.APP_DEFAULTS.strategy || strategies[0]?.id || "none");
    state.strategy = getStrategyMeta(fallback) ? fallback : normalizeStrategyValue(strategies[0]?.id || "none");
    saveStrategyPreference();
  }

  dom.strategySelect.value = state.strategy;
}

function renderStrategyError(message) {
  dom.strategySignalBadge.textContent = "ERR";
  dom.strategySignalBadge.className = "strategy-pill neutral";
  setStrategyMetaText("策略信号加载失败", message || "Strategy signal load failed");
  renderStrategyHealthStrip(null, message || "策略数据状态加载失败");
}

function buildStrategyMetaText(payload) {
  const parts = [];
  const actionLabel = strategyActionLabel(payload);
  const reason = String(payload?.reason || "").trim();
  if (payload?.triggered && actionLabel) {
    parts.push(actionLabel);
  } else if (payload?.signal) {
    parts.push(String(payload.signal).trim().toUpperCase());
  }
  if (reason) {
    parts.push(reason);
  }
  return parts.join(" · ");
}

function buildStrategyMetaTitle(payload) {
  const parts = [];
  const displayTimeframe = strategyDisplayTimeframe(payload);
  const actionLabel = strategyActionLabel(payload);

  if (payload?.triggered && actionLabel) {
    parts.push(actionLabel);
  } else if (payload?.signal) {
    parts.push(String(payload.signal).trim().toUpperCase());
  }

  if (payload?.reason) {
    parts.push(payload.reason);
  }

  if (payload?.priority?.label && payload.priority.label !== "--") {
    parts.push(`优先级 ${payload.priority.label}`);
  }

  const jValue = Number(payload?.indicators?.j);
  if (Number.isFinite(jValue)) {
    parts.push(`J ${formatFixed(jValue, 2)}`);
  }

  if (payload?.timestamp) {
    parts.push(formatTimestampLabel(payload.timestamp, displayTimeframe || "5m", false));
  }

  return parts.join(" | ");
}

function compactStrategyMetaFallback(strategyMeta, mode = "idle") {
  const label = String(strategyMeta?.label || "策略").trim();
  if (mode === "off") {
    return `${label} 已关闭`;
  }
  if (mode === "error") {
    return `${label} 加载失败`;
  }
  return `${label} · 等待本轮信号刷新`;
}

function setStrategyMetaText(text, title = "") {
  if (!dom.strategySignalMeta) {
    return;
  }
  const compact = String(text || "").trim();
  const fullTitle = String(title || compact).trim();
  dom.strategySignalMeta.textContent = compact || "--";
  dom.strategySignalMeta.title = fullTitle || compact || "--";
}

function strategyHealthTone(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (normalized === "ok") return "ok";
  if (normalized === "warn") return "warn";
  if (["insufficient", "error"].includes(normalized)) return "error";
  return "pending";
}

function deriveStrategyHealthFromDetails(payload) {
  const components = payload?.details?.components;
  if (!components || typeof components !== "object") {
    return null;
  }
  const items = Object.values(components).map((component) => {
    const warningSet = new Set();
    Object.values(component?.checks || {}).forEach((check) => {
      (check?.warnings || []).forEach((warning) => {
        const text = String(warning || "").trim();
        if (text) {
          warningSet.add(text);
        }
      });
    });
    const warnings = [...warningSet];
    const status = warnings.length > 0 ? "warn" : "ok";
    return {
      id: String(component?.id || "").trim().toLowerCase(),
      label: String(component?.label || component?.id || "组件").trim(),
      timeframe: String(component?.timeframe || "--").trim(),
      actual_source_label: String(component?.actual_source || "").trim(),
      status,
      status_label: status === "warn" ? "警告" : "正常",
      message: warnings[0] || "数据正常",
      timestamp: component?.timestamp || null,
      bars: Number(component?.bar_count || 0),
      min_bars: Number(component?.min_bars || 0),
      warnings,
    };
  });
  const warningCount = items.filter((item) => item.status === "warn").length;
  const summaryStatus = warningCount > 0 ? "warn" : "ok";
  return {
    status: summaryStatus,
    status_label: summaryStatus === "warn" ? "警告" : "正常",
    summary: warningCount > 0 ? `${warningCount} 个周期存在规则告警` : "当前策略周期数据正常",
    is_reliable: items.length > 0,
    counts: {
      total: items.length,
      healthy: items.filter((item) => item.status === "ok").length,
      warn: warningCount,
      degraded: 0,
    },
    items,
  };
}

function resolveStrategyHealth(payload) {
  const health = payload?.details?.health;
  if (health && typeof health === "object") {
    return health;
  }
  return deriveStrategyHealthFromDetails(payload);
}

function renderStrategyHealthStrip(payload = null, fallbackMessage = "") {
  const container = dom.strategyHealthStrip;
  if (!container) {
    return;
  }

  const strategyMeta = getStrategyMeta(state.strategy);
  if (normalizeStrategyValue(state.strategy) === "none") {
    container.className = "topbar-health-strip empty";
    container.title = "当前策略已关闭";
    container.textContent = "当前策略已关闭";
    return;
  }

  const health = resolveStrategyHealth(payload);
  if (!payload && !fallbackMessage) {
    container.className = "topbar-health-strip empty";
    container.title = String(strategyMeta?.description || "等待策略周期状态刷新").trim();
    container.textContent = "正在加载周期状态…";
    return;
  }

  if (!health || !Array.isArray(health.items)) {
    container.className = "topbar-health-strip empty";
    container.title = String(fallbackMessage || "策略周期状态暂不可用").trim();
    container.textContent = fallbackMessage || "策略周期状态暂不可用";
    return;
  }

  container.className = "topbar-health-strip";
  container.title = String(health.summary || "").trim();
  container.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = `topbar-health-summary ${strategyHealthTone(health.status)}`;
  const counts = health?.counts || {};
  const total = Number(counts.total || health.items.length || 0);
  const healthy = Number(counts.healthy || 0);
  const degraded = Number(counts.degraded || 0);
  const warn = Number(counts.warn || 0);
  const statText =
    degraded > 0
      ? `${degraded} 异常`
      : warn > 0
        ? `${warn} 告警`
        : total > 0
          ? `${healthy}/${total}`
          : "等待";
  summary.innerHTML = `
    <strong>${health.status_label || "状态"}</strong>
    <span class="topbar-health-dot" aria-hidden="true"></span>
    <span class="topbar-health-hint">${statText}</span>
  `;
  container.appendChild(summary);

  const track = document.createElement("div");
  track.className = "topbar-health-track";
  health.items.forEach((item) => {
    const node = document.createElement("div");
    const status = String(item?.status || "").trim().toLowerCase();
    node.className = `topbar-health-item ${status || "pending"}`;
    const sourceText = String(item?.actual_source_label || item?.actual_source || "--").trim();
    const message = String(item?.message || "").trim();
    const bars = Number(item?.bars || 0);
    const minBars = Number(item?.min_bars || 0);
    node.title = [
      `${String(item?.label || item?.id || "组件").trim()} (${String(item?.timeframe || "--").trim()})`,
      `状态：${item?.status_label || "未知"}`,
      sourceText ? `来源：${sourceText}` : "",
      minBars > 0 ? `样本：${bars}/${minBars}` : "",
      message,
    ]
      .filter(Boolean)
      .join("\n");
    node.innerHTML = `
      <span class="topbar-health-dot" aria-hidden="true"></span>
      <span class="topbar-health-timeframe">${String(item?.timeframe || "--").trim()}</span>
      <span class="topbar-health-state">${String(item?.status_label || "未知").trim()}</span>
    `;
    track.appendChild(node);
  });
  container.appendChild(track);
}

function renderStrategySignal(payload = null) {
  const strategyMeta = getStrategyMeta(state.strategy);
  if (normalizeStrategyValue(state.strategy) === "none") {
    dom.strategySignalBadge.textContent = "OFF";
    dom.strategySignalBadge.className = "strategy-pill off";
    setStrategyMetaText(compactStrategyMetaFallback(strategyMeta, "off"), strategyMeta?.description || "Strategy alerts are off");
    renderStrategyHealthStrip(null);
    if (state.rulesModalOpen && state.rulesPayload) {
      renderStrategyComponentStatuses(dom.strategyComponentStatusList, state.rulesPayload.components || [], null);
    }
    return;
  }

  if (!payload) {
    dom.strategySignalBadge.textContent = "SCAN";
    dom.strategySignalBadge.className = "strategy-pill neutral";
    setStrategyMetaText(
      compactStrategyMetaFallback(strategyMeta, "idle"),
      strategyMeta?.description || "Waiting for strategy refresh"
    );
    renderStrategyHealthStrip(null);
    if (state.rulesModalOpen && state.rulesPayload) {
      renderStrategyComponentStatuses(dom.strategyComponentStatusList, state.rulesPayload.components || [], null);
    }
    return;
  }

  const signal = String(payload.signal || "HOLD").toUpperCase();
  dom.strategySignalBadge.textContent = signal;
  dom.strategySignalBadge.className = `strategy-pill ${strategyPillClass(signal)}`;
  setStrategyMetaText(buildStrategyMetaText(payload), buildStrategyMetaTitle(payload));
  renderStrategyHealthStrip(payload);
  if (state.rulesModalOpen && state.rulesPayload) {
    renderStrategyComponentStatuses(
      dom.strategyComponentStatusList,
      state.rulesPayload.components || [],
      payload.details || {}
    );
  }
}

function showToast({ tone = "neutral", title, body = "", meta = "" }) {
  if (!dom.toastStack) return;

  const toast = document.createElement("article");
  toast.className = `toast-card ${tone}`;

  const titleNode = document.createElement("p");
  titleNode.className = `toast-title ${tone}`;
  titleNode.textContent = title;
  toast.appendChild(titleNode);

  if (body) {
    const bodyNode = document.createElement("div");
    bodyNode.className = "toast-body";
    bodyNode.textContent = body;
    toast.appendChild(bodyNode);
  }

  if (meta) {
    const metaNode = document.createElement("div");
    metaNode.className = "toast-meta";
    metaNode.textContent = meta;
    toast.appendChild(metaNode);
  }

  dom.toastStack.appendChild(toast);
  window.requestAnimationFrame(() => {
    toast.classList.add("visible");
  });

  window.setTimeout(() => {
    toast.classList.remove("visible");
    window.setTimeout(() => {
      toast.remove();
    }, 220);
  }, 5200);
}

function maybeShowStrategyToast(payload, options = {}) {
  const { announce = false } = options;
  if (!announce || !payload?.triggered || !payload?.alert_key) {
    return;
  }
  if (state.lastStrategyAlertKey === payload.alert_key) {
    return;
  }

  state.lastStrategyAlertKey = payload.alert_key;
  const signal = String(payload?.signal || "").trim().toUpperCase();
  const tone = signal === "BUY" ? "buy" : signal === "SELL" ? "sell" : "neutral";
  const symbol = String(payload?.symbol || "").trim().toUpperCase();
  const name = String(payload?.name || "").trim();
  const titleParts = [symbol];
  if (name) {
    titleParts.push(name);
  }
  if (signal) {
    const actionLabel = strategyActionLabel(payload);
    titleParts.push(actionLabel ? `${signal} · ${actionLabel}` : signal);
  }
  const strategyLabel = payload?.strategy?.label || getStrategyMeta(state.strategy)?.label || "策略";
  const decisionText = buildStrategyDecisionText(payload);
  const bodyParts = [`策略：${strategyLabel}`];
  if (decisionText) {
    bodyParts.push(`判定：${decisionText}`);
  } else if (payload?.reason) {
    bodyParts.push(`判定：${payload.reason}`);
  }
  showToast({
    tone,
    title: titleParts.join(" | "),
    body: bodyParts.join("\n"),
    meta: buildStrategyToastMeta(payload),
  });
}

async function loadStrategies() {
  try {
    const response = await fetch("/api/strategies");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Load strategies failed");
    }
    if (Array.isArray(payload.strategies) && payload.strategies.length > 0) {
      state.availableStrategies = payload.strategies;
    }

    const fallback = normalizeStrategyValue(payload.default || window.APP_DEFAULTS.strategy || "none");
    if (!getStrategyMeta(state.strategy)) {
      state.strategy = getStrategyMeta(fallback)
        ? fallback
        : normalizeStrategyValue(state.availableStrategies[0]?.id || "none");
      saveStrategyPreference();
    }
  } catch (error) {
    console.error(error);
    if (!Array.isArray(state.availableStrategies) || state.availableStrategies.length === 0) {
      state.availableStrategies = [{ id: "none", label: "Off", description: "Disable strategy alerts" }];
    }
    state.strategy = getStrategyMeta(state.strategy) ? state.strategy : "none";
  }

  renderStrategyOptions();
  renderStrategySignal(state.strategySignal);
}

async function fetchStrategySignal(symbol = state.symbol, options = {}) {
  const { silent = true, announce = false } = options;
  if (!symbol) {
    return;
  }

  if (normalizeStrategyValue(state.strategy) === "none") {
    state.strategySignal = null;
    renderStrategySignal(null);
    return;
  }

  const requestId = ++state.strategyRequestId;
  state.isLoadingStrategy = true;

  try {
    const payload = await requestDashboardPulse({
      symbol,
      timeframe: state.timeframe,
      bars: 260,
      source: state.source,
      strategy: state.strategy,
      watchlistSymbols: [],
      includeChart: false,
      includeWatchlistSignals: false,
    });

    if (requestId !== state.strategyRequestId || symbol !== state.symbol) {
      return;
    }

    if (normalizeStrategyValue(payload?.strategy_signal?.strategy?.id) !== normalizeStrategyValue(state.strategy)) {
      return;
    }

    applyDashboardPulsePayload(payload, {
      includeChart: false,
      includeWatchlistSignals: false,
      announce,
      now: Date.now(),
    });
    if (!silent) {
      setRefreshStatus(`Strategy signal updated | ${new Date().toLocaleTimeString("zh-CN")}`);
    }
  } catch (error) {
    console.error(error);
    if (requestId !== state.strategyRequestId) {
      return;
    }
    renderStrategyError(error.message || "Strategy signal load failed");
    if (!silent) {
      setRefreshStatus(error.message || "Strategy signal load failed");
    }
  } finally {
    if (requestId === state.strategyRequestId) {
      state.isLoadingStrategy = false;
    }
  }
}

async function loadSources() {
  try {
    const response = await fetch("/api/sources");
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Load sources failed");
    }
    if (Array.isArray(payload.sources) && payload.sources.length > 0) {
      state.availableSources = payload.sources;
    }
    if (!getSourceMeta(state.source)) {
      state.source = payload.default || "auto";
      saveSourcePreference();
    }
  } catch (error) {
    console.error(error);
  }
  renderSourceOptions();
  renderSourcePanels();
}

async function ensureRulesLoaded(options = {}) {
  const { force = false } = options;
  const strategy = normalizeStrategyValue(state.strategy);
  if (!force && state.rulesPayload?.strategy?.id && normalizeStrategyValue(state.rulesPayload.strategy.id) === strategy) {
    return state.rulesPayload;
  }
  const response = await fetch(`/api/rules?strategy=${encodeURIComponent(strategy)}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Load rules failed");
  }
  state.rulesPayload = payload;
  return payload;
}

function renderRulesModal(payload) {
  const strategyMeta = payload.strategy || getStrategyMeta(state.strategy);
  dom.rulesTimeframe.textContent = payload.timeframe || "--";
  dom.rulesAdjust.textContent = payload.adjust || "--";
  dom.rulesCurrentSource.textContent = state.currentPayload?.source.actual_label || getSourceMeta(state.source)?.label || "--";
  renderStrategySignal(state.strategySignal);
  renderStrategyConfigEditor(payload);
  renderStrategyConfigHelp(payload);
  renderStrategyBlueprint(dom.strategyComponentsList, payload.components || []);
  renderStrategyComponentStatuses(
    dom.strategyComponentStatusList,
    payload.components || [],
    state.strategySignal?.details || {}
  );
  renderChipList(
    dom.indicatorList,
    (payload.indicators || []).map((item) => `${item.name}: ${item.description}`),
    "当前没有指标配置"
  );
  renderChipList(dom.buyRulesList, payload.buy_rules || [], "当前没有买入规则");
  renderChipList(dom.sellRulesList, payload.sell_rules || [], "当前没有卖出规则");
  renderChipList(dom.rulesNotes, payload.notes || [], "当前没有额外说明");
  if (dom.rulesModalTitle && strategyMeta?.label) {
    dom.rulesModalTitle.textContent = `规则说明 · ${strategyMeta.label}`;
  }
}

async function refreshRulesModal(options = {}) {
  try {
    const payload = await ensureRulesLoaded({ force: options.force !== false });
    renderRulesModal(payload);
  } catch (error) {
    console.error(error);
    setRefreshStatus(error.message || "规则说明加载失败");
  }
}

function parseStrategyConfigDraft() {
  const raw = dom.strategyConfigInput?.value.trim() || "";
  if (!raw) {
    throw new Error("策略配置不能为空");
  }
  const config = JSON.parse(raw);
  if (!config || Array.isArray(config) || typeof config !== "object") {
    throw new Error("策略配置必须是 JSON 对象");
  }
  return config;
}

function formatStrategyConfigEditor() {
  try {
    const config = parseStrategyConfigDraft();
    dom.strategyConfigInput.value = JSON.stringify(config, null, 2);
    state.strategyConfigDirty = dom.strategyConfigInput.value !== state.strategyConfigSeed;
    setStrategyConfigMessage("已格式化当前策略配置。", "success");
  } catch (error) {
    console.error(error);
    setStrategyConfigMessage(error.message || "策略配置格式化失败", "error");
  }
}

async function saveStrategyConfigOverride() {
  if (!isStrategyEditable()) {
    setStrategyConfigMessage("当前策略不支持编辑。", "error");
    return;
  }

  let config;
  try {
    config = parseStrategyConfigDraft();
  } catch (error) {
    console.error(error);
    setStrategyConfigMessage(error.message || "策略配置解析失败", "error");
    return;
  }

  setStrategyConfigControlsDisabled(true);
  setStrategyConfigMessage("正在保存策略配置...");
  try {
    const response = await fetch(`/api/strategy-config/${encodeURIComponent(state.strategy)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "策略配置保存失败");
    }

    if (Array.isArray(payload.strategies)) {
      state.availableStrategies = payload.strategies;
    }
    state.rulesPayload = payload.rules || null;
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    renderStrategyOptions();
    renderWatchlist();
    renderStrategySignal(null);
    if (state.rulesPayload) {
      renderRulesModal(state.rulesPayload);
    }
    setStrategyConfigMessage("策略配置已保存到本机覆盖。", "success");
    setRefreshStatus("策略配置已保存");
    runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  } catch (error) {
    console.error(error);
    setStrategyConfigMessage(error.message || "策略配置保存失败", "error");
    setRefreshStatus(error.message || "策略配置保存失败");
  } finally {
    if (!state.rulesPayload) {
      setStrategyConfigControlsDisabled(false);
    }
  }
}

async function resetStrategyConfigOverride() {
  if (!isStrategyEditable()) {
    setStrategyConfigMessage("当前策略不支持编辑。", "error");
    return;
  }
  if (!window.confirm("恢复默认后，会移除这套策略的本机覆盖配置。确定继续吗？")) {
    return;
  }

  setStrategyConfigControlsDisabled(true);
  setStrategyConfigMessage("正在恢复内置配置...");
  try {
    const response = await fetch(`/api/strategy-config/${encodeURIComponent(state.strategy)}`, {
      method: "DELETE",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "恢复默认失败");
    }

    if (Array.isArray(payload.strategies)) {
      state.availableStrategies = payload.strategies;
    }
    state.rulesPayload = payload.rules || null;
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    renderStrategyOptions();
    renderWatchlist();
    renderStrategySignal(null);
    if (state.rulesPayload) {
      renderRulesModal(state.rulesPayload);
    }
    setStrategyConfigMessage("已恢复为内置基础配置。", "success");
    setRefreshStatus("策略配置已恢复默认");
    runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  } catch (error) {
    console.error(error);
    setStrategyConfigMessage(error.message || "恢复默认失败", "error");
    setRefreshStatus(error.message || "恢复默认失败");
  } finally {
    if (!state.rulesPayload) {
      setStrategyConfigControlsDisabled(false);
    }
  }
}

function setCustomRuleMessage(message, tone = "neutral") {
  if (!dom.customRuleMessage) return;
  dom.customRuleMessage.textContent = message || "";
  dom.customRuleMessage.classList.toggle("error", tone === "error");
  dom.customRuleMessage.classList.toggle("success", tone === "success");
}

async function submitCustomStrategyRule() {
  const rule = dom.customRuleInput?.value.trim() || "";
  if (!rule) {
    setCustomRuleMessage("请输入自定义规则。", "error");
    return;
  }
  if (dom.customRuleSaveButton) {
    dom.customRuleSaveButton.disabled = true;
  }
  setCustomRuleMessage("正在录入规则...", "neutral");
  try {
    const response = await fetch("/api/custom-strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rule }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "规则录入失败");
    }
    if (Array.isArray(payload.strategies)) {
      state.availableStrategies = payload.strategies;
    }
    state.strategy = normalizeStrategyValue(payload.strategy?.id || state.strategy);
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    state.rulesPayload = payload.rules || null;
    saveStrategyPreference();
    renderStrategyOptions();
    renderWatchlist();
    renderStrategySignal(null);
    if (state.rulesPayload) {
      renderRulesModal(state.rulesPayload);
    } else {
      await refreshRulesModal({ force: true });
    }
    setCustomRuleMessage("规则已录入，并已切换到该策略。", "success");
    setRefreshStatus("自定义规则已录入");
    runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  } catch (error) {
    console.error(error);
    setCustomRuleMessage(error.message || "规则录入失败", "error");
    setRefreshStatus(error.message || "规则录入失败");
  } finally {
    if (dom.customRuleSaveButton) {
      dom.customRuleSaveButton.disabled = false;
    }
  }
}

async function deleteSelectedCustomStrategy() {
  const strategy = getStrategyMeta(state.strategy);
  if (!strategy || normalizeStrategyValue(strategy.id) === "none") {
    setRefreshStatus("不启用不能删除");
    updateStrategyDeleteButtonState();
    return;
  }
  const label = strategy.label || strategy.id;
  if (!window.confirm(`确认删除规则“${label}”？`)) {
    return;
  }
  if (!window.confirm("删除后不可恢复，确认继续？")) {
    return;
  }
  if (dom.strategyDeleteButton) {
    dom.strategyDeleteButton.disabled = true;
  }
  try {
    const response = await fetch(`/api/custom-strategy/${encodeURIComponent(strategy.id)}`, {
      method: "DELETE",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "规则删除失败");
    }
    if (Array.isArray(payload.strategies)) {
      state.availableStrategies = payload.strategies;
    }
    state.strategy = normalizeStrategyValue(payload.default || "none");
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    state.rulesPayload = null;
    updateStrategyDeleteButtonState();
    saveStrategyPreference();
    renderStrategyOptions();
    renderWatchlist();
    renderStrategySignal(null);
    processWebhookAlerts();
    if (state.rulesModalOpen) {
      await refreshRulesModal({ force: true });
    }
    runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
    setRefreshStatus(`已删除自定义规则：${label}`);
  } catch (error) {
    console.error(error);
    setRefreshStatus(error.message || "规则删除失败");
    updateStrategyDeleteButtonState();
  }
}

async function openRulesModal() {
  try {
    const payload = await ensureRulesLoaded({ force: true });
    renderRulesModal(payload);
    state.rulesModalOpen = true;
    dom.rulesBackdrop.classList.remove("hidden");
    dom.rulesModal.classList.remove("hidden");
    dom.rulesModal.setAttribute("aria-hidden", "false");
  } catch (error) {
    console.error(error);
    setRefreshStatus(error.message || "规则说明加载失败");
  }
}

function closeRulesModal() {
  state.rulesModalOpen = false;
  dom.rulesBackdrop.classList.add("hidden");
  dom.rulesModal.classList.add("hidden");
  dom.rulesModal.setAttribute("aria-hidden", "true");
}

function applyQuotePayload(payload) {
  if (!state.currentPayload || payload.symbol !== state.currentPayload.symbol) {
    return;
  }

  const nextMarket = {
    ...state.currentPayload.market,
    ...(payload.market || {}),
  };

  state.currentPayload = {
    ...state.currentPayload,
    market: nextMarket,
    last_price: payload.market?.last_price ?? state.currentPayload.last_price,
    change: payload.market?.change ?? state.currentPayload.change,
    change_pct: payload.market?.change_pct ?? state.currentPayload.change_pct,
  };

  cacheWatchlistQuote(payload.symbol, state.currentPayload.name, nextMarket, payload.source?.actual);
  renderSummary(state.currentPayload);
  renderMarketStats(state.currentPayload.market);
  renderWatchlist();
}

function applyWatchlistQuotes(payload) {
  const nextQuotes = { ...state.watchlistQuotes };
  (payload?.quotes || []).forEach((item) => {
    const entry = buildWatchlistQuote(item.symbol, item.name, item.market, item.source?.actual, item.streak);
    if (entry) {
      nextQuotes[entry.symbol] = entry;
    }
  });
  state.watchlistQuotes = nextQuotes;
  renderWatchlist();
  if (state.signalDrawerOpen) {
    renderSignalDrawerFromWatchlist();
  }
}

function applyWatchlistStrategySignals(payload) {
  const nextSignals = { ...state.watchlistStrategySignals };
  (payload?.signals || []).forEach((item) => {
    const entry = normalizeWatchlistStrategySignal(item);
    if (entry) {
      nextSignals[entry.symbol] = entry;
    }
  });
  state.watchlistStrategySignals = nextSignals;
  renderWatchlist();
  processWebhookAlerts();
  if (state.signalDrawerOpen) {
    renderSignalDrawerFromWatchlist();
  }
}

function applyCurrentStrategySignalPayload(payload, options = {}) {
  const { announce = false, silent = true } = options;
  if (!payload) {
    if (normalizeStrategyValue(state.strategy) === "none") {
      state.strategySignal = null;
      renderStrategySignal(null);
    }
    return;
  }
  if (payload.symbol && payload.symbol !== state.symbol) {
    return;
  }
  if (normalizeStrategyValue(payload?.strategy?.id) !== normalizeStrategyValue(state.strategy)) {
    return;
  }
  state.strategySignal = payload;
  renderStrategySignal(payload);
  maybeShowStrategyToast(payload, { announce });
  if (!silent) {
    setRefreshStatus(`Strategy signal updated | ${new Date().toLocaleTimeString("zh-CN")}`);
  }
}

function applyChartPayload(payload) {
  if (!payload) {
    return;
  }
  state.currentPayload = payload;
  state.symbol = payload.symbol;
  dom.searchInput.value = payload.symbol;
  renderSummary(payload);
  renderMarketStats(payload.market);
  renderChart(payload);
  syncWatchlistName(payload.symbol, payload.name);
  cacheWatchlistQuote(payload.symbol, payload.name, payload.market, payload.source?.actual);
  renderWatchlist();
  if (state.rulesPayload) {
    renderRulesModal(state.rulesPayload);
  }
}

function shouldRefreshChart(now, force = false) {
  if (force) {
    return true;
  }
  return !state.lastChartRefreshAt || now - state.lastChartRefreshAt >= AUTO_REFRESH_CHART_INTERVAL_MS;
}

function shouldRefreshWatchlistSignals(now, force = false) {
  if (normalizeStrategyValue(state.strategy) === "none") {
    return false;
  }
  if (force) {
    return true;
  }
  return (
    !state.lastWatchlistSignalRefreshAt ||
    now - state.lastWatchlistSignalRefreshAt >= AUTO_REFRESH_WATCHLIST_SIGNAL_INTERVAL_MS
  );
}

function buildDashboardPulseParams(options = {}) {
  const {
    symbol = state.symbol,
    timeframe = state.timeframe,
    bars = 260,
    source = state.source,
    strategy = state.strategy,
    watchlistSymbols = currentGroupSymbols(),
    includeChart = false,
    includeWatchlistSignals = false,
  } = options;
  const params = new URLSearchParams({
    symbol,
    timeframe,
    bars: String(bars),
    source,
    strategy,
  });
  if (watchlistSymbols.length > 0) {
    params.set("symbols", watchlistSymbols.join(","));
  }
  if (includeChart) {
    params.set("include_chart", "1");
  }
  if (includeWatchlistSignals) {
    params.set("include_watchlist_signals", "1");
  }
  return params;
}

async function requestDashboardPulse(options = {}) {
  const response = await fetch(`/api/dashboard-pulse?${buildDashboardPulseParams(options).toString()}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Refresh failed");
  }
  return payload;
}

function applyDashboardPulsePayload(payload, options = {}) {
  const { includeChart = false, includeWatchlistSignals = false, announce = true, now = Date.now() } = options;

  if (includeChart && payload.chart) {
    applyChartPayload(payload.chart);
    state.lastChartRefreshAt = now;
  } else if (payload.quote) {
    applyQuotePayload(payload.quote);
  }

  if (payload.strategy_signal) {
    applyCurrentStrategySignalPayload(payload.strategy_signal, { announce, silent: true });
  } else if (normalizeStrategyValue(state.strategy) === "none") {
    state.strategySignal = null;
    renderStrategySignal(null);
  }

  if (payload.watchlist_quotes) {
    applyWatchlistQuotes(payload.watchlist_quotes);
  }

  if (includeWatchlistSignals) {
    if (payload.watchlist_signals) {
      applyWatchlistStrategySignals(payload.watchlist_signals);
    } else {
      state.watchlistStrategySignals = {};
      renderWatchlist();
      processWebhookAlerts();
    }
    state.lastWatchlistSignalRefreshAt = now;
  }

  if (state.rulesPayload) {
    renderRulesModal(state.rulesPayload);
  }
}

async function runDashboardPulse(options = {}) {
  const { silent = true, forceChart = false, forceWatchlistSignals = false, announce = true } = options;
  if (!state.symbol || state.isRefreshingPulse || state.isLoadingChart) {
    return;
  }

  const requestId = ++state.pulseRequestId;
  const now = Date.now();
  const includeChart = shouldRefreshChart(now, forceChart);
  const includeWatchlistSignals = shouldRefreshWatchlistSignals(now, forceWatchlistSignals);
  const targetSymbol = state.symbol;
  const watchlistSymbols = currentGroupSymbols();

  state.isRefreshingPulse = true;
  try {
    const payload = await requestDashboardPulse({
      symbol: targetSymbol,
      timeframe: state.timeframe,
      bars: 260,
      source: state.source,
      strategy: state.strategy,
      watchlistSymbols,
      includeChart,
      includeWatchlistSignals,
    });
    if (requestId !== state.pulseRequestId || targetSymbol !== state.symbol || payload.symbol !== state.symbol) {
      return;
    }

    applyDashboardPulsePayload(payload, { includeChart, includeWatchlistSignals, announce, now });

    const chartError = includeChart ? String(payload?.errors?.chart || "").trim() : "";
    if (chartError && !payload.chart && !silent) {
      setRefreshStatus(chartError);
      return;
    }

    if (!silent) {
      setRefreshStatus(`自动刷新中 · ${new Date().toLocaleTimeString("zh-CN")}`);
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      setRefreshStatus(error.message || "Refresh failed");
    }
  } finally {
    if (requestId === state.pulseRequestId) {
      state.isRefreshingPulse = false;
    }
  }
}

async function fetchWatchlistQuotes(options = {}) {
  const { silent = true } = options;
  const symbols = currentGroupSymbols();
  if (symbols.length === 0) {
    return;
  }
  if (state.isLoadingWatchlistQuotes) {
    return;
  }

  const requestId = ++state.watchlistQuoteRequestId;
  state.isLoadingWatchlistQuotes = true;

  try {
    const payload = await requestDashboardPulse({
      symbol: state.symbol || symbols[0],
      timeframe: state.timeframe,
      bars: 260,
      source: state.source,
      strategy: state.strategy,
      watchlistSymbols: symbols,
      includeChart: false,
      includeWatchlistSignals: false,
    });
    if (requestId !== state.watchlistQuoteRequestId) {
      return;
    }

    applyDashboardPulsePayload(payload, {
      includeChart: false,
      includeWatchlistSignals: false,
      announce: false,
      now: Date.now(),
    });
    if (!silent && Array.isArray(payload.watchlist_quotes?.errors) && payload.watchlist_quotes.errors.length > 0) {
      setRefreshStatus(payload.watchlist_quotes.errors[0].error || "Watchlist quote load failed");
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      setRefreshStatus(error.message || "Watchlist quote load failed");
    }
  } finally {
    if (requestId === state.watchlistQuoteRequestId) {
      state.isLoadingWatchlistQuotes = false;
    }
  }
}

async function fetchWatchlistStrategySignals(options = {}) {
  const { silent = true } = options;
  const symbols = currentGroupSymbols();
  if (normalizeStrategyValue(state.strategy) === "none") {
    state.watchlistStrategySignals = {};
    renderWatchlist();
    processWebhookAlerts();
    if (state.signalDrawerOpen) {
      renderSignalDrawerFromWatchlist();
    }
    return;
  }
  if (symbols.length === 0) {
    state.watchlistStrategySignals = {};
    renderWatchlist();
    processWebhookAlerts();
    if (state.signalDrawerOpen) {
      renderSignalDrawerFromWatchlist();
    }
    return;
  }
  if (state.isLoadingWatchlistStrategySignals) {
    return;
  }

  const requestId = ++state.watchlistStrategyRequestId;
  state.isLoadingWatchlistStrategySignals = true;

  try {
    const payload = await requestDashboardPulse({
      symbol: state.symbol || symbols[0],
      timeframe: state.timeframe,
      bars: 260,
      source: state.source,
      strategy: state.strategy,
      watchlistSymbols: symbols,
      includeChart: false,
      includeWatchlistSignals: true,
    });
    if (requestId !== state.watchlistStrategyRequestId) {
      return;
    }

    applyDashboardPulsePayload(payload, {
      includeChart: false,
      includeWatchlistSignals: true,
      announce: false,
      now: Date.now(),
    });
    if (!silent && Array.isArray(payload.watchlist_signals?.errors) && payload.watchlist_signals.errors.length > 0) {
      setRefreshStatus(payload.watchlist_signals.errors[0].error || "Watchlist strategy load failed");
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      setRefreshStatus(error.message || "Watchlist strategy load failed");
    }
  } finally {
    if (requestId === state.watchlistStrategyRequestId) {
      state.isLoadingWatchlistStrategySignals = false;
    }
  }
}

async function fetchQuote(symbol = state.symbol, options = {}) {
  const { silent = true } = options;
  if (!symbol || state.isLoadingQuote || state.isLoadingChart) {
    return;
  }
  if (!state.currentPayload || state.currentPayload.symbol !== symbol) {
    return;
  }

  const requestId = ++state.quoteRequestId;
  state.isLoadingQuote = true;

  try {
    const payload = await requestDashboardPulse({
      symbol,
      timeframe: state.timeframe,
      bars: 260,
      source: state.source,
      strategy: state.strategy,
      watchlistSymbols: [],
      includeChart: false,
      includeWatchlistSignals: false,
    });
    if (requestId !== state.quoteRequestId || symbol !== state.symbol) {
      return;
    }

    applyDashboardPulsePayload(payload, {
      includeChart: false,
      includeWatchlistSignals: false,
      announce: false,
      now: Date.now(),
    });
    if (!silent) {
      setRefreshStatus(`快照更新 · ${new Date().toLocaleTimeString("zh-CN")}`);
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      setRefreshStatus(error.message || "Quote load failed");
    }
  } finally {
    if (requestId === state.quoteRequestId) {
      state.isLoadingQuote = false;
    }
  }
}

async function loadMarket(symbol, options = {}) {
  const { silent = false, background = false } = options;
  if (!symbol) {
    return;
  }
  if (background && state.isLoadingChart) {
    return;
  }

  const requestId = ++state.marketRequestId;
  state.isLoadingChart = true;
  if (!silent) {
    setRefreshStatus(`正在加载 ${symbol} · ${getSourceMeta(state.source)?.label || state.source}`);
  }
  try {
    const payload = await requestDashboardPulse({
      symbol,
      timeframe: state.timeframe,
      bars: 260,
      source: state.source,
      strategy: state.strategy,
      watchlistSymbols: currentGroupSymbols(),
      includeChart: true,
      includeWatchlistSignals: true,
    });
    if (requestId !== state.marketRequestId) {
      return;
    }

    applyDashboardPulsePayload(payload, {
      includeChart: true,
      includeWatchlistSignals: true,
      announce: !background,
      now: Date.now(),
    });
    state.isLoadingChart = false;
    const chartError = String(payload?.errors?.chart || "").trim();
    if (chartError && !payload.chart) {
      setRefreshStatus(chartError);
    } else {
      setRefreshStatus(`自动刷新中 · ${new Date().toLocaleTimeString("zh-CN")}`);
    }
  } catch (error) {
    console.error(error);
    if (requestId !== state.marketRequestId) {
      return;
    }
    state.isLoadingChart = false;
    const message = error.message || "加载失败";
    if (state.source !== "auto") {
      setRefreshStatus(`${message}，可切换到自动选择或腾讯`);
    } else {
      setRefreshStatus(message);
    }
  }
}

function toggleCurrentIntoWatchlist() {
  if (!state.currentPayload) return;
  const symbol = state.currentPayload.symbol;
  if (symbolExistsInGroup(symbol)) return;

  state.watchlistModel.items = [
    {
      symbol,
      name: state.currentPayload.name,
      trade_cycle: inferTradeCycle(state.currentPayload),
    },
    ...currentGroupItems(),
  ];
  saveWatchlistModel();
  cacheWatchlistQuote(symbol, state.currentPayload.name, state.currentPayload.market, state.currentPayload.source?.actual);
  renderWatchlist();
  runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  updateWatchlistButtonState();
}

function startAutoRefresh(options = {}) {
  const { immediate = true } = options;
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }
  if (state.quoteTimer) {
    clearInterval(state.quoteTimer);
  }
  if (state.strategyTimer) {
    clearInterval(state.strategyTimer);
  }
  if (state.watchlistQuoteTimer) {
    clearInterval(state.watchlistQuoteTimer);
  }
  if (state.watchlistStrategyTimer) {
    clearInterval(state.watchlistStrategyTimer);
  }
  state.quoteTimer = null;
  state.strategyTimer = null;
  state.watchlistQuoteTimer = null;
  state.watchlistStrategyTimer = null;
  state.refreshTimer = window.setInterval(() => {
    if (!state.symbol) return;
    runDashboardPulse({ silent: true, announce: true });
  }, AUTO_REFRESH_INTERVAL_MS);
  if (immediate) {
    runDashboardPulse({ silent: true, forceWatchlistSignals: true, announce: false });
  }
}

function bindEvents() {
  dom.searchButton.addEventListener("click", () => {
    resolveAndLoadInput();
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!isSuggestionsOpen()) {
        fetchSuggestions(dom.searchInput.value).catch((error) => {
          console.error(error);
          hideSuggestions();
        });
      } else {
        setActiveSuggestionIndex(state.activeSuggestionIndex + 1);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp") {
      if (isSuggestionsOpen()) {
        setActiveSuggestionIndex(state.activeSuggestionIndex - 1);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      resolveAndLoadInput();
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  dom.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      fetchSuggestions(dom.searchInput.value).catch((error) => {
        console.error(error);
        hideSuggestions();
      });
    }, 220);
  });

  dom.searchInput.addEventListener("focus", () => {
    if (dom.searchInput.value.trim() && state.searchResults.length > 0) {
      renderSuggestions(state.searchResults);
    }
  });

  dom.groupNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createGroup();
    }
  });

  document.addEventListener("click", (event) => {
    if (!dom.searchSuggestions.contains(event.target) && event.target !== dom.searchInput) {
      hideSuggestions();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.rulesModalOpen) {
      closeRulesModal();
    }
  });

  dom.watchlistButton.addEventListener("click", () => {
    toggleCurrentIntoWatchlist();
  });

  dom.groupCreateButton.addEventListener("click", () => {
    createGroup();
  });

  dom.groupDeleteButton.addEventListener("click", () => {
    deleteCurrentGroup();
  });

  dom.watchlistImportButton.addEventListener("click", () => {
    if (dom.watchlistImportInput) {
      if (typeof dom.watchlistImportInput.showPicker === "function") {
        dom.watchlistImportInput.showPicker();
      } else {
        dom.watchlistImportInput.click();
      }
    }
  });

  dom.watchlistImportInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    try {
      await handleWatchlistImport(file);
    } catch (error) {
      console.error(error);
      const message = error?.message || "XLSX import failed";
      setRefreshStatus(message);
      showToast({
        tone: "sell",
        title: "Watchlist import failed",
        body: message,
      });
    } finally {
      event.target.value = "";
    }
  });

  dom.watchlistSortSelect.addEventListener("change", () => {
    state.watchlistSortMode = normalizeWatchlistSortMode(dom.watchlistSortSelect.value);
    saveWatchlistSortPreference();
    renderWatchlist();
  });

  dom.sourceSelect.addEventListener("change", () => {
    state.source = dom.sourceSelect.value;
    saveSourcePreference();
    renderSourcePanels();
    loadMarket(state.symbol);
  });

  dom.strategySelect.addEventListener("change", () => {
    state.strategy = normalizeStrategyValue(dom.strategySelect.value);
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    state.rulesPayload = null;
    updateStrategyDeleteButtonState();
    saveStrategyPreference();
    renderWatchlist();
    renderStrategySignal(null);
    renderSignalDrawerFromWatchlist();
    if (state.rulesModalOpen) {
      refreshRulesModal({ force: true });
    }
    startAutoRefresh();
  });

  if (dom.strategyDeleteButton) {
    dom.strategyDeleteButton.addEventListener("click", deleteSelectedCustomStrategy);
  }

  dom.timeframeButtons.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.timeframe = button.dataset.timeframe;
      setActiveTimeframeButton();
      loadMarket(state.symbol);
    });
  });

  dom.rulesButton.addEventListener("click", () => {
    openRulesModal();
  });

  dom.rulesMiniButton.addEventListener("click", () => {
    openRulesModal();
  });

  dom.rulesModalClose.addEventListener("click", () => {
    closeRulesModal();
  });

  dom.rulesBackdrop.addEventListener("click", () => {
    closeRulesModal();
  });

  if (dom.strategyConfigFormatButton) {
    dom.strategyConfigFormatButton.addEventListener("click", formatStrategyConfigEditor);
  }
  if (dom.strategyConfigHelpButton) {
    dom.strategyConfigHelpButton.addEventListener("click", () => {
      setStrategyConfigHelpOpen(!state.strategyConfigHelpOpen);
    });
  }
  if (dom.strategyConfigSaveButton) {
    dom.strategyConfigSaveButton.addEventListener("click", saveStrategyConfigOverride);
  }
  if (dom.strategyConfigResetButton) {
    dom.strategyConfigResetButton.addEventListener("click", resetStrategyConfigOverride);
  }
  if (dom.strategyConfigInput) {
    dom.strategyConfigInput.addEventListener("input", () => {
      state.strategyConfigDirty = dom.strategyConfigInput.value !== state.strategyConfigSeed;
      if (state.strategyConfigDirty && !dom.strategyConfigMessage.classList.contains("error")) {
        setStrategyConfigMessage("检测到未保存修改。");
      }
    });
    dom.strategyConfigInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveStrategyConfigOverride();
      }
    });
  }
}

function renderSourcePanels(sourcePayload) {
  const source = sourcePayload || {
    requested: state.source,
    requested_label: getSourceMeta(state.source)?.label || state.source,
    actual: state.source,
    actual_label: getSourceMeta(state.source)?.label || state.source,
  };

  dom.activeSourceLabel.textContent = source.actual_label;
  dom.metricSource.textContent = source.actual_label;

  if (source.requested === source.actual) {
    dom.metricSourceMeta.textContent = `请求: ${source.requested_label}`;
    return;
  }

  dom.metricSourceMeta.textContent = `请求: ${source.requested_label} -> ${source.actual_label}`;
}

function renderSummary(payload) {
  dom.metricName.textContent = payload.name;
  dom.metricSymbol.textContent = `${payload.symbol.toUpperCase()} · ${payload.timeframe}`;
  dom.metricPrice.textContent = formatFixed(payload.last_price, 3);
  dom.metricChange.textContent = `${formatSigned(payload.change)} / ${formatPercent(payload.change_pct)}`;
  dom.metricChange.style.color = payload.change >= 0 ? "var(--rise)" : "var(--fall)";
  dom.metricSignal.textContent = payload.signal.signal;
  dom.metricSignal.className = `metric-value signal-pill ${signalClass(payload.signal.signal)}`;
  dom.metricTime.textContent = `更新于 ${payload.market.timestamp || payload.last_timestamp}`;
  renderSignalDrawerFromWatchlist();
  renderSourcePanels(payload.source);
  renderIndicatorHeaders(payload);
  updateWatchlistButtonState();
}

function buildChartDivergenceMarkers(payload, riseColor, fallColor) {
  const items = Array.isArray(payload?.annotations?.divergences) ? payload.annotations.divergences : [];
  const bottomLabel = "\u5e95\u80cc\u79bb";
  const topLabel = "\u9876\u80cc\u79bb";
  return items
    .filter((item) => item?.time && Number.isFinite(Number(item?.price)))
    .map((item) => {
      const isBottom = String(item.type || "").trim().toLowerCase() === "bottom";
      const markerColor = isBottom ? riseColor : fallColor;
      return {
        name: item.label || (isBottom ? "底背离" : "顶背离"),
        coord: [item.time, Number(item.price)],
        value: item.short_label || item.label || (isBottom ? "底背离" : "顶背离"),
        symbol: "triangle",
        symbolSize: 18,
        symbolRotate: isBottom ? 0 : 180,
        symbolOffset: [0, isBottom ? 12 : -12],
        itemStyle: {
          color: markerColor,
          borderColor: "rgba(244, 247, 250, 0.88)",
          borderWidth: 1,
          shadowBlur: 10,
          shadowColor: `${markerColor}66`,
        },
        label: {
          show: true,
          formatter: item.short_label || item.label || (isBottom ? "底背离" : "顶背离"),
          color: markerColor,
          fontSize: 10,
          fontWeight: 700,
          position: isBottom ? "bottom" : "top",
          distance: 4,
        },
        tooltipMeta: item,
      };
    });
}

function buildChartDivergenceTooltipMap(payload) {
  const items = Array.isArray(payload?.annotations?.divergences) ? payload.annotations.divergences : [];
  const result = new Map();
  items.forEach((item) => {
    const time = String(item?.time || "").trim();
    if (!time) return;
    const lines = result.get(time) || [];
    const indicatorText = Number.isFinite(Number(item?.indicator))
      ? `DIF ${formatFixed(item.indicator, 2)}`
      : "DIF --";
    const referenceText = item?.reference_time
      ? ` | 对比 ${formatTimestampLabel(item.reference_time, payload.timeframe, false)}`
      : "";
    lines.push(`${item.label || "背离"} | ${indicatorText}${referenceText}`);
    result.set(time, lines);
  });
  return result;
}

function buildChartDivergenceMarkersSafe(payload, riseColor, fallColor) {
  const items = Array.isArray(payload?.annotations?.divergences) ? payload.annotations.divergences : [];
  const bottomLabel = "\u5e95\u80cc\u79bb";
  const topLabel = "\u9876\u80cc\u79bb";
  return items
    .filter((item) => item?.time && Number.isFinite(Number(item?.price)))
    .map((item) => {
      const isBottom = String(item?.type || "").trim().toLowerCase() === "bottom";
      const markerColor = isBottom ? riseColor : fallColor;
      const label = item?.short_label || item?.label || (isBottom ? bottomLabel : topLabel);
      return {
        name: item?.label || (isBottom ? bottomLabel : topLabel),
        coord: [item.time, Number(item.price)],
        value: label,
        symbol: "triangle",
        symbolSize: 18,
        symbolRotate: isBottom ? 0 : 180,
        symbolOffset: [0, isBottom ? 12 : -12],
        itemStyle: {
          color: markerColor,
          borderColor: "rgba(244, 247, 250, 0.88)",
          borderWidth: 1,
          shadowBlur: 10,
          shadowColor: `${markerColor}66`,
        },
        label: {
          show: true,
          formatter: label,
          color: markerColor,
          fontSize: 10,
          fontWeight: 700,
          position: isBottom ? "bottom" : "top",
          distance: 4,
        },
        tooltipMeta: item,
      };
    });
}

function buildChartDivergenceTooltipMapSafe(payload) {
  const items = Array.isArray(payload?.annotations?.divergences) ? payload.annotations.divergences : [];
  const result = new Map();
  items.forEach((item) => {
    const time = String(item?.time || "").trim();
    if (!time) return;
    const lines = result.get(time) || [];
    const label = item?.label || "\u80cc\u79bb";
    const indicatorText = Number.isFinite(Number(item?.indicator))
      ? `DIF ${formatFixed(item.indicator, 2)}`
      : "DIF --";
    const referenceText = item?.reference_time
      ? ` | \u5bf9\u6bd4 ${formatTimestampLabel(item.reference_time, payload.timeframe, false)}`
      : "";
    lines.push(`${label} | ${indicatorText}${referenceText}`);
    result.set(time, lines);
  });
  return result;
}

function renderChart(payload) {
  if (!state.chart) {
    state.chart = echarts.init(document.getElementById("chart"));
    window.addEventListener("resize", () => state.chart && state.chart.resize());
  }

  const riseColor = "#d14f3f";
  const fallColor = "#14966b";
  const difColor = "#f6a21a";
  const deaColor = "#3f91ff";
  const kColor = "#f6a21a";
  const dColor = "#3f91ff";
  const jColor = "#d83bb0";
  const ma5Color = "#e1a84e";
  const ma20Color = "#58a6ff";
  const axisColor = "rgba(223, 231, 242, 0.74)";
  const splitColor = "rgba(148, 163, 184, 0.14)";
  const gridBorderColor = "rgba(148, 163, 184, 0.12)";
  const divergenceMarkers = buildChartDivergenceMarkersSafe(payload, riseColor, fallColor);
  const divergenceTooltipMap = buildChartDivergenceTooltipMapSafe(payload);

  state.chart.setOption(
    {
      animation: false,
      backgroundColor: "transparent",
      color: [riseColor, ma5Color, ma20Color, difColor, deaColor, kColor, dColor, jColor],
      legend: [],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: "rgba(6, 11, 18, 0.96)",
        borderColor: "rgba(148, 163, 184, 0.16)",
        borderWidth: 1,
        textStyle: { color: "#f4f7fa" },
        formatter: (params) => {
          const rows = Array.isArray(params) ? params : [params];
          if (rows.length === 0) return "";
          const lines = [`<div style="margin-bottom:6px;">${formatTimestampLabel(rows[0].axisValue, payload.timeframe, false)}</div>`];

          rows.forEach((item) => {
            if (item.seriesType === "candlestick" && Array.isArray(item.data)) {
              const [open, close, low, high] = item.data;
              lines.push(
                `${item.marker}${item.seriesName} 开 ${formatFixed(open, 3)} 收 ${formatFixed(close, 3)} 低 ${formatFixed(low, 3)} 高 ${formatFixed(high, 3)}`
              );
              return;
            }

            const rawValue = Array.isArray(item.value) ? item.value[item.value.length - 1] : item.value;
            lines.push(`${item.marker}${item.seriesName} ${formatTooltipValue(item.seriesName, rawValue)}`);
          });

          const divergenceLines = divergenceTooltipMap.get(String(rows[0].axisValue || "").trim()) || [];
          divergenceLines.forEach((line) => {
            lines.push(`• ${line}`);
          });

          return lines.join("<br/>");
        },
      },
      axisPointer: {
        link: [{ xAxisIndex: "all" }],
        label: {
          backgroundColor: "#17232e",
          color: "#f4f7fa",
          formatter: (params) => {
            if (params.axisDimension === "x") {
              return formatTimestampLabel(params.value, payload.timeframe, false);
            }
            return Number.isFinite(Number(params.value)) ? formatCompactNumber(params.value) : params.value;
          },
        },
      },
      grid: [
        {
          left: 56,
          right: 16,
          top: 48,
          height: "39%",
          show: true,
          backgroundColor: "rgba(10, 16, 24, 0.72)",
          borderColor: gridBorderColor,
          borderWidth: 1,
        },
        {
          left: 56,
          right: 16,
          top: "52.5%",
          height: "16.5%",
          show: true,
          backgroundColor: "rgba(18, 14, 18, 0.72)",
          borderColor: "rgba(209, 79, 63, 0.12)",
          borderWidth: 1,
        },
        {
          left: 56,
          right: 16,
          top: "75.5%",
          height: "11.5%",
          show: true,
          backgroundColor: "rgba(12, 16, 24, 0.74)",
          borderColor: "rgba(43, 120, 214, 0.12)",
          borderWidth: 1,
        },
      ],
      dataZoom: [
        { type: "inside", xAxisIndex: [0, 1, 2], start: 72, end: 100 },
        {
          type: "slider",
          xAxisIndex: [0, 1, 2],
          bottom: 8,
          height: 18,
          borderColor: "transparent",
          backgroundColor: "rgba(255, 255, 255, 0.06)",
          fillerColor: "rgba(43, 120, 214, 0.18)",
          handleSize: "110%",
        },
      ],
      xAxis: [
        {
          type: "category",
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: { show: false },
          axisTick: { show: false },
          min: "dataMin",
          max: "dataMax",
        },
        {
          type: "category",
          gridIndex: 1,
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: { show: false },
          axisTick: { show: false },
        },
        {
          type: "category",
          gridIndex: 2,
          data: payload.chart.timestamps,
          boundaryGap: true,
          axisLine: { lineStyle: { color: splitColor } },
          axisLabel: {
            color: axisColor,
            hideOverlap: true,
            formatter: (value) => formatTimestampLabel(value, payload.timeframe, true),
            margin: 14,
          },
          axisTick: { show: false },
        },
      ],
      yAxis: [
        {
          scale: true,
          splitNumber: 4,
          axisLine: { show: false },
          axisLabel: { color: axisColor, showMinLabel: false },
          splitLine: { lineStyle: { color: splitColor } },
        },
        {
          gridIndex: 1,
          scale: true,
          splitNumber: 3,
          axisLine: { show: false },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: splitColor } },
        },
        {
          gridIndex: 2,
          scale: true,
          splitNumber: 3,
          axisLine: { show: false },
          axisLabel: { color: axisColor },
          splitLine: { lineStyle: { color: splitColor } },
        },
      ],
      series: [
        {
          name: "K线",
          type: "candlestick",
          data: payload.chart.candles,
          itemStyle: {
            color: riseColor,
            color0: fallColor,
            borderColor: riseColor,
            borderColor0: fallColor,
          },
          markPoint: divergenceMarkers.length
            ? {
                data: divergenceMarkers,
                tooltip: {
                  formatter: (params) => {
                    const meta = params?.data?.tooltipMeta || {};
                    const parts = [meta.label || params.name || "背离"];
                    if (meta.time) {
                      parts.push(formatTimestampLabel(meta.time, payload.timeframe, false));
                    }
                    if (Number.isFinite(Number(meta.close))) {
                      parts.push(`收盘 ${formatFixed(meta.close, 3)}`);
                    }
                    if (Number.isFinite(Number(meta.indicator))) {
                      parts.push(`DIF ${formatFixed(meta.indicator, 2)}`);
                    }
                    return parts.join("<br/>");
                  },
                },
              }
            : undefined,
        },
        {
          name: `${payload.timeframe} MA5`,
          type: "line",
          data: payload.indicators.ma5,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 1.4, color: ma5Color },
        },
        {
          name: `${payload.timeframe} MA20`,
          type: "line",
          data: payload.indicators.ma20,
          showSymbol: false,
          smooth: true,
          lineStyle: { width: 1.4, color: ma20Color },
        },
        {
          name: "MACD Hist",
          type: "bar",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: payload.indicators.macd.hist,
          itemStyle: {
            color: (params) => (Number(params.value) >= 0 ? riseColor : fallColor),
          },
        },
        {
          name: "DIF",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: payload.indicators.macd.dif,
          showSymbol: false,
          lineStyle: { width: 1.4, color: difColor },
        },
        {
          name: "DEA",
          type: "line",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: payload.indicators.macd.dea,
          showSymbol: false,
          lineStyle: { width: 1.4, color: deaColor },
        },
        {
          name: "K",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: payload.indicators.kdj.k,
          showSymbol: false,
          lineStyle: { width: 1.4, color: kColor },
        },
        {
          name: "D",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: payload.indicators.kdj.d,
          showSymbol: false,
          lineStyle: { width: 1.4, color: dColor },
        },
        {
          name: "J",
          type: "line",
          xAxisIndex: 2,
          yAxisIndex: 2,
          data: payload.indicators.kdj.j,
          showSymbol: false,
          lineStyle: { width: 1.4, color: jColor },
        },
      ],
    },
    true
  );
}

async function openRulesModal() {
  try {
    const payload = await ensureRulesLoaded({ force: true });
    renderRulesModal(payload);
    if (state.webhookModalOpen) {
      closeWebhookModal();
    }
    setSignalDrawerOpen(false);
    state.rulesModalOpen = true;
    dom.rulesBackdrop.classList.remove("hidden");
    dom.rulesModal.classList.remove("hidden");
    dom.rulesModal.setAttribute("aria-hidden", "false");
  } catch (error) {
    console.error(error);
    setRefreshStatus(error.message || "规则说明加载失败");
  }
}

function closeRulesModal() {
  state.rulesModalOpen = false;
  dom.rulesBackdrop.classList.add("hidden");
  dom.rulesModal.classList.add("hidden");
  dom.rulesModal.setAttribute("aria-hidden", "true");
}

function setSignalDrawerOpen(nextOpen) {
  state.signalDrawerOpen = Boolean(nextOpen);
  dom.signalDrawer.classList.toggle("open", state.signalDrawerOpen);
  dom.signalDrawerBackdrop.classList.toggle("hidden", !state.signalDrawerOpen);
  dom.signalDrawer.setAttribute("aria-hidden", state.signalDrawerOpen ? "false" : "true");
  dom.signalDrawerToggle.setAttribute("aria-expanded", state.signalDrawerOpen ? "true" : "false");
  if (state.signalDrawerOpen) {
    refreshSignalDrawerData().catch((error) => {
      console.error(error);
      renderSignalDrawerFromWatchlist();
    });
  }
}

function scheduleWatchlistScrollRefresh() {
  if (!dom.watchlist) return;
  clearTimeout(state.watchlistScrollTimer);
  state.watchlistScrollTimer = window.setTimeout(() => {
    runDashboardPulse({ silent: true, forceWatchlistSignals: false, announce: false });
  }, 420);
}

function bindEvents() {
  dom.searchButton.addEventListener("click", () => {
    resolveAndLoadInput();
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!isSuggestionsOpen()) {
        fetchSuggestions(dom.searchInput.value).catch((error) => {
          console.error(error);
          hideSuggestions();
        });
      } else {
        setActiveSuggestionIndex(state.activeSuggestionIndex + 1);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp") {
      if (isSuggestionsOpen()) {
        setActiveSuggestionIndex(state.activeSuggestionIndex - 1);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      resolveAndLoadInput();
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  dom.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      fetchSuggestions(dom.searchInput.value).catch((error) => {
        console.error(error);
        hideSuggestions();
      });
    }, 220);
  });

  dom.searchInput.addEventListener("focus", () => {
    if (dom.searchInput.value.trim() && state.searchResults.length > 0) {
      renderSuggestions(state.searchResults);
    }
  });

  dom.groupNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      createGroup();
    }
  });

  document.addEventListener("click", (event) => {
    if (!dom.searchSuggestions.contains(event.target) && event.target !== dom.searchInput) {
      hideSuggestions();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.rulesModalOpen) {
      closeRulesModal();
      return;
    }
    if (state.signalDrawerOpen) {
      setSignalDrawerOpen(false);
    }
  });

  dom.watchlistButton.addEventListener("click", () => {
    toggleCurrentIntoWatchlist();
  });

  dom.groupCreateButton.addEventListener("click", () => {
    createGroup();
  });

  dom.groupDeleteButton.addEventListener("click", () => {
    deleteCurrentGroup();
  });

  dom.watchlistImportButton.addEventListener("click", () => {
    if (!dom.watchlistImportInput) {
      return;
    }
    if (typeof dom.watchlistImportInput.showPicker === "function") {
      dom.watchlistImportInput.showPicker();
      return;
    }
    dom.watchlistImportInput.click();
  });

  dom.watchlistImportInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    try {
      await handleWatchlistImport(file);
    } catch (error) {
      console.error(error);
      const message = error?.message || "XLSX import failed";
      setRefreshStatus(message);
      showToast({
        tone: "sell",
        title: "Watchlist import failed",
        body: message,
      });
    } finally {
      event.target.value = "";
    }
  });

  dom.watchlistSortSelect.addEventListener("change", () => {
    state.watchlistSortMode = normalizeWatchlistSortMode(dom.watchlistSortSelect.value);
    saveWatchlistSortPreference();
    renderWatchlist();
  });

  dom.sourceSelect.addEventListener("change", () => {
    state.source = dom.sourceSelect.value;
    saveSourcePreference();
    renderSourcePanels();
    loadMarket(state.symbol);
  });

  dom.strategySelect.addEventListener("change", () => {
    state.strategy = normalizeStrategyValue(dom.strategySelect.value);
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    state.rulesPayload = null;
    updateStrategyDeleteButtonState();
    saveStrategyPreference();
    renderWatchlist();
    renderStrategySignal(null);
    if (state.rulesModalOpen) {
      refreshRulesModal({ force: true });
    }
    startAutoRefresh();
  });

  if (dom.strategyDeleteButton) {
    dom.strategyDeleteButton.addEventListener("click", deleteSelectedCustomStrategy);
  }

  dom.timeframeButtons.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.timeframe = button.dataset.timeframe;
      setActiveTimeframeButton();
      loadMarket(state.symbol);
    });
  });

  dom.rulesButton.addEventListener("click", () => {
    openRulesModal();
  });

  dom.signalDrawerToggle.addEventListener("click", () => {
    setSignalDrawerOpen(!state.signalDrawerOpen);
  });

  dom.signalDrawerClose.addEventListener("click", () => {
    setSignalDrawerOpen(false);
  });

  dom.signalDrawerBackdrop.addEventListener("click", () => {
    setSignalDrawerOpen(false);
  });

  dom.rulesModalClose.addEventListener("click", () => {
    closeRulesModal();
  });

  dom.rulesBackdrop.addEventListener("click", () => {
    closeRulesModal();
  });

  if (dom.strategyConfigFormatButton) {
    dom.strategyConfigFormatButton.addEventListener("click", formatStrategyConfigEditor);
  }
  if (dom.strategyConfigHelpButton) {
    dom.strategyConfigHelpButton.addEventListener("click", () => {
      setStrategyConfigHelpOpen(!state.strategyConfigHelpOpen);
    });
  }
  if (dom.strategyConfigSaveButton) {
    dom.strategyConfigSaveButton.addEventListener("click", saveStrategyConfigOverride);
  }
  if (dom.strategyConfigResetButton) {
    dom.strategyConfigResetButton.addEventListener("click", resetStrategyConfigOverride);
  }
  if (dom.strategyConfigInput) {
    dom.strategyConfigInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveStrategyConfigOverride();
      }
    });
  }
}

function bindEvents() {
  dom.searchButton.addEventListener("click", () => {
    resolveAndLoadInput();
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!isSuggestionsOpen()) {
        fetchSuggestions(dom.searchInput.value).catch((error) => {
          console.error(error);
          hideSuggestions();
        });
      } else {
        setActiveSuggestionIndex(state.activeSuggestionIndex + 1);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp") {
      if (isSuggestionsOpen()) {
        setActiveSuggestionIndex(state.activeSuggestionIndex - 1);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      resolveAndLoadInput();
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  dom.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      fetchSuggestions(dom.searchInput.value).catch((error) => {
        console.error(error);
        hideSuggestions();
      });
    }, 220);
  });

  dom.searchInput.addEventListener("focus", () => {
    if (dom.searchInput.value.trim() && state.searchResults.length > 0) {
      renderSuggestions(state.searchResults);
    }
  });

  if (dom.webhookInput) {
    dom.webhookInput.addEventListener("input", () => {
      dom.webhookInput.classList.toggle("unsaved", dom.webhookInput.value.trim() !== state.webhookUrl);
    });
    dom.webhookInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitWebhookUrlPreference();
      }
    });
  }
  if (dom.webhookSaveButton) {
    dom.webhookSaveButton.addEventListener("click", commitWebhookUrlPreference);
  }
  if (dom.webhookTestButton) {
    dom.webhookTestButton.addEventListener("click", testWebhookConnection);
  }

  if (dom.watchlistSearchInput) {
    dom.watchlistSearchInput.addEventListener("input", () => {
      state.watchlistFilter = dom.watchlistSearchInput.value.trim();
      renderWatchlist();
    });
  }
  if (dom.watchlist) {
    dom.watchlist.addEventListener("scroll", scheduleWatchlistScrollRefresh, { passive: true });
  }

  document.addEventListener("click", (event) => {
    if (!dom.searchSuggestions.contains(event.target) && event.target !== dom.searchInput) {
      hideSuggestions();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.webhookModalOpen) {
      closeWebhookModal();
      return;
    }
    if (state.rulesModalOpen) {
      closeRulesModal();
      return;
    }
    if (state.signalDrawerOpen) {
      setSignalDrawerOpen(false);
    }
  });

  dom.watchlistButton.addEventListener("click", () => {
    toggleCurrentIntoWatchlist();
  });

  dom.watchlistImportButton.addEventListener("click", () => {
    if (!dom.watchlistImportInput) {
      return;
    }
    if (typeof dom.watchlistImportInput.showPicker === "function") {
      dom.watchlistImportInput.showPicker();
      return;
    }
    dom.watchlistImportInput.click();
  });

  dom.watchlistImportInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    try {
      await handleWatchlistImport(file);
    } catch (error) {
      console.error(error);
      const message = error?.message || "XLSX import failed";
      setRefreshStatus(message);
      showToast({
        tone: "sell",
        title: "Watchlist import failed",
        body: message,
      });
    } finally {
      event.target.value = "";
    }
  });

  dom.watchlistSortSelect.addEventListener("change", () => {
    state.watchlistSortMode = normalizeWatchlistSortMode(dom.watchlistSortSelect.value);
    saveWatchlistSortPreference();
    renderWatchlist();
  });

  dom.sourceSelect.addEventListener("change", () => {
    state.source = dom.sourceSelect.value;
    saveSourcePreference();
    renderSourcePanels();
    loadMarket(state.symbol);
  });

  dom.strategySelect.addEventListener("change", () => {
    state.strategy = normalizeStrategyValue(dom.strategySelect.value);
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    state.rulesPayload = null;
    updateStrategyDeleteButtonState(state.strategy);
    saveStrategyPreference();
    renderWatchlist();
    renderStrategySignal(null);
    if (state.rulesModalOpen) {
      refreshRulesModal({ force: true });
    }
    startAutoRefresh();
  });

  if (dom.strategyDeleteButton) {
    dom.strategyDeleteButton.addEventListener("click", deleteSelectedCustomStrategy);
  }

  dom.timeframeButtons.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.timeframe = button.dataset.timeframe;
      setActiveTimeframeButton();
      loadMarket(state.symbol);
    });
  });

  dom.rulesButton.addEventListener("click", () => {
    openRulesModal();
  });

  if (dom.webhookButton) {
    dom.webhookButton.addEventListener("click", () => {
      openWebhookModal();
    });
  }

  dom.signalDrawerToggle.addEventListener("click", () => {
    setSignalDrawerOpen(!state.signalDrawerOpen);
  });

  dom.signalDrawerClose.addEventListener("click", () => {
    setSignalDrawerOpen(false);
  });

  dom.signalDrawerBackdrop.addEventListener("click", () => {
    setSignalDrawerOpen(false);
  });

  dom.rulesModalClose.addEventListener("click", () => {
    closeRulesModal();
  });

  dom.rulesBackdrop.addEventListener("click", () => {
    closeRulesModal();
  });

  if (dom.webhookModalClose) {
    dom.webhookModalClose.addEventListener("click", () => {
      closeWebhookModal();
    });
  }
  if (dom.webhookBackdrop) {
    dom.webhookBackdrop.addEventListener("click", () => {
      closeWebhookModal();
    });
  }

  if (dom.customRuleSaveButton) {
    dom.customRuleSaveButton.addEventListener("click", submitCustomStrategyRule);
  }
  if (dom.customRuleInput) {
    dom.customRuleInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitCustomStrategyRule();
      }
    });
  }
}

function bindEvents() {
  dom.searchButton.addEventListener("click", () => {
    resolveAndLoadInput();
  });

  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      if (!isSuggestionsOpen()) {
        fetchSuggestions(dom.searchInput.value).catch((error) => {
          console.error(error);
          hideSuggestions();
        });
      } else {
        setActiveSuggestionIndex(state.activeSuggestionIndex + 1);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "ArrowUp") {
      if (isSuggestionsOpen()) {
        setActiveSuggestionIndex(state.activeSuggestionIndex - 1);
        event.preventDefault();
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      resolveAndLoadInput();
      return;
    }

    if (event.key === "Escape") {
      hideSuggestions();
    }
  });

  dom.searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
      fetchSuggestions(dom.searchInput.value).catch((error) => {
        console.error(error);
        hideSuggestions();
      });
    }, 220);
  });

  dom.searchInput.addEventListener("focus", () => {
    if (dom.searchInput.value.trim() && state.searchResults.length > 0) {
      renderSuggestions(state.searchResults);
    }
  });

  if (dom.webhookInput) {
    dom.webhookInput.addEventListener("input", () => {
      dom.webhookInput.classList.toggle("unsaved", dom.webhookInput.value.trim() !== state.webhookUrl);
    });
    dom.webhookInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitWebhookUrlPreference();
      }
    });
  }
  if (dom.webhookSaveButton) {
    dom.webhookSaveButton.addEventListener("click", commitWebhookUrlPreference);
  }
  if (dom.webhookTestButton) {
    dom.webhookTestButton.addEventListener("click", testWebhookConnection);
  }

  if (dom.watchlistSearchInput) {
    dom.watchlistSearchInput.addEventListener("input", () => {
      state.watchlistFilter = dom.watchlistSearchInput.value.trim();
      renderWatchlist();
    });
  }
  if (dom.watchlist) {
    dom.watchlist.addEventListener("scroll", scheduleWatchlistScrollRefresh, { passive: true });
  }

  document.addEventListener("click", (event) => {
    if (!dom.searchSuggestions.contains(event.target) && event.target !== dom.searchInput) {
      hideSuggestions();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.webhookModalOpen) {
      closeWebhookModal();
      return;
    }
    if (state.rulesModalOpen) {
      closeRulesModal();
      return;
    }
    if (state.signalDrawerOpen) {
      setSignalDrawerOpen(false);
    }
  });

  dom.watchlistButton.addEventListener("click", () => {
    toggleCurrentIntoWatchlist();
  });

  dom.watchlistImportButton.addEventListener("click", () => {
    if (!dom.watchlistImportInput) {
      return;
    }
    if (typeof dom.watchlistImportInput.showPicker === "function") {
      dom.watchlistImportInput.showPicker();
      return;
    }
    dom.watchlistImportInput.click();
  });

  dom.watchlistImportInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    try {
      await handleWatchlistImport(file);
    } catch (error) {
      console.error(error);
      const message = error?.message || "XLSX import failed";
      setRefreshStatus(message);
      showToast({
        tone: "sell",
        title: "Watchlist import failed",
        body: message,
      });
    } finally {
      event.target.value = "";
    }
  });

  dom.watchlistSortSelect.addEventListener("change", () => {
    state.watchlistSortMode = normalizeWatchlistSortMode(dom.watchlistSortSelect.value);
    saveWatchlistSortPreference();
    renderWatchlist();
  });

  dom.sourceSelect.addEventListener("change", () => {
    state.source = dom.sourceSelect.value;
    saveSourcePreference();
    renderSourcePanels();
    loadMarket(state.symbol);
  });

  dom.strategySelect.addEventListener("change", () => {
    state.strategy = normalizeStrategyValue(dom.strategySelect.value);
    state.strategySignal = null;
    state.watchlistStrategySignals = {};
    state.lastStrategyAlertKey = "";
    state.rulesPayload = null;
    saveStrategyPreference();
    renderWatchlist();
    renderStrategySignal(null);
    renderSignalDrawerFromWatchlist();
    if (state.rulesModalOpen) {
      refreshRulesModal({ force: true });
    }
    startAutoRefresh();
  });

  dom.timeframeButtons.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.timeframe = button.dataset.timeframe;
      setActiveTimeframeButton();
      loadMarket(state.symbol);
    });
  });

  dom.rulesButton.addEventListener("click", () => {
    openRulesModal();
  });

  if (dom.webhookButton) {
    dom.webhookButton.addEventListener("click", () => {
      openWebhookModal();
    });
  }

  dom.signalDrawerToggle.addEventListener("click", () => {
    setSignalDrawerOpen(!state.signalDrawerOpen);
  });

  dom.signalDrawerClose.addEventListener("click", () => {
    setSignalDrawerOpen(false);
  });

  dom.signalDrawerBackdrop.addEventListener("click", () => {
    setSignalDrawerOpen(false);
  });

  dom.rulesModalClose.addEventListener("click", () => {
    closeRulesModal();
  });

  dom.rulesBackdrop.addEventListener("click", () => {
    closeRulesModal();
  });

  if (dom.webhookModalClose) {
    dom.webhookModalClose.addEventListener("click", () => {
      closeWebhookModal();
    });
  }
  if (dom.webhookBackdrop) {
    dom.webhookBackdrop.addEventListener("click", () => {
      closeWebhookModal();
    });
  }

  if (dom.strategyConfigFormatButton) {
    dom.strategyConfigFormatButton.addEventListener("click", formatStrategyConfigEditor);
  }
  if (dom.strategyConfigHelpButton) {
    dom.strategyConfigHelpButton.addEventListener("click", () => {
      setStrategyConfigHelpOpen(!state.strategyConfigHelpOpen);
    });
  }
  if (dom.strategyConfigSaveButton) {
    dom.strategyConfigSaveButton.addEventListener("click", saveStrategyConfigOverride);
  }
  if (dom.strategyConfigResetButton) {
    dom.strategyConfigResetButton.addEventListener("click", resetStrategyConfigOverride);
  }
  if (dom.strategyConfigInput) {
    dom.strategyConfigInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveStrategyConfigOverride();
      }
    });
  }
}

async function sendWebhookAlert(payload, options = {}) {
  const { urlOverride = "", recordType = "signal", quietStatus = false } = options;
  const targetUrl = String(urlOverride || state.webhookUrl || "").trim();
  if (!targetUrl) {
    return { ok: false, error: "Please provide a WebHook URL first.", skipped: true };
  }

  try {
    const response = await fetch("/api/webhook-alert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        payload,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (result?.runtime && typeof result.runtime === "object") {
      applyAlertRuntimePayload(result.runtime);
    }
    if (!response.ok) {
      if (!result?.runtime) {
        appendWebhookLogEntry({
          ok: false,
          type: recordType,
          signal: payload.signal || "TEST",
          symbol: payload.symbol || "",
          name: payload.name || payload.reason || "",
          strategyLabel: payload.strategy_label || payload.strategy || "",
          responseStatus: result.status || null,
          message: (result.error || "Webhook send failed").toString().slice(0, 80),
          reason: payload.reason || "",
        });
      }
      throw new Error(result.error || "Webhook send failed");
    }

    if (!result?.runtime) {
      appendWebhookLogEntry({
        ok: true,
        type: recordType,
        signal: payload.signal || "TEST",
        symbol: payload.symbol || "",
        name: payload.name || payload.reason || "",
        strategyLabel: payload.strategy_label || payload.strategy || "",
        responseStatus: result.status || response.status,
        message: (result.body || "Sent").toString().slice(0, 80),
        reason: payload.reason || "",
      });
    }

    if (!quietStatus) {
      setRefreshStatus(`WebHook sent | ${String(payload.symbol || "test").toUpperCase()} ${payload.signal}`);
    }
    if (state.webhookModalOpen) {
      renderWebhookPanel({ syncInput: true });
    }
    return {
      ok: true,
      status: result.status || response.status,
      body: result.body || "",
      runtime: result.runtime || null,
    };
  } catch (error) {
    console.error(error);
    if (!quietStatus) {
      setRefreshStatus(error.message || "Webhook send failed");
    }
    return { ok: false, error: error.message || "Webhook send failed" };
  }
}

async function init() {
  bindEvents();
  await loadAlertRuntimeState();
  renderWatchlist();
  renderWebhookPanel({ syncInput: true });
  setActiveTimeframeButton();
  setSignalDrawerOpen(false);
  renderSourcePanels();
  await loadSources();
  await loadStrategies();
  await loadMarket(state.symbol);
  scheduleChartResize();
  startAutoRefresh({ immediate: false });
}

init();
