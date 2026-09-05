const DB_NAME = 'edge-journal-db'
const DB_VERSION = 2
const TRADES = 'trades'
const SETTINGS = 'settings'
const USERS = 'users'
const SESSION_KEY = 'trade-rise-session'

export const defaults = {
  accountName: 'Main account',
  currency: 'USD',
  monthlyGoal: 1000,
  yearlyGoal: 12000,
  dailyStopLossByMonth: {},
  showWeekends: true,
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const transaction = request.transaction

      let tradeStore
      if (!db.objectStoreNames.contains(TRADES)) {
        tradeStore = db.createObjectStore(TRADES, { keyPath: 'id' })
        tradeStore.createIndex('date', 'date')
      } else {
        tradeStore = transaction.objectStore(TRADES)
      }
      if (!tradeStore.indexNames.contains('userId')) tradeStore.createIndex('userId', 'userId')

      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(USERS)) {
        const userStore = db.createObjectStore(USERS, { keyPath: 'id' })
        userStore.createIndex('email', 'email', { unique: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(storeName, mode, action) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode)
    const store = transaction.objectStore(storeName)
    const request = action(store)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => reject(transaction.error)
  })
}

function normalizeEmail(email) {
  return email.trim().toLowerCase()
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

async function hashPassword(password, saltValue) {
  const salt = saltValue ? base64ToBytes(saltValue) : crypto.getRandomValues(new Uint8Array(16))
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    material,
    256,
  )
  return { salt: bytesToBase64(salt), hash: bytesToBase64(new Uint8Array(bits)) }
}

function hashesMatch(left, right) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

function publicUser(user) {
  if (!user) return null
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt }
}

async function claimLegacyData(userId) {
  const users = await withStore(USERS, 'readonly', (store) => store.getAll())
  if (users.length !== 1) return

  const legacyTrades = await withStore(TRADES, 'readonly', (store) => store.getAll())
  for (const trade of legacyTrades.filter((item) => !item.userId)) {
    await withStore(TRADES, 'readwrite', (store) => store.put({ ...trade, userId }))
  }

  const legacySettings = await withStore(SETTINGS, 'readonly', (store) => store.get('preferences'))
  if (legacySettings?.value) await saveSettings(userId, { ...defaults, ...legacySettings.value })
}

export async function registerUser({ name, email, password }) {
  const normalizedEmail = normalizeEmail(email)
  const existing = await withStore(USERS, 'readonly', (store) => store.index('email').get(normalizedEmail))
  if (existing) throw new Error('An account already exists for this email.')

  const credentials = await hashPassword(password)
  const user = {
    id: randomId(),
    name: name.trim(),
    email: normalizedEmail,
    passwordHash: credentials.hash,
    passwordSalt: credentials.salt,
    createdAt: new Date().toISOString(),
  }
  await withStore(USERS, 'readwrite', (store) => store.add(user))
  await claimLegacyData(user.id)
  localStorage.setItem(SESSION_KEY, user.id)
  return publicUser(user)
}

export async function loginUser({ email, password }) {
  const user = await withStore(USERS, 'readonly', (store) => store.index('email').get(normalizeEmail(email)))
  if (!user) throw new Error('Email or password is incorrect.')
  const credentials = await hashPassword(password, user.passwordSalt)
  if (!hashesMatch(credentials.hash, user.passwordHash)) throw new Error('Email or password is incorrect.')
  localStorage.setItem(SESSION_KEY, user.id)
  return publicUser(user)
}

export async function getCurrentUser() {
  const userId = localStorage.getItem(SESSION_KEY)
  if (!userId) return null
  const user = await withStore(USERS, 'readonly', (store) => store.get(userId))
  if (!user) localStorage.removeItem(SESSION_KEY)
  return publicUser(user)
}

export function logoutUser() {
  localStorage.removeItem(SESSION_KEY)
}

export async function getTrades(userId) {
  if (!userId) return []
  const values = await withStore(TRADES, 'readonly', (store) => store.index('userId').getAll(userId))
  return values.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
}

export function saveTrade(trade, userId) {
  return withStore(TRADES, 'readwrite', (store) => store.put({ ...trade, userId }))
}

export async function removeTrade(id, userId) {
  const trade = await withStore(TRADES, 'readonly', (store) => store.get(id))
  if (!trade || trade.userId !== userId) throw new Error('This trade could not be found.')
  return withStore(TRADES, 'readwrite', (store) => store.delete(id))
}

export async function getSettings(userId) {
  if (!userId) return defaults
  const saved = await withStore(SETTINGS, 'readonly', (store) => store.get(`preferences:${userId}`))
  return { ...defaults, ...(saved?.value || {}) }
}

export function saveSettings(userId, value) {
  return withStore(SETTINGS, 'readwrite', (store) => store.put({ id: `preferences:${userId}`, userId, value }))
}

export async function replaceAllData(payload, userId) {
  const currentTrades = await getTrades(userId)
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([TRADES, SETTINGS], 'readwrite')
    const tradeStore = transaction.objectStore(TRADES)
    for (const trade of currentTrades) tradeStore.delete(trade.id)
    for (const trade of payload.trades || []) {
      tradeStore.put({ ...trade, id: randomId(), userId, amount: Math.abs(Number(trade.amount) || 0) })
    }
    transaction.objectStore(SETTINGS).put({
      id: `preferences:${userId}`,
      userId,
      value: { ...defaults, ...(payload.settings || {}) },
    })
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function clearAllData(userId) {
  const currentTrades = await getTrades(userId)
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([TRADES, SETTINGS], 'readwrite')
    const tradeStore = transaction.objectStore(TRADES)
    for (const trade of currentTrades) tradeStore.delete(trade.id)
    transaction.objectStore(SETTINGS).delete(`preferences:${userId}`)
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => reject(transaction.error)
  })
}
