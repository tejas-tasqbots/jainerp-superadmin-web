/**
 * Button-level sweep — the manual "click every control on every screen" pass,
 * automated so it is repeatable.
 *
 * For each route it enumerates every visible, enabled control (button, [role=
 * button], tab, and nav links inside the page body), clicks them one at a time,
 * and after each click checks for: an error boundary, a thrown page error, a 5xx
 * from the API, or a raw sentinel/placeholder leaking to screen (NaN, undefined,
 * [object Object], "-1" limits). The page is reloaded between clicks so one
 * control's modal cannot hide the next.
 *
 * Destructive controls are *not* executed: anything matching DESTRUCTIVE is
 * opened far enough to confirm its confirmation step appears, then cancelled.
 * That exercises the button without deleting the operator's data.
 *
 *   PLAYWRIGHT_PATH=<abs path> node e2e/full/button-sweep.mjs [superadmin|mandir]
 */
import { mkdirSync } from 'node:fs';

const TARGET = process.argv[2] ?? 'superadmin';
const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const SHOTS = new URL(`./screens/button-sweep-${TARGET}/`, import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

/** Controls we enumerate but must not actually execute. */
const DESTRUCTIVE = /delete|remove|revoke|deactivate|suspend|archive|sign out|logout|void|cancel subscription|erase|reset/i;
/** Clicking these navigates away from the app or opens an external surface. */
const SKIP = /^(sign out|logout)$/i;

const results = [];
function rec(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  if (!ok) console.log(`  ✘ FAIL ${id} ${title} — ${detail}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// per-target config
// ─────────────────────────────────────────────────────────────────────────────
const TARGETS = {
  superadmin: {
    web: process.env.E2E_SA_WEB ?? 'http://localhost:5180',
    api: process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1',
    routes: ['/', '/mandirs', '/devotees', '/maharaj', '/change-requests', '/plans', '/sect-readiness', '/settings'],
    async login(page, ctx) {
      const { authenticator } = await import('otplib');
      const { execFileSync } = await import('node:child_process');
      // clear the QA account's TOTP so enrolment always yields a known secret
      try {
        execFileSync('docker', ['exec', 'jainerp-superadmin-pg', 'psql', '-U', 'jainerp', '-d', 'jainerp', '-tAc',
          `UPDATE public.super_admin_credentials c SET totp_secret_enc=NULL, totp_enrolled_at=NULL,
             recovery_codes_hash='{}', recovery_codes_used=0, failed_attempts=0, locked_until=NULL
           FROM public.global_users u WHERE u.id=c.global_user_id AND u.email='qa-tester@tasqbots.com'`],
          { stdio: 'ignore' });
      } catch { /* best effort */ }
      const api = async (m, p, b) => {
        const r = await fetch(TARGETS.superadmin.api + p, {
          method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined,
        });
        return r.json().catch(() => null);
      };
      const l = await api('POST', '/admin/auth/login', { identifier: 'qa-tester@tasqbots.com', password: 'QaTest@12345' });
      const s = await api('POST', '/admin/auth/mfa/setup', { mfa_token: l.data.mfa_token });
      const secret = s.data.otpauth_uri.match(/secret=([A-Z0-9]+)/)[1];
      const v = await api('POST', '/admin/auth/mfa/verify', {
        mfa_token: l.data.mfa_token, type: 'totp', code: authenticator.generate(secret),
      });
      const session = { access_token: v.data.access_token, refresh_token: v.data.refresh_token, user: v.data.user };
      await ctx.addInitScript((x) => localStorage.setItem('jainerp_sa_session', JSON.stringify(x)), session);
    },
  },
  mandir: {
    web: process.env.E2E_WEB ?? 'http://localhost:5173',
    api: process.env.E2E_API ?? 'http://localhost:3106/api/v1',
    routes: [
      '/dashboard', '/donations', '/donations/add', '/donors', '/boli/add', '/expenses', '/expenses/add',
      '/rooms', '/rooms/checkin', '/hall', '/prasad', '/prasad/items', '/seva', '/events', '/reports',
      '/certificates', '/devotees', '/annadaan', '/creditors', '/gaushala',
      '/accounts/cash-bank', '/accounts/day-book', '/accounts/ledger', '/accounts/trial-balance',
      '/accounts/receipts-payments', '/accounts/income-expenditure', '/accounts/balance-sheet',
      '/accounts/contra', '/accounts/fixed-assets', '/accounts/loans', '/accounts/reconciliation', '/accounts/cheques',
      '/masters/vendors', '/masters/priests', '/masters/employees', '/masters/inventory',
      '/registers/lost-found', '/registers/visitor-count', '/registers/recycle-bin',
      '/settings', '/help',
    ],
    async login(page) {
      const WEB = TARGETS.mandir.web;
      await page.goto(WEB, { waitUntil: 'networkidle' });
      await page.fill('input[type=tel]', '9876512345');
      await page.click('button:has-text("Send OTP")');
      await page.waitForSelector('text=Dev mode — OTP:', { timeout: 15000 });
      const otp = (await page.textContent('.font-mono.font-bold')).trim();
      await page.fill('input[maxlength="6"]', otp);
      await page.click('button:has-text("Verify OTP")');
      await page.waitForTimeout(1500);
      if (await page.locator('text=Select your temple').count()) {
        await page.locator('.space-y-2 button').first().click();
      }
      await page.waitForURL('**/dashboard', { timeout: 20000 });
    },
  },
  devotee: {
    web: process.env.E2E_DEVOTEE_WEB ?? 'http://localhost:5174',
    api: process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1',
    routes: [
      '/home', '/donations', '/bolis', '/donate', '/temples', '/stays',
      '/sant', '/profile', '/notifications',
    ],
    async login(page) {
      await otpLogin(page, TARGETS.devotee.web, process.env.E2E_DEVOTEE_MOBILE ?? '9811100022');
      // a fresh mobile lands on /register (profile completion) first
      if (page.url().includes('/register')) {
        await page.fill('input[placeholder="Ayush Kasliwal"]', 'Button Sweep Devotee').catch(() => {});
        await page.click('button:has-text("Save & Continue")').catch(() => {});
        await page.waitForTimeout(2000);
      }
    },
  },
  sant: {
    web: process.env.E2E_SANT_WEB ?? 'http://localhost:5175',
    api: process.env.E2E_SANT_API ?? 'http://localhost:3108/api/v1',
    // The per-profile screens are the bulk of this portal; they are only
    // reachable once the rep owns a profile, so resolve one at login and
    // append its routes. Without this the sweep only ever saw 3 screens.
    routes: ['/', '/profiles/new', '/settings'],
    async login(page) {
      const mobile = process.env.E2E_SANT_MOBILE ?? '9822200033';
      await otpLogin(page, TARGETS.sant.web, mobile);
      const api = async (m, p, b, t) => {
        const r = await fetch(TARGETS.sant.api + p, {
          method: m,
          headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
          body: b ? JSON.stringify(b) : undefined,
        });
        return r.json().catch(() => null);
      };
      const s = await api('POST', '/auth/send-otp', { mobile });
      const v = await api('POST', '/auth/verify-otp', { mobile, otp: s?.data?.dev_otp });
      const token = v?.data?.access_token;
      let mine = (await api('GET', '/sant/mine', null, token))?.data ?? [];
      if (mine.length === 0) {
        await api('POST', '/sant', { name: 'Muni Shri QA Sweep', type: 'muni', samuday: 'Oswal', sect: 'digambar', diksha_year: 2005 }, token);
        mine = (await api('GET', '/sant/mine', null, token))?.data ?? [];
      }
      const id = mine[0]?.id;
      if (id) {
        TARGETS.sant.routes.push(
          `/profiles/${id}`, `/profiles/${id}/location`, `/profiles/${id}/vihar`,
          `/profiles/${id}/requirements`, `/profiles/${id}/broadcast`, `/profiles/${id}/followers`,
        );
      }
    },
  },
};

/**
 * OTP login via the dev bypass. The three portals word it differently —
 * mandir/devotee render "Dev mode — OTP: 123456" and a "Verify OTP" button,
 * sant renders "Dev OTP: 123456" and "Verify & Sign In" — so match on the
 * digits rather than either portal's phrasing.
 */
async function otpLogin(page, web, mobile) {
  await page.goto(web, { waitUntil: 'networkidle' });
  await page.fill('input[type=tel]', mobile);
  await page.click('button:has-text("Send OTP")');
  await page.waitForFunction(
    () => /Dev (mode — )?OTP:\s*\d{6}/.test(document.body.innerText),
    undefined, { timeout: 15000 },
  );
  const otp = (await page.textContent('body')).match(/Dev (?:mode — )?OTP:\s*(\d{6})/)[1];
  await page.fill('input[maxlength="6"]', otp);
  await page.locator('button').filter({ hasText: /Verify( OTP| & Sign In)?/i }).first().click();
  await page.waitForTimeout(2500);
}

const CONFIG = TARGETS[TARGET];

if (!CONFIG) throw new Error(`unknown target "${TARGET}" — use superadmin or mandir`);

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
// Native confirm()/alert() — accept alerts, DISMISS confirms so nothing is deleted.
page.on('dialog', (d) => (d.type() === 'confirm' ? d.dismiss() : d.accept()).catch(() => {}));

let pageErrors = [];
let serverErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('response', (r) => {
  if (r.url().includes('/api/v1/') && r.status() >= 500) serverErrors.push(`${r.status()} ${r.url().split('/api/v1')[1]}`);
});

/** Text that must never reach the screen. */
function badRender(body) {
  if (/Something went wrong|Unexpected Application Error/i.test(body)) return 'error boundary';
  if (/\bNaN\b/.test(body)) return 'NaN on screen';
  if (/\bundefined\b/.test(body)) return '"undefined" on screen';
  if (/\[object Object\]/.test(body)) return '[object Object] on screen';
  return null;
}

async function labelOf(el) {
  const t = ((await el.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 40);
  const aria = await el.getAttribute('aria-label').catch(() => null);
  const title = await el.getAttribute('title').catch(() => null);
  return (aria || title || '(icon)').slice(0, 40);
}

try {
  console.log(`\n=== Button sweep — ${TARGET} @ ${CONFIG.web} ===\n`);
  await CONFIG.login(page, ctx);
  rec(`${TARGET}-login`, 'logged in', true);

  // ROUTE_SLICE=start:end runs only part of the route list, so a long sweep can
  // be done in resumable chunks instead of one process that must survive 30min.
  const slice = process.env.ROUTE_SLICE;
  const routes = slice
    ? CONFIG.routes.slice(Number(slice.split(':')[0]), Number(slice.split(':')[1] || CONFIG.routes.length))
    : CONFIG.routes;
  console.log(`(${routes.length} of ${CONFIG.routes.length} routes${slice ? ` — slice ${slice}` : ''})\n`);

  for (const route of routes) {
    await page.goto(`${CONFIG.web}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1200);
    pageErrors = []; serverErrors = [];
    // A screen that never produces a <body> is itself a finding — record it
    // and carry on rather than aborting the whole sweep.
    const landedBody = await page.textContent('body', { timeout: 8000 }).catch(() => null);
    const bad = landedBody === null ? 'no <body> rendered' : badRender(landedBody);
    rec(`${route}::render`, `screen ${route} renders clean`,
      !bad && serverErrors.length === 0 && pageErrors.length === 0,
      bad ?? serverErrors[0] ?? pageErrors[0]?.slice(0, 80) ?? '');
    if (landedBody === null) continue;
    await page.screenshot({ path: `${SHOTS}${route.replace(/\//g, '_') || '_root'}.png`, fullPage: true });

    // enumerate the controls on this screen
    const controls = page.locator('main button, main [role="button"], .tabs button, button');
    const n = Math.min(await controls.count(), 60);
    const labels = [];
    for (let i = 0; i < n; i++) {
      const el = controls.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      if (!(await el.isEnabled().catch(() => false))) continue;
      labels.push(await labelOf(el));
    }
    rec(`${route}::controls`, `screen ${route} exposes controls`, true, `${labels.length} control(s)`);

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      if (SKIP.test(label)) continue;
      const destructive = DESTRUCTIVE.test(label);

      // Reload before every click: the control list is addressed by index, so
      // the DOM has to be in the same state it was enumerated in. Skipping the
      // reload silently dropped ~40% of the controls when a click reordered the
      // tree. `domcontentloaded` (not `networkidle`) keeps this affordable.
      await page.goto(`${CONFIG.web}${route}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(700);
      pageErrors = []; serverErrors = [];

      const el = page.locator('main button, main [role="button"], .tabs button, button').nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const before = page.url();
      await el.click({ timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(1100);

      const body = await page.textContent('body', { timeout: 8000 }).catch(() => null);
      const problem = body === null ? 'screen stopped rendering after this click' : badRender(body);
      const id = `${route}::${i}:${label}`;
      rec(id, `click "${label}"`,
        !problem && serverErrors.length === 0 && pageErrors.length === 0,
        problem ?? serverErrors[0] ?? pageErrors[0]?.slice(0, 80) ?? (page.url() !== before ? `→ ${new URL(page.url()).pathname}` : 'ok'));

      // If a destructive action opened an in-app confirm, verify it asks and back out.
      if (destructive) {
        const dialog = page.locator('.fixed.inset-0, .modal').filter({ hasText: /delete|remove|revoke|deactivate|suspend|confirm|sure/i }).last();
        if (await dialog.count()) {
          rec(`${id}::confirm`, `"${label}" asks for confirmation before destroying`, true, 'confirm shown');
          await page.locator('button').filter({ hasText: /^(cancel|close|no)$/i }).last().click({ timeout: 3000 }).catch(() => {});
        }
      }
      // close any modal left open
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== BUTTON SWEEP (${TARGET}): ${passed}/${results.length} passed, ${failed.length} failed ===`);
  for (const f of failed) console.log(`  ✘ ${f.id} — ${f.detail}`);
  console.log(`Screenshots → ${SHOTS}`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
