import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  Eye,
  EyeOff,
  Hash,
  ImagePlus,
  LineChart,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  Smartphone,
  Target,
  Trash2,
  Upload,
  UserRound,
  WalletCards,
  WifiOff,
  X,
} from 'lucide-react'
import {
  clearAllData,
  defaults,
  getCurrentUser,
  getSettings,
  getTrades,
  loginUser,
  logoutUser,
  registerUser,
  removeTrade,
  replaceAllData,
  saveSettings,
  saveTrade,
} from './db.js'

const locale = 'en-US'
const viewOptions = [
  { id: 'day', label: 'Day' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
  { id: 'all', label: 'All time' },
]
const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const currencies = ['USD', 'THB', 'EUR', 'GBP', 'JPY', 'SGD']
const assets = ['XAUUSD', 'BTCUSD']
const activeSides = ['long', 'short']
const marketProfiles = {
  XAUUSD: {
    source: 'Yahoo Finance gold futures proxy',
    sizeLabel: 'lots',
    contractSize: 100,
  },
  BTCUSD: {
    source: 'Binance spot BTCUSDT',
    sizeLabel: 'BTC',
    contractSize: 1,
  },
}

function dateKey(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function fromDateKey(value) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

function nowTime() {
  return new Date().toTimeString().slice(0, 5)
}

function marketPriceFor(symbol, marketPrices = {}) {
  const price = Number(marketPrices[symbol]?.price)
  return Number.isFinite(price) && price > 0 ? price : null
}

function tradePrice(trade, marketPrices = {}) {
  const exit = Number(trade.exitPrice)
  if (trade.status === 'closed' && Number.isFinite(exit) && exit > 0) return exit
  const live = marketPriceFor(trade.symbol, marketPrices)
  if (live) return live
  const current = Number(trade.currentPrice)
  if (Number.isFinite(current) && current > 0) return current
  const entry = Number(trade.entryPrice)
  return Number.isFinite(entry) && entry > 0 ? entry : 0
}

function calculatedPnl(trade, price) {
  const entry = Number(trade.entryPrice)
  const size = Number(trade.positionSize)
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(size) || size <= 0 || !Number.isFinite(price) || price <= 0) return 0
  const profile = marketProfiles[trade.symbol] || { contractSize: 1 }
  const direction = trade.side === 'short' ? -1 : 1
  return (price - entry) * direction * size * profile.contractSize
}

function pnlOf(trade, marketPrices = {}) {
  if (trade.side === 'withdrawal') return 0
  if (activeSides.includes(trade.side)) return calculatedPnl(trade, tradePrice(trade, marketPrices))
  return trade.side === 'loss' ? -Math.abs(Number(trade.amount)) : Math.abs(Number(trade.amount))
}

function isWithdrawal(record) {
  return record.side === 'withdrawal'
}

function isTradingRecord(record) {
  return !isWithdrawal(record)
}

function isOpenTrade(record) {
  return activeSides.includes(record.side) && record.status !== 'closed'
}

function monthKey(value) {
  return value.slice(0, 7)
}

function dailyStopLossFor(settings, date) {
  return Math.max(0, Number(settings.dailyStopLossByMonth?.[monthKey(date)]) || 0)
}

function dailyTradeLimitFor(settings) {
  return Math.max(0, Math.floor(Number(settings.dailyTradeLimit) || 0))
}

function dailyTradeCount(trades, date) {
  return trades.filter((trade) => trade.date === date && isTradingRecord(trade)).length
}

function isDailyStopLossReached(trades, settings, date, marketPrices) {
  const limit = dailyStopLossFor(settings, date)
  return limit > 0 && totalPnl(trades.filter((trade) => trade.date === date), marketPrices) <= -limit
}

function isDailyTradeLimitReached(trades, settings, date) {
  const limit = dailyTradeLimitFor(settings)
  return limit > 0 && dailyTradeCount(trades, date) >= limit
}

function dailyTradingLockReason(trades, settings, date, marketPrices) {
  if (isDailyStopLossReached(trades, settings, date, marketPrices)) {
    return {
      type: 'loss',
      title: 'Daily loss limit reached',
      message: `Loss reached ${formatMoney(dailyStopLossFor(settings, date), settings.currency)}. Do not trade again today.`,
      notification: 'Daily loss limit reached. Trading is locked for this day.',
    }
  }
  if (isDailyTradeLimitReached(trades, settings, date)) {
    const limit = dailyTradeLimitFor(settings)
    return {
      type: 'trades',
      title: 'Daily trade limit reached',
      message: `${limit} ${limit === 1 ? 'trade' : 'trades'} recorded today. Do not trade again today.`,
      notification: 'Daily trade limit reached. Trading is locked for this day.',
    }
  }
  return null
}

function isWithinDailyLossBudget(trades, settings, date, marketPrices) {
  const tradingRecords = trades.filter((trade) => trade.date === date && isTradingRecord(trade))
  if (!tradingRecords.length) return true
  const limit = dailyStopLossFor(settings, date)
  const pnl = totalPnl(tradingRecords, marketPrices)
  return limit > 0 ? pnl >= -limit : pnl >= 0
}

function totalPnl(trades, marketPrices = {}) {
  return trades.reduce((total, trade) => total + pnlOf(trade, marketPrices), 0)
}

function targetPnl(trade, key) {
  const price = Number(trade[key])
  return calculatedPnl(trade, price)
}

function riskReward(trade) {
  const reward = Math.abs(targetPnl(trade, 'tpPrice'))
  const risk = Math.abs(targetPnl(trade, 'slPrice'))
  if (!reward || !risk) return '—'
  return `${(reward / risk).toFixed(2)}R`
}

function formatMoney(value, currency, signed = false) {
  const absolute = Math.abs(Number(value) || 0)
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'JPY' ? 0 : 2,
    maximumFractionDigits: currency === 'JPY' ? 0 : 2,
  }).format(absolute)
  if (value < 0) return `−${formatted}`
  if (signed && value > 0) return `+${formatted}`
  return formatted
}

function formatCompactMoney(value, currency) {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: Math.abs(value) < 1000 ? 0 : 1,
  }).format(Math.abs(Number(value) || 0))
  if (value < 0) return `−${formatted}`
  if (value > 0) return `+${formatted}`
  return formatted
}

function formatPeriod(date, mode) {
  if (mode === 'day') {
    return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(date)
  }
  if (mode === 'month') {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date)
  }
  return String(date.getFullYear())
}

function moveDate(date, mode, amount) {
  const result = new Date(date)
  if (mode === 'day') result.setDate(result.getDate() + amount)
  else if (mode === 'month') result.setMonth(result.getMonth() + amount)
  else result.setFullYear(result.getFullYear() + amount)
  return result
}

function monthCells(date, showWeekends) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const days = new Date(year, month + 1, 0).getDate()
  const values = []

  for (let day = 1; day <= days; day += 1) {
    const current = new Date(year, month, day, 12)
    const weekday = current.getDay()
    if (!showWeekends && (weekday === 0 || weekday === 6)) continue
    if (values.length === 0) {
      const offset = showWeekends ? (weekday + 6) % 7 : weekday - 1
      for (let index = 0; index < offset; index += 1) values.push(null)
    }
    values.push(current)
  }
  return values
}

function safeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function fetchMarketPrice(symbol) {
  if (symbol === 'BTCUSD') {
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
    if (!response.ok) throw new Error('BTC price request failed')
    const data = await response.json()
    const price = Number(data.price)
    if (!Number.isFinite(price) || price <= 0) throw new Error('BTC price was invalid')
    return { price, source: marketProfiles.BTCUSD.source, at: new Date().toISOString() }
  }

  if (symbol === 'XAUUSD') {
    const response = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d')
    if (!response.ok) throw new Error('Gold price request failed')
    const data = await response.json()
    const result = data.chart?.result?.[0]
    const quote = result?.indicators?.quote?.[0]?.close || []
    const lastClose = [...quote].reverse().find((value) => Number.isFinite(Number(value)) && Number(value) > 0)
    const price = Number(result?.meta?.regularMarketPrice || lastClose)
    if (!Number.isFinite(price) || price <= 0) throw new Error('Gold price was invalid')
    return { price, source: marketProfiles.XAUUSD.source, at: new Date().toISOString() }
  }

  throw new Error('Unsupported market')
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 5 * 1024 * 1024) {
      reject(new Error('Images must be 5 MB or smaller.'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result })
    reader.onerror = () => reject(new Error('This image could not be read.'))
    reader.readAsDataURL(file)
  })
}

function App() {
  const [currentUser, setCurrentUser] = useState(null)
  const [trades, setTrades] = useState([])
  const [settings, setSettingsState] = useState(defaults)
  const [page, setPage] = useState('calendar')
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()))
  const [tradeModal, setTradeModal] = useState(null)
  const [lightbox, setLightbox] = useState(null)
  const [toast, setToast] = useState('')
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(navigator.onLine)
  const [marketPrices, setMarketPrices] = useState({})
  const [priceStatus, setPriceStatus] = useState({ state: 'idle', message: '' })
  const [installPrompt, setInstallPrompt] = useState(null)
  const toastTimer = useRef(null)

  const notify = (message) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2800)
  }

  useEffect(() => {
    getCurrentUser()
      .then(async (user) => {
        setCurrentUser(user)
        if (user) {
          const [storedTrades, storedSettings] = await Promise.all([getTrades(user.id), getSettings(user.id)])
          setTrades(storedTrades)
          setSettingsState(storedSettings)
        }
      })
      .catch(() => notify("Couldn't open your journal. Refresh and try again."))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    const handleInstall = (event) => {
      event.preventDefault()
      setInstallPrompt(event)
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeinstallprompt', handleInstall)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeinstallprompt', handleInstall)
    }
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [page])

  async function refreshMarketPrices({ quiet = false } = {}) {
    if (!navigator.onLine) {
      setPriceStatus({ state: 'offline', message: 'Offline' })
      return
    }
    if (!quiet) setPriceStatus({ state: 'loading', message: 'Refreshing prices' })
    try {
      const entries = await Promise.allSettled(assets.map(async (symbol) => [symbol, await fetchMarketPrice(symbol)]))
      const nextPrices = {}
      const failed = []
      entries.forEach((entry, index) => {
        if (entry.status === 'fulfilled') nextPrices[entry.value[0]] = entry.value[1]
        else failed.push(assets[index])
      })
      setMarketPrices((current) => ({ ...current, ...nextPrices }))
      setPriceStatus({
        state: failed.length ? 'partial' : 'ready',
        message: failed.length ? `${failed.join(', ')} price unavailable` : 'Live prices ready',
      })
      if (!quiet) notify(failed.length ? `${failed.join(', ')} price unavailable` : 'Prices refreshed')
    } catch {
      setPriceStatus({ state: 'error', message: 'Price feed unavailable' })
      if (!quiet) notify('Price feed unavailable')
    }
  }

  useEffect(() => {
    if (!currentUser || !online) return undefined
    refreshMarketPrices({ quiet: true })
    const timer = window.setInterval(() => refreshMarketPrices({ quiet: true }), 30000)
    return () => window.clearInterval(timer)
  }, [currentUser, online])

  async function persistTrade(trade) {
    const currentLockReason = dailyTradingLockReason(trades, settings, trade.date, marketPrices)
    if (!tradeModal?.trade && !isWithdrawal(trade) && currentLockReason) {
      notify(currentLockReason.notification)
      return
    }
    await saveTrade(trade, currentUser.id)
    const nextTrades = [trade, ...trades.filter((item) => item.id !== trade.id)]
    const dailyLimitReached = !isWithdrawal(trade) ? dailyTradingLockReason(nextTrades, settings, trade.date, marketPrices) : null
    setTrades((current) => {
      const without = current.filter((item) => item.id !== trade.id)
      return [trade, ...without].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    })
    setSelectedDate(trade.date)
    setCursor(fromDateKey(trade.date))
    setTradeModal(null)
    notify(dailyLimitReached ? dailyLimitReached.notification : tradeModal?.trade ? 'Trade updated' : isWithdrawal(trade) ? 'Withdrawal saved' : 'Trade saved')
  }

  async function deleteTrade(trade) {
    if (!window.confirm(`Delete ${trade.symbol || 'this trade'}?`)) return
    await removeTrade(trade.id, currentUser.id)
    setTrades((current) => current.filter((item) => item.id !== trade.id))
    notify('Trade deleted')
  }

  async function updatePreferences(next) {
    await saveSettings(currentUser.id, next)
    setSettingsState(next)
    notify('Settings saved')
  }

  const openNewTrade = (date = selectedDate) => {
    const lockReason = dailyTradingLockReason(trades, settings, date, marketPrices)
    if (lockReason) {
      setTradeModal({ date, trade: null, locked: true })
      notify(`${lockReason.title}. Only a withdrawal can be added today.`)
      return
    }
    setTradeModal({ date, trade: null })
  }
  const openDay = (date) => {
    setCursor(date)
    setSelectedDate(dateKey(date))
    setView('day')
  }

  if (loading) {
    return (
      <div className="splash-screen">
        <img className="splash-logo" src="/trade-rise-logo.png" alt="Trade Rise" />
        <p>Opening your journal…</p>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <AuthScreen
        onAuthenticated={async (user) => {
          setLoading(true)
          const [storedTrades, storedSettings] = await Promise.all([getTrades(user.id), getSettings(user.id)])
          setCurrentUser(user)
          setTrades(storedTrades)
          setSettingsState(storedSettings)
          setLoading(false)
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      <div className="app-body">
        <header className="topbar">
          <Brand />
          <nav className="desktop-top-nav" aria-label="Main navigation">
            <NavItems page={page} setPage={setPage} />
          </nav>
          <div className="topbar-actions">
            {!online && <span className="offline-pill"><WifiOff size={14} /> Offline</span>}
            <button className="user-chip" onClick={() => setPage('settings')}>
              <span>{currentUser.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{currentUser.name}</strong><small>{currentUser.email}</small></div>
            </button>
            <button className="primary-button compact" onClick={() => openNewTrade(dateKey(new Date()))}>
              <Plus size={18} /> Start trade
            </button>
          </div>
        </header>

        <TodayPulse
          trades={trades}
          settings={settings}
          marketPrices={marketPrices}
          priceStatus={priceStatus}
          onOpenToday={() => {
            setPage('calendar')
            openDay(new Date())
          }}
        />

        <main className="main-content">
          {page === 'calendar' && (
            <CalendarPage
              trades={trades}
              settings={settings}
              view={view}
              setView={setView}
              cursor={cursor}
              setCursor={setCursor}
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              marketPrices={marketPrices}
              openDay={openDay}
              openNewTrade={openNewTrade}
              editTrade={(trade) => setTradeModal({ date: trade.date, trade })}
              deleteTrade={deleteTrade}
              openImage={setLightbox}
              goSettings={() => setPage('settings')}
            />
          )}
          {page === 'analytics' && <AnalyticsPage trades={trades} settings={settings} marketPrices={marketPrices} />}
          {page === 'settings' && (
            <SettingsPage
              user={currentUser}
              settings={settings}
              trades={trades}
              onSave={updatePreferences}
              onImport={async (payload) => {
                await replaceAllData(payload, currentUser.id)
                setTrades(await getTrades(currentUser.id))
                setSettingsState(await getSettings(currentUser.id))
                notify('Backup imported')
              }}
              onClear={async () => {
                await clearAllData(currentUser.id)
                setTrades([])
                setSettingsState(defaults)
                notify('Journal data cleared')
              }}
              installPrompt={installPrompt}
              onInstalled={() => setInstallPrompt(null)}
              notify={notify}
              onLogout={() => {
                logoutUser()
                setCurrentUser(null)
                setTrades([])
                setSettingsState(defaults)
                setPage('calendar')
              }}
            />
          )}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Main navigation">
        <NavItems page={page} setPage={setPage} />
      </nav>

      <button className="mobile-fab" aria-label="Start trade" onClick={() => openNewTrade(dateKey(new Date()))}>
        <Plus size={27} />
      </button>

      {tradeModal && (
        <TradeModal
          key={tradeModal.trade?.id || tradeModal.date}
          date={tradeModal.date}
          trade={tradeModal.trade}
          locked={tradeModal.locked}
          currency={settings.currency}
          marketPrices={marketPrices}
          priceStatus={priceStatus}
          onRefreshPrices={refreshMarketPrices}
          onClose={() => setTradeModal(null)}
          onSave={persistTrade}
          notify={notify}
        />
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button className="icon-button lightbox-close" onClick={() => setLightbox(null)} aria-label="Close"><X /></button>
          <img src={lightbox.dataUrl} alt={lightbox.name || 'Trade plan'} onClick={(event) => event.stopPropagation()} />
        </div>
      )}

      {toast && <div className="toast"><Check size={17} /> {toast}</div>}
    </div>
  )
}

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const switchMode = (nextMode) => {
    setMode(nextMode)
    setError('')
    setPassword('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    if (mode === 'register' && name.trim().length < 2) {
      setError('Enter a display name with at least 2 characters.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.')
      return
    }
    setSubmitting(true)
    try {
      const user = mode === 'login'
        ? await loginUser({ email, password })
        : await registerUser({ name, email, password })
      await onAuthenticated(user)
    } catch (authError) {
      setError(authError.message || 'Sign in failed. Check your details and try again.')
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-logo-wrap"><img src="/trade-rise-logo.png" alt="Trade Rise" /></div>
        <div className="auth-statement">
          <span>TRADING JOURNAL</span>
          <h1>Review. Learn.<br />Trade better.</h1>
        </div>
        <small className="auth-footnote">PLAN · TRADE · PROFIT</small>
      </section>

      <section className="auth-form-panel">
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-form-wrap">
          <header>
            <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
          </header>

          <div className="auth-tabs" role="tablist">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>Sign in</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>Create account</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <label>Display name<div className="auth-input"><UserRound size={18} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" required /></div></label>
            )}
            <label>Email<div className="auth-input"><span className="at-sign">@</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" required /></div></label>
            <label>Password<div className="auth-input"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Checking…' : mode === 'login' ? 'Sign in' : 'Create account'}
              {!submitting && <ArrowUpRight size={19} />}
            </button>
            <p className="session-note"><Check size={14} /> Stay signed in on this device.</p>
          </form>
        </div>
      </section>
    </main>
  )
}

function Brand() {
  return (
    <div className="brand">
      <img src="/trade-rise-logo.png" alt="Trade Rise" />
      <span><strong>TRADE RISE</strong><small>Trading journal</small></span>
    </div>
  )
}

function NavItems({ page, setPage }) {
  const items = [
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'analytics', label: 'Insights', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: SettingsIcon },
  ]
  return items.map((item) => {
    const Icon = item.icon
    return (
      <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}>
        <Icon size={22} />
        <span>{item.label}</span>
      </button>
    )
  })
}

