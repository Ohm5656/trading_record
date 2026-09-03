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

const locale = 'th-TH-u-ca-gregory'
const viewOptions = [
  { id: 'day', label: 'วัน' },
  { id: 'month', label: 'เดือน' },
  { id: 'year', label: 'ปี' },
  { id: 'all', label: 'ทั้งหมด' },
]
const weekdayLabels = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.']
const currencies = ['USD', 'THB', 'EUR', 'GBP', 'JPY', 'SGD']

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
  return trade.side === 'loss' ? -Math.abs(Number(trade.amount)) : Math.abs(Number(trade.amount))
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
      reject(new Error('รูปภาพต้องมีขนาดไม่เกิน 5 MB'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result })
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์นี้ได้'))
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
      .catch(() => notify('เปิดฐานข้อมูลไม่สำเร็จ ลองรีเฟรชอีกครั้ง'))
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

  async function persistTrade(trade) {
    await saveTrade(trade, currentUser.id)
    setTrades((current) => {
      const without = current.filter((item) => item.id !== trade.id)
      return [trade, ...without].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    })
    setSelectedDate(trade.date)
    setCursor(fromDateKey(trade.date))
    setTradeModal(null)
    notify(tradeModal?.trade ? 'อัปเดตรายการแล้ว' : 'บันทึกการเทรดแล้ว')
  }

  async function deleteTrade(trade) {
    if (!window.confirm(`ลบรายการ ${trade.symbol || 'เทรดนี้'} ใช่ไหม?`)) return
    await removeTrade(trade.id, currentUser.id)
    setTrades((current) => current.filter((item) => item.id !== trade.id))
    notify('ลบรายการแล้ว')
  }

  async function updatePreferences(next) {
    await saveSettings(currentUser.id, next)
    setSettingsState(next)
    notify('บันทึกการตั้งค่าแล้ว')
  }

  const openNewTrade = (date = selectedDate) => setTradeModal({ date, trade: null })
  const openDay = (date) => {
    setCursor(date)
    setSelectedDate(dateKey(date))
    setView('day')
  }

  if (loading) {
    return (
      <div className="splash-screen">
        <img className="splash-logo" src="/trade-rise-logo.png" alt="Trade Rise" />
        <p>กำลังเปิดสมุดเทรด…</p>
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
      <aside className="desktop-rail">
        <Brand />
        <NavItems page={page} setPage={setPage} />
        <button className="rail-add" onClick={() => openNewTrade(dateKey(new Date()))}><Plus size={20} /> เพิ่มรายการ</button>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <Brand />
          <div className="topbar-actions">
            {!online && <span className="offline-pill"><WifiOff size={14} /> ออฟไลน์</span>}
            <button className="user-chip" onClick={() => setPage('settings')}>
              <span>{currentUser.name.slice(0, 1).toUpperCase()}</span>
              <div><strong>{currentUser.name}</strong><small>{currentUser.email}</small></div>
            </button>
            <button className="primary-button compact" onClick={() => openNewTrade(dateKey(new Date()))}>
              <Plus size={18} /> เพิ่มการเทรด
            </button>
          </div>
        </header>

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
                notify('นำเข้าข้อมูลเรียบร้อย')
              }}
              onClear={async () => {
                await clearAllData(currentUser.id)
                setTrades([])
                setSettingsState(defaults)
                notify('ล้างข้อมูลทั้งหมดแล้ว')
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

      <nav className="bottom-nav" aria-label="เมนูหลัก">
        <NavItems page={page} setPage={setPage} />
      </nav>

      <button className="mobile-fab" aria-label="เพิ่มการเทรด" onClick={() => openNewTrade(dateKey(new Date()))}>
        <Plus size={27} />
      </button>

      {tradeModal && (
        <TradeModal
          key={tradeModal.trade?.id || tradeModal.date}
          date={tradeModal.date}
          trade={tradeModal.trade}
          currency={settings.currency}
          onClose={() => setTradeModal(null)}
          onSave={persistTrade}
          notify={notify}
        />
      )}

      {lightbox && (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <button className="icon-button lightbox-close" onClick={() => setLightbox(null)} aria-label="ปิด"><X /></button>
          <img src={lightbox.dataUrl} alt={lightbox.name || 'ภาพแผนการเทรด'} onClick={(event) => event.stopPropagation()} />
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
      setError('กรุณาระบุชื่ออย่างน้อย 2 ตัวอักษร')
      return
    }
    if (password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      return
    }
    setSubmitting(true)
    try {
      const user = mode === 'login'
        ? await loginUser({ email, password })
        : await registerUser({ name, email, password })
      await onAuthenticated(user)
    } catch (authError) {
      setError(authError.message || 'เข้าสู่ระบบไม่สำเร็จ')
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-brand-panel">
        <div className="auth-logo-wrap"><img src="/trade-rise-logo.png" alt="Trade Rise" /></div>
        <div className="auth-statement">
          <span>TRADING JOURNAL</span>
          <h1>บันทึกให้ชัด<br />เทรดให้มีระบบ</h1>
          <p>พื้นที่ส่วนตัวสำหรับแผน ผลลัพธ์ และบทเรียนจากทุกการตัดสินใจของคุณ</p>
        </div>
        <small className="auth-footnote">PLAN · TRADE · PROFIT</small>
      </section>

      <section className="auth-form-panel">
        <div className="auth-mobile-brand"><Brand /></div>
        <div className="auth-form-wrap">
          <header>
            <p>{mode === 'login' ? 'ยินดีต้อนรับกลับ' : 'เริ่มต้นใช้งาน'}</p>
            <h2>{mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี Trade Rise'}</h2>
            <span>{mode === 'login' ? 'ข้อมูลและ session ของคุณจะอยู่บนอุปกรณ์นี้' : 'สร้างพื้นที่บันทึกที่แยกจากผู้ใช้อื่นบนเครื่องเดียวกัน'}</span>
          </header>

          <div className="auth-tabs" role="tablist">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => switchMode('login')}>เข้าสู่ระบบ</button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => switchMode('register')}>สมัครสมาชิก</button>
          </div>

          <form className="auth-form" onSubmit={submit}>
            {mode === 'register' && (
              <label>ชื่อที่ใช้แสดง<div className="auth-input"><UserRound size={18} /><input value={name} onChange={(event) => setName(event.target.value)} placeholder="ชื่อของคุณ" autoComplete="name" required /></div></label>
            )}
            <label>อีเมล<div className="auth-input"><span className="at-sign">@</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" required /></div></label>
            <label>รหัสผ่าน<div className="auth-input"><LockKeyhole size={18} /><input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>

            {error && <div className="auth-error" role="alert">{error}</div>}

            <button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'กำลังตรวจสอบ…' : mode === 'login' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}
              {!submitting && <ArrowUpRight size={19} />}
            </button>
            <p className="session-note"><Check size={14} /> ระบบจะจำการเข้าสู่ระบบบนอุปกรณ์นี้จนกว่าคุณจะกดออกจากระบบ</p>
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
    { id: 'calendar', label: 'ปฏิทิน', icon: CalendarDays },
    { id: 'analytics', label: 'วิเคราะห์', icon: BarChart3 },
    { id: 'settings', label: 'ตั้งค่า', icon: SettingsIcon },
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

function CalendarPage(props) {
  const { view, setView, cursor, setCursor } = props
  return (
    <section className="page-section calendar-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">TRADING JOURNAL</p>
          <h1>ปฏิทินผลการเทรด</h1>
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
      <button className="icon-button" onClick={previous} aria-label="ก่อนหน้า"><ChevronLeft /></button>
      <button className="period-title" onClick={today} title="กลับมาวันนี้">{label}</button>
      <button className="icon-button" onClick={next} aria-label="ถัดไป"><ChevronRight /></button>
    </div>
  )
}

function SummaryCard({ label, value, tone = '', icon: Icon, children }) {
  return (
    <article className={`summary-card ${tone}`}>
      <div className="summary-label">{Icon && <span className="summary-icon"><Icon size={18} /></span>}{label}</div>
      {value != null && <div className="summary-value">{value}</div>}
      {children}
    </article>
  )
}

function GoalCard({ current, target, currency, label, goSettings }) {
  const progress = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0
  return (
    <SummaryCard label={label} icon={Target}>
      <div className="goal-row"><strong>{formatMoney(current, currency)}</strong><span>{target > 0 ? formatMoney(target, currency) : 'ยังไม่ตั้ง'}</span></div>
      <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
      <button className="text-button" onClick={goSettings}>แก้ไขเป้าหมาย</button>
    </SummaryCard>
  )
}

function MonthView({ trades, settings, cursor, openDay, goSettings }) {
  const filtered = trades.filter((trade) => {
    const date = fromDateKey(trade.date)
    return date.getFullYear() === cursor.getFullYear() && date.getMonth() === cursor.getMonth()
  })
  const pnl = totalPnl(filtered)
  const cells = monthCells(cursor, settings.showWeekends)
  const labels = settings.showWeekends ? weekdayLabels : weekdayLabels.slice(0, 5)

  return (
    <>
      <div className="summary-grid two">
        <SummaryCard label="กำไร / ขาดทุนสุทธิ" value={formatMoney(pnl, settings.currency, true)} tone={pnl < 0 ? 'negative' : 'positive'} icon={WalletCards}>
          <p className="summary-caption">{filtered.length} รายการในเดือนนี้</p>
        </SummaryCard>
        <GoalCard current={pnl} target={settings.monthlyGoal} currency={settings.currency} label="เป้าหมายประจำเดือน" goSettings={goSettings} />
      </div>

      <div className="calendar-panel panel">
        <div className="panel-heading">
          <div><h2>ภาพรวมรายวัน</h2><p>{settings.showWeekends ? 'แสดงทุกวัน' : 'ซ่อนวันเสาร์–อาทิตย์'}</p></div>
          <span className="legend"><i className="gain" /> กำไร <i className="loss" /> ขาดทุน</span>
        </div>
        <div className={`calendar-grid ${settings.showWeekends ? '' : 'workweek'}`}>
          {labels.map((label) => <div className="weekday" key={label}>{label}</div>)}
          {cells.map((date, index) => {
            if (!date) return <span className="day-cell blank" key={`blank-${index}`} />
            const key = dateKey(date)
            const dayTrades = trades.filter((trade) => trade.date === key)
            const dayPnl = totalPnl(dayTrades)
            const isToday = key === dateKey(new Date())
            return (
              <button
                key={key}
                className={`day-cell ${dayPnl > 0 ? 'win' : ''} ${dayPnl < 0 ? 'lose' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => openDay(date)}
                aria-label={`${date.getDate()} ${dayPnl ? formatMoney(dayPnl, settings.currency, true) : 'ไม่มีรายการ'}`}
              >
                <span className="day-number">{date.getDate()}</span>
                {dayTrades.length ? (
                  <>
                    <strong>{formatMoney(dayPnl, settings.currency, true)}</strong>
                    <small>{dayTrades.length} {dayTrades.length === 1 ? 'trade' : 'trades'}</small>
                  </>
                ) : <span className="empty-dash">—</span>}
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
  const wins = dayTrades.filter((trade) => pnlOf(trade) > 0)
  const losses = dayTrades.filter((trade) => pnlOf(trade) < 0)
  return (
    <>
      <div className="summary-grid three day-summary">
        <SummaryCard label={`P&L วันนี้ (${dayTrades.length})`} value={formatMoney(totalPnl(dayTrades), settings.currency, true)} tone={totalPnl(dayTrades) < 0 ? 'negative' : 'positive'} icon={CircleDollarSign} />
        <SummaryCard label={`กำไร (${wins.length})`} value={formatMoney(totalPnl(wins), settings.currency)} tone="positive" icon={ArrowUpRight} />
        <SummaryCard label={`ขาดทุน (${losses.length})`} value={formatMoney(Math.abs(totalPnl(losses)), settings.currency)} tone="negative" icon={ArrowDownRight} />
      </div>

      <div className="section-heading">
        <div><h2>รายการเทรด</h2><p>{dayTrades.length ? 'รายละเอียดทั้งหมดของวันนี้' : 'ยังไม่มีรายการสำหรับวันนี้'}</p></div>
        <button className="primary-button" onClick={() => openNewTrade(key)}><Plus size={18} /> เพิ่มรายการ</button>
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
          title="วันนี้ยังว่างอยู่"
          text="บันทึกผลลัพธ์ โน้ต บทเรียน และแนบภาพแผนการเทรดไว้ทบทวนภายหลัง"
          action={() => openNewTrade(key)}
        />
      )}
    </>
  )
}

function TradeCard({ trade, currency, onEdit, onDelete, onImage }) {
  const pnl = pnlOf(trade)
  return (
    <article className="trade-card">
      <div className={`trade-side ${trade.side}`}><span>{trade.side === 'profit' ? <ArrowUpRight /> : <ArrowDownRight />}</span></div>
      <div className="trade-content">
        <div className="trade-title-row">
          <div><h3>{trade.symbol || 'ไม่ระบุสินทรัพย์'}</h3><p>{trade.setup || (trade.side === 'profit' ? 'กำไร' : 'ขาดทุน')} · {trade.time} น.</p></div>
          <strong className={pnl >= 0 ? 'profit-text' : 'loss-text'}>{formatMoney(pnl, currency, true)}</strong>
        </div>
        {(trade.note || trade.lesson) && (
          <div className="trade-notes">
            {trade.note && <p><span>บันทึก</span>{trade.note}</p>}
            {trade.lesson && <p><span>บทเรียน</span>{trade.lesson}</p>}
          </div>
        )}
        {trade.image && <button className="image-thumb" onClick={() => onImage(trade.image)}><img src={trade.image.dataUrl} alt={trade.image.name || 'ภาพแผน'} /><span>ดูภาพแผน</span></button>}
      </div>
      <div className="trade-actions">
        <button className="icon-button" onClick={() => onEdit(trade)} aria-label="แก้ไข"><Pencil size={17} /></button>
        <button className="icon-button danger" onClick={() => onDelete(trade)} aria-label="ลบ"><Trash2 size={17} /></button>
      </div>
    </article>
  )
}

function YearView({ trades, settings, cursor, openDay, goSettings }) {
  const yearTrades = trades.filter((trade) => fromDateKey(trade.date).getFullYear() === cursor.getFullYear())
  const pnl = totalPnl(yearTrades)
  return (
    <>
      <div className="summary-grid two">
        <SummaryCard label="กำไร / ขาดทุนสุทธิ" value={formatMoney(pnl, settings.currency, true)} tone={pnl < 0 ? 'negative' : 'positive'} icon={WalletCards}>
          <p className="summary-caption">{yearTrades.length} รายการในปีนี้</p>
        </SummaryCard>
        <GoalCard current={pnl} target={settings.yearlyGoal} currency={settings.currency} label="เป้าหมายประจำปี" goSettings={goSettings} />
      </div>
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, month) => (
          <MiniMonth
            key={month}
            year={cursor.getFullYear()}
            month={month}
            trades={trades}
            currency={settings.currency}
            onOpen={(date) => openDay(date)}
          />
        ))}
      </div>
    </>
  )
}

function MiniMonth({ year, month, trades, currency, onOpen }) {
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
          const pnl = totalPnl(trades.filter((trade) => trade.date === dateKey(day)))
          return <button key={dateKey(day)} className={`heat ${pnl > 0 ? 'win' : pnl < 0 ? 'lose' : ''}`} onClick={() => onOpen(day)} title={`${day.getDate()}: ${formatMoney(pnl, currency, true)}`} />
        })}
      </div>
      <p>{monthTrades.length} รายการ</p>
    </article>
  )
}

function AllTimeView({ trades, settings, openDay }) {
  const yearMap = useMemo(() => {
    const grouped = new Map()
    for (const trade of trades) {
      const year = fromDateKey(trade.date).getFullYear()
      if (!grouped.has(year)) grouped.set(year, [])
      grouped.get(year).push(trade)
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0])
  }, [trades])
  const pnl = totalPnl(trades)
  return (
    <>
      <article className="all-time-hero panel">
        <div><p className="eyebrow">ALL-TIME PERFORMANCE</p><h2>ผลลัพธ์ตลอดการเทรด</h2><p>{trades.length} รายการ · {yearMap.length} ปี</p></div>
        <strong className={pnl < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(pnl, settings.currency, true)}</strong>
      </article>
      {yearMap.length ? (
        <div className="year-list">
          {yearMap.map(([year, entries]) => {
            const value = totalPnl(entries)
            return (
              <button key={year} onClick={() => openDay(fromDateKey(entries[0].date))}>
                <span><strong>{year}</strong><small>{entries.length} รายการ</small></span>
                <strong className={value < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(value, settings.currency, true)}</strong>
                <ChevronRight size={20} />
              </button>
            )
          })}
        </div>
      ) : <EmptyState icon={LineChart} title="เริ่มสร้างสถิติของคุณ" text="เมื่อบันทึกการเทรด ผลลัพธ์แยกตามปีจะแสดงที่นี่" />}
    </>
  )
}

function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty-state panel">
      <span><Icon size={26} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action && <button className="primary-button" onClick={action}><Plus size={17} /> เพิ่มการเทรดครั้งแรก</button>}
    </div>
  )
}

function AnalyticsPage({ trades, settings }) {
  const wins = trades.filter((trade) => pnlOf(trade) > 0)
  const losses = trades.filter((trade) => pnlOf(trade) < 0)
  const grossProfit = totalPnl(wins)
  const grossLoss = Math.abs(totalPnl(losses))
  const winRate = trades.length ? (wins.length / trades.length) * 100 : 0
  const factor = grossLoss ? grossProfit / grossLoss : grossProfit ? Infinity : 0
  const avgWin = wins.length ? grossProfit / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const expectancy = trades.length ? totalPnl(trades) / trades.length : 0
  const dailyMap = new Map()
  trades.forEach((trade) => dailyMap.set(trade.date, (dailyMap.get(trade.date) || 0) + pnlOf(trade)))
  const bestDay = [...dailyMap.values()].sort((a, b) => b - a)[0] || 0
  const ordered = [...trades].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
  let running = 0
  const equity = ordered.map((trade) => {
    running += pnlOf(trade)
    return running
  })
  const monthly = makeMonthlyResults(trades, settings.currency)

  return (
    <section className="page-section">
      <div className="page-heading">
        <div><p className="eyebrow">PERFORMANCE</p><h1>วิเคราะห์การเทรด</h1></div>
        <div className="account-chip"><span className="status-dot" />{settings.accountName}</div>
      </div>

      <div className="analytics-hero panel">
        <div><p>กำไร / ขาดทุนสะสม</p><strong className={totalPnl(trades) < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(totalPnl(trades), settings.currency, true)}</strong><span>{trades.length} รายการทั้งหมด</span></div>
        <EquityChart values={equity} />
      </div>

      <div className="metrics-grid">
        <Metric label="Win rate" value={`${winRate.toFixed(1)}%`} detail={`${wins.length} ชนะ / ${losses.length} แพ้`} />
        <Metric label="Profit factor" value={factor === Infinity ? '∞' : factor.toFixed(2)} detail="กำไรรวม ÷ ขาดทุนรวม" />
        <Metric label="Expectancy" value={formatMoney(expectancy, settings.currency, true)} detail="ผลลัพธ์เฉลี่ยต่อรายการ" tone={expectancy < 0 ? 'loss' : 'profit'} />
        <Metric label="วันที่ดีที่สุด" value={formatMoney(bestDay, settings.currency, true)} detail="P&L รายวันสูงสุด" tone={bestDay < 0 ? 'loss' : 'profit'} />
        <Metric label="กำไรเฉลี่ย" value={formatMoney(avgWin, settings.currency)} detail="เฉลี่ยเฉพาะรายการชนะ" tone="profit" />
        <Metric label="ขาดทุนเฉลี่ย" value={formatMoney(avgLoss, settings.currency)} detail="เฉลี่ยเฉพาะรายการแพ้" tone="loss" />
      </div>

      <div className="panel monthly-performance">
        <div className="panel-heading"><div><h2>ผลลัพธ์รายเดือน</h2><p>6 เดือนล่าสุดที่มีข้อมูล</p></div></div>
        {monthly.length ? monthly.map((item) => (
          <div className="month-result" key={item.key}>
            <span>{item.label}</span>
            <div><i className={item.value < 0 ? 'loss' : ''} style={{ width: `${item.width}%` }} /></div>
            <strong className={item.value < 0 ? 'loss-text' : 'profit-text'}>{formatMoney(item.value, settings.currency, true)}</strong>
          </div>
        )) : <p className="no-data">เพิ่มรายการเทรดเพื่อเริ่มวิเคราะห์ผลลัพธ์</p>}
      </div>
    </section>
  )
}

function Metric({ label, value, detail, tone }) {
  return <article className="metric-card"><p>{label}</p><strong className={tone === 'loss' ? 'loss-text' : tone === 'profit' ? 'profit-text' : ''}>{value}</strong><span>{detail}</span></article>
}

function EquityChart({ values }) {
  if (!values.length) return <div className="chart-empty"><LineChart size={28} /><span>กราฟจะแสดงเมื่อมีข้อมูล</span></div>
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
    <svg className="equity-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="กราฟผลกำไรสะสม">
      <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#31e981" stopOpacity=".35" /><stop offset="1" stopColor="#31e981" stopOpacity="0" /></linearGradient></defs>
      <line x1="0" y1={zeroY} x2={width} y2={zeroY} stroke="#2b3834" strokeDasharray="6 8" />
      <polygon points={`0,${height} ${points} ${width},${height}`} fill="url(#area)" />
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
  const importRef = useRef(null)
  useEffect(() => setForm(settings), [settings])

  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const submit = (event) => {
    event.preventDefault()
    onSave({ ...form, monthlyGoal: Math.max(0, Number(form.monthlyGoal) || 0), yearlyGoal: Math.max(0, Number(form.yearlyGoal) || 0) })
  }
  const exportData = () => {
    const content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, trades }, null, 2)
    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `edge-journal-backup-${dateKey(new Date())}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('ส่งออกไฟล์สำรองแล้ว')
  }
  const importFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!Array.isArray(parsed.trades)) throw new Error()
      if (!window.confirm(`นำเข้า ${parsed.trades.length} รายการและแทนที่ข้อมูลปัจจุบันใช่ไหม?`)) return
      await onImport(parsed)
    } catch {
      notify('ไฟล์สำรองไม่ถูกต้อง')
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
    notify('บน iPhone: แตะแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”')
  }

  return (
    <section className="page-section settings-page">
      <div className="page-heading settings-heading">
        <div><p className="eyebrow">ACCOUNT & PREFERENCES</p><h1>ตั้งค่า</h1></div>
        <button className="logout-button" onClick={onLogout}><LogOut size={17} /> ออกจากระบบ</button>
      </div>
      <section className="profile-strip">
        <span className="profile-avatar">{user.name.slice(0, 1).toUpperCase()}</span>
        <div><strong>{user.name}</strong><small>{user.email}</small></div>
        <p><i /> กำลังเข้าสู่ระบบบนอุปกรณ์นี้</p>
      </section>
      <form onSubmit={submit}>
        <div className="settings-grid">
          <section className="settings-card panel">
            <div className="settings-title"><span><WalletCards /></span><div><h2>บัญชีและสกุลเงิน</h2><p>ใช้กับผลลัพธ์และรายงานทั้งหมด</p></div></div>
            <label>ชื่อบัญชี<input value={form.accountName} onChange={(event) => change('accountName', event.target.value)} maxLength={40} required /></label>
            <label>สกุลเงิน<select value={form.currency} onChange={(event) => change('currency', event.target.value)}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></label>
          </section>

          <section className="settings-card panel">
            <div className="settings-title"><span><Target /></span><div><h2>เป้าหมาย</h2><p>ติดตามความคืบหน้าในหน้าปฏิทิน</p></div></div>
            <label>เป้าหมายรายเดือน<input type="number" min="0" step="0.01" value={form.monthlyGoal} onChange={(event) => change('monthlyGoal', event.target.value)} /></label>
            <label>เป้าหมายรายปี<input type="number" min="0" step="0.01" value={form.yearlyGoal} onChange={(event) => change('yearlyGoal', event.target.value)} /></label>
          </section>

          <section className="settings-card panel">
            <div className="settings-title"><span><CalendarDays /></span><div><h2>ปฏิทิน</h2><p>ปรับรูปแบบวันที่ต้องการติดตาม</p></div></div>
            <label className="toggle-row"><span><strong>แสดงวันหยุดสุดสัปดาห์</strong><small>รวมวันเสาร์และอาทิตย์ในปฏิทิน</small></span><input type="checkbox" checked={form.showWeekends} onChange={(event) => change('showWeekends', event.target.checked)} /><i /></label>
          </section>

          <section className="settings-card panel">
            <div className="settings-title"><span><Smartphone /></span><div><h2>ติดตั้งแอป</h2><p>เปิดใช้งานแบบเต็มหน้าจอและออฟไลน์</p></div></div>
            <button className="secondary-button full" type="button" onClick={install}><Smartphone size={18} /> ติดตั้ง Edge Journal</button>
          </section>
        </div>
        <button className="primary-button save-settings" type="submit"><Check size={18} /> บันทึกการตั้งค่า</button>
      </form>

      <section className="data-section panel">
        <div className="settings-title"><span><RotateCcw /></span><div><h2>สำรองและกู้คืนข้อมูล</h2><p>ไฟล์สำรองรวมรายการเทรด โน้ต การตั้งค่า และรูปภาพทั้งหมด</p></div></div>
        <div className="data-actions">
          <button className="secondary-button" onClick={exportData}><Download size={18} /> ส่งออกข้อมูล</button>
          <button className="secondary-button" onClick={() => importRef.current?.click()}><Upload size={18} /> นำเข้าข้อมูล</button>
          <input ref={importRef} className="hidden-input" type="file" accept="application/json" onChange={importFile} />
          <button className="danger-button" onClick={() => {
            if (window.confirm('ลบข้อมูลเทรดและการตั้งค่าทั้งหมด? การดำเนินการนี้ย้อนกลับไม่ได้')) onClear()
          }}><Trash2 size={18} /> ล้างข้อมูล</button>
        </div>
      </section>
    </section>
  )
}

function TradeModal({ date, trade, currency, onClose, onSave, notify }) {
  const [form, setForm] = useState(() => ({
    side: trade?.side || 'profit',
    amount: trade?.amount || '',
    date: trade?.date || date,
    time: trade?.time || nowTime(),
    symbol: trade?.symbol || '',
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
      notify('กรุณาระบุจำนวนเงินที่มากกว่า 0')
      amountRef.current?.focus()
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
        symbol: form.symbol.trim().toUpperCase(),
        setup: form.setup.trim(),
        note: form.note.trim(),
        lesson: form.lesson.trim(),
      })
    } catch {
      notify('บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง')
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="trade-modal" role="dialog" aria-modal="true" aria-labelledby="trade-modal-title">
        <div className="modal-header">
          <div><p className="eyebrow">{trade ? 'EDIT TRADE' : 'NEW TRADE'}</p><h2 id="trade-modal-title">{trade ? 'แก้ไขการเทรด' : 'บันทึกการเทรด'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="ปิด"><X /></button>
        </div>
        <form onSubmit={submit}>
          <div className="outcome-switch">
            <button type="button" className={form.side === 'profit' ? 'active profit' : ''} onClick={() => change('side', 'profit')}><ArrowUpRight /> กำไร</button>
            <button type="button" className={form.side === 'loss' ? 'active loss' : ''} onClick={() => change('side', 'loss')}><ArrowDownRight /> ขาดทุน</button>
          </div>

          <div className="form-grid">
            <label className="amount-field">P&L ({currency})<div><span>{form.side === 'loss' ? '−' : '+'}</span><input ref={amountRef} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" value={form.amount} onChange={(event) => change('amount', event.target.value)} /></div></label>
            <label>วันที่<input type="date" value={form.date} onChange={(event) => change('date', event.target.value)} required /></label>
            <label>เวลา<input type="time" value={form.time} onChange={(event) => change('time', event.target.value)} required /></label>
            <label>สินทรัพย์ / Symbol<input placeholder="เช่น XAUUSD" value={form.symbol} onChange={(event) => change('symbol', event.target.value)} maxLength={20} /></label>
            <label className="full-field">แผนหรือ Setup<input placeholder="เช่น Breakout + Retest" value={form.setup} onChange={(event) => change('setup', event.target.value)} maxLength={80} /></label>
            <label className="full-field">บันทึก (ไม่บังคับ)<textarea placeholder="เกิดอะไรขึ้นระหว่างการเทรด?" value={form.note} onChange={(event) => change('note', event.target.value)} maxLength={500} /></label>
            <label className="full-field">บทเรียน (ไม่บังคับ)<textarea placeholder="ครั้งหน้าจะทำอะไรให้ดีขึ้น?" value={form.lesson} onChange={(event) => change('lesson', event.target.value)} maxLength={500} /></label>
          </div>

          <div className="upload-field">
            <div><strong>ภาพแผนการเทรด</strong><span>JPG, PNG หรือ WEBP · สูงสุด 5 MB</span></div>
            {form.image ? (
              <div className="upload-preview"><img src={form.image.dataUrl} alt="ตัวอย่างภาพแผน" /><div><span>{form.image.name}</span><button type="button" onClick={() => change('image', null)}><Trash2 size={16} /> ลบรูป</button></div></div>
            ) : (
              <label className="upload-button"><ImagePlus size={22} /><span><strong>เลือกรูปภาพ</strong><small>แตะเพื่อเพิ่ม Screenshot</small></span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImage} /></label>
            )}
          </div>

          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={onClose}>ยกเลิก</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? 'กำลังบันทึก…' : trade ? 'บันทึกการแก้ไข' : 'บันทึกการเทรด'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default App
