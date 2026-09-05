import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({
  preview: { host: '127.0.0.1', port: 4179 },
  logLevel: 'error',
})

const browser = await chromium.launch({
  headless: true,
  ...(process.platform === 'win32' ? { channel: 'chrome' } : {}),
})

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const failures = []
  const pageErrors = []
  page.on('requestfailed', (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`))
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto('http://127.0.0.1:4179', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Display name').fill('Offline Trader')
  await page.getByLabel('Email').fill('offline@example.com')
  await page.locator('.auth-input input[type="password"]').fill('offline-pass-123')
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click()
  await page.locator('.calendar-grid').waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.reload({ waitUntil: 'networkidle' })

  const cachedUrls = await page.evaluate(async () => {
    const cache = await caches.open('trade-rise-v10')
    return (await cache.keys()).map((request) => request.url)
  })
  if (!cachedUrls.some((url) => url.endsWith('/'))) throw new Error('App shell was not cached')
  if (!cachedUrls.some((url) => url.includes('/assets/'))) throw new Error('Built assets were not cached')

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  try {
    await page.locator('.calendar-grid').waitFor({ timeout: 8000 })
  } catch (error) {
    const details = await page.evaluate(() => ({
      body: document.body.innerText,
      html: document.documentElement.outerHTML.slice(0, 800),
      controller: Boolean(navigator.serviceWorker?.controller),
    }))
    throw new Error(`Offline render failed: ${JSON.stringify({ ...details, cachedUrls, failures, pageErrors })}\n${error.message}`)
  }

  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
  if (manifest !== '/manifest.webmanifest') throw new Error('Web manifest is not connected')

  console.log('PWA test passed: service worker served the app while offline')
  await context.close()
} finally {
  await browser.close()
  await new Promise((resolve, reject) => {
    server.httpServer.close((error) => error ? reject(error) : resolve())
  })
}