function TodayPulse({ trades, settings, marketPrices, priceStatus, onOpenToday }) {
  const today = new Date()
  const todayKey = dateKey(today)
  const todayTrades = trades.filter((trade) => trade.date === todayKey && isTradingRecord(trade))
  const openTrades = todayTrades.filter(isOpenTrade).length
  const pnl = totalPnl(todayTrades, marketPrices)
  const stopped = dailyTradingLockReason(trades, settings, todayKey, marketPrices)
  return (
    <button className={`today-pulse ${stopped ? 'stop-loss' : ''}`} onClick={onOpenToday}>
      <span className="pulse-label"><i /> {stopped ? 'Trading locked' : 'Today'}</span>
      <span className="pulse-date">{new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(today)}</span>
      <span><small>Account</small><strong>{settings.accountName}</strong></span>
      <span><small>Open</small><strong>{openTrades}</strong></span>
      <span className="pulse-pnl"><small>{priceStatus.message || 'Net P&L'}</small><strong className={pnl < 0 ? 'loss-text' : pnl > 0 ? 'profit-text' : ''}>{formatMoney(pnl, settings.currency, true)}</strong></span>
      <ChevronRight size={15} />
    </button>
  )
}

function CalendarPage(props) {
  const { view, setView, cursor, setCursor } = props
  return (
    <section className="page-section calendar-page">
      <div className="page-heading">
        <div>
          <h1>Calendar</h1>
        </div>
        <div className="account-chip"><span className="status-dot" />{props.settings.accountName}<ChevronDown size={15} /></div>
      </div>

      <div className="view-switcher">
        {viewOptions.map((option) => (
          <button key={option.id} className={view === option.id ? 'active' : ''} onClick={() => setView(option.id)}>{option.label}</button>
        ))}
      </div>

      {view !== 'all' && (
        <PeriodNavigator
          label={formatPeriod(cursor, view)}
          previous={() => setCursor(moveDate(cursor, view, -1))}
          next={() => setCursor(moveDate(cursor, view, 1))}
          today={() => {
            const today = new Date()
            setCursor(today)
            props.setSelectedDate(dateKey(today))
          }}
        />
      )}

      {view === 'day' && <DayView {...props} date={cursor} />}
      {view === 'month' && <MonthView {...props} />}
      {view === 'year' && <YearView {...props} />}
      {view === 'all' && <AllTimeView {...props} />}
    </section>
  )
}

