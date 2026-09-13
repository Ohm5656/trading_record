export const assets = ['XAUUSD', 'BTCUSD']

export const marketProfiles = {
  XAUUSD: {
    source: 'Yahoo Finance gold futures proxy',
    chartSource: 'Yahoo Finance GC=F futures proxy',
    sizeLabel: 'lots',
    contractSize: 100,
    pricePrecision: 2,
  },
  BTCUSD: {
    source: 'Binance spot BTCUSDT',
    chartSource: 'Binance spot BTCUSDT',
    sizeLabel: 'BTC',
    contractSize: 1,
    pricePrecision: 2,
  },
}

export const chartTimeframes = [
  { id: '1m', label: '1m', binanceInterval: '1m', yahooInterval: '1m', yahooRange: '1d' },
  { id: '5m', label: '5m', binanceInterval: '5m', yahooInterval: '5m', yahooRange: '5d' },
  { id: '15m', label: '15m', binanceInterval: '15m', yahooInterval: '15m', yahooRange: '5d' },
  { id: '1h', label: '1h', binanceInterval: '1h', yahooInterval: '60m', yahooRange: '1mo' },
]

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

async function fetchJson(url, errorMessage, fetcher) {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(errorMessage)
  return response.json()
}

function normalizeBinanceCandles(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => ({
      time: Math.floor(Number(row[0]) / 1000),
      open: positiveNumber(row[1]),
      high: positiveNumber(row[2]),
      low: positiveNumber(row[3]),
      close: positiveNumber(row[4]),
    }))
    .filter((candle) => Number.isFinite(candle.time) && candle.open && candle.high && candle.low && candle.close)
}

function normalizeYahooCandles(result) {
  const timestamps = result?.timestamp || []
  const quote = result?.indicators?.quote?.[0] || {}
  return timestamps
    .map((time, index) => ({
      time: Number(time),
      open: positiveNumber(quote.open?.[index]),
      high: positiveNumber(quote.high?.[index]),
      low: positiveNumber(quote.low?.[index]),
      close: positiveNumber(quote.close?.[index]),
    }))
    .filter((candle) => Number.isFinite(candle.time) && candle.open && candle.high && candle.low && candle.close)
}

export async function fetchMarketPrice(symbol, fetcher = fetch) {
  if (symbol === 'BTCUSD') {
    const data = await fetchJson(
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      'BTC price request failed',
      fetcher,
    )
    const price = positiveNumber(data.price)
    if (!price) throw new Error('BTC price was invalid')
    return { price, source: marketProfiles.BTCUSD.source, at: new Date().toISOString() }
  }

  if (symbol === 'XAUUSD') {
    const data = await fetchJson(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d',
      'Gold price request failed',
      fetcher,
    )
    const result = data.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]?.close || []
    const lastClose = [...quote].reverse().find((value) => positiveNumber(value))
    const price = positiveNumber(result?.meta?.regularMarketPrice) || positiveNumber(lastClose)
    if (!price) throw new Error('Gold price was invalid')
    return { price, source: marketProfiles.XAUUSD.source, at: new Date().toISOString() }
  }

  throw new Error('Unsupported market')
}

export async function fetchMarketCandles(symbol, timeframe = '5m', fetcher = fetch) {
  const profile = marketProfiles[symbol]
  const interval = chartTimeframes.find((item) => item.id === timeframe)
  if (!profile) throw new Error('Unsupported market')
  if (!interval) throw new Error('Unsupported timeframe')

  let candles
  if (symbol === 'BTCUSD') {
    const query = new URLSearchParams({ symbol: 'BTCUSDT', interval: interval.binanceInterval, limit: '500' })
    const data = await fetchJson(
      `https://api.binance.com/api/v3/klines?${query}`,
      'BTC chart request failed',
      fetcher,
    )
    candles = normalizeBinanceCandles(data)
  } else {
    const query = new URLSearchParams({ interval: interval.yahooInterval, range: interval.yahooRange })
    const data = await fetchJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?${query}`,
      'Gold chart request failed',
      fetcher,
    )
    candles = normalizeYahooCandles(data.chart?.result?.[0])
  }

  if (candles.length < 2) throw new Error(`${symbol} chart data was unavailable`)
  return {
    candles,
    source: profile.chartSource,
    at: new Date().toISOString(),
  }
}
