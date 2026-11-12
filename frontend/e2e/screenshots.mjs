/**
 * Visual verification routine (docs/DECISIONS.md D-33): drives the real app in Chrome and saves screenshots
 * to docs/screenshots/. It starts its own isolated servers, so it never touches your dev database:
 *
 *   backend  :8100  LLM_MODE=mock, fresh temporary SQLite database
 *   frontend :5180  Vite dev server proxying /api to :8100
 *
 * Besides screenshots it checks: no browser console errors; the OpenAI key prompt appears on a first
 * visit and when a question needs a key, and the waiting question runs once the key is saved;
 * palette/binning changes make no LLM call; a remembered key survives reload; shared maps open without a
 * key; PNG/CSV exports download; Esc returns focus to the control that opened a modal.
 *
 *   npm run screenshots            (from frontend/)       --only=<substring> to save a subset
 *   make screenshots               (from the repo root)
 *   node e2e/screenshots.mjs --out=<dir>                  check everything without touching docs/screenshots
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const ROOT = resolve(FRONTEND, '..')
const BACKEND = join(ROOT, 'backend')
const OUT_ARG = process.argv.find((a) => a.startsWith('--out='))?.slice(6)
const OUT = OUT_ARG ? resolve(OUT_ARG) : join(ROOT, 'docs', 'screenshots')
const API_PORT = 8100
const WEB_PORT = 5180
const BASE = `http://localhost:${WEB_PORT}`
const IS_WIN = process.platform === 'win32'
const PY = join(BACKEND, '.venv', IS_WIN ? 'Scripts/python.exe' : 'bin/python')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7)
const WW1 = 'How many deaths were there in each country in World War 1?'

const procs = []
function start(cmd, args, opts) {
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN })
  child.stdout.on('data', () => {})
  child.stderr.on('data', (d) => { if (process.env.DEBUG_SERVERS) process.stderr.write(d) })
  procs.push(child)
  return child
}
function stopAll() {
  for (const p of procs) {
    if (p.exitCode !== null) continue
    if (IS_WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(p.pid)], { stdio: 'ignore' })
    else try { process.kill(-p.pid, 'SIGTERM') } catch { /* already gone */ }
  }
}
process.on('exit', stopAll)
process.on('SIGINT', () => { stopAll(); process.exit(130) })

async function waitFor(url, label, timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error(`${label} did not start (${url})`)
}

async function launchBrowser() {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch(channel ? { channel } : {})
    } catch { /* try the next one */ }
  }
  throw new Error('No Chromium-based browser found. Install Chrome, or run `npx playwright install chromium`.')
}

// ---- helpers -------------------------------------------------------------------------------------
const errors = []
const shots = []
let mapPosts = 0
let expectHttpErrors = false // deliberate 4xx/5xx (key required, mocked failures) are logged by Chrome as console errors

function watch(page) {
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expectHttpErrors && /status of (4|5)\d\d|net::ERR_FAILED/.test(msg.text())) return
    errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/maps$/.test(new URL(r.url()).pathname)) mapPosts++
  })
}
async function shot(page, name) {
  if (ONLY && !name.includes(ONLY)) return
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88 })
  shots.push(name)
  console.log(`  ✓ ${name}`)
}
async function waitMap(page) {
  await page.waitForFunction(() => {
    const m = window.__terrachromeMap
    return !!m && m.isStyleLoaded() && m.loaded() && m.querySourceFeatures('countries').length > 100
  }, null, { timeout: 30000 })
}
const settle = (page, ms = 1800) => page.waitForTimeout(ms) // the reveal sweep takes ~1.3 s
async function ask(page, q) {
  const input = page.getByLabel('Ask a question to map')
  await input.fill(q)
  await input.press('Enter')
}
async function waitIdle(page) {
  await page.waitForFunction(() => !document.querySelector('form[role="search"] .progress-sweep'), null, { timeout: 30000 })
}
async function point(page, lng, lat) {
  return page.evaluate(([x, y]) => {
    const p = window.__terrachromeMap.project([x, y])
    return { x: p.x, y: p.y }
  }, [lng, lat])
}
async function statusText(page) {
  return page.locator('form[role="search"] + p').innerText()
}
function check(cond, message) {
  if (!cond) {
    errors.push(`CHECK: ${message}`)
    console.log(`  ✗ ${message}`)
  }
}
function sse(events) {
  return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join('')
}
async function mockMaps(page, fulfill) {
  await page.route('**/api/maps', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await fulfill(route)
  })
}