function PeriodNavigator({ label, previous, next, today }) {
  return (
    <div className="period-nav">
      <button className="icon-button" onClick={previous} aria-label="Previous period"><ChevronLeft /></button>
      <button className="period-title" onClick={today} title="Back to today">{label}</button>
      <button className="icon-button" onClick={next} aria-label="Next period"><ChevronRight /></button>
    </div>
  )
}

function PerformanceLedger({ label, trades, target, currency, marketPrices, goSettings }) {
  const tradingRecords = trades.filter(isTradingRecord)
  const pnl = totalPnl(tradingRecords, marketPrices)
  const wins = tradingRecords.filter((trade) => pnlOf(trade, marketPrices) > 0).length
  const winRate = tradingRecords.length ? Math.round((wins / tradingRecords.length) * 100) : 0
  const tradeDays = new Set(tradingRecords.map((trade) => trade.date)).size
  const openTrades = tradingRecords.filter(isOpenTrade).length
  const progress = target > 0 ? Math.max(0, Math.min(100, (pnl / target) * 100)) : 0
  return (
    <section className="performance-ledger">
      <div className="ledger-net">
        <span>{label}</span>
        <strong className={pnl < 0 ? 'loss-text' : pnl > 0 ? 'profit-text' : ''}>{formatMoney(pnl, currency, true)}</strong>
      </div>
      <div className="ledger-stat"><span>Trades</span><strong>{tradingRecords.length}</strong><small>{openTrades} open</small></div>
      <div className="ledger-stat"><span>Days</span><strong>{tradeDays}</strong></div>
      <div className="ledger-stat"><span>Win rate</span><strong>{winRate}%</strong></div>
      <div className="ledger-goal">
        <div><span>Goal</span><button onClick={goSettings}>Edit</button></div>
        <div className="ledger-goal-values"><strong>{target > 0 ? `${Math.round(progress)}%` : '—'}</strong><small>{target > 0 ? formatMoney(target, currency) : 'No goal yet'}</small></div>
        <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      </div>
    </section>
  )
}

