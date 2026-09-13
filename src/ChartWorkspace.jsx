import { useEffect, useRef, useState } from 'react'
import { CandlestickSeries, ColorType, CrosshairMode, LineStyle, createChart } from 'lightweight-charts'
import { ArrowDownRight, ArrowUpRight, RefreshCw, Target, Trash2, WifiOff } from 'lucide-react'
import { assets, chartTimeframes, fetchMarketCandles, marketProfiles } from './marketData.js'

function formatPrice(value, precision = 2) {
  if (!Number.isFinite(Number(value))) return '--'
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
}

function roundedPrice(value, precision) {
  return Number(Number(value).toFixed(precision))
}

function averageTrueRange(candles, period = 14) {
  if (candles.length < 2) return 0
  const ranges = candles.slice(-period).map((candle, index, sample) => {
    const previousClose = index > 0 ? sample[index - 1].close : candle.open
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    )
  })
  return ranges.reduce((total, value) => total + value, 0) / ranges.length
}

function createDraft(side, entryPrice, candles, precision) {
  const minimumDistance = entryPrice * 0.001
  const riskDistance = Math.max(averageTrueRange(candles) * 1.25, minimumDistance)
  const direction = side === 'short' ? -1 : 1
  return {
    side,
    entryPrice: roundedPrice(entryPrice, precision),
    tpPrice: roundedPrice(entryPrice + direction * riskDistance * 2, precision),
    slPrice: roundedPrice(entryPrice - direction * riskDistance, precision),
  }
}

function validateDraft(draft) {
  if (!draft) return ''
  const entry = Number(draft.entryPrice)
  const tp = Number(draft.tpPrice)
  const sl = Number(draft.slPrice)
  if (![entry, tp, sl].every((value) => Number.isFinite(value) && value > 0)) return 'Enter valid positive prices.'
  if (draft.side === 'long' && (tp <= entry || sl >= entry)) return 'Long plans need TP above Entry and SL below Entry.'
  if (draft.side === 'short' && (tp >= entry || sl <= entry)) return 'Short plans need TP below Entry and SL above Entry.'
  return ''
}

function CandleChart({ candles, symbol, activeTool, draft, onHover, onEntrySelect }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const priceLinesRef = useRef([])
  const activeToolRef = useRef(activeTool)
  const onHoverRef = useRef(onHover)
  const onEntrySelectRef = useRef(onEntrySelect)
  const [zone, setZone] = useState(null)

  activeToolRef.current = activeTool
  onHoverRef.current = onHover
  onEntrySelectRef.current = onEntrySelect

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
    const updateZone = () => {
      const currentSeries = seriesRef.current
      const currentDraft = currentSeries?.planDraft
      if (!currentSeries || !currentDraft) {
        setZone(null)
        return
      }
      const entryY = currentSeries.priceToCoordinate(Number(currentDraft.entryPrice))
      const tpY = currentSeries.priceToCoordinate(Number(currentDraft.tpPrice))
      const slY = currentSeries.priceToCoordinate(Number(currentDraft.slPrice))
      if ([entryY, tpY, slY].some((value) => value === null)) {
        setZone(null)
        return
      }
      setZone({ entryY, tpY, slY })
    }
    chartRef.current = chart
    seriesRef.current = series
    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        chart.resize(width, height)
        window.requestAnimationFrame(updateZone)
      }
    })
    resizeObserver.observe(container)
    chart.subscribeCrosshairMove((event) => {
      const candle = event.seriesData.get(series)
      onHoverRef.current(candle || null)
    })
    chart.subscribeClick((event) => {
      if (!activeToolRef.current || !event.point) return
      const price = series.coordinateToPrice(event.point.y)
      if (Number.isFinite(price) && price > 0) onEntrySelectRef.current(Number(price))
    })
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateZone)

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

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    priceLinesRef.current.forEach((line) => series.removePriceLine(line))
    priceLinesRef.current = []
    series.planDraft = draft
    if (!draft) {
      setZone(null)
      return
    }
    const lines = [
      { price: Number(draft.entryPrice), color: '#d8e4dd', title: 'ENTRY', lineStyle: LineStyle.Dashed },
      { price: Number(draft.tpPrice), color: '#43d17d', title: 'TP', lineStyle: LineStyle.Dashed },
      { price: Number(draft.slPrice), color: '#f06464', title: 'SL', lineStyle: LineStyle.Dashed },
    ]
    priceLinesRef.current = lines
      .filter((line) => Number.isFinite(line.price) && line.price > 0)
      .map((line) => series.createPriceLine({ ...line, lineWidth: 1, axisLabelVisible: true }))
    window.requestAnimationFrame(() => {
      const entryY = series.priceToCoordinate(Number(draft.entryPrice))
      const tpY = series.priceToCoordinate(Number(draft.tpPrice))
      const slY = series.priceToCoordinate(Number(draft.slPrice))
      if (![entryY, tpY, slY].some((value) => value === null)) setZone({ entryY, tpY, slY })
    })
  }, [draft])

  const rewardTop = zone ? Math.min(zone.entryY, zone.tpY) : 0
  const riskTop = zone ? Math.min(zone.entryY, zone.slY) : 0

  return (
    <div className={`market-chart-wrap ${activeTool ? 'placing-entry' : ''}`}>
      <div className="market-chart" ref={containerRef} aria-label={`${symbol} candlestick chart`} />
      {zone && (
        <div className="position-zone" aria-hidden="true">
          <span className="reward-zone" style={{ top: rewardTop, height: Math.abs(zone.entryY - zone.tpY) }} />
          <span className="risk-zone" style={{ top: riskTop, height: Math.abs(zone.entryY - zone.slY) }} />
        </div>
      )}
      {activeTool && <span className={`entry-cursor-state ${activeTool}`}>ENTRY</span>}
    </div>
  )
}

