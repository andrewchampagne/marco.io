/**
 * Visual verification routine (docs/DECISIONS.md, skills table): drives the real app in Chrome and saves
 * screenshots to docs/screenshots/. It starts its own isolated servers, so it never touches your dev database:
 *
 *   backend  :8100  LLM_MODE=mock AUTH_MODE=mock, fresh temporary SQLite database
 *   frontend :5180  Vite dev server proxying /api to :8100
 *
 * Fails (exit 1) on any browser console error, or if changing palette/binning triggers an LLM request.
 *
 *   npm run screenshots            (from frontend/)
 *   make screenshots               (from the repo root)
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(HERE, '..')
const ROOT = resolve(FRONTEND, '..')
const BACKEND = join(ROOT, 'backend')
const OUT = join(ROOT, 'docs', 'screenshots')
const API_PORT = 8100
const WEB_PORT = 5180
const BASE = `http://localhost:${WEB_PORT}`
const IS_WIN = process.platform === 'win32'
const PY = join(BACKEND, '.venv', IS_WIN ? 'Scripts/python.exe' : 'bin/python')
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7)

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
      const res = await fetch(url)
      if (res.ok) return
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
let mapPosts = 0
let expect429 = false // the over-quota attempt answers 429 on purpose; Chrome logs that as a console error
const shots = []

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
async function settle(page, ms = 1700) {
  await page.waitForTimeout(ms) // reveal sweep is ~1.25 s
}
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
function assert(cond, message) {
  if (!cond) {
    errors.push(`ASSERT: ${message}`)
    console.log(`  ✗ ${message}`)
  }
}

// ---- main ----------------------------------------------------------------------------------------
async function main() {
  if (!existsSync(PY)) throw new Error('backend/.venv is missing: run `make setup` first.')
  mkdirSync(OUT, { recursive: true })
  const db = join(tmpdir(), `terrachrome-shots-${Date.now()}.db`)
  console.log('Starting isolated servers…')
  start(PY, ['-m', 'uvicorn', 'app.main:app', '--port', String(API_PORT)], {
    cwd: BACKEND,
    env: {
      ...process.env, LLM_MODE: 'mock', AUTH_MODE: 'mock', MOCK_LATENCY_MS: '2600', DATASOURCES_ENABLED: 'false',
      DATABASE_URL: `sqlite:///${db.replace(/\\/g, '/')}`, FREE_MAPS_PER_IP_PER_DAY: '1000', FREE_MAPS_PER_DAY: '3',
      RATE_LIMIT_PER_MINUTE: '1000', MAPS_RATE_LIMIT_PER_MINUTE: '1000', DAILY_BUDGET_USD: '100',
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    if (expect429 && /status of 429/.test(msg.text())) return
    errors.push(`console: ${msg.text()}`)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/maps$/.test(new URL(r.url()).pathname)) mapPosts++
  })

  console.log('Desktop 1440×900')
  await page.goto(BASE)
  await waitMap(page)
  await settle(page, 1200)
  await shot(page, '01-empty-state')

  await ask(page, 'How many deaths were there in each country in World War 1?')
  await page.waitForTimeout(1300)
  await shot(page, '02-loading')
  await waitIdle(page)
  await settle(page)
  await shot(page, '03-map-ww1')

  const france = await point(page, 2.4, 46.6)
  await page.mouse.move(france.x, france.y)
  await page.waitForTimeout(350)
  await shot(page, '04-tooltip-france')

  await page.locator('section[aria-label="Legend"] li button').nth(1).hover()
  await page.waitForTimeout(350)
  await shot(page, '05-legend-hover')
  await page.mouse.move(700, 450)
  await page.mouse.move(france.x, france.y)
  await page.mouse.click(france.x, france.y)
  await page.waitForTimeout(500)
  await shot(page, '06-detail-panel')
  await page.keyboard.press('Escape')

  const postsBefore = mapPosts
  await page.getByRole('button', { name: 'Palette' }).click()
  await page.waitForTimeout(250)
  await shot(page, '07-palette-picker')
  await page.getByRole('option', { name: /Viridis/ }).click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(600)
  await shot(page, '08-palette-viridis')
  await page.getByRole('button', { name: 'Fewer classes' }).click()
  await page.getByRole('radio', { name: 'Log' }).click()
  await page.waitForTimeout(700)
  await shot(page, '09-rebinned-log-6')
  assert(mapPosts === postsBefore, 'palette/binning changes must not call POST /api/maps')

  await page.getByRole('button', { name: 'About this map' }).click()
  await page.waitForTimeout(250)
  await shot(page, '10-info-popover')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Data table' }).click()
  await page.waitForTimeout(350)
  await shot(page, '11-data-table')
  await page.getByRole('button', { name: 'Close table' }).click()

  await ask(page, 'Average annual rainfall by country')
  await waitIdle(page)
  await settle(page)
  await shot(page, '12-map-rainfall')

  await page.getByRole('button', { name: 'Settings' }).click()
  for (const [tab, slug] of [['Account', 'account'], ['API key', 'api-key'], ['Usage', 'usage'], ['Appearance', 'appearance'], ['Privacy and data', 'privacy'], ['About', 'about']]) {
    await page.getByRole('tab', { name: tab }).click()
    await page.waitForTimeout(250)
    await shot(page, `13-settings-${slug}-signed-out`)
  }
  await page.keyboard.press('Escape')

  await ask(page, 'write me a poem about maps')
  await waitIdle(page)
  await page.waitForTimeout(500)
  await shot(page, '14-unmappable')
  await page.getByRole('button', { name: 'Dismiss' }).first().click()

  expect429 = true
  await ask(page, 'Coffee consumption per person')
  await page.getByRole('dialog', { name: /Free maps used up/ }).waitFor()
  expect429 = false
  await page.waitForTimeout(350)
  await shot(page, '15-access-step1-signed-out')

  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await page.getByRole('dialog', { name: /Unlock unlimited maps/ }).waitFor({ timeout: 20000 })
  await waitMap(page)
  await page.waitForTimeout(500)
  await shot(page, '16-access-step2-add-key')

  await page.getByPlaceholder('sk-ant-…').fill('sk-ant-api03-' + 'x'.repeat(40))
  await page.getByRole('button', { name: 'Validate and save' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.waitForTimeout(600)
  await waitIdle(page)
  await settle(page)
  await shot(page, '17-byok-map-resumed')
  const status = await page.locator('form[role="search"] + p').innerText()
  assert(/Using your API key/.test(status), 'after saving a key the usage line says "Using your API key"')

  await page.getByRole('button', { name: /Settings for/ }).click()
  await page.getByRole('tab', { name: 'Account' }).click()
  await page.waitForTimeout(250)
  await shot(page, '18-settings-account-signed-in')
  await page.getByRole('tab', { name: 'API key' }).click()
  await page.waitForTimeout(250)
  await shot(page, '19-settings-api-key-connected')
  await page.keyboard.press('Escape')

  await page.reload()
  await waitMap(page)
  await settle(page)
  await shot(page, '20-reload-keeps-key')
  const status2 = await page.locator('form[role="search"] + p').innerText()
  assert(/Using your API key/.test(status2), 'a remembered key survives a reload')

  console.log('Tablet 820×1180')
  await page.setViewportSize({ width: 820, height: 1180 })
  await page.waitForTimeout(900)
  await shot(page, '21-tablet-820')
  const fr2 = await point(page, 2.4, 46.6)
  await page.mouse.click(fr2.x, fr2.y)
  await page.waitForTimeout(500)
  await shot(page, '22-tablet-detail')
  await page.keyboard.press('Escape')

  console.log('Phone 390×844')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(900)
  await shot(page, '23-phone-390')
  await page.getByRole('button', { name: /Settings for/ }).click()
  await page.waitForTimeout(300)
  await shot(page, '24-phone-settings-list')
  await page.getByRole('tab', { name: /Usage/ }).click()
  await page.waitForTimeout(300)
  await shot(page, '25-phone-settings-usage')
  await page.keyboard.press('Escape')

  await browser.close()
  stopAll()
  await new Promise((r) => setTimeout(r, 800)) // let the backend release the SQLite file (Windows locks it)
  for (const ext of ['', '-wal', '-shm']) {
    try { rmSync(db + ext, { force: true }) } catch { /* temp file; the OS cleans it up eventually */ }
  }

  console.log(`\n${shots.length} screenshots in docs/screenshots/`)
  if (errors.length) {
    console.log(`\n${errors.length} problem(s):`)
    for (const e of errors) console.log(`  - ${e}`)
    process.exitCode = 1
  } else {
    console.log('No console errors. Palette and binning changes made no LLM calls.')
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(stopAll)
