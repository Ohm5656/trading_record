import { chromium } from 'playwright'
import { createServer } from 'vite'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const server = await createServer({
  server: { host: '127.0.0.1', port: 4178 },
  logLevel: 'error',
})

await server.listen()

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32' ? { channel: 'chrome' } : {}),
})

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'en-US',
    timezoneId: 'Asia/Bangkok',
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  const countStoredTrades = () => page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('edge-journal-db')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const count = database.transaction('trades').objectStore('trades').count()
      count.onerror = () => reject(count.error)
      count.onsuccess = () => {
        database.close()
        resolve(count.result)
      }
    }
  }))

  const now = Date.now()
  const btcKlines = Array.from({ length: 120 }, (_, index) => {
    const open = 76500 + Math.sin(index / 8) * 900 + index * 6
    return [now - (119 - index) * 300000, String(open), String(open + 260), String(open - 230), String(open + Math.sin(index) * 120)]
  })
  const goldTimestamps = Array.from({ length: 120 }, (_, index) => Math.floor((now - (119 - index) * 300000) / 1000))
  const goldValues = goldTimestamps.map((_, index) => 2340 + Math.sin(index / 7) * 8 + index * 0.08)
  await page.route('**/api/v3/ticker/price*', (route) => route.fulfill({ contentType: 'application/json', body: '{"price":"78255"}' }))
  await page.route('**/api/v3/klines*', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(btcKlines) }))
  await page.route('**/v8/finance/chart/GC=F*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      chart: {
        result: [{
          timestamp: goldTimestamps,
          meta: { regularMarketPrice: goldValues.at(-1) },
          indicators: {
            quote: [{
              open: goldValues,
              high: goldValues.map((value) => value + 2.4),
              low: goldValues.map((value) => value - 2.1),
              close: goldValues.map((value, index) => value + Math.sin(index) * 1.2),
            }],
          },
        }],
      },
    }),
  }))

  await page.goto('http://127.0.0.1:4178', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Display name').fill('Test Trader')
  await page.getByLabel('Email').fill('trader@example.com')
  await page.locator('.auth-input input[type="password"]').fill('secure-pass-123')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await page.locator('.calendar-grid').waitFor()
  const restDays = page.locator('.day-cell.rest-day')
  const todayDay = Number(new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date()))
  assert(await restDays.count() === todayDay, 'Only past and current no-trade days should be marked as rest days')
  assert((await restDays.first().locator('strong').innerText()).startsWith('+$0'), 'Rest days did not show a green +$0 result')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Settings' }).click()
  await page.getByLabel('Maximum loss per day').fill('50')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.getByText('Settings saved', { exact: true }).waitFor()
  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Calendar' }).click()

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Analyze' }).click()
  await page.locator('.chart-state').waitFor({ state: 'hidden' })
  await page.getByRole('tab', { name: 'BTCUSD', exact: true }).click()
  await page.locator('.chart-state').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: 'Long', exact: true }).click()
  await page.locator('.market-chart').click({ position: { x: 190, y: 220 } })
  await page.getByLabel('Plan entry price').fill('77000')
  await page.getByLabel('Plan take profit').fill('79000')
  await page.getByLabel('Plan stop loss').fill('76000')
  assert(await page.locator('.reward-zone').count() === 1, 'Long plan reward zone was not drawn')
  assert(await page.locator('.risk-zone').count() === 1, 'Long plan risk zone was not drawn')
  const chartHasPixels = await page.locator('.market-chart canvas').evaluateAll((canvases) => canvases.some((canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return pixels.some((value, index) => index % 4 !== 3 && value !== 0)
  }))
  assert(chartHasPixels, 'Market chart canvas was blank')
  assert(await countStoredTrades() === 0, 'A chart draft was stored before confirmation')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Analysis workspace overflowed on mobile')
  if (process.env.SCREENSHOT_ANALYSIS_PATH) await page.screenshot({ path: process.env.SCREENSHOT_ANALYSIS_PATH })
  if (process.env.SCREENSHOT_ANALYSIS_DESKTOP_PATH) {
    await page.setViewportSize({ width: 1440, height: 900 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Analysis workspace overflowed on desktop')
    await page.screenshot({ path: process.env.SCREENSHOT_ANALYSIS_DESKTOP_PATH })
    await page.setViewportSize({ width: 390, height: 844 })
  }
  await page.getByRole('button', { name: 'Use this plan', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert(await page.getByLabel('Entry price', { exact: true }).inputValue() === '77000', 'Chart entry was not transferred to the ticket')
  assert(await page.getByLabel('Take profit', { exact: true }).inputValue() === '79000', 'Chart TP was not transferred to the ticket')
  assert(await page.getByLabel('Stop loss', { exact: true }).inputValue() === '76000', 'Chart SL was not transferred to the ticket')
  assert(await page.locator('.upload-preview img').count() === 1, 'Chart snapshot was not attached to the ticket')
  assert(await page.locator('.upload-preview img').evaluate((image) => image.complete && image.naturalWidth > 0), 'Chart snapshot was blank')
  assert(await countStoredTrades() === 0, 'Opening a planned ticket stored a trade before Start trade')
  if (process.env.SCREENSHOT_TICKET_PATH) await page.screenshot({ path: process.env.SCREENSHOT_TICKET_PATH })
  await page.getByLabel('Size (BTC)', { exact: true }).fill('0.1')
  await page.getByLabel('Current price', { exact: true }).fill('78255')
  await page.getByLabel('Setup').fill('Breakout retest')
  await page.getByLabel('Note (optional)').fill('Waited for the planned entry')
  await page.getByRole('dialog').getByRole('button', { name: 'Start trade', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.locator('.trade-card.open-trade-card').waitFor()
  assert((await page.locator('.trade-card').innerText()).includes('BTCUSD'), 'Confirmed chart plan did not open in the day view')
  await page.getByRole('button', { name: 'Month', exact: true }).click()
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true })
  if (process.env.SCREENSHOT_DESKTOP_PATH) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: process.env.SCREENSHOT_DESKTOP_PATH, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
  }

  const winCell = page.locator('.day-cell.today').filter({ hasText: '1 trade' })
  assert(await winCell.count() === 1, 'Monthly calendar did not show the saved trade')
  await winCell.click()
  await page.locator('.trade-card').waitFor()
  assert((await page.locator('.trade-card').innerText()).includes('BTCUSD'), 'Day view did not show the saved trade')
  assert(await page.locator('.image-thumb').count() === 1, 'Uploaded trade image was not saved')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Settings' }).click()
  await page.getByLabel('Maximum trades per day').fill('1')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.getByText('Settings saved', { exact: true }).waitFor()
  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Calendar' }).click()
  await page.locator('.mobile-fab').click()
  assert(await page.getByRole('button', { name: 'Long', exact: true }).isDisabled(), 'Trading should be locked after the daily trade limit')
  await page.getByRole('button', { name: 'Close' }).click()

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Short' }).click()
  await page.getByLabel('Status').selectOption('closed')
  await page.getByLabel('Entry price', { exact: true }).fill('77000')
  await page.getByLabel('Take profit', { exact: true }).fill('76000')
  await page.getByLabel('Stop loss', { exact: true }).fill('78000')
  await page.getByLabel('Exit price', { exact: true }).fill('77500')
  await page.getByLabel('Size (BTC)', { exact: true }).fill('0.1')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.locator('.trade-card .loss-text').waitFor()
  assert((await page.locator('.trade-card .loss-text').innerText()).includes('50.00'), 'Edited loss was not reflected')
  assert(await page.locator('.stop-loss-alert').count() === 1, 'Daily stop-loss alert was not shown')

  await page.locator('.mobile-fab').click()
  assert(await page.getByRole('button', { name: 'Long', exact: true }).isDisabled(), 'Trading should be locked after the daily limit')
  await page.locator('.amount-field input').fill('25')
  await page.getByRole('button', { name: 'Save withdrawal', exact: true }).click()
  await page.locator('.withdrawal-card').waitFor()
  assert((await page.locator('.withdrawal-card').innerText()).includes('Withdrawal'), 'Withdrawal was not shown as a separate card')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Insights' }).click()
  await page.locator('.analytics-hero').waitFor()
  assert((await page.locator('.analytics-hero').innerText()).includes('50.00'), 'Analytics did not include the edited trade')
  if (process.env.SCREENSHOT_ANALYTICS_PATH) await page.screenshot({ path: process.env.SCREENSHOT_ANALYTICS_PATH, fullPage: true })

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('.calendar-grid').waitFor()
  const plannedLossCell = page.locator('.day-cell.on-plan').filter({ hasText: '50' })
  assert(await plannedLossCell.count() === 1, 'A loss within the daily budget was not preserved as on-plan after reload')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Settings' }).click()
  if (process.env.SCREENSHOT_SETTINGS_PATH) await page.screenshot({ path: process.env.SCREENSHOT_SETTINGS_PATH, fullPage: true })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.locator('.auth-form').waitFor()

  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Display name').fill('Second Trader')
  await page.getByLabel('Email').fill('second@example.com')
  await page.locator('.auth-input input[type="password"]').fill('second-pass-123')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await page.locator('.calendar-grid').waitFor()
  assert(await page.locator('.day-cell.lose').count() === 0, 'A second user could see the first user’s trade')
  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Settings' }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.getByLabel('Email').fill('trader@example.com')
  await page.locator('.auth-input input[type="password"]').fill('secure-pass-123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.locator('.calendar-grid').waitFor()
  assert(await page.locator('.day-cell.on-plan').filter({ hasText: '50' }).count() === 1, 'Trade was not isolated to and restored for the logged-in user')
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(', ')}`)

  console.log('Smoke test passed: auth, chart plan, trade workflow, analytics, and user data persistence')
  await context.close()
} finally {
  await browser.close()
  await server.close()
}