export default function ChartWorkspace({ online, marketPrices }) {
  const [symbol, setSymbol] = useState('XAUUSD')
  const [timeframe, setTimeframe] = useState('5m')
  const [chartData, setChartData] = useState({ candles: [], source: '', at: '' })
  const [status, setStatus] = useState({ state: 'loading', message: 'Loading chart' })
  const [hoveredCandle, setHoveredCandle] = useState(null)
  const [activeTool, setActiveTool] = useState(null)
  const [draft, setDraft] = useState(null)
  const requestRef = useRef(0)
  const precision = marketProfiles[symbol]?.pricePrecision || 2
  const latestCandle = chartData.candles.at(-1)
  const inspectedCandle = hoveredCandle || latestCandle
  const livePrice = Number(marketPrices[symbol]?.price) || latestCandle?.close
  const draftError = validateDraft(draft)
  const risk = draft ? Math.abs(Number(draft.entryPrice) - Number(draft.slPrice)) : 0
  const reward = draft ? Math.abs(Number(draft.tpPrice) - Number(draft.entryPrice)) : 0
  const ratio = risk > 0 && reward > 0 ? reward / risk : 0

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
      setActiveTool(null)
      setDraft(null)
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

  const chooseTool = (side) => {
    setDraft(null)
    setActiveTool((current) => current === side ? null : side)
  }

  const placeEntry = (price) => {
    if (!activeTool) return
    setDraft(createDraft(activeTool, price, chartData.candles, precision))
    setActiveTool(null)
  }

  const changeDraftPrice = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

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

      <div className="analysis-layout">
        <div className="chart-workbench">
          <div className="position-toolbar" aria-label="Position tools">
            <span>POSITION</span>
            <button type="button" className={activeTool === 'long' ? 'active long' : ''} onClick={() => chooseTool('long')}>
              <ArrowUpRight size={16} /> Long
            </button>
            <button type="button" className={activeTool === 'short' ? 'active short' : ''} onClick={() => chooseTool('short')}>
              <ArrowDownRight size={16} /> Short
            </button>
          </div>
          <div className="ohlc-strip" aria-live="polite">
            <span>O <strong>{formatPrice(inspectedCandle?.open, precision)}</strong></span>
            <span>H <strong>{formatPrice(inspectedCandle?.high, precision)}</strong></span>
            <span>L <strong>{formatPrice(inspectedCandle?.low, precision)}</strong></span>
            <span>C <strong>{formatPrice(inspectedCandle?.close, precision)}</strong></span>
          </div>
          <div className="chart-stage">
            <CandleChart
              candles={chartData.candles}
              symbol={symbol}
              activeTool={activeTool}
              draft={draft}
              onHover={setHoveredCandle}
              onEntrySelect={placeEntry}
            />
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

        <aside className={`plan-draft-panel ${draft?.side || ''}`}>
          <header>
            <div>
              <span>TRADE PLAN</span>
              <h2>{draft ? `${draft.side === 'long' ? 'Long' : 'Short'} draft` : activeTool ? `${activeTool === 'long' ? 'Long' : 'Short'} entry` : 'No draft'}</h2>
            </div>
            {(draft || activeTool) && (
              <button className="icon-button" type="button" onClick={() => { setDraft(null); setActiveTool(null) }} aria-label="Clear plan" title="Clear plan">
                <Trash2 size={16} />
              </button>
            )}
          </header>

          {!draft ? (
            <div className="plan-empty">
              <Target size={24} />
              <strong>{activeTool ? 'Select entry on chart' : 'Choose Long or Short'}</strong>
              <span>{activeTool ? symbol : 'Draft stays outside your journal.'}</span>
            </div>
          ) : (
            <div className="plan-fields">
              <label>
                Entry
                <input aria-label="Plan entry price" type="number" min="0" step={10 ** -precision} value={draft.entryPrice} onChange={(event) => changeDraftPrice('entryPrice', event.target.value)} />
              </label>
              <label>
                Take profit
                <input aria-label="Plan take profit" type="number" min="0" step={10 ** -precision} value={draft.tpPrice} onChange={(event) => changeDraftPrice('tpPrice', event.target.value)} />
              </label>
              <label>
                Stop loss
                <input aria-label="Plan stop loss" type="number" min="0" step={10 ** -precision} value={draft.slPrice} onChange={(event) => changeDraftPrice('slPrice', event.target.value)} />
              </label>
              <div className="plan-measures">
                <span>RISK<strong>{formatPrice(risk, precision)}</strong></span>
                <span>TARGET<strong>{formatPrice(reward, precision)}</strong></span>
                <span>R:R<strong>{ratio ? `${ratio.toFixed(2)}R` : '--'}</strong></span>
              </div>
              {draftError && <p className="plan-error" role="alert">{draftError}</p>}
              <div className="draft-state"><i /> Draft only - not in journal</div>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
