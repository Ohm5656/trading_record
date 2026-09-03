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

  const winCell = page.locator('.day-cell.win').filter({ hasText: '125.50' })
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

  await page.reload({ waitUntil: 'networkidle' })
  const lossCell = page.locator('.day-cell.lose').filter({ hasText: '50.00' })
  assert(await lossCell.count() === 1, 'Trade did not persist in IndexedDB after reload')
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(', ')}`)

  console.log('Smoke test passed: create, image upload, edit, analytics, and IndexedDB persistence')
  await context.close()
} finally {
  await browser.close()
  await server.close()
}