function MonthView({ trades, settings, marketPrices, cursor, openDay, goSettings }) {
  const filtered = trades.filter((trade) => {
    const date = fromDateKey(trade.date)
    return date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth()
  })
  const cells = monthCells(cursor, settings.showWeekends)
  const labels = settings.showWeekends ? weekdayLabels : weekdayLabels.slice(0, 5)
  const todayKey = dateKey(new Date())

  return (
    <>
      <PerformanceLedger label="Net P&L this month" trades={filtered} target={settings.monthlyGoal} currency={settings.currency} marketPrices={marketPrices} goSettings={goSettings} />

      <div className="calendar-panel panel">
        <div className="panel-heading">
          <div><h2>Daily results</h2></div>
          <span className="legend"><i className="gain" /> Profit <i className="loss" /> Loss</span>
        </div>
        <div className={`calendar-grid ${settings.showWeekends ? '' : 'workweek'}`}>
          {labels.map((label) => <div className="weekday" key={label}>{label}</div>)}
          {cells.map((date, index) => {
            if (!date) return <span className="day-cell blank" key={`blank-${index}`} />
            const key = dateKey(date)
            const dayTrades = trades.filter((trade) => trade.date === key)
            const tradingRecords = dayTrades.filter(isTradingRecord)
            const dayPnl = totalPnl(tradingRecords, marketPrices)
            const futureDay = key > todayKey
            const restDay = !tradingRecords.length && !futureDay
            const onPlan = (!futureDay || tradingRecords.length) && isWithinDailyLossBudget(trades, settings, key, marketPrices)
            const overBudget = tradingRecords.length && !onPlan
            const dayStopped = dailyTradingLockReason(trades, settings, key, marketPrices)
            const isToday = key === todayKey
            return (
              <button
                key={key}
                className={`day-cell ${onPlan ? 'win on-plan' : ''} ${overBudget ? 'lose' : ''} ${restDay ? 'rest-day' : ''} ${dayStopped ? 'stop-loss' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => openDay(date)}
                aria-label={futureDay && !tradingRecords.length ? `${date.getDate()} future date` : `${date.getDate()} ${onPlan ? 'within daily loss budget' : 'daily loss budget exceeded'} ${formatMoney(dayPnl, settings.currency, true)}`}
              >
                <span className="day-number">{date.getDate()}</span>
                {tradingRecords.length ? (
                  <>
                    <strong>{formatCompactMoney(dayPnl, settings.currency)}</strong>
                    <small>{tradingRecords.length} {tradingRecords.length === 1 ? 'trade' : 'trades'}</small>
                  </>
                ) : restDay ? <><strong>+{formatCompactMoney(0, settings.currency)}</strong><small>{dayTrades.some(isWithdrawal) ? 'Withdrawal' : 'No trades'}</small></> : <span className="empty-dash">—</span>}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function DayView({ date, trades, settings, marketPrices, openNewTrade, editTrade, deleteTrade, openImage }) {
  const key = dateKey(date)
  const dayTrades = trades.filter((trade) => trade.date === key)
  const tradingRecords = dayTrades.filter(isTradingRecord)
  const wins = tradingRecords.filter((trade) => pnlOf(trade, marketPrices) > 0)
  const losses = tradingRecords.filter((trade) => pnlOf(trade, marketPrices) < 0)
  const stopped = dailyTradingLockReason(trades, settings, key, marketPrices)
  return (
    <>
      <section className="day-ledger">
        <div className="ledger-net"><span>Net P&L</span><strong className={totalPnl(tradingRecords, marketPrices) < 0 ? 'loss-text' : totalPnl(tradingRecords, marketPrices) > 0 ? 'profit-text' : ''}>{formatMoney(totalPnl(tradingRecords, marketPrices), settings.currency, true)}</strong></div>
        <div className="ledger-stat"><span>Trades</span><strong>{tradingRecords.length}</strong></div>
        <div className="ledger-stat profit"><span>Profit</span><strong>{formatMoney(totalPnl(wins, marketPrices), settings.currency)}</strong><small>{wins.length} {wins.length === 1 ? 'trade' : 'trades'}</small></div>
        <div className="ledger-stat loss"><span>Loss</span><strong>{formatMoney(Math.abs(totalPnl(losses, marketPrices)), settings.currency)}</strong><small>{losses.length} {losses.length === 1 ? 'trade' : 'trades'}</small></div>
      </section>

      {stopped && <section className="stop-loss-alert" role="alert"><LockKeyhole size={19} /><div><strong>{stopped.title}</strong><span>{stopped.message}</span></div></section>}

      <div className="section-heading">
        <div><h2>Trades</h2></div>
        <button className="primary-button" onClick={() => openNewTrade(key)}><Plus size={18} /> {stopped ? 'Add withdrawal' : 'Start trade'}</button>
      </div>

      {dayTrades.length ? (
        <div className="trade-list">
          {dayTrades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} currency={settings.currency} marketPrices={marketPrices} onEdit={editTrade} onDelete={deleteTrade} onImage={openImage} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="No trades yet"
          text="Start with entry, TP, SL, size, and a chart."
          action={() => openNewTrade(key)}
        />
      )}
    </>
  )
}

function TradeCard({ trade, currency, marketPrices, onEdit, onDelete, onImage }) {
  const pnl = pnlOf(trade, marketPrices)
  const withdrawal = isWithdrawal(trade)
  const title = withdrawal ? 'Withdrawal' : trade.symbol || 'Unspecified market'
  const livePrice = activeSides.includes(trade.side) ? tradePrice(trade, marketPrices) : 0
  const subtitle = withdrawal ? 'Cash withdrawn' : `${activeSides.includes(trade.side) ? trade.side.toUpperCase() : trade.side === 'profit' ? 'Profit' : 'Loss'} · ${trade.status === 'closed' ? 'Closed' : 'Open'} · ${trade.time}`
  return (
    <article className={`trade-card ${withdrawal ? 'withdrawal-card' : ''} ${isOpenTrade(trade) ? 'open-trade-card' : ''}`}>
      <div className={`trade-side ${trade.side}`}><span>{withdrawal ? <CircleDollarSign /> : trade.side === 'profit' || trade.side === 'long' ? <ArrowUpRight /> : <ArrowDownRight />}</span></div>
      <div className="trade-content">
        <div className="trade-title-row">
          <div><h3>{title}</h3><p>{subtitle}</p></div>
          <strong className={withdrawal ? 'withdrawal-text' : pnl >= 0 ? 'profit-text' : 'loss-text'}>{withdrawal ? formatMoney(-Math.abs(Number(trade.amount)), currency, true) : formatMoney(pnl, currency, true)}</strong>
        </div>
        {activeSides.includes(trade.side) && (
          <div className="trade-plan-row">
            <span>Entry <strong>{Number(trade.entryPrice).toLocaleString(locale)}</strong></span>
            <span>{trade.status === 'closed' ? 'Exit' : 'Now'} <strong>{livePrice ? livePrice.toLocaleString(locale) : '—'}</strong></span>
            <span>TP <strong>{Number(trade.tpPrice).toLocaleString(locale)}</strong></span>
            <span>SL <strong>{Number(trade.slPrice).toLocaleString(locale)}</strong></span>
            <span>R:R <strong>{riskReward(trade)}</strong></span>
          </div>
        )}
        {(trade.note || trade.lesson) && (
          <div className="trade-notes">
            {trade.note && <p><span>Note</span>{trade.note}</p>}
            {trade.lesson && <p><span>Lesson</span>{trade.lesson}</p>}
          </div>
        )}
        {trade.image && <button className="image-thumb" onClick={() => onImage(trade.image)}><img src={trade.image.dataUrl} alt={trade.image.name || 'Trade plan'} /><span>View chart</span></button>}
      </div>
      <div className="trade-actions">
        <button className="icon-button" onClick={() => onEdit(trade)} aria-label="Edit"><Pencil size={17} /></button>
        <button className="icon-button danger" onClick={() => onDelete(trade)} aria-label="Delete"><Trash2 size={17} /></button>
      </div>
    </article>
  )
}

function YearView({ trades, settings, marketPrices, cursor, openDay, goSettings }) {
  const yearTrades = trades.filter((trade) => fromDateKey(trade.date).getFullYear() === cursor.getFullYear())
  return (
    <>
      <PerformanceLedger label="Net P&L this year" trades={yearTrades} target={settings.yearlyGoal} currency={settings.currency} marketPrices={marketPrices} goSettings={goSettings} />
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, month) => (
          <MiniMonth
            key={month}
            year={cursor.getFullYear()}
            month={month}
            trades={trades}
            settings={settings}
            marketPrices={marketPrices}
            currency={settings.currency}
            onOpen={(date) => openDay(date)}
          />
        ))}
      </div>
    </>
  )
}

function MiniMonth({ year, month, trades, settings, marketPrices, currency, onOpen }) {
  const date = new Date(year, month, 1, 12)
  const cells = monthCells(date, true)
  const todayKey = dateKey(new Date())
  const monthTrades = trades.filter((trade) => {
    const itemDate = fromDateKey(trade.date)
    return itemDate.getFullYear() === year && itemDate.getMonth() === month
  })
  const total = totalPnl(monthTrades, marketPrices)
  return (
    <article className="mini-month panel">
      <button className="mini-heading" onClick={() => onOpen(date)}>
        <span>{new Intl.DateTimeFormat(locale, { month: 'short' }).format(date)}</span>
        <strong className={total < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(total, currency, true)}</strong>
      </button>
      <div className="heat-grid">
        {cells.map((day, index) => {
          if (!day) return <i className="heat blank" key={`b-${index}`} />
          const key = dateKey(day)
          const tradingRecords = trades.filter((trade) => trade.date === key && isTradingRecord(trade))
          const pnl = totalPnl(tradingRecords, marketPrices)
          const futureDay = key > todayKey
          const onPlan = (!futureDay || tradingRecords.length) && isWithinDailyLossBudget(trades, settings, key, marketPrices)
          return <button key={key} className={`heat ${onPlan ? 'win' : tradingRecords.length ? 'lose' : ''}`} onClick={() => onOpen(day)} title={`${day.getDate()}: ${formatMoney(pnl, currency, true)}`} />
        })}
      </div>
      <p>{monthTrades.length} {monthTrades.length === 1 ? 'trade' : 'trades'}</p>
    </article>
  )
}

function AllTimeView({ trades, settings, marketPrices, openDay }) {
  const tradingRecords = trades.filter(isTradingRecord)
  const yearMap = useMemo(() => {
    const grouped = new Map()
    for (const trade of tradingRecords) {
      const year = fromDateKey(trade.date).getFullYear()
      if (!grouped.has(year)) grouped.set(year, [])
      grouped.get(year).push(trade)
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0])
  }, [tradingRecords])
  const pnl = totalPnl(tradingRecords, marketPrices)
  return (
    <>
      <article className="all-time-hero panel">
        <div><h2>All time</h2><p>{tradingRecords.length} {tradingRecords.length === 1 ? 'trade' : 'trades'} · {yearMap.length} {yearMap.length === 1 ? 'year' : 'years'}</p></div>
        <strong className={pnl < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(pnl, settings.currency, true)}</strong>
      </article>
      {yearMap.length ? (
        <div className="year-list">
          {yearMap.map(([year, entries]) => {
            const value = totalPnl(entries, marketPrices)
            return (
              <button key={year} onClick={() => openDay(fromDateKey(entries[0].date))}>
                <span><strong>{year}</strong><small>{entries.length} {entries.length === 1 ? 'trade' : 'trades'}</small></span>
                <strong className={value < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(value, settings.currency, true)}</strong>
                <ChevronRight size={20} />
              </button>
            )
          })}
        </div>
      ) : <EmptyState icon={LineChart} title="No history yet" text="Your yearly results will appear here." />}
    </>
  )
}

function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty-state panel">
      <span><Icon size={26} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <button className="primary-button" onClick={action}><Plus size={17} /> Add your first trade</button>}
    </div>
  )
}

function AnalyticsPage({ trades, settings, marketPrices }) {
  const tradingRecords = trades.filter(isTradingRecord)
  const wins = tradingRecords.filter((trade) => pnlOf(trade, marketPrices) > 0)
  const losses = tradingRecords.filter((trade) => pnlOf(trade, marketPrices) < 0)
  const grossProfit = totalPnl(wins, marketPrices)
  const grossLoss = Math.abs(totalPnl(losses, marketPrices))
  const netPnl = totalPnl(tradingRecords, marketPrices)
  const winRate = tradingRecords.length ? (wins.length / tradingRecords.length) * 100 : 0
  const factor = grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const expectancy = tradingRecords.length ? netPnl / tradingRecords.length : 0
  const dailyMap = new Map()
  tradingRecords.forEach((trade) => dailyMap.set(trade.date, (dailyMap.get(trade.date) || 0) + pnlOf(trade, marketPrices)))
  const bestDay = [...dailyMap.values()].sort((a, b) => b - a)[0] || 0
  const ordered = [...tradingRecords].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  let running = 0
  const equity = ordered.map((trade) => {
    running += pnlOf(trade, marketPrices)
    return running
  })
  const monthly = makeMonthlyResults(tradingRecords, marketPrices)

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><h1>Insights</h1></div>
        <div className="account-chip"><span className="status-dot" />{settings.accountName}</div>
      </div>

      <div className="analytics-hero panel">
        <div><p>All-time net P&L</p><strong className={netPnl < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(netPnl, settings.currency, true)}</strong><span>{tradingRecords.length} {tradingRecords.length === 1 ? 'trade' : 'trades'} recorded</span></div>
        <EquityChart values={equity} />
      </div>

      <div className="metrics-grid">
        <Metric label="Win rate" value={`${winRate.toFixed(1)}%`} detail={`${wins.length} wins / ${losses.length} losses`} />
        <Metric label="Profit factor" value={factor === Infinity ? '∞' : factor.toFixed(2)} detail="Gross profit ÷ gross loss" />
        <Metric label="Expectancy" value={formatMoney(expectancy, settings.currency, true)} detail="Average result per trade" tone={expectancy < 0 ? 'loss' : 'profit'} />
        <Metric label="Best day" value={formatMoney(bestDay, settings.currency, true)} detail="Highest daily P&L" tone={bestDay < 0 ? 'loss' : 'profit'} />
        <Metric label="Average win" value={formatMoney(avgWin, settings.currency)} detail="Average winning trade" tone="profit" />
        <Metric label="Average loss" value={formatMoney(avgLoss, settings.currency)} detail="Average losing trade" tone="loss" />
      </div>

      <div className="panel monthly-performance">
        <div className="panel-heading"><div><h2>Monthly results</h2></div></div>
        {monthly.length ? monthly.map((item) => (
          <div className="month-result" key={item.key}>
            <span>{item.label}</span>
            <div><i className={item.value < 0 ? 'loss' : ''} style={{ width: `${item.width}%` }} /></div>
            <strong className={item.value < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(item.value, settings.currency, true)}</strong>
          </div>
        )) : <p className="no-data">Add a trade to start seeing useful patterns.</p>}
      </div>
    </section>
  )
}

function Metric({ label, value, detail, tone }) {
  return <article className="metric-card" title={detail}><p>{label}</p><strong className={tone === 'loss' ? 'loss-text' : tone === 'profit' ? 'profit-text' : ''}>{value}</strong></article>
}

function EquityChart({ values }) {
  if (values.length < 2) return <div className="chart-empty"><LineChart size={28} /><span>Add 2 trades to see your equity curve.</span></div>
  const width = 760
  const height = 210
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 26) - 13
    return `${x},${y}`
  }).join(' ')
  const zeroY = height - ((0 - min) / range) * (height - 26) - 13
  return (
    <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Cumulative P&L chart">
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="#2b3834" strokeDasharray="6 8" />
      <polygon points={`0,${height} ${points} ${width},${height}`} fill="#31e981" fillOpacity=".08" />
      <polyline points={points} fill="none" stroke="#31e981" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function makeMonthlyResults(trades, marketPrices = {}) {
  const grouped = new Map()
  for (const trade of trades) {
    const key = trade.date.slice(0, 7)
    grouped.set(key, (grouped.get(key) || 0) + pnlOf(trade, marketPrices))
  }
  const items = [...grouped.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6).reverse()
  const max = Math.max(1, ...items.map(([, value]) => Math.abs(value)))
  return items.map(([key, value]) => ({
    key,
    value,
    label: new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(fromDateKey(`${key}-01`)),
    width: Math.max(4, (Math.abs(value) / max) * 100),
  }))
}

function SettingsPage({ user, settings, trades, onSave, onImport, onClear, installPrompt, onInstalled, notify, onLogout }) {
  const [form, setForm] = useState(settings)
  const [limitMonth, setLimitMonth] = useState(() => dateKey(new Date()).slice(0, 7))
  const importRef = useRef(null)
  useEffect(() => setForm(settings), [settings])

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const changeDailyStopLoss = (value) => setForm((current) => {
    const dailyStopLossByMonth = { ...(current.dailyStopLossByMonth || {}) }
    if (Number(value) > 0) dailyStopLossByMonth[limitMonth] = value
    else delete dailyStopLossByMonth[limitMonth]
    return { ...current, dailyStopLossByMonth }
  })
  const submit = (event) => {
    event.preventDefault()
    const dailyStopLossByMonth = Object.fromEntries(Object.entries(form.dailyStopLossByMonth || {})
      .map(([month, value]) => [month, Math.max(0, Number(value) || 0)])
      .filter(([, value]) => value > 0))
    onSave({
      ...form,
      monthlyGoal: Math.max(0, Number(form.monthlyGoal) || 0),
      yearlyGoal: Math.max(0, Number(form.yearlyGoal) || 0),
      dailyStopLossByMonth,
      dailyTradeLimit: Math.max(0, Math.floor(Number(form.dailyTradeLimit) || 0)),
    })
  }
  const exportData = () => {
    const content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, trades }, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `trade-rise-backup-${dateKey(new Date())}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('Backup exported')
  }
  const importFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!Array.isArray(parsed.trades)) throw new Error()
      if (!window.confirm(`Import ${parsed.trades.length} trades and replace your current journal?`)) return
      await onImport(parsed)
    } catch {
      notify('That backup file is not valid.')
    } finally {
      event.target.value = ''
    }
  }
  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt()
      const result = await installPrompt.userChoice
      if (result.outcome === 'accepted') onInstalled()
      return
    }
    notify('On iPhone, tap Share, then Add to Home Screen.')
  }

  return (
    <section className="page-section settings-page">
      <div className="page-heading settings-heading">
        <div><h1>Settings</h1></div>
        <button className="logout-button" onClick={onLogout}><LogOut size={17} /> Sign out</button>
      </div>
      <section className="profile-strip">
        <span className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <div><strong>{user.name}</strong><small>{user.email}</small></div>
      </section>
      <form onSubmit={submit}>
        <div className="settings-grid">
          <section className="settings-card panel">
            <div className="settings-title"><span><WalletCards /></span><div><h2>Account & currency</h2></div></div>
            <label>Account name<input value={form.accountName} onChange={(event) => change('accountName', event.target.value)} maxLength={40} required /></label>
            <label>Currency<select value={form.currency} onChange={(event) => change('currency', event.target.value)}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></label>
          </section>

          <section className="settings-card panel">
            <div className="settings-title"><span><Target /></span><div><h2>Goals</h2></div></div>
            <label>Monthly goal<input type="number" min="0" step="0.01" value={form.monthlyGoal} onChange={(event) => change('monthlyGoal', event.target.value)} /></label>
            <label>Yearly goal<input type="number" min="0" step="0.01" value={form.yearlyGoal} onChange={(event) => change('yearlyGoal', event.target.value)} /></label>
          </section>

          <section className="settings-card panel stop-loss-settings">
            <div className="settings-title"><span><LockKeyhole /></span><div><h2>Daily stop loss</h2><p>Locks new trades after the day reaches this loss.</p></div></div>
            <label>Month<input type="month" value={limitMonth} onChange={(event) => setLimitMonth(event.target.value)} /></label>
            <label>Maximum loss per day<input type="number" min="0" step="0.01" placeholder="No limit" value={form.dailyStopLossByMonth?.[limitMonth] || ''} onChange={(event) => changeDailyStopLoss(event.target.value)} /></label>
          </section>

          <section className="settings-card panel stop-loss-settings">
            <div className="settings-title"><span><Hash /></span><div><h2>Daily trade limit</h2><p>Locks new trades after the daily trade count is reached.</p></div></div>
            <label>Maximum trades per day<input type="number" min="0" step="1" placeholder="No limit" value={form.dailyTradeLimit || ''} onChange={(event) => change('dailyTradeLimit', event.target.value)} /></label>
          </section>

          <section className="settings-card panel">
            <div className="settings-title"><span><CalendarDays /></span><div><h2>Calendar</h2></div></div>
            <label className="toggle-row"><span><strong>Show weekends</strong><small>Include Saturday and Sunday</small></span><input type="checkbox" checked={form.showWeekends} onChange={(event) => change('showWeekends', event.target.checked)} /><i /></label>
          </section>

          <section className="settings-card panel">
            <div className="settings-title"><span><Smartphone /></span><div><h2>Install app</h2></div></div>
            <button className="secondary-button full" type="button" onClick={install}><Smartphone size={18} /> Install Trade Rise</button>
          </section>
        </div>
        <button className="primary-button save-settings" type="submit"><Check size={18} /> Save settings</button>
      </form>

      <section className="data-section panel">
        <div className="settings-title"><span><RotateCcw /></span><div><h2>Backup & restore</h2></div></div>
        <div className="data-actions">
          <button className="secondary-button" onClick={exportData}><Download size={18} /> Export backup</button>
          <button className="secondary-button" onClick={() => importRef.current?.click()}><Upload size={18} /> Import backup</button>
          <input ref={importRef} className="hidden-input" type="file" accept="application/json" onChange={importFile} />
          <button className="danger-button" onClick={() => {
            if (window.confirm('Delete every trade and all settings? This cannot be undone.')) onClear()
          }}><Trash2 size={18} /> Clear journal</button>
        </div>
      </section>
    </section>
  )
}

