# Market Signal Tool

这是一个本地可运行的小型看盘项目，包含两部分：

- 命令行信号工具
- 可视化前端页面

当前默认支持 A 股/指数代码，例如 `sh600519`、`sh000001`、`sh000300`。

## 前端页面

页面能力：

- 证券代码 / 名称查询
- 自选栏
- 实时刷新 K 线图
- MACD 图形
- KDJ 图形
- 当前规则命中状态

启动方式：

```bash
python app.py
```

然后打开：

```text
http://127.0.0.1:8000
```

如果你的环境没有 Flask：

```bash
pip install -r requirements.txt
```

## 命令行工具

直接输出策略信号：

```bash
python market_signal_tool.py --config config.example.json
```

只分析某几个代码：

```bash
python market_signal_tool.py --config config.example.json --symbols sh600519,sh000001
```

输出 JSON：

```bash
python market_signal_tool.py --config config.example.json --output json
```

每 60 秒刷新一次：

```bash
python market_signal_tool.py --config config.example.json --watch 60
```

## 当前版本能力

- 支持 `sh` / `sz` 代码
- 支持大盘指数和个股
- 支持周期：`1m`、`5m`、`15m`、`30m`、`60m`、`1d`、`1w`、`1M`
- 支持指标：
  - `sma`
  - `ema`
  - `rsi`
  - `macd`
  - `bollinger`
  - `atr`
- 支持通过 JSON 配置买入/卖出规则

## 重要说明

- 这里使用的是公开网络行情接口，不是交易所授权低延迟专线。
- 它适合看盘、策略验证、提醒和研究，不适合高频交易或强合规场景。
- `1d` 周期在盘中会随着当日未收盘数据变化，信号可能在收盘前后发生变化。

## 规则写法

规则本质上是表达式。只要表达式结果为 `true`，就视为命中。

可直接使用这些字段：

- `open`
- `close`
- `high`
- `low`
- `volume`
- `amount`

以及它们的上一根值：

- `prev_open`
- `prev_close`
- `prev_high`
- `prev_low`
- `prev_volume`
- `prev_amount`

指标变量命名规则：

- 普通指标直接用名字，例如 `ma5`、`rsi14`
- 同时会自动生成上一根值，例如 `prev_ma5`、`prev_rsi14`
- `macd` 会生成：
  - `macd`
  - `macd_signal`
  - `macd_hist`
- `bollinger` 名称如果写成 `boll`，会生成：
  - `boll_upper`
  - `boll_mid`
  - `boll_lower`

内置辅助函数：

- `cross_over("ma5", "ma20")`
- `cross_under("ma5", "ma20")`

示例：

```json
{
  "buy": [
    "cross_over(\"ma5\", \"ma20\")",
    "rsi14 is not None and rsi14 < 70",
    "close > boll_mid"
  ],
  "sell": [
    "cross_under(\"ma5\", \"ma20\")",
    "rsi14 is not None and rsi14 > 80"
  ]
}
```


