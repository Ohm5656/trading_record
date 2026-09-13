import { useEffect, useRef, useState } from 'react'
import { CandlestickSeries, ColorType, CrosshairMode, createChart } from 'lightweight-charts'
import { RefreshCw, WifiOff } from 'lucide-react'
import { assets, chartTimeframes, fetchMarketCandles, marketProfiles } from './marketData.js'

function formatPrice(value, precision = 2) {
  if (!Number.isFinite(Number(value))) return '--'
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
}

function CandleChart({ candles, symbol, onHover }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return undefined
    const container = containerRef.current
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#09110d' },
        textColor: '#7f9188',
        fontFamily: '"DM Mono", monospace',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(74, 101, 88, 0.16)' },
        horzLines: { color: 'rgba(74, 101, 88, 0.16)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#71877c', width: 1, labelBackgroundColor: '#263a30' },
        horzLine: { color: '#71877c', width: 1, labelBackgroundColor: '#263a30' },
      },
      rightPriceScale: {
        borderColor: '#263a30',
        scaleMargins: { top: 0.12, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#263a30',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 3,
      },
      handleScroll: true,
      handleScale: true,
      localization: { locale: 'en-US' },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#43d17d',
      downColor: '#f06464',
      borderVisible: false,
      wickUpColor: '#43d17d',
      wickDownColor: '#f06464',
      priceLineColor: '#d8e4dd',
      priceLineWidth: 1,
    })
    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) chart.resize(width, height)
    })
    resizeObserver.observe(container)
    chart.subscribeCrosshairMove((event) => {
      const candle = event.seriesData.get(series)
      onHover(candle || null)
    })
    chartRef.current = chart
    seriesRef.current = series

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [onHover])

  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    if (!series || !chart || !candles.length) return
    const precision = marketProfiles[symbol]?.pricePrecision || 2
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove: 10 ** -precision } })
    series.setData(candles)
    chart.timeScale().fitContent()
  }, [candles, symbol])

  return <div className="market-chart" ref={containerRef} aria-label={`${symbol} candlestick chart`} />
}

export default function ChartWorkspace({ online, marketPrices }) {
  const [symbol, setSymbol] = useState('XAUUSD')
  const [timeframe, setTimeframe] = useState('5m')
  const [chartData, setChartData] = useState({ candles: [], source: '', at: '' })
  const [status, setStatus] = useState({ state: 'loading', message: 'Loading chart' })
  const [hoveredCandle, setHoveredCandle] = useState(null)
  const requestRef = useRef(0)
  const precision = marketProfiles[symbol]?.pricePrecision || 2
  const latestCandle = chartData.candles.at(-1)
  const inspectedCandle = hoveredCandle || latestCandle
  const livePrice = Number(marketPrices[symbol]?.price) || latestCandle?.close

  async function loadChart() {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    if (!navigator.onLine) {
      setStatus({ state: 'offline', message: 'Reconnect to load market history' })
      return
    }
    setStatus({ state: 'loading', message: 'Loading market history' })
    try {
      const next = await fetchMarketCandles(symbol, timeframe)
      if (requestRef.current !== requestId) return
      setChartData(next)
      setHoveredCandle(null)
      setStatus({ state: 'ready', message: 'Chart ready' })
    } catch (error) {
      if (requestRef.current !== requestId) return
      setChartData({ candles: [], source: '', at: '' })
      setStatus({ state: 'error', message: error.message || 'Chart data is unavailable' })
    }
  }

  useEffect(() => {
    loadChart()
  }, [symbol, timeframe, online])

  return (
    <section className="analysis-workspace-page">
      <header className="analysis-page-heading">
        <div>
          <span className="section-kicker">MARKET WORKSPACE</span>
          <h1>Analyze before you trade.</h1>
          <p>Read price action first. A trade starts only after a plan is confirmed.</p>
        </div>
        <div className="market-quote" aria-live="polite">
          <span>{symbol}</span>
          <strong>{formatPrice(livePrice, precision)}</strong>
          <small>{marketProfiles[symbol].source}</small>
        </div>
      </header>

      <div className="analysis-controls">
        <div className="market-tabs" role="tablist" aria-label="Market">
          {assets.map((asset) => (
            <button
              type="button"
              role="tab"
              aria-selected={symbol === asset}
              className={symbol === asset ? 'active' : ''}
              key={asset}
              onClick={() => setSymbol(asset)}
            >
              {asset}
            </button>
          ))}
        </div>
        <div className="timeframe-tabs" role="tablist" aria-label="Timeframe">
          {chartTimeframes.map((option) => (
            <button
              type="button"
              role="tab"
              aria-selected={timeframe === option.id}
              className={timeframe === option.id ? 'active' : ''}
              key={option.id}
              onClick={() => setTimeframe(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button className="icon-button chart-refresh" type="button" onClick={loadChart} aria-label="Refresh chart" title="Refresh chart">
          <RefreshCw size={17} />
        </button>
      </div>

      <div className="chart-workbench">
        <div className="ohlc-strip" aria-live="polite">
          <span>O <strong>{formatPrice(inspectedCandle?.open, precision)}</strong></span>
          <span>H <strong>{formatPrice(inspectedCandle?.high, precision)}</strong></span>
          <span>L <strong>{formatPrice(inspectedCandle?.low, precision)}</strong></span>
          <span>C <strong>{formatPrice(inspectedCandle?.close, precision)}</strong></span>
        </div>
        <div className="chart-stage">
          <CandleChart candles={chartData.candles} symbol={symbol} onHover={setHoveredCandle} />
          {status.state !== 'ready' && (
            <div className={`chart-state ${status.state}`}>
              {status.state === 'offline' && <WifiOff size={22} />}
              <strong>{status.message}</strong>
              {(status.state === 'error' || status.state === 'offline') && (
                <button className="secondary-button" type="button" onClick={loadChart}>Try again</button>
              )}
            </div>
          )}
        </div>
        <footer className="chart-attribution">
          <span>{chartData.source || marketProfiles[symbol].chartSource}</span>
          <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">Charts by TradingView</a>
        </footer>
      </div>
    </section>
  )
}
