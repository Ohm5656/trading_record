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
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    serviceWorkers: 'block',
  })
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))

  await page.goto('http://127.0.0.1:4178', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click()
  await page.getByLabel('ชื่อที่ใช้แสดง').fill('Test Trader')
  await page.getByLabel('อีเมล').fill('trader@example.com')
  await page.locator('.auth-input input[type="password"]').fill('secure-pass-123')
  await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click()
  await page.locator('.calendar-grid').waitFor()

  await page.locator('.mobile-fab').click()
  await page.locator('.amount-field input').fill('125.50')
  await page.getByLabel('สินทรัพย์ / Symbol').fill('EURUSD')
  await page.getByLabel('แผนหรือ Setup').fill('Breakout retest')
  await page.getByLabel('บันทึก (ไม่บังคับ)').fill('รอตามแผนก่อนเข้า')
  await page.locator('.upload-button input').setInputFiles({
    name: 'plan.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  })
  await page.getByRole('button', { name: 'บันทึกการเทรด', exact: true }).click()
  await page.locator('.toast').waitFor()
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true })
  if (process.env.SCREENSHOT_DESKTOP_PATH) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: process.env.SCREENSHOT_DESKTOP_PATH, fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
  }

  const winCell = page.locator('.day-cell.win')
  assert(await winCell.count() === 1, 'Monthly calendar did not show the saved profit')
  await winCell.click()
  await page.locator('.trade-card').waitFor()
  assert((await page.locator('.trade-card').innerText()).includes('EURUSD'), 'Day view did not show the saved trade')
  assert(await page.locator('.image-thumb').count() === 1, 'Uploaded trade image was not saved')

  await page.getByRole('button', { name: 'แก้ไข' }).click()
  await page.getByRole('button', { name: 'ขาดทุน' }).click()
  await page.locator('.amount-field input').fill('50')
  await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click()
  await page.locator('.trade-card .loss-text').waitFor()
  assert((await page.locator('.trade-card .loss-text').innerText()).includes('50.00'), 'Edited loss was not reflected')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'วิเคราะห์' }).click()
  await page.locator('.analytics-hero').waitFor()
  assert((await page.locator('.analytics-hero').innerText()).includes('50.00'), 'Analytics did not include the edited trade')
  if (process.env.SCREENSHOT_ANALYTICS_PATH) await page.screenshot({ path: process.env.SCREENSHOT_ANALYTICS_PATH, fullPage: true })

  await page.reload({ waitUntil: 'networkidle' })
  const lossCell = page.locator('.day-cell.lose')
  assert(await lossCell.count() === 1, 'Trade did not persist in IndexedDB after reload')

  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'ตั้งค่า' }).click()
  if (process.env.SCREENSHOT_SETTINGS_PATH) await page.screenshot({ path: process.env.SCREENSHOT_SETTINGS_PATH, fullPage: true })
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click()
  await page.locator('.auth-form').waitFor()

  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click()
  await page.getByLabel('ชื่อที่ใช้แสดง').fill('Second Trader')
  await page.getByLabel('อีเมล').fill('second@example.com')
  await page.locator('.auth-input input[type="password"]').fill('second-pass-123')
  await page.getByRole('button', { name: 'สร้างบัญชี', exact: true }).click()
  await page.locator('.calendar-grid').waitFor()
  assert(await page.locator('.day-cell.lose').count() === 0, 'A second user could see the first user’s trade')
  await page.locator('.bottom-nav .nav-item').filter({ hasText: 'ตั้งค่า' }).click()
  await page.getByRole('button', { name: 'ออกจากระบบ' }).click()

  await page.getByLabel('อีเมล').fill('trader@example.com')
  await page.locator('.auth-input input[type="password"]').fill('secure-pass-123')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).last().click()
  await page.locator('.calendar-grid').waitFor()
  assert(await page.locator('.day-cell.lose').count() === 1, 'Trade was not isolated to and restored for the logged-in user')
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(', ')}`)

  console.log('Smoke test passed: auth, remembered session, trade workflow, image, analytics, and user data persistence')
  await context.close()
} finally {
  await browser.close()
  await server.close()
}
