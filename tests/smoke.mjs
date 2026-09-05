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

  await page.goto('http://127.0.0.1:4178', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Display name').fill('Test Trader')
  await page.getByLabel('Email').fill('trader@example.com')
  await page.locator('.auth-input input[type="password"]').fill('secure-pass-123')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await page.locator('.calendar-grid').waitFor()
  const restDays = page.locator('.day-cell.rest-day')
  assert(await restDays.count() > 0, 'Days without trades were not marked as rest days')
  assert((await restDays.first().locator('strong').innerText()).startsWith('+$0'), 'Rest days did not show a green +$0 result')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Settings' }).click()
  await page.getByLabel('Maximum loss per day').fill('50')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.getByText('Settings saved', { exact: true }).waitFor()
  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'Calendar' }).click()

  await page.locator('.mobile-fab').click()
  await page.locator('.amount-field input').fill('125.50')
  await page.getByLabel('Asset').selectOption('BTCUSD')
  await page.getByLabel('Setup').fill('Breakout retest')
  await page.getByLabel('Note (optional)').fill('Waited for the planned entry')
  await page.getByRole('button', { name: 'Save trade', exact: true }).click()
  await page.getByText('Add a trade chart before saving.', { exact: true }).waitFor()
  await page.locator('.upload-button input').setInputFiles({
    name: 'plan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })
  await page.getByRole('button', { name: 'Save trade', exact: true }).click()
  await page.getByText('Trade saved', { exact: true }).waitFor()
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true })
  if (process.env.SCREENSHOT_DESKTOP_PATH) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: process.env.SCREENSHOT_DESKTOP_PATH, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
  }

  const winCell = page.locator('.day-cell.on-plan').filter({ hasText: '+$126' })
  assert(await winCell.count() === 1, 'Monthly calendar did not show the saved profit')
  await winCell.click()
  await page.locator('.trade-card').waitFor()
  assert((await page.locator('.trade-card').innerText()).includes('BTCUSD'), 'Day view did not show the saved trade')
  assert(await page.locator('.image-thumb').count() === 1, 'Uploaded trade image was not saved')

  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('button', { name: 'Loss' }).click()
  await page.locator('.amount-field input').fill('50')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.locator('.trade-card .loss-text').waitFor()
  assert((await page.locator('.trade-card .loss-text').innerText()).includes('50.00'), 'Edited loss was not reflected')
  assert(await page.locator('.stop-loss-alert').count() === 1, 'Daily stop-loss alert was not shown')

  await page.locator('.mobile-fab').click()
  assert(await page.getByRole('button', { name: 'Profit', exact: true }).isDisabled(), 'Trading should be locked after the daily limit')
  await page.locator('.amount-field input').fill('25')
  await page.getByRole('button', { name: 'Save trade', exact: true }).click()
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

  console.log('Smoke test passed: auth, remembered session, trade workflow, image, analytics, and user data persistence')
  await context.close()
} finally {
  await browser.close()
  await server.close()
}