function TradeModal({ date, trade, locked = false, currency, marketPrices, priceStatus, onRefreshPrices, onClose, onSave, notify }) {
  const initialSymbol = assets.includes(trade?.symbol) ? trade.symbol : 'XAUUSD'
  const initialSide = activeSides.includes(trade?.side) || trade?.side === 'withdrawal'
    ? trade.side
    : locked ? 'withdrawal' : 'long'
  const [form, setForm] = useState(() => ({
    side: initialSide,
    status: trade?.status || (trade?.exitPrice ? 'closed' : 'open'),
    amount: trade?.amount || '',
    date: trade?.date || date,
    time: trade?.time || nowTime(),
    symbol: initialSymbol,
    entryPrice: trade?.entryPrice || '',
    tpPrice: trade?.tpPrice || '',
    slPrice: trade?.slPrice || '',
    currentPrice: trade?.currentPrice || '',
    exitPrice: trade?.exitPrice || '',
    positionSize: trade?.positionSize || '0.01',
    setup: trade?.setup || '',
    note: trade?.note || '',
    lesson: trade?.lesson || '',
    image: trade?.image || null,
  }))
  const [saving, setSaving] = useState(false)
  const firstFieldRef = useRef(null)

  const profile = marketProfiles[form.symbol] || marketProfiles.XAUUSD
  const liveMarket = marketPrices[form.symbol]
  const livePrice = marketPriceFor(form.symbol, marketPrices)
  const previewPrice = Number(form.status === 'closed' ? form.exitPrice : form.currentPrice || livePrice || form.entryPrice)
  const previewTrade = { ...form, symbol: form.symbol }
  const previewPnl = form.side === 'withdrawal'
    ? -Math.abs(Number(form.amount) || 0)
    : calculatedPnl(previewTrade, previewPrice)
  const previewReward = Math.abs(targetPnl(previewTrade, 'tpPrice'))
  const previewRisk = Math.abs(targetPnl(previewTrade, 'slPrice'))

  useEffect(() => {
    document.body.classList.add('modal-open')
    const escape = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', escape)
    window.setTimeout(() => firstFieldRef.current?.focus(), 100)
    return () => {
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const useLivePrice = (key) => {
    if (!livePrice) {
      notify('Live price is not available yet.')
      return
    }
    change(key, String(livePrice))
  }
  const handleImage = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      change('image', await readImage(file))
    } catch (error) {
      notify(error.message)
    }
  }
  const submit = async (event) => {
    event.preventDefault()
    const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0

    if (form.side === 'withdrawal') {
      if (!positive(form.amount)) {
        notify('Enter a withdrawal amount greater than 0.')
        firstFieldRef.current?.focus()
        return
      }
      setSaving(true)
      try {
        await onSave({
          id: trade?.id || safeId(),
          createdAt: trade?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          ...form,
          amount: Math.abs(Number(form.amount)),
          symbol: '',
          setup: '',
          note: form.note.trim(),
          lesson: form.lesson.trim(),
          image: null,
        })
      } catch {
        notify("Couldn't save this withdrawal. Try again.")
        setSaving(false)
      }
      return
    }

    if (!positive(form.entryPrice) || !positive(form.tpPrice) || !positive(form.slPrice) || !positive(form.positionSize)) {
      notify('Enter entry, TP, SL, and size greater than 0.')
      firstFieldRef.current?.focus()
      return
    }
    if (form.status === 'closed' && !positive(form.exitPrice)) {
      notify('Enter the exit price before closing this trade.')
      return
    }
    const entry = Number(form.entryPrice)
    const tp = Number(form.tpPrice)
    const sl = Number(form.slPrice)
    const validLong = form.side === 'long' && tp > entry && sl < entry
    const validShort = form.side === 'short' && tp < entry && sl > entry
    if (!validLong && !validShort) {
      notify(form.side === 'long' ? 'For a long trade, TP must be above entry and SL below entry.' : 'For a short trade, TP must be below entry and SL above entry.')
      return
    }
    if (!form.setup.trim()) {
      notify('Add the setup before saving this trade.')
      return
    }
    if (!form.image) {
      notify('Add a trade chart before saving.')
      return
    }

    const price = form.status === 'closed' ? Number(form.exitPrice) : Number(form.currentPrice || livePrice || form.entryPrice)
    const nextTrade = {
      id: trade?.id || safeId(),
      createdAt: trade?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...form,
      amount: Math.abs(calculatedPnl(form, price)),
      entryPrice: entry,
      tpPrice: tp,
      slPrice: sl,
      positionSize: Number(form.positionSize),
      currentPrice: form.status === 'open' ? price : '',
      exitPrice: form.status === 'closed' ? Number(form.exitPrice) : '',
      setup: form.setup.trim(),
      note: form.note.trim(),
      lesson: form.lesson.trim(),
      priceSource: liveMarket?.source || '',
      priceUpdatedAt: liveMarket?.at || '',
    }

    setSaving(true)
    try {
      await onSave(nextTrade)
    } catch {
      notify("Couldn't save this trade. Try again.")
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title">
        <div className="modal-header">
          <div><p className="modal-context">{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(fromDateKey(form.date))}</p><h2 id="trade-modal-title">{trade ? 'Edit trade' : locked ? 'Add withdrawal' : 'Start trade'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <form onSubmit={submit}>
          <div className="outcome-switch plan-switch">
            <button type="button" className={form.side === 'long' ? 'active profit' : ''} onClick={() => change('side', 'long')} disabled={locked}><ArrowUpRight /> Long</button>
            <button type="button" className={form.side === 'short' ? 'active loss' : ''} onClick={() => change('side', 'short')} disabled={locked}><ArrowDownRight /> Short</button>
            <button type="button" className={form.side === 'withdrawal' ? 'active withdrawal' : ''} onClick={() => change('side', 'withdrawal')}><CircleDollarSign /> Withdrawal</button>
          </div>

          {form.side !== 'withdrawal' && (
            <section className="price-feed-row">
              <div>
                <strong>{form.symbol} {livePrice ? livePrice.toLocaleString(locale) : 'No live price'}</strong>
                <span>{liveMarket?.source || priceStatus.message || profile.source}</span>
              </div>
              <div>
                <button type="button" className="icon-button" onClick={() => onRefreshPrices()} aria-label="Refresh price"><RefreshCw size={17} /></button>
                <button type="button" className="secondary-button" onClick={() => useLivePrice(form.status === 'closed' ? 'exitPrice' : 'currentPrice')}>Use live</button>
              </div>
            </section>
          )}

          {form.side === 'withdrawal' ? (
            <div className="form-grid">
              <label className="amount-field full-field">Withdrawal amount ({currency})<div><span>-</span><input ref={firstFieldRef} aria-label="Withdrawal amount" type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(event) => change('amount', event.target.value)} /></div></label>
              <label>Date<input type="date" value={form.date} onChange={(event) => change('date', event.target.value)} required /></label>
              <label>Time<input type="time" value={form.time} onChange={(event) => change('time', event.target.value)} required /></label>
              <label className="full-field">Note (optional)<textarea placeholder="Cash movement note" value={form.note} onChange={(event) => change('note', event.target.value)} maxLength={500} /></label>
            </div>
          ) : (
            <>
              <div className="form-grid">
                <label>Date<input type="date" value={form.date} onChange={(event) => change('date', event.target.value)} required /></label>
                <label>Time<input type="time" value={form.time} onChange={(event) => change('time', event.target.value)} required /></label>
                <label>Asset<select value={form.symbol} onChange={(event) => change('symbol', event.target.value)} required>{assets.map((asset) => <option key={asset} value={asset}>{asset}</option>)}</select></label>
                <label>Status<select value={form.status} onChange={(event) => change('status', event.target.value)}><option value="open">Open</option><option value="closed">Closed</option></select></label>
                <label>Entry price<input ref={firstFieldRef} aria-label="Entry price" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" value={form.entryPrice} onChange={(event) => change('entryPrice', event.target.value)} required /></label>
                <label>Size ({profile.sizeLabel})<input aria-label={`Size (${profile.sizeLabel})`} type="number" inputMode="decimal" min="0" step="any" placeholder="0.01" value={form.positionSize} onChange={(event) => change('positionSize', event.target.value)} required /></label>
                <label>Take profit<input aria-label="Take profit" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" value={form.tpPrice} onChange={(event) => change('tpPrice', event.target.value)} required /></label>
                <label>Stop loss<input aria-label="Stop loss" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" value={form.slPrice} onChange={(event) => change('slPrice', event.target.value)} required /></label>
                <label>{form.status === 'closed' ? 'Exit price' : 'Current price'}<input aria-label={form.status === 'closed' ? 'Exit price' : 'Current price'} type="number" inputMode="decimal" min="0" step="any" placeholder={livePrice ? String(livePrice) : 'Optional'} value={form.status === 'closed' ? form.exitPrice : form.currentPrice} onChange={(event) => change(form.status === 'closed' ? 'exitPrice' : 'currentPrice', event.target.value)} /></label>
                <label className="full-field">Setup<input placeholder="Breakout + retest" value={form.setup} onChange={(event) => change('setup', event.target.value)} maxLength={80} required /></label>
                <label className="full-field">Note (optional)<textarea placeholder="What is the plan?" value={form.note} onChange={(event) => change('note', event.target.value)} maxLength={500} /></label>
                <label className="full-field">Lesson (optional)<textarea placeholder="After closing, what did you learn?" value={form.lesson} onChange={(event) => change('lesson', event.target.value)} maxLength={500} /></label>
              </div>

              <section className="plan-preview">
                <div><span>Live P&L</span><strong className={previewPnl < 0 ? 'loss-text' : previewPnl > 0 ? 'profit-text' : ''}>{formatMoney(previewPnl, currency, true)}</strong></div>
                <div><span>Target</span><strong className="profit-text">{formatMoney(previewReward, currency)}</strong></div>
                <div><span>Risk</span><strong className="loss-text">{formatMoney(previewRisk, currency)}</strong></div>
                <div><span>R:R</span><strong>{riskReward(previewTrade)}</strong></div>
              </section>

              <div className="upload-field">
                <div><strong>Trade chart</strong><span>Required - image up to 5 MB</span></div>
                {form.image ? (
                  <div className="upload-preview"><img src={form.image.dataUrl} alt="Trade chart preview" /><div><span>{form.image.name}</span><button type="button" onClick={() => change('image', null)}><Trash2 size={16} /> Remove</button></div></div>
                ) : (
                  <label className="upload-button"><ImagePlus size={22} /><span><strong>Add required image</strong></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} /></label>
                )}
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : trade ? 'Save changes' : form.side === 'withdrawal' ? 'Save withdrawal' : 'Start trade'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default App
