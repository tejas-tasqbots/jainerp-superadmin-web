/**
 * End-to-end browser test of the Super Admin console against the live API.
 *
 * Prereqs: superadmin-api on :3105 (with seeded admin, MFA un-enrolled for the
 * full first-login flow), web dev server on :5180, system Google Chrome.
 *
 *   node e2e/run.mjs
 *
 * Covers: login → MFA enrolment (TOTP from the displayed otpauth URI) → dashboard →
 * mandir onboarding → detail (plan change, suspend/reactivate, global sync, billing:
 * payment link / mark paid / auto-debit, trustees, requirements, licenses) →
 * devotees (create/verify/edit) → settings (create user, reset password, audit,
 * recovery-code regeneration) → logout → recovery-code login.
 */
import { mkdirSync } from 'fs';
import { authenticator } from 'otplib';
import { chromium } from 'playwright';

const WEB = 'http://localhost:5180';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'ayush@tasqbots.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe@123';
const RUN = Date.now().toString().slice(-6);
const SHOTS = new URL('./screens/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

let step = 0;
const pass = (msg) => console.log(`  ✔ ${++step}. ${msg}`);
const fail = (msg) => {
  console.error(`  ✘ FAILED at step ${step + 1}: ${msg}`);
  process.exitCode = 1;
};

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
page.setDefaultTimeout(10000);
page.on('dialog', (d) => d.accept());

try {
  // ---------- Login + full MFA enrolment ----------
  await page.goto(WEB);
  await page.waitForURL('**/login');
  await page.fill('input[name=identifier]', ADMIN_EMAIL);
  await page.fill('input[name=password]', ADMIN_PASSWORD);
  await page.screenshot({ path: SHOTS + '01-login.png' });
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('text=First login');
  pass('password step → MFA enrolment required');

  await page.click('button:has-text("Set up MFA")');
  await page.waitForSelector('[data-testid=recovery-codes]');
  await page.click('summary'); // reveal otpauth URI
  const uri = await page.textContent('[data-testid=otpauth-uri]');
  const secret = new URL(uri.trim()).searchParams.get('secret');
  const recoveryCodes = await page.$$eval('[data-testid=recovery-codes] code', (els) =>
    els.map((e) => e.textContent),
  );
  if (recoveryCodes.length !== 10) throw new Error('expected 10 recovery codes');
  await page.screenshot({ path: SHOTS + '02-mfa-enrol.png' });
  pass(`MFA QR + secret + ${recoveryCodes.length} recovery codes displayed`);

  await page.fill('input[name=code]', authenticator.generate(secret));
  await page.click('button:has-text("Verify & sign in")');
  await page.waitForSelector('[data-testid=stat-temples]');
  pass('TOTP verified → dashboard');

  // ---------- Dashboard ----------
  const temples = await page.textContent('[data-testid=stat-temples]');
  const pending = await page.textContent('[data-testid=stat-pending]');
  await page.screenshot({ path: SHOTS + '03-dashboard.png' });
  pass(`dashboard stats render (temples=${temples.trim()}, pending=${pending.trim()})`);

  // ---------- Onboard a mandir ----------
  await page.click('nav >> text=Manage Mandir');
  await page.waitForSelector('h1:has-text("Manage Mandir")');
  await page.click('button:has-text("+ Onboard Mandir")');
  const name = `E2E Mandir ${RUN}`;
  await page.fill('input[name=name]', name);
  await page.selectOption('select[name=plan]', 'standard');
  await page.selectOption('select[name=billing_cycle]', 'yearly');
  await page.fill('input[name=admin_name]', 'E2E Admin');
  await page.fill('input[name=admin_mobile]', `+9197${RUN}00`.slice(0, 13));
  await page.fill('input[name=city]', 'Surat');
  await page.click('.modal button:has-text("Create")');
  await page.waitForSelector(`a:has-text("${name}")`);
  await page.screenshot({ path: SHOTS + '04-mandir-list.png' });
  pass('mandir onboarded and visible in list');

  // ---------- Detail: overview actions ----------
  await page.click(`a:has-text("${name}")`);
  await page.waitForSelector('h2:has-text("Profile")');
  await page.click('button:has-text("Change plan")');
  await page.selectOption('.modal select >> nth=0', 'premium');
  await page.click('.modal button:has-text("Change plan")');
  await page.waitForSelector('[data-testid=notice]:has-text("Plan updated")');
  pass('plan changed to premium');

  await page.click('button:has-text("Enable global sync")');
  await page.waitForSelector('[data-testid=notice]:has-text("Global sync enabled")');
  pass('global sync toggled on');

  await page.click('button:has-text("Suspend")');
  await page.click('.modal button:has-text("Suspend")');
  await page.waitForSelector('.badge.suspended');
  pass('mandir suspended');
  await page.click('button:has-text("Reactivate")');
  await page.waitForSelector('.badge.active');
  pass('mandir reactivated');

  // ---------- Billing ----------
  await page.click('.tabs button:has-text("Billing")');
  await page.waitForSelector('h2:has-text("Invoices")');
  await page.click('table button:has-text("Payment link")');
  await page.waitForSelector('[data-testid=payment-link] a');
  const link = await page.textContent('[data-testid=payment-link] a');
  pass(`payment link generated: ${link.trim()}`);

  await page.click('button:has-text("Set up auto-debit")');
  await page.waitForSelector('[data-testid=mandate-link]');
  pass('auto-debit mandate created (authorization link shown)');

  await page.click('table button:has-text("Mark paid")');
  await page.waitForSelector('table .badge.paid');
  await page.screenshot({ path: SHOTS + '05-billing.png' });
  pass('invoice marked paid');

  // ---------- Trustees ----------
  await page.click('.tabs button:has-text("Trustees")');
  await page.click('button:has-text("+ Add trustee")');
  await page.fill('input[name=trustee_name]', 'Mahesh Jain');
  await page.click('.modal button:has-text("Add")');
  await page.waitForSelector('td:has-text("Mahesh Jain")');
  pass('trustee added');

  // ---------- Licenses ----------
  await page.click('.tabs button:has-text("Licenses")');
  await page.click('button:has-text("+ Issue license")');
  await page.click('.modal button:has-text("Issue")');
  await page.waitForSelector('td.mono:has-text("JERP-")');
  const key = await page.textContent('td.mono:has-text("JERP-")');
  pass(`license issued: ${key.trim()}`);
  await page.click('table button:has-text("Revoke")');
  await page.waitForSelector('.badge.revoked');
  await page.screenshot({ path: SHOTS + '06-licenses.png' });
  pass('license revoked');

  // ---------- Devotees ----------
  await page.click('nav >> text=Manage Devotees');
  await page.waitForSelector('h1:has-text("Manage Devotees")');
  await page.click('button:has-text("+ Add Devotee")');
  const mob = `+9198${RUN}11`.slice(0, 13);
  await page.fill('.modal input[name=mobile]', mob);
  await page.fill('.modal input[name=name]', `Devotee ${RUN}`);
  await page.click('.modal button:has-text("Create")');
  await page.waitForSelector(`td:has-text("${mob}")`);
  pass('devotee created');

  const row = page.locator('tr', { hasText: mob });
  await row.locator('button:has-text("Verify")').click();
  await row.locator('.badge.verified').waitFor();
  pass('devotee verified');

  await row.locator('button:has-text("Edit")').click();
  await page.fill('.modal input[name=name]', `Devotee ${RUN} Edited`);
  await page.click('.modal button:has-text("Save")');
  await page.waitForSelector(`td:has-text("Devotee ${RUN} Edited")`);
  await page.screenshot({ path: SHOTS + '07-devotees.png' });
  pass('devotee edited');

  // ---------- Settings: users ----------
  await page.click('nav >> text=Settings');
  await page.click('button:has-text("+ Add super-admin user")');
  await page.fill('input[name=user_name]', `Support ${RUN}`);
  await page.fill('input[name=user_email]', `support${RUN}@tasqbots.com`);
  await page.fill('input[name=user_mobile]', `+9196${RUN}22`.slice(0, 13));
  await page.selectOption('select[name=user_role]', 'support');
  await page.click('.modal button:has-text("Create")');
  await page.waitForSelector('[data-testid=users-notice]:has-text("Set-password token")');
  pass('super-admin user created (set-password token shown)');

  const newUserRow = page.locator('tr', { hasText: `support${RUN}@tasqbots.com` });
  await newUserRow.locator('button:has-text("Reset password")').click();
  await page.waitForSelector('[data-testid=users-notice]:has-text("Temp password")');
  pass('password reset (temp password shown)');

  // ---------- Settings: audit trail ----------
  await page.click('.tabs button:has-text("Audit trail")');
  await page.waitForSelector('td.mono:has-text("admin_user.create")');
  await page.screenshot({ path: SHOTS + '08-audit.png' });
  pass('audit trail shows recent actions');

  // ---------- Settings: regenerate recovery codes ----------
  await page.click('.tabs button:has-text("My account")');
  await page.fill('.card:has-text("Regenerate") input', authenticator.generate(secret));
  await page.click('button:has-text("Regenerate")');
  await page.waitForSelector('[data-testid=new-recovery-codes]');
  const newCodes = await page.$$eval('[data-testid=new-recovery-codes] code', (els) =>
    els.map((e) => e.textContent),
  );
  pass(`recovery codes regenerated (${newCodes.length} new codes)`);

  // ---------- Logout + recovery-code login ----------
  await page.click('a:has-text("Sign out")');
  await page.waitForURL('**/login');
  pass('logged out');

  await page.fill('input[name=identifier]', ADMIN_EMAIL);
  await page.fill('input[name=password]', ADMIN_PASSWORD);
  await page.click('button:has-text("Continue")');
  await page.click('a:has-text("Lost device? Use a recovery code")');
  await page.fill('input[name=code]', newCodes[0]);
  await page.click('button:has-text("Verify & sign in")');
  await page.waitForSelector('[data-testid=stat-temples]');
  await page.screenshot({ path: SHOTS + '09-recovery-login.png' });
  pass('recovery-code login works');

  console.log(`\nALL ${step} E2E STEPS PASSED — screenshots in e2e/screens/`);
} catch (e) {
  await page.screenshot({ path: SHOTS + 'failure.png' }).catch(() => undefined);
  fail(e.message);
} finally {
  await browser.close();
}
