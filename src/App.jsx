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
  ImagePlus,
  LineChart,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
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

function pnlOf(trade) {
  if (trade.side === 'withdrawal') return 0
  return trade.side === 'loss' ? -Math.abs(Number(trade.amount)) : Math.abs(Number(trade.amount))
}

function isWithdrawal(record) {
  return record.side === 'withdrawal'
}

function monthKey(value) {
  return value.slice(0, 7)
}

function dailyStopLossFor(settings, date) {
  return Math.max(0, Number(settings.dailyStopLossByMonth?.[monthKey(date)]) || 0)
}

function isDailyStopLossReached(trades, settings, date) {
  const limit = dailyStopLossFor(settings, date)
  return limit > 0 && totalPnl(trades.filter((trade) => trade.date === date)) <= -limit
}

function isWithinDailyLossBudget(trades, settings, date) {
  const tradingRecords = trades.filter((trade) => trade.date === date && !isWithdrawal(trade))
  if (!tradingRecords.length) return true
  const limit = dailyStopLossFor(settings, date)
  const pnl = totalPnl(tradingRecords)
  return limit > 0 ? pnl >= -limit : pnl >= 0
}

function totalPnl(trades) {
  return trades.reduce((total, trade) => total + pnlOf(trade), 0)
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

  async function persistTrade(trade) {
    if (!tradeModal?.trade && !isWithdrawal(trade) && isDailyStopLossReached(trades, settings, trade.date)) {
      notify('Daily loss limit reached. Trading is locked for this day.')
      return
    }
    await saveTrade(trade, currentUser.id)
    const nextTrades = [trade, ...trades.filter((item) => item.id !== trade.id)]
    const dailyLimitReached = !isWithdrawal(trade) && isDailyStopLossReached(nextTrades, settings, trade.date)
    setTrades((current) => {
      const without = current.filter((item) => item.id !== trade.id)
      return [trade, ...without].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    })
    setSelectedDate(trade.date)
    setCursor(fromDateKey(trade.date))
    setTradeModal(null)
    notify(dailyLimitReached ? 'Daily loss limit reached. Trading is locked for this day.' : tradeModal?.trade ? 'Trade updated' : isWithdrawal(trade) ? 'Withdrawal saved' : 'Trade saved')
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
    if (isDailyStopLossReached(trades, settings, date)) {
      setTradeModal({ date, trade: null, locked: true })
      notify('Daily loss limit reached. Only a withdrawal can be added today.')
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
              <Plus size={18} /> Add trade
            </button>
          </div>
        </header>

        <TodayPulse
          trades={trades}
          settings={settings}
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
              openDay={openDay}
              openNewTrade={openNewTrade}
              editTrade={(trade) => setTradeModal({ date: trade.date, trade })}
              deleteTrade={deleteTrade}
              openImage={setLightbox}
              goSettings={() => setPage('settings')}
            />
          )}
          {page === 'analytics' && <AnalyticsPage trades={trades} settings={settings} />}
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

      <button className="mobile-fab" aria-label="Add trade" onClick={() => openNewTrade(dateKey(new Date()))}>
        <Plus size={27} />
      </button>

      {tradeModal && (
        <TradeModal
          key={tradeModal.trade?.id || tradeModal.date}
          date={tradeModal.date}
          trade={tradeModal.trade}
          locked={tradeModal.locked}
          currency={settings.currency}
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

function TodayPulse({ trades, settings, onOpenToday }) {
  const today = new Date()
  const todayTrades = trades.filter((trade) => trade.date === dateKey(today) && !isWithdrawal(trade))
  const pnl = totalPnl(todayTrades)
  const stopped = isDailyStopLossReached(trades, settings, dateKey(today))
  return (
    <button className={`today-pulse ${stopped ? 'stop-loss' : ''}`} onClick={onOpenToday}>
      <span className="pulse-label"><i /> {stopped ? 'Trading locked' : 'Today'}</span>
      <span className="pulse-date">{new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(today)}</span>
      <span><small>Account</small><strong>{settings.accountName}</strong></span>
      <span><small>Trades</small><strong>{todayTrades.length}</strong></span>
      <span className="pulse-pnl"><small>Net P&L</small><strong className={pnl < 0 ? 'loss-text' : pnl > 0 ? 'profit-text' : ''}>{formatMoney(pnl, settings.currency, true)}</strong></span>
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

function PerformanceLedger({ label, trades, target, currency, goSettings }) {
  const tradingRecords = trades.filter((trade) => !isWithdrawal(trade))
  const pnl = totalPnl(tradingRecords)
  const wins = tradingRecords.filter((trade) => pnlOf(trade) > 0).length
  const winRate = tradingRecords.length ? Math.round((wins / tradingRecords.length) * 100) : 0
  const tradeDays = new Set(tradingRecords.map((trade) => trade.date)).size
  const progress = target > 0 ? Math.max(0, Math.min(100, (pnl / target) * 100)) : 0
  return (
    <section className="performance-ledger">
      <div className="ledger-net">
        <span>{label}</span>
        <strong className={pnl < 0 ? 'loss-text' : pnl > 0 ? 'profit-text' : ''}>{formatMoney(pnl, currency, true)}</strong>
      </div>
      <div className="ledger-stat"><span>Trades</span><strong>{tradingRecords.length}</strong></div>
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

function MonthView({ trades, settings, cursor, openDay, goSettings }) {
  const filtered = trades.filter((trade) => {
    const date = fromDateKey(trade.date)
    return date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth()
  })
  const cells = monthCells(cursor, settings.showWeekends)
  const labels = settings.showWeekends ? weekdayLabels : weekdayLabels.slice(0, 5)

  return (
    <>
      <PerformanceLedger label="Net P&L this month" trades={filtered} target={settings.monthlyGoal} currency={settings.currency} goSettings={goSettings} />

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
            const tradingRecords = dayTrades.filter((trade) => !isWithdrawal(trade))
            const dayPnl = totalPnl(tradingRecords)
            const onPlan = isWithinDailyLossBudget(trades, settings, key)
            const restDay = !tradingRecords.length
            const dayStopped = isDailyStopLossReached(trades, settings, key)
            const isToday = key === dateKey(new Date())
            return (
              <button
                key={key}
                className={`day-cell ${onPlan ? 'win on-plan' : 'lose'} ${restDay ? 'rest-day' : ''} ${dayStopped && !onPlan ? 'stop-loss' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => openDay(date)}
                aria-label={`${date.getDate()} ${onPlan ? 'within daily loss budget' : 'daily loss budget exceeded'} ${formatMoney(dayPnl, settings.currency, true)}`}
              >
                <span className="day-number">{date.getDate()}</span>
                {tradingRecords.length ? (
                  <>
                    <strong>{formatCompactMoney(dayPnl, settings.currency)}</strong>
                    <small>{tradingRecords.length} {tradingRecords.length === 1 ? 'trade' : 'trades'}</small>
                  </>
                ) : <><strong>+{formatCompactMoney(0, settings.currency)}</strong><small>{dayTrades.some(isWithdrawal) ? 'Withdrawal' : 'No trades'}</small></>}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

function DayView({ date, trades, settings, openNewTrade, editTrade, deleteTrade, openImage }) {
  const key = dateKey(date)
  const dayTrades = trades.filter((trade) => trade.date === key)
  const tradingRecords = dayTrades.filter((trade) => !isWithdrawal(trade))
  const wins = tradingRecords.filter((trade) => pnlOf(trade) > 0)
  const losses = tradingRecords.filter((trade) => pnlOf(trade) < 0)
  const stopLoss = dailyStopLossFor(settings, key)
  const stopped = isDailyStopLossReached(trades, settings, key)
  return (
    <>
      <section className="day-ledger">
        <div className="ledger-net"><span>Net P&L</span><strong className={totalPnl(tradingRecords) < 0 ? 'loss-text' : totalPnl(tradingRecords) > 0 ? 'profit-text' : ''}>{formatMoney(totalPnl(tradingRecords), settings.currency, true)}</strong></div>
        <div className="ledger-stat"><span>Trades</span><strong>{tradingRecords.length}</strong></div>
        <div className="ledger-stat profit"><span>Profit</span><strong>{formatMoney(totalPnl(wins), settings.currency)}</strong><small>{wins.length} {wins.length === 1 ? 'trade' : 'trades'}</small></div>
        <div className="ledger-stat loss"><span>Loss</span><strong>{formatMoney(Math.abs(totalPnl(losses)), settings.currency)}</strong><small>{losses.length} {losses.length === 1 ? 'trade' : 'trades'}</small></div>
      </section>

      {stopped && <section className="stop-loss-alert" role="alert"><LockKeyhole size={19} /><div><strong>Daily loss limit reached</strong><span>Loss reached {formatMoney(stopLoss, settings.currency)}. Do not trade again today.</span></div></section>}

      <div className="section-heading">
        <div><h2>Trades</h2></div>
        <button className="primary-button" onClick={() => openNewTrade(key)}><Plus size={18} /> {stopped ? 'Add withdrawal' : 'Add trade'}</button>
      </div>

      {dayTrades.length ? (
        <div className="trade-list">
          {dayTrades.map((trade) => (
            <TradeCard key={trade.id} trade={trade} currency={settings.currency} onEdit={editTrade} onDelete={deleteTrade} onImage={openImage} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={CalendarDays}
          title="No trades yet"
          text="Add a result, note, lesson, or chart."
          action={() => openNewTrade(key)}
        />
      )}
    </>
  )
}

function TradeCard({ trade, currency, onEdit, onDelete, onImage }) {
  const pnl = pnlOf(trade)
  const withdrawal = isWithdrawal(trade)
  const title = withdrawal ? 'Withdrawal' : trade.symbol || 'Unspecified market'
  const subtitle = withdrawal ? 'Cash withdrawn' : trade.setup || (trade.side === 'profit' ? 'Profit' : 'Loss')
  return (
    <article className={`trade-card ${withdrawal ? 'withdrawal-card' : ''}`}>
      <div className={`trade-side ${trade.side}`}><span>{withdrawal ? <CircleDollarSign /> : trade.side === 'profit' ? <ArrowUpRight /> : <ArrowDownRight />}</span></div>
      <div className="trade-content">
        <div className="trade-title-row">
          <div><h3>{title}</h3><p>{subtitle} · {trade.time}</p></div>
          <strong className={withdrawal ? 'withdrawal-text' : pnl >= 0 ? 'profit-text' : 'loss-text'}>{withdrawal ? formatMoney(-Math.abs(Number(trade.amount)), currency, true) : formatMoney(pnl, currency, true)}</strong>
        </div>
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

function YearView({ trades, settings, cursor, openDay, goSettings }) {
  const yearTrades = trades.filter((trade) => fromDateKey(trade.date).getFullYear() === cursor.getFullYear())
  return (
    <>
      <PerformanceLedger label="Net P&L this year" trades={yearTrades} target={settings.yearlyGoal} currency={settings.currency} goSettings={goSettings} />
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, month) => (
          <MiniMonth
            key={month}
            year={cursor.getFullYear()}
            month={month}
            trades={trades}
            settings={settings}
            currency={settings.currency}
            onOpen={(date) => openDay(date)}
          />
        ))}
      </div>
    </>
  )
}

function MiniMonth({ year, month, trades, settings, currency, onOpen }) {
  const date = new Date(year, month, 1, 12)
  const cells = monthCells(date, true)
  const monthTrades = trades.filter((trade) => {
    const itemDate = fromDateKey(trade.date)
    return itemDate.getFullYear() === year && itemDate.getMonth() === month
  })
  const total = totalPnl(monthTrades)
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
          const pnl = totalPnl(trades.filter((trade) => trade.date === key && !isWithdrawal(trade)))
          const onPlan = isWithinDailyLossBudget(trades, settings, key)
          return <button key={key} className={`heat ${onPlan ? 'win' : 'lose'}`} onClick={() => onOpen(day)} title={`${day.getDate()}: ${formatMoney(pnl, currency, true)}`} />
        })}
      </div>
      <p>{monthTrades.length} {monthTrades.length === 1 ? 'trade' : 'trades'}</p>
    </article>
  )
}

function AllTimeView({ trades, settings, openDay }) {
  const tradingRecords = trades.filter((trade) => !isWithdrawal(trade))
  const yearMap = useMemo(() => {
    const grouped = new Map()
    for (const trade of tradingRecords) {
      const year = fromDateKey(trade.date).getFullYear()
      if (!grouped.has(year)) grouped.set(year, [])
      grouped.get(year).push(trade)
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0])
  }, [tradingRecords])
  const pnl = totalPnl(tradingRecords)
  return (
    <>
      <article className="all-time-hero panel">
        <div><h2>All time</h2><p>{tradingRecords.length} {tradingRecords.length === 1 ? 'trade' : 'trades'} · {yearMap.length} {yearMap.length === 1 ? 'year' : 'years'}</p></div>
        <strong className={pnl < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(pnl, settings.currency, true)}</strong>
      </article>
      {yearMap.length ? (
        <div className="year-list">
          {yearMap.map(([year, entries]) => {
            const value = totalPnl(entries)
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

function AnalyticsPage({ trades, settings }) {
  const tradingRecords = trades.filter((trade) => !isWithdrawal(trade))
  const wins = tradingRecords.filter((trade) => pnlOf(trade) > 0)
  const losses = tradingRecords.filter((trade) => pnlOf(trade) < 0)
  const grossProfit = totalPnl(wins)
  const grossLoss = Math.abs(totalPnl(losses))
  const winRate = tradingRecords.length ? (wins.length / tradingRecords.length) * 100 : 0
  const factor = grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const expectancy = tradingRecords.length ? totalPnl(tradingRecords) / tradingRecords.length : 0
  const dailyMap = new Map()
  tradingRecords.forEach((trade) => dailyMap.set(trade.date, (dailyMap.get(trade.date) || 0) + pnlOf(trade)))
  const bestDay = [...dailyMap.values()].sort((a, b) => b - a)[0] || 0
  const ordered = [...tradingRecords].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  let running = 0
  const equity = ordered.map((trade) => {
    running += pnlOf(trade)
    return running
  })
  const monthly = makeMonthlyResults(tradingRecords, settings.currency)

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><h1>Insights</h1></div>
        <div className="account-chip"><span className="status-dot" />{settings.accountName}</div>
      </div>

      <div className="analytics-hero panel">
        <div><p>All-time net P&L</p><strong className={totalPnl(tradingRecords) < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(totalPnl(tradingRecords), settings.currency, true)}</strong><span>{tradingRecords.length} {tradingRecords.length === 1 ? 'trade' : 'trades'} recorded</span></div>
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

function makeMonthlyResults(trades) {
  const grouped = new Map()
  for (const trade of trades) {
    const key = trade.date.slice(0, 7)
    grouped.set(key, (grouped.get(key) || 0) + pnlOf(trade))
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
    onSave({ ...form, monthlyGoal: Math.max(0, Number(form.monthlyGoal) || 0), yearlyGoal: Math.max(0, Number(form.yearlyGoal) || 0), dailyStopLossByMonth })
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

function TradeModal({ date, trade, locked = false, currency, onClose, onSave, notify }) {
  const [form, setForm] = useState(() => ({
    side: trade?.side || (locked ? 'withdrawal' : 'profit'),
    amount: trade?.amount || '',
    date: trade?.date || date,
    time: trade?.time || nowTime(),
    symbol: assets.includes(trade?.symbol) ? trade.symbol : 'XAUUSD',
    setup: trade?.setup || '',
    note: trade?.note || '',
    lesson: trade?.lesson || '',
    image: trade?.image || null,
  }))
  const [saving, setSaving] = useState(false)
  const amountRef = useRef(null)

  useEffect(() => {
    document.body.classList.add('modal-open')
    const escape = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', escape)
    window.setTimeout(() => amountRef.current?.focus(), 100)
    return () => {
      document.body.classList.remove('modal-open')
      window.removeEventListener('keydown', escape)
    }
  }, [onClose])

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
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
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      notify('Enter an amount greater than 0.')
      amountRef.current?.focus()
      return
    }
    if (form.side !== 'withdrawal' && !form.setup.trim()) {
      notify('Add the setup before saving this trade.')
      return
    }
    if (form.side !== 'withdrawal' && !form.image) {
      notify('Add a trade chart before saving.')
      return
    }
    setSaving(true)
    try {
      await onSave({
        id: trade?.id || safeId(),
        createdAt: trade?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...form,
        amount: Math.abs(amount),
        symbol: form.side === 'withdrawal' ? '' : form.symbol,
        setup: form.side === 'withdrawal' ? '' : form.setup.trim(),
        note: form.note.trim(),
        lesson: form.lesson.trim(),
        image: form.side === 'withdrawal' ? null : form.image,
      })
    } catch {
      notify("Couldn't save this trade. Try again.")
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title">
        <div className="modal-header">
          <div><p className="modal-context">{new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(fromDateKey(form.date))}</p><h2 id="trade-modal-title">{trade ? 'Edit trade' : 'Add trade'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <form onSubmit={submit}>
          <div className="outcome-switch">
            <button type="button" className={form.side === 'profit' ? 'active profit' : ''} onClick={() => change('side', 'profit')} disabled={locked}><ArrowUpRight /> Profit</button>
            <button type="button" className={form.side === 'loss' ? 'active loss' : ''} onClick={() => change('side', 'loss')} disabled={locked}><ArrowDownRight /> Loss</button>
            <button type="button" className={form.side === 'withdrawal' ? 'active withdrawal' : ''} onClick={() => change('side', 'withdrawal')}><CircleDollarSign /> Withdrawal</button>
          </div>

          <div className="form-grid">
            <label className="amount-field">{form.side === 'withdrawal' ? `Withdrawal amount (${currency})` : `P&L (${currency})`}<div><span>{form.side === 'loss' || form.side === 'withdrawal' ? '−' : '+'}</span><input ref={amountRef} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(event) => change('amount', event.target.value)} /></div></label>
            <label>Date<input type="date" value={form.date} onChange={(event) => change('date', event.target.value)} required /></label>
            <label>Time<input type="time" value={form.time} onChange={(event) => change('time', event.target.value)} required /></label>
            {form.side !== 'withdrawal' && <>
              <label>Asset<select value={form.symbol} onChange={(event) => change('symbol', event.target.value)} required>{assets.map((asset) => <option key={asset} value={asset}>{asset}</option>)}</select></label>
              <label className="full-field">Setup<input placeholder="Breakout + retest" value={form.setup} onChange={(event) => change('setup', event.target.value)} maxLength={80} required /></label>
            </>}
            <label className="full-field">Note (optional)<textarea placeholder="What happened?" value={form.note} onChange={(event) => change('note', event.target.value)} maxLength={500} /></label>
            <label className="full-field">Lesson (optional)<textarea placeholder="Next time…" value={form.lesson} onChange={(event) => change('lesson', event.target.value)} maxLength={500} /></label>
          </div>

          {form.side !== 'withdrawal' && (
            <div className="upload-field">
              <div><strong>Trade chart</strong><span>Required · image up to 5 MB</span></div>
              {form.image ? (
                <div className="upload-preview"><img src={form.image.dataUrl} alt="Trade chart preview" /><div><span>{form.image.name}</span><button type="button" onClick={() => change('image', null)}><Trash2 size={16} /> Remove</button></div></div>
              ) : (
                <label className="upload-button"><ImagePlus size={22} /><span><strong>Add required image</strong></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} /></label>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : trade ? 'Save changes' : 'Save trade'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default App
