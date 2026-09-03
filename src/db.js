const DB_NAME = 'edge-journal-db'
const DB_VERSION = 1
const TRADES = 'trades'
const SETTINGS = 'settings'

export const defaults = {
  accountName: 'Main account',
  currency: 'USD',
  monthlyGoal: 1000,
  yearlyGoal: 12000,
  showWeekends: true,
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(TRADES)) {
        const store = db.createObjectStore(TRADES, { keyPath: 'id' })
        store.createIndex('date', 'date')
      }
      if (!db.objectStoreNames.contains(SETTINGS)) {
        db.createObjectStore(SETTINGS, { keyPath: 'id' })
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
  })
}

export async function getTrades() {
  const values = await withStore(TRADES, 'readonly', (store) => store.getAll())
  return values.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
}

export function saveTrade(trade) {
  return withStore(TRADES, 'readwrite', (store) => store.put(trade))
}

export function removeTrade(id) {
  return withStore(TRADES, 'readwrite', (store) => store.delete(id))
}

export async function getSettings() {
  const saved = await withStore(SETTINGS, 'readonly', (store) => store.get('preferences'))
  return { ...defaults, ...(saved?.value || {}) }
}

export function saveSettings(value) {
  return withStore(SETTINGS, 'readwrite', (store) => store.put({ id: 'preferences', value }))
}

export async function replaceAllData(payload) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRADES, SETTINGS], 'readwrite')
    const tradeStore = tx.objectStore(TRADES)
    tradeStore.clear()
    for (const trade of payload.trades || []) tradeStore.put(trade)
    tx.objectStore(SETTINGS).put({ id: 'preferences', value: { ...defaults, ...(payload.settings || {}) } })
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export async function clearAllData() {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([TRADES, SETTINGS], 'readwrite')
    tx.objectStore(TRADES).clear()
    tx.objectStore(SETTINGS).clear()
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}

export { defaults }
