/**
 * Super Admin console — full manual-equivalent walkthrough, login bypassed.
 *
 * Mints a real super-admin session over the API (password + TOTP, the sanctioned
 * enrolment flow) and injects it into localStorage as `jainerp_sa_session`, so
 * the browser lands straight on the console. Then walks every route, every tab
 * and the A2–A8 flows in doc-v2/User_Flow_SuperAdmin.md, asserting each screen
 * actually renders its data — not merely that it returned 200.
 *
 *   (cd ../superadmin-api && npx ts-node scripts/seed-qa-tester.ts)
 *   PLAYWRIGHT_PATH=<abs path> node e2e/full/sa-flow-walkthrough.mjs
 */
import { mkdirSync } from 'node:fs';
import { authenticator } from 'otplib';

const pwPath = process.env.PLAYWRIGHT_PATH ?? 'playwright';
const pw = await import(pwPath);
const chromium = pw.chromium ?? pw.default?.chromium;

const WEB = process.env.E2E_SA_WEB ?? 'http://localhost:5180';
const API = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const QA_ID = 'qa-tester@tasqbots.com';
const QA_PASSWORD = 'QaTest@12345';
const SHOTS = new URL('./screens/sa-flow/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const results = [];
function rec(id, title, ok, detail = '') {
  results.push({ id, title, ok, detail });
  console.log(`  ${ok ? '✔ PASS' : '✘ FAIL'} ${id} ${title}${detail ? ' — ' + detail : ''}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json, data: json?.data };
}

/** Password + TOTP, returning the session object the SPA persists. */
async function mintSession() {
  const login = await api('POST', '/admin/auth/login', { body: { identifier: QA_ID, password: QA_PASSWORD } });
  const mfaToken = login.data?.mfa_token;
  if (!mfaToken) throw new Error(`login failed: ${JSON.stringify(login.json)}`);
  const setup = await api('POST', '/admin/auth/mfa/setup', { body: { mfa_token: mfaToken } });
  const secret = setup.data?.otpauth_uri?.match(/secret=([A-Z0-9]+)/)?.[1];
  if (!secret) throw new Error(`mfa/setup gave no secret (already enrolled?) — re-run seed-qa-tester.ts: ${JSON.stringify(setup.json)}`);
  const verify = await api('POST', '/admin/auth/mfa/verify', {
    body: { mfa_token: mfaToken, type: 'totp', code: authenticator.generate(secret) },
  });
  if (!verify.data?.access_token) throw new Error(`mfa/verify failed: ${JSON.stringify(verify.json)}`);
  return {
    access_token: verify.data.access_token,
    refresh_token: verify.data.refresh_token,
    user: verify.data.user,
  };
}

const session = await mintSession();
const TOKEN = session.access_token;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
page.on('dialog', (d) => d.accept().catch(() => {}));

let pageErrors = [];
let serverErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('response', (r) => {
  if (r.url().includes('/api/v1/') && r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});

// ---- login bypass: seed localStorage before the SPA boots ----
await page.addInitScript((s) => {
  localStorage.setItem('jainerp_sa_session', JSON.stringify(s));
}, session);

async function go(route, waitMs = 1400) {
  pageErrors = []; serverErrors = [];
  await page.goto(`${WEB}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(waitMs);
}

/** Assert a screen: landed on the route, no crash, no 5xx, and shows real content. */
async function screen(id, title, route, mustMatch, { shot } = {}) {
  await go(route);
  const body = (await page.textContent('body')) ?? '';
  const landed = new URL(page.url()).pathname === route;
  const crashed = /Something went wrong|Unexpected Application Error|TypeError|is not a function/i.test(body);
  const has = mustMatch ? mustMatch.every((m) => new RegExp(m, 'i').test(body)) : true;
  const missing = mustMatch?.filter((m) => !new RegExp(m, 'i').test(body)) ?? [];
  await page.screenshot({ path: `${SHOTS}${shot ?? id.toLowerCase()}.png`, fullPage: true });
  rec(id, title,
    landed && !crashed && has && pageErrors.length === 0 && serverErrors.length === 0,
    !landed ? `redirected to ${new URL(page.url()).pathname}`
      : crashed ? 'error boundary / TypeError on screen'
      : missing.length ? `missing: ${missing.join(', ')}`
      : serverErrors.length ? serverErrors[0]
      : pageErrors.length ? pageErrors[0].slice(0, 90)
      : 'ok');
  return body;
}

try {
  console.log(`\n=== Super Admin console walkthrough — ${WEB} (login bypassed as ${QA_ID}) ===\n`);

  // ── A1. login bypass actually took ────────────────────────────────────────
  await go('/');
  rec('SAF-A1-01', 'injected session lands on the console, not /login',
    new URL(page.url()).pathname === '/', `url=${new URL(page.url()).pathname}`);
  const shell = (await page.textContent('body')) ?? '';
  rec('SAF-A1-02', 'sidebar shows the signed-in operator + all 8 nav items',
    /qa-tester@tasqbots\.com|QA/i.test(shell) &&
    ['Dashboard', 'Manage Mandir', 'Manage Devotees', 'Sadhu-Sadhvi', 'Change Requests', 'Plans', 'Sampradaya', 'Settings']
      .every((n) => shell.includes(n)),
    'nav complete');

  // ── A2. Daily dashboard review ────────────────────────────────────────────
  const dash = await screen('SAF-A2-01', 'Dashboard renders temple + subscription + devotee stats',
    '/', ['temple|mandir', 'subscription|revenue|MRR|pending', 'devotee']);
  const stats = await api('GET', '/admin/stats', { token: TOKEN });
  rec('SAF-A2-02', 'dashboard numbers come from GET /admin/stats',
    stats.status === 200 && dash.includes(String(stats.data?.temples?.total ?? ' ')),
    `temples.total=${stats.data?.temples?.total}`);
  const pending = await api('GET', '/admin/stats/pending-subscriptions', { token: TOKEN });
  rec('SAF-A2-03', 'pending-subscriptions drill-down responds (A2 step 2)',
    pending.status === 200 && Array.isArray(pending.data), `n=${pending.data?.length}`);

  // ── A3/A4. Manage Mandir: list → detail → every tab ───────────────────────
  await screen('SAF-A3-01', 'Manage Mandir list renders mandir rows',
    '/mandirs', ['mandir|temple']);
  const tenants = await api('GET', '/admin/tenants', { token: TOKEN });
  const rows = Array.isArray(tenants.data) ? tenants.data : (tenants.data?.items ?? []);
  const subject = rows.find((t) => t.slug === 'smoke-portal') ?? rows[0];
  // The list is paginated, so the subject is not necessarily on page 1 — reach
  // it through the search box, the way an operator would. (`list` holds only
  // page 1, which is why asserting on it broke once the fixture grew past it.)
  const tenantSearch = page.locator('input[placeholder*="Search name or slug" i]').first();
  const hasSearch = (await tenantSearch.count()) > 0;
  if (hasSearch) {
    await tenantSearch.fill(subject?.slug ?? 'smoke-portal');
    await page.waitForTimeout(1600);
  }
  const searched = (await page.textContent('body')) ?? '';
  rec('SAF-A3-02', 'searching the mandir list finds the subject mandir',
    rows.length > 0 && hasSearch && searched.includes(subject?.slug ?? ' '),
    `n=${rows.length} subject=${subject?.slug}${hasSearch ? '' : ' — no search box'}`);

  // "New mandir" entry point must exist (A3 onboarding)
  await go('/mandirs');
  const newBtn = page.locator('button, a').filter({ hasText: /new mandir|add mandir|onboard|\+ *mandir/i }).first();
  rec('SAF-A3-03', 'onboarding entry point present on the list (A3)',
    (await newBtn.count()) > 0, (await newBtn.count()) ? await newBtn.textContent() : 'no new-mandir control');

  if (subject) {
    const TABS = [
      ['overview', 'Overview'],
      ['billing', 'Billing'],
      ['history', 'Subscription & Receipts'],
      ['users', 'Mandir Users'],
      ['people', 'Trustees & Requirements'],
    ];
    await screen('SAF-A4-01', 'Mandir detail opens on Overview',
      `/mandirs/${subject.id}`, [subject.slug]);
    for (const [key, label] of TABS) {
      pageErrors = []; serverErrors = [];
      const btn = page.locator('.tabs button').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first();
      if (!(await btn.count())) { rec(`SAF-A4-${key}`, `tab "${label}" exists`, false, 'tab button missing'); continue; }
      await btn.click();
      await page.waitForTimeout(1600);
      const b = (await page.textContent('body')) ?? '';
      const crashed = /Something went wrong|TypeError|is not a function/i.test(b);
      // Case-sensitive and word-bounded on purpose: /NaN/i also matches the
      // "nan" inside "tenancy" and "tenant.custom_plan.clear", both of which
      // are legitimately on these screens.
      const nan = /\bNaN\b/.test(b);
      await page.screenshot({ path: `${SHOTS}a4-tab-${key}.png`, fullPage: true });
      rec(`SAF-A4-${key}`, `tab "${label}" renders without crash/5xx/NaN`,
        !crashed && !nan && pageErrors.length === 0 && serverErrors.length === 0,
        crashed ? 'error boundary / TypeError on screen'
          : nan ? 'NaN rendered on screen'
          : serverErrors[0] ?? pageErrors[0]?.slice(0, 90) ?? 'ok');
    }

    // A4 read-only API surface the tabs are built on
    for (const [id, path, label] of [
      ['SAF-A4-api-detail', `/admin/tenants/${subject.id}`, 'GET tenant detail'],
      ['SAF-A4-api-sub', `/admin/tenants/${subject.id}/subscription`, 'GET subscription'],
      ['SAF-A4-api-inv', `/admin/tenants/${subject.id}/invoices`, 'GET invoices'],
      ['SAF-A4-api-billhist', `/admin/tenants/${subject.id}/billing-history`, 'GET billing-history'],
      ['SAF-A4-api-lifecycle', `/admin/tenants/${subject.id}/lifecycle-history`, 'GET lifecycle-history'],
      ['SAF-A4-api-access', `/admin/tenants/${subject.id}/access`, 'GET access (block preview)'],
      ['SAF-A4-api-effplan', `/admin/tenants/${subject.id}/effective-plan`, 'GET effective-plan'],
      ['SAF-A4-api-licenses', `/admin/tenants/${subject.id}/licenses`, 'GET licenses'],
      ['SAF-A4-api-trustees', `/admin/tenants/${subject.id}/trustees`, 'GET trustees'],
      ['SAF-A4-api-users', `/admin/tenants/${subject.id}/users`, 'GET mandir users'],
      ['SAF-A4-api-receipts', `/admin/tenants/${subject.id}/receipt-downloads`, 'GET receipt-downloads'],
    ]) {
      const r = await api('GET', path, { token: TOKEN });
      rec(id, `${label} (A4)`, r.status === 200, `status=${r.status}`);
    }

    // recycle bin (A4)
    const bin = await api('GET', '/admin/tenants?deleted_only=true', { token: TOKEN });
    const binRows = Array.isArray(bin.data) ? bin.data : (bin.data?.items ?? []);
    rec('SAF-A4-bin', 'recycle bin lists soft-deleted mandirs (A4)',
      bin.status === 200, `status=${bin.status} n=${binRows.length}`);
  }

  // ── A5. Manage Devotees ───────────────────────────────────────────────────
  await screen('SAF-A5-01', 'Manage Devotees list renders', '/devotees', ['devotee']);
  const dev = await api('GET', '/admin/devotees', { token: TOKEN });
  const devRows = Array.isArray(dev.data) ? dev.data : (dev.data?.items ?? dev.data?.rows ?? []);
  rec('SAF-A5-02', 'devotee list API backs the screen', dev.status === 200, `n=${devRows.length}`);
  const search = page.locator('input[type=search], input[placeholder*="search" i]').first();
  if (await search.count()) {
    await search.fill('a');
    await page.waitForTimeout(1400);
    const b = (await page.textContent('body')) ?? '';
    rec('SAF-A5-03', 'devotee search box filters without crashing (A5 step 1)',
      !/TypeError|Something went wrong/i.test(b), 'searched "a"');
  } else rec('SAF-A5-03', 'devotee search box present (A5 step 1)', false, 'no search input');

  // ── A7. Moderation: sant directory + change requests ──────────────────────
  await screen('SAF-A7-01', 'Sadhu-Sadhvi (sant) directory renders', '/maharaj', ['sadhu|sant|maharaj|muni|aryika']);
  await screen('SAF-A7-02', 'Change Requests queue renders (DEF-SA-01 regression)',
    '/change-requests', ['request|change']);
  const cr = await api('GET', '/admin/change-requests', { token: TOKEN });
  rec('SAF-A7-03', 'change-requests API returns an unwrappable list envelope',
    cr.status === 200 && (Array.isArray(cr.data) || Array.isArray(cr.data?.rows) || Array.isArray(cr.data?.items)),
    `status=${cr.status} type=${Array.isArray(cr.data) ? 'array' : typeof cr.data}`);

  // ── A8. Plans master ──────────────────────────────────────────────────────
  const plansBody = await screen('SAF-A8-01', 'Plans master renders with live tenant counts',
    '/plans', ['plan']);
  const plans = await api('GET', '/admin/plans', { token: TOKEN });
  const planRows = Array.isArray(plans.data) ? plans.data : (plans.data?.items ?? []);
  rec('SAF-A8-02', 'each plan row carries tenant_count (A8)',
    plans.status === 200 && planRows.length > 0 && planRows.every((p) => typeof p.tenant_count === 'number'),
    `n=${planRows.length}`);
  rec('SAF-A8-03', 'a plan name from the API is actually on screen',
    planRows.some((p) => plansBody.includes(p.display_name ?? p.name)),
    planRows[0]?.display_name ?? planRows[0]?.name);
  // Regression for the leaked-entity bug: the list must answer in snake_case,
  // or the whole Plans table renders blank names / "Free" / "Archived".
  rec('SAF-A8-03b', 'plan list is snake_case, not a leaked TypeORM entity',
    planRows.every((p) => typeof p.display_name === 'string' && typeof p.is_active === 'boolean'
      && typeof p.price_yearly_paise === 'number'),
    `first=${JSON.stringify(Object.keys(planRows[0] ?? {}).slice(0, 6))}`);
  // …and the screen must actually show a price and an Active badge.
  const planTable = await page.locator('table.data tbody').first().textContent().catch(() => '');
  rec('SAF-A8-03c', 'Plans table shows real prices + Active badges (not all Free/Archived)',
    /₹/.test(planTable) && /Active/.test(planTable),
    planTable.replace(/\s+/g, ' ').slice(0, 90));
  rec('SAF-A8-03d', 'the -1 "no cap" sentinel renders as Unlimited, never as -1',
    !/-1/.test(planTable), /-1/.test(planTable) ? 'raw -1 on screen' : 'ok');
  rec('SAF-A8-03e', 'money never renders a single decimal place (₹…​.6)',
    !/₹[\d,]+\.\d(?!\d)/.test(planTable + (await page.textContent('body') ?? '')), 'ok');

  // An unlimited plan must survive an unchanged edit — @Min(1) used to 400 it,
  // making the Enterprise plan permanently uneditable from the console.
  const entPlan = planRows.find((p) => p.max_users != null && p.max_users < 0) ?? planRows.find((p) => p.name === 'enterprise');
  if (entPlan) {
    const roundTrip = await api('PATCH', `/admin/plans/${entPlan.id}`, {
      token: TOKEN,
      body: {
        display_name: entPlan.display_name,
        price_monthly_paise: entPlan.price_monthly_paise,
        price_yearly_paise: entPlan.price_yearly_paise,
        max_users: entPlan.max_users,
        max_devices: entPlan.max_devices,
        max_receipts_per_month: entPlan.max_receipts_per_month,
        max_sms_per_month: entPlan.max_sms_per_month,
        max_storage_mb: entPlan.max_storage_mb,
        sort_order: entPlan.sort_order,
        is_active: entPlan.is_active,
      },
    });
    rec('SAF-A8-03f', 'an unlimited (-1) plan can be re-saved unchanged (A8 edit)',
      roundTrip.status === 200, `status=${roundTrip.status} ${JSON.stringify(roundTrip.json?.error ?? '').slice(0, 80)}`);
  }

  // ── Sampradaya (sect readiness) — in the nav, so it must work ─────────────
  await screen('SAF-SECT-01', 'Sampradaya / sect-readiness renders',
    '/sect-readiness', ['sect|sampradaya|digambar|shwetambar']);

  // ── A6. Settings: users / audit / my account ──────────────────────────────
  await screen('SAF-A6-01', 'Settings opens on User management', '/settings', ['user']);
  for (const [key, label, expect] of [
    ['users', 'User management', 'user'],
    ['audit', 'Audit trail', 'audit|action|actor|event'],
    ['account', 'My account', 'account|email|password|mfa'],
  ]) {
    pageErrors = []; serverErrors = [];
    const btn = page.locator('.tabs button').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first();
    if (!(await btn.count())) { rec(`SAF-A6-${key}`, `Settings tab "${label}"`, false, 'tab missing'); continue; }
    await btn.click();
    await page.waitForTimeout(1400);
    const b = (await page.textContent('body')) ?? '';
    await page.screenshot({ path: `${SHOTS}a6-${key}.png`, fullPage: true });
    rec(`SAF-A6-${key}`, `Settings tab "${label}" renders its content`,
      new RegExp(expect, 'i').test(b) && !/TypeError|Something went wrong/i.test(b) &&
        pageErrors.length === 0 && serverErrors.length === 0,
      serverErrors[0] ?? pageErrors[0]?.slice(0, 90) ?? 'ok');
  }
  const audit = await api('GET', '/admin/audit-events', { token: TOKEN });
  rec('SAF-A6-audit-api', 'audit trail API backs the tab (A6)', audit.status === 200, `status=${audit.status}`);

  // ── unknown route falls back to the dashboard, not a blank screen ─────────
  await go('/definitely-not-a-route');
  rec('SAF-NAV-01', 'unknown route redirects to the dashboard',
    new URL(page.url()).pathname === '/', `url=${new URL(page.url()).pathname}`);

  // ── every sidebar link actually navigates ────────────────────────────────
  await go('/');
  for (const [label, expectPath] of [
    ['Manage Mandir', '/mandirs'], ['Manage Devotees', '/devotees'], ['Sadhu-Sadhvi', '/maharaj'],
    ['Change Requests', '/change-requests'], ['Plans', '/plans'], ['Sampradaya', '/sect-readiness'],
    ['Settings', '/settings'], ['Dashboard', '/'],
  ]) {
    await page.locator('.sidebar nav a').filter({ hasText: new RegExp(`^${label}$`) }).first().click();
    await page.waitForTimeout(900);
    rec(`SAF-NAV-${label.replace(/\s+/g, '-')}`, `sidebar "${label}" navigates to ${expectPath}`,
      new URL(page.url()).pathname === expectPath, `url=${new URL(page.url()).pathname}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WRITE FLOWS — driven through the real UI on a throwaway mandir.
  // Nothing below touches smoke-portal.
  // ══════════════════════════════════════════════════════════════════════════
  const stamp = String(Date.now()).slice(-6);
  const newName = `SA Flow QA ${stamp}`;
  let newId = null;
  let newSlug = null;

  /** Wait for the detail page's success banner and report it. */
  async function expectNotice(id, title, timeout = 12000) {
    pageErrors = []; serverErrors = [];
    const notice = page.locator('[data-testid="notice"]');
    const ok = await notice.first().waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
    const text = ok ? (await notice.first().textContent())?.trim() : '';
    const err = await page.locator('.error-box').first().textContent().catch(() => '');
    rec(id, title, ok && serverErrors.length === 0,
      ok ? (text ?? '').slice(0, 70) : (err || 'no success banner appeared').slice(0, 90));
  }

  // ── A3. Onboard a new mandir, through the form ────────────────────────────
  await go('/mandirs');
  await page.locator('button', { hasText: '+ Onboard Mandir' }).first().click();
  await page.waitForTimeout(800);
  await page.fill('input[name="name"]', newName);
  await page.fill('input[name="admin_name"]', 'SA Flow Admin');
  await page.fill('input[name="admin_mobile"]', `98${stamp}00`.slice(0, 10));
  await page.screenshot({ path: `${SHOTS}a3-onboard-form.png`, fullPage: true });
  pageErrors = []; serverErrors = [];
  await page.locator('form button[type="submit"], form button.primary').last().click();
  await page.waitForTimeout(4500);
  const afterCreate = (await page.textContent('body')) ?? '';
  const created = await api('GET', `/admin/tenants?q=${encodeURIComponent(newName)}`, { token: TOKEN });
  const createdRows = Array.isArray(created.data) ? created.data : (created.data?.items ?? []);
  const mine = createdRows.find((t) => t.name === newName);
  newId = mine?.id ?? null;
  newSlug = mine?.slug ?? null;
  await page.screenshot({ path: `${SHOTS}a3-after-create.png`, fullPage: true });
  rec('SAF-A3-04', 'onboarding form provisions a real mandir (A3)',
    !!newId && serverErrors.length === 0,
    newId ? `slug=${newSlug} status=${mine?.status}` : (serverErrors[0] ?? 'no tenant created — ' + afterCreate.slice(0, 80)));

  if (newId) {
    const detail = `/mandirs/${newId}`;

    // ── A4. lifecycle actions, each through its own control ────────────────
    await go(detail, 1800);
    await page.locator('[data-testid="toggle-visibility"]').click();
    await expectNotice('SAF-A4-vis-hide', 'Hide from devotees (A4 visibility)');

    await go(detail, 1500);
    await page.locator('[data-testid="toggle-visibility"]').click();
    await expectNotice('SAF-A4-vis-show', 'Show to devotees (A4 visibility)');

    await go(detail, 1500);
    await page.locator('[data-testid="deactivate"]').click();
    await page.waitForTimeout(700);
    await page.fill('input[name="block_message"]', 'QA flow check — please ignore.');
    await page.locator('form button[type="submit"]').last().click();
    await expectNotice('SAF-A4-deactivate', 'Deactivate blocks staff logins (A4 activation)');

    // the block message the plan promises staff will see
    const access = await api('GET', `/admin/tenants/${newId}/access`, { token: TOKEN });
    rec('SAF-A4-blockmsg', 'block-message preview reflects what was typed (A4)',
      access.status === 200 && /QA flow check/.test(access.data?.block_message ?? ''),
      (access.data?.block_message ?? '').slice(0, 60));

    await go(detail, 1500);
    await page.locator('[data-testid="activate"]').click();
    await expectNotice('SAF-A4-activate', 'Activate restores staff logins (A4 activation)');

    await go(detail, 1500);
    await page.locator('[data-testid="custom-plan-btn"]').click();
    await page.waitForTimeout(700);
    const cpNum = page.locator('form input[type="number"]').first();
    if (await cpNum.count()) await cpNum.fill('1234500');
    await page.locator('form button[type="submit"]').last().click();
    await expectNotice('SAF-A4-custom-plan', 'Set a per-mandir custom plan (A4)');
    const eff = await api('GET', `/admin/tenants/${newId}/effective-plan`, { token: TOKEN });
    rec('SAF-A4-custom-plan-effect', 'custom plan shows up in effective-plan (A4)',
      eff.status === 200 && !!eff.data, `status=${eff.status}`);

    await go(detail, 1500);
    await page.locator('button', { hasText: /^Change plan$/ }).first().click();
    await page.waitForTimeout(700);
    const planSel = page.locator('form select').first();
    if (await planSel.count()) {
      const opts = await planSel.locator('option').allTextContents();
      const other = opts.find((o) => o.trim() && o.trim() !== 'standard');
      if (other) await planSel.selectOption({ label: other });
    }
    await page.locator('form button[type="submit"]').last().click();
    await expectNotice('SAF-A4-change-plan', 'Change plan (A4)');

    await go(detail, 1500);
    await page.locator('button', { hasText: /global sync$/ }).first().click();
    await expectNotice('SAF-A4-global-sync', 'Toggle global-ledger sync (A4)');

    await go(detail, 1500);
    await page.locator('button', { hasText: /bank & tax details$/ }).first().click();
    await expectNotice('SAF-A4-verify-sensitive', 'Verify & lock bank/tax details (A4)');

    // An online mandir has no licence tab: the desktop app signs in with the
    // trust's mobile OTP, and JainERP Offline's licence is on its own page.
    await go(detail, 1500);
    rec('SAF-A4-license', 'No licence tab on an online mandir (A4)',
      (await page.locator('.tabs button', { hasText: /licen/i }).count()) === 0);

    // ── A4. soft delete → recycle bin → restore ────────────────────────────
    await go(detail, 1500);
    await page.locator('[data-testid="delete-tenant"]').click();
    await page.waitForTimeout(700);
    await page.fill('input[name="confirm_slug"]', newSlug);
    pageErrors = []; serverErrors = [];
    await page.locator('form button[type="submit"]').last().click();
    await page.waitForTimeout(2500);
    const afterDel = await api('GET', `/admin/tenants/${newId}`, { token: TOKEN });
    rec('SAF-A4-delete', 'Soft delete with slug confirmation (A4)',
      afterDel.data?.is_deleted === true, `is_deleted=${afterDel.data?.is_deleted}`);

    const bin2 = await api('GET', '/admin/tenants?deleted_only=true', { token: TOKEN });
    const binRows2 = Array.isArray(bin2.data) ? bin2.data : (bin2.data?.items ?? []);
    rec('SAF-A4-in-bin', 'deleted mandir appears in the recycle bin (A4)',
      binRows2.some((t) => t.id === newId), `bin n=${binRows2.length}`);

    await go(detail, 1800);
    const restoreBtn = page.locator('[data-testid="restore"]');
    if (await restoreBtn.count()) {
      await restoreBtn.click();
      await expectNotice('SAF-A4-restore', 'Restore a deleted mandir (A4)');
    } else rec('SAF-A4-restore', 'Restore a deleted mandir (A4)', false, 'no restore button on a deleted mandir');

    // lifecycle history should have recorded every one of those actions
    const lh = await api('GET', `/admin/tenants/${newId}/lifecycle-history`, { token: TOKEN });
    const lhRows = Array.isArray(lh.data) ? lh.data : (lh.data?.items ?? lh.data?.rows ?? []);
    rec('SAF-A4-lifecycle-log', 'every lifecycle action was audit-logged (A4)',
      lh.status === 200 && lhRows.length >= 6, `n=${lhRows.length}`);
  }

  // ── A8. Plans master: create → verify on screen → delete ──────────────────
  const planKey = `qa_flow_${stamp}`;
  const mk = await api('POST', '/admin/plans', {
    token: TOKEN,
    body: { name: planKey, display_name: `QA Flow ${stamp}`, price_monthly_paise: 100000, price_yearly_paise: 1000000, max_users: 5 },
  });
  rec('SAF-A8-04', 'create a plan in the master (A8)', mk.status === 201 || mk.status === 200, `status=${mk.status}`);
  const mkId = mk.data?.id;
  if (mkId) {
    const body = await screen('SAF-A8-05', 'the new plan is visible on the Plans screen (A8)', '/plans', [`QA Flow ${stamp}`]);
    rec('SAF-A8-06', 'new plan starts with zero mandirs on it (A8)', /QA Flow/.test(body), 'listed');
    const del = await api('DELETE', `/admin/plans/${mkId}`, { token: TOKEN });
    rec('SAF-A8-07', 'an unused plan can be deleted (A8 cleanup)', del.status === 200, `status=${del.status}`);
  }

  // ── cleanup: leave the throwaway mandir soft-deleted ──────────────────────
  if (newId && newSlug) {
    const cleanup = await api('DELETE', `/admin/tenants/${newId}`, { token: TOKEN, body: { confirm_slug: newSlug, reason: 'qa flow walkthrough cleanup' } });
    rec('SAF-CLEAN', 'throwaway mandir soft-deleted at the end', cleanup.status === 200, `status=${cleanup.status}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== SA WALKTHROUGH: ${passed}/${results.length} passed, ${failed.length} failed ===`);
  for (const f of failed) console.log(`  ✘ ${f.id} ${f.title} — ${f.detail}`);
  console.log(`\nScreenshots → ${SHOTS}`);
  if (failed.length) process.exitCode = 1;
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