// ---- main ----------------------------------------------------------------------------------------
async function main() {
  if (!existsSync(PY)) throw new Error('backend/.venv is missing: run `make setup` first.')
  mkdirSync(OUT, { recursive: true })
  if (!ONLY) for (const f of readdirSync(OUT)) if (f.endsWith('.jpg') || f.endsWith('.png')) rmSync(join(OUT, f))
  const db = join(tmpdir(), `terrachrome-shots-${Date.now()}.db`)
  const downloads = join(tmpdir(), `terrachrome-downloads-${Date.now()}`)
  console.log('Starting isolated servers…')
  start(PY, ['-m', 'uvicorn', 'app.main:app', '--port', String(API_PORT)], {
    cwd: BACKEND,
    env: {
      ...process.env, LLM_MODE: 'mock', MOCK_LATENCY_MS: '2600', DATASOURCES_ENABLED: 'false',
      DATABASE_URL: `sqlite:///${db.replace(/\\/g, '/')}`,
      RATE_LIMIT_PER_MINUTE: '1000', MAPS_RATE_LIMIT_PER_MINUTE: '1000',
      SESSION_SECRET: 'screenshot-run-secret-0123456789abcdefghijkl', COOKIE_SECURE: 'true',
    },
  })
  start(process.execPath, [join(FRONTEND, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(WEB_PORT), '--strictPort'], {
    cwd: FRONTEND,
    env: { ...process.env, API_PORT: String(API_PORT) },
  })
  await waitFor(`http://127.0.0.1:${API_PORT}/api/health`, 'backend')
  await waitFor(`${BASE}/`, 'frontend')

  const browser = await launchBrowser()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', acceptDownloads: true })
  const page = await context.newPage()
  watch(page)

  console.log('Desktop 1440×900')
  await page.goto(BASE)
  await waitMap(page)
  await page.getByRole('dialog', { name: 'Add your OpenAI API key' }).waitFor({ timeout: 10000 })
  await settle(page, 900)
  await shot(page, '01-key-prompt-first-visit')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await settle(page, 600)
  await shot(page, '02-empty-state')
  check(/Add your OpenAI API key/.test(await statusText(page)), 'without a key the usage line asks for one')

  await page.keyboard.press('/')
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Ask a question to map'), '"/" focuses the command bar')
  expectHttpErrors = true // the question is answered 401 key_required, which Chrome logs
  await page.keyboard.type(WW1)
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Add your OpenAI API key' }).waitFor({ timeout: 10000 })
  expectHttpErrors = false
  await page.waitForTimeout(400)
  await shot(page, '03-key-prompt-question-waiting')
  check(/World War 1/.test(await page.getByRole('dialog').innerText()), 'the prompt names the question that is waiting')

  await page.getByPlaceholder('sk-proj-…').fill('sk-proj-' + 'x'.repeat(40))
  await page.getByRole('button', { name: 'Validate and save' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.waitForTimeout(1100)
  await shot(page, '04-loading')
  await waitIdle(page)
  await page.waitForTimeout(520)
  await shot(page, '05-reveal-sweep')
  await settle(page)
  await shot(page, '06-map-ww1')
  check(/Using your OpenAI key/.test(await statusText(page)), 'the usage line says "Using your OpenAI key"')
  check(/1914/.test(await page.locator('section[aria-label="Legend"]').innerText()), 'the waiting question ran after the key was saved')
  const ww1Slug = new URL(page.url()).pathname.split('/').pop()

  const france = await point(page, 2.4, 46.6)
  await page.mouse.move(france.x, france.y)
  await page.waitForTimeout(350)
  await shot(page, '07-tooltip')

  await page.locator('section[aria-label="Legend"] li button').nth(1).hover()
  await page.waitForTimeout(350)
  await shot(page, '08-legend-hover')
  await page.mouse.move(700, 450)
  await page.mouse.move(france.x, france.y)
  await page.mouse.click(france.x, france.y)
  await page.waitForTimeout(500)
  await shot(page, '09-detail-panel')
  await page.keyboard.press('Escape')

  const postsBefore = mapPosts
  await page.getByRole('button', { name: 'Palette' }).click()
  await page.waitForTimeout(250)
  await shot(page, '10-palette-picker')
  await page.getByRole('option', { name: /Viridis/ }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await shot(page, '11-palette-viridis')
  await page.getByRole('button', { name: 'Fewer classes' }).click()
  await page.getByRole('radio', { name: 'Log' }).click()
  await page.waitForTimeout(700)
  await shot(page, '12-rebinned-log-6-classes')
  check(mapPosts === postsBefore, 'palette and binning changes make no POST /api/maps')

  await page.getByRole('button', { name: 'About this map' }).click()
  await page.waitForTimeout(250)
  await shot(page, '13-info-popover')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Data table' }).click()
  await page.waitForTimeout(350)
  await shot(page, '14-data-table')
  await page.getByRole('button', { name: 'Close table' }).click()

  await page.getByRole('button', { name: 'Share or export' }).click()
  await page.waitForTimeout(250)
  await shot(page, '15-share-menu')
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()])
  const pngPath = join(downloads, png.suggestedFilename())
  await png.saveAs(pngPath)
  check(png.suggestedFilename().endsWith('.png') && statSync(pngPath).size > 50_000, `PNG export downloads (${png.suggestedFilename()})`)
  await page.getByRole('button', { name: 'Share or export' }).click()
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()])
  const csvPath = join(downloads, csv.suggestedFilename())
  await csv.saveAs(csvPath)
  const csvText = readFileSync(csvPath, 'utf8')
  check(csvText.includes('iso3,country,value,unit') && csvText.split('\n').length > 200, 'CSV export has a header and every country')

  await ask(page, 'Average annual rainfall by country')
  await waitIdle(page)
  await settle(page)
  await shot(page, '16-map-rainfall')
  await page.evaluate(() => window.__terrachromeMap.jumpTo({ center: [-68, 15.5], zoom: 3.7 }))
  await page.waitForTimeout(900)
  await shot(page, '17-tiny-country-markers')
  await page.getByRole('button', { name: 'Reset view' }).click()
  await page.waitForTimeout(1100)

  await page.getByRole('button', { name: 'Query history' }).click()
  await page.waitForTimeout(400)
  await shot(page, '18-history-drawer')
  await page.getByRole('button', { name: 'Close history' }).click()

  const settingsButton = page.getByRole('button', { name: 'Settings' })
  await settingsButton.click()
  for (const [tab, slug] of [['API key', 'api-key'], ['Appearance', 'appearance'], ['Privacy and data', 'privacy'], ['About', 'about']]) {
    await page.getByRole('tab', { name: tab }).click()
    await page.waitForTimeout(250)
    await shot(page, `19-settings-${slug}`)
  }
  check(await page.getByRole('tab').count() === 4, 'Settings has exactly the API key, Appearance, Privacy and About tabs')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Settings'), 'Esc returns focus to the Settings button')

  await ask(page, 'write me a poem about maps')
  await waitIdle(page)
  await page.waitForTimeout(500)
  await shot(page, '20-unmappable')
  await page.getByRole('button', { name: 'Dismiss' }).first().click()

  await page.goto(`${BASE}/m/${ww1Slug}`)
  await waitMap(page)
  await settle(page)
  await shot(page, '21-reload-keeps-key')
  check(/Using your OpenAI key/.test(await statusText(page)), 'a remembered key survives a reload')

  console.log('Share link, fresh visitor (no key)')
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  const vpage = await visitor.newPage()
  watch(vpage)
  await vpage.goto(`${BASE}/m/${ww1Slug}`)
  await waitMap(vpage)
  await settle(vpage)
  await shot(vpage, '22-share-link-fresh-visitor')
  check(await vpage.getByRole('dialog').count() === 0, 'a shared map opens without asking for a key')

  console.log('Friendly error states (failures injected in the browser)')
  expectHttpErrors = true
  await mockMaps(vpage, (route) => route.abort('failed'))
  await ask(vpage, 'Forest cover by country')
  await vpage.waitForTimeout(500)
  await shot(vpage, '23-error-network')
  await vpage.getByRole('button', { name: 'Dismiss' }).first().click()
  await vpage.unroute('**/api/maps')

  await mockMaps(vpage, (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 'rate_limited', message: 'Too many requests.', retry_after: 42 }) }))
  await ask(vpage, 'Forest cover by country')
  await vpage.waitForTimeout(500)
  await shot(vpage, '24-error-rate-limited-toast')
  await vpage.unroute('**/api/maps')

  await mockMaps(vpage, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([
    ['status', { stage: 'interpreting', message: 'Interpreting your question' }],
    ['error', { code: 'llm_unavailable', message: 'OpenAI had a problem. Please try again.', retryable: true }],
  ]) }))
  await ask(vpage, 'Forest cover by country')
  await vpage.waitForTimeout(500)
  await shot(vpage, '25-error-ai-unavailable')
  await vpage.getByRole('button', { name: 'Dismiss' }).first().click()
  await vpage.unroute('**/api/maps')

  // a rejected key: reuse the first page, which has a saved key
  await mockMaps(page, (route) => route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse([
    ['status', { stage: 'interpreting', message: 'Interpreting your question' }],
    ['error', { code: 'invalid_key', message: 'Your OpenAI API key was rejected. Check it in Settings.', retryable: false }],
  ]) }))
  await ask(page, 'Forest cover by country')
  await page.getByRole('dialog', { name: 'Update your OpenAI API key' }).waitFor({ timeout: 10000 })
  await page.waitForTimeout(400)
  await shot(page, '26-error-invalid-key-prompt')
  await page.getByRole('button', { name: 'Not now' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForTimeout(350)
  await shot(page, '27-settings-api-key-invalid')
  await page.keyboard.press('Escape')
  await page.unroute('**/api/maps')
  expectHttpErrors = false
  await visitor.close()

  console.log('Tablet 820×1180 (fresh load)')
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.goto(`${BASE}/m/${ww1Slug}`)
  await waitMap(page)
  await settle(page)
  await shot(page, '28-tablet-820')
  const fr2 = await point(page, 2.4, 46.6)
  await page.mouse.click(fr2.x, fr2.y)
  await page.waitForTimeout(500)
  await shot(page, '29-tablet-detail')
  await page.keyboard.press('Escape')

  console.log('Phone 390×844 (fresh load)')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${BASE}/m/${ww1Slug}`)
  await waitMap(page)
  await settle(page)
  await shot(page, '30-phone-390')
  const de = await point(page, 10.4, 51.1)
  await page.mouse.click(de.x, de.y)
  await page.waitForTimeout(500)
  await shot(page, '31-phone-detail-sheet')
  await page.getByRole('button', { name: 'Close details' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.waitForTimeout(300)
  await shot(page, '32-phone-settings-list')
  await page.getByRole('tab', { name: /API key/ }).click()
  await page.waitForTimeout(300)
  await shot(page, '33-phone-settings-api-key')
  await page.keyboard.press('Escape')

  await browser.close()
  stopAll()
  await new Promise((r) => setTimeout(r, 800)) // let the backend release the SQLite file (Windows locks it)
  for (const path of [db, `${db}-wal`, `${db}-shm`, downloads]) {
    try { rmSync(path, { force: true, recursive: true }) } catch { /* temp files */ }
  }

  console.log(`\n${shots.length} screenshots in ${OUT_ARG ? OUT : 'docs/screenshots/'}`)
  if (errors.length) {
    console.log(`\n${errors.length} problem(s):`)
    for (const e of errors) console.log(`  - ${e}`)
    process.exitCode = 1
  } else {
    console.log('All checks passed: no console errors, key prompt + resume, no LLM calls from palette/binning, reload + share + export OK.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(stopAll)
