/**
 * Functional API E2E suite for the Super Admin console API (:3105).
 *
 * Auth is password + TOTP MFA (no OTP mock). To drive a real session without
 * touching any existing user's secret, the suite uses a dedicated QA super-admin
 * seeded with a known password and NO TOTP, then walks the sanctioned first-login
 * enrolment flow (login -> mfa/setup returns a fresh secret by design -> mfa/verify).
 *
 * Prereq: run the seeder once so the QA account exists in a clean state. Note
 * superadmin-api's .env.local may point at a remote DB — pass local overrides so
 * the QA admin lands in the same DB the running API is using:
 *   (cd ../superadmin-api && DB_HOST=localhost DB_PORT=5434 DB_PASSWORD=jainerp_dev \
 *      npx ts-node scripts/seed-qa-tester.ts)
 *
 *   node e2e/full/api-suite.mjs
 *
 * Emits one line per case: PASS/FAIL <TC-ID> <title>. Exit 1 if any P1 fails.
 */
import { authenticator } from 'otplib';

const BASE = process.env.E2E_SA_API ?? 'http://localhost:3105/api/v1';
const QA_ID = 'qa-tester@tasqbots.com';
const QA_PASSWORD = 'QaTest@12345';

const results = [];
function record(id, pri, title, ok, detail = '') {
  results.push({ id, pri, title, ok, detail });
  console.log(`  ${ok ? '✔' : '✘'} ${ok ? 'PASS' : 'FAIL'} ${id} [${pri}] ${title}${detail ? ' — ' + detail : ''}`);
}

async function http(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, json, data: json?.data, code: json?.error?.code };
}

/** Drives password -> mfa/setup -> mfa/verify, returning tokens + the fresh secret. */
async function fullLogin() {
  const login = await http('POST', '/admin/auth/login', { body: { identifier: QA_ID, password: QA_PASSWORD } });
  const mfaToken = login.data?.mfa_token;
  if (!mfaToken) throw new Error(`login failed: ${JSON.stringify(login.json)}`);
  const setup = await http('POST', '/admin/auth/mfa/setup', { body: { mfa_token: mfaToken } });
  const secret = setup.data?.otpauth_uri?.match(/secret=([A-Z0-9]+)/)?.[1];
  if (!secret) throw new Error(`mfa/setup failed: ${JSON.stringify(setup.json)}`);
  const verify = await http('POST', '/admin/auth/mfa/verify', {
    body: { mfa_token: mfaToken, type: 'totp', code: authenticator.generate(secret) },
  });
  if (!verify.data?.access_token) throw new Error(`mfa/verify failed: ${JSON.stringify(verify.json)}`);
  return { access: verify.data.access_token, refresh: verify.data.refresh_token, secret, recovery: setup.data.recovery_codes };
}

async function main() {
  // ---------------- AUTH ----------------
  const login = await http('POST', '/admin/auth/login', { body: { identifier: QA_ID, password: QA_PASSWORD } });
  record('SA-AUTH-01', 'P1', 'password login returns mfa_token + mfa_required',
    login.status === 200 && !!login.data?.mfa_token && login.data?.mfa_required === true,
    `status=${login.status}`);

  const badPw = await http('POST', '/admin/auth/login', { body: { identifier: QA_ID, password: 'wrong-password' } });
  record('SA-AUTH-02', 'P1', 'wrong password rejected 401',
    badPw.status === 401, `status=${badPw.status} code=${badPw.code}`);

  const unknownUser = await http('POST', '/admin/auth/login', { body: { identifier: 'nobody@nowhere.com', password: 'x' } });
  record('SA-AUTH-03', 'P2', 'unknown identifier rejected 401 (no user enumeration)',
    unknownUser.status === 401, `status=${unknownUser.status}`);

  const mfaToken = login.data?.mfa_token;
  const setup = await http('POST', '/admin/auth/mfa/setup', { body: { mfa_token: mfaToken } });
  const secret = setup.data?.otpauth_uri?.match(/secret=([A-Z0-9]+)/)?.[1];
  record('SA-AUTH-04', 'P1', 'mfa/setup returns otpauth uri + 10 recovery codes',
    setup.status === 200 && !!secret && setup.data?.recovery_codes?.length === 10,
    `codes=${setup.data?.recovery_codes?.length}`);

  const badTotp = await http('POST', '/admin/auth/mfa/verify', { body: { mfa_token: mfaToken, type: 'totp', code: '000000' } });
  record('SA-AUTH-05', 'P1', 'wrong TOTP code rejected',
    badTotp.status === 401, `status=${badTotp.status}`);

  const verify = await http('POST', '/admin/auth/mfa/verify', {
    body: { mfa_token: mfaToken, type: 'totp', code: authenticator.generate(secret) },
  });
  const token = verify.data?.access_token;
  const refresh = verify.data?.refresh_token;
  record('SA-AUTH-06', 'P1', 'valid TOTP issues access + refresh token',
    verify.status === 200 && !!token && !!refresh && verify.data?.user?.admin_role === 'superadmin',
    `role=${verify.data?.user?.admin_role}`);

  const badMfaToken = await http('POST', '/admin/auth/mfa/setup', { body: { mfa_token: 'not-a-jwt' } });
  record('SA-AUTH-07', 'P2', 'malformed mfa_token rejected',
    badMfaToken.status === 401, `status=${badMfaToken.status}`);

  const refreshed = await http('POST', '/admin/auth/refresh', { body: { refresh_token: refresh } });
  record('SA-AUTH-08', 'P1', 'refresh rotates access token',
    refreshed.status === 200 && !!refreshed.data?.access_token, `status=${refreshed.status}`);

  // ---------------- GUARD ----------------
  const noToken = await http('GET', '/admin/tenants');
  record('SA-GRD-01', 'P1', 'protected route without token -> 401',
    noToken.status === 401, `status=${noToken.status} code=${noToken.code}`);

  const badToken = await http('GET', '/admin/tenants', { token: 'garbage.token.here' });
  record('SA-GRD-02', 'P1', 'protected route with garbage token -> 401',
    badToken.status === 401, `status=${badToken.status}`);

  // ---------------- ME ----------------
  const me = await http('GET', '/admin/me', { token });
  record('SA-ME-01', 'P1', '/admin/me returns current admin',
    me.status === 200 && me.data?.email === QA_ID, `email=${me.data?.email}`);

  // ---------------- STATS ----------------
  const stats = await http('GET', '/admin/stats', { token });
  record('SA-STAT-01', 'P1', 'dashboard stats shape (temples/subscriptions/devotees)',
    stats.status === 200 && !!stats.data?.temples && !!stats.data?.subscriptions && !!stats.data?.devotees,
    `temples.total=${stats.data?.temples?.total}`);

  const pendingSubs = await http('GET', '/admin/stats/pending-subscriptions', { token });
  record('SA-STAT-02', 'P2', 'pending-subscriptions list',
    pendingSubs.status === 200 && Array.isArray(pendingSubs.data), `status=${pendingSubs.status}`);

  // ---------------- TENANTS ----------------
  const tenants = await http('GET', '/admin/tenants', { token });
  const rows = Array.isArray(tenants.data) ? tenants.data : (tenants.data?.items ?? []);
  const firstTenant = rows[0];
  record('SA-TEN-01', 'P1', 'tenant list returns rows',
    tenants.status === 200 && !!firstTenant, `n=${rows.length}`);

  // Prefer a fully-provisioned tenant that actually has a subscription so the
  // subscription/invoice assertions are meaningful (seed tenants have none).
  const subjectTenant =
    rows.find((t) => t.slug === 'smoke-portal') ??
    rows.find((t) => t.status === 'active' && t.schema_name && t.schema_name !== 'tenant_test' && t.schema_name !== 'tenant_other') ??
    firstTenant;
  const tId = subjectTenant?.id;
  if (tId) {
    const one = await http('GET', `/admin/tenants/${tId}`, { token });
    record('SA-TEN-02', 'P1', 'tenant detail by id',
      one.status === 200 && one.data?.id === tId, `slug=${one.data?.slug}`);

    const sub = await http('GET', `/admin/tenants/${tId}/subscription`, { token });
    record('SA-TEN-03', 'P2', 'tenant subscription', sub.status === 200, `status=${sub.status}`);

    const invoices = await http('GET', `/admin/tenants/${tId}/invoices`, { token });
    record('SA-TEN-04', 'P2', 'tenant invoices list',
      invoices.status === 200, `status=${invoices.status}`);

    const licenses = await http('GET', `/admin/tenants/${tId}/licenses`, { token });
    record('SA-TEN-05', 'P2', 'tenant licenses list', licenses.status === 200, `status=${licenses.status}`);

    const trustees = await http('GET', `/admin/tenants/${tId}/trustees`, { token });
    record('SA-TEN-06', 'P2', 'tenant trustees list', trustees.status === 200, `status=${trustees.status}`);

    const users = await http('GET', `/admin/tenants/${tId}/users`, { token });
    record('SA-TEN-07', 'P2', 'tenant users list', users.status === 200, `status=${users.status}`);

    const planChanges = await http('GET', `/admin/tenants/${tId}/plan-changes`, { token });
    record('SA-TEN-08', 'P3', 'tenant plan-change history', planChanges.status === 200, `status=${planChanges.status}`);
  }

  const badUuid = await http('GET', '/admin/tenants/not-a-uuid', { token });
  record('SA-TEN-09', 'P1', 'non-UUID tenant id -> 400 (ParseUUIDPipe)',
    badUuid.status === 400, `status=${badUuid.status}`);

  const missingTenant = await http('GET', '/admin/tenants/00000000-0000-0000-0000-000000000000', { token });
  record('SA-TEN-10', 'P2', 'unknown tenant id -> 404',
    missingTenant.status === 404, `status=${missingTenant.status}`);

  const badCreate = await http('POST', '/admin/tenants', { token, body: {} });
  record('SA-TEN-11', 'P1', 'create tenant validation (empty body -> 400)',
    badCreate.status === 400, `status=${badCreate.status}`);

  const badCreate2 = await http('POST', '/admin/tenants', {
    token, body: { name: 'X', plan: 'basic', admin_contact: { name: 'a', mobile: 'not-e164' } },
  });
  record('SA-TEN-12', 'P1', 'create tenant rejects non-E164 admin mobile',
    badCreate2.status === 400, `status=${badCreate2.status}`);

  // ---------------- INVOICES ----------------
  const invoicesAll = await http('GET', '/admin/invoices', { token });
  record('SA-INV-01', 'P2', 'platform invoices list', invoicesAll.status === 200, `status=${invoicesAll.status}`);

  // ---------------- PLANS ----------------
  const plans = await http('GET', '/admin/plans', { token });
  record('SA-PLAN-01', 'P1', 'plans list', plans.status === 200 && Array.isArray(plans.data), `n=${plans.data?.length}`);

  // ---------------- GLOBAL TRANSACTIONS ----------------
  const gtx = await http('GET', '/admin/global-transactions', { token });
  record('SA-GTX-01', 'P1', 'global transactions list', gtx.status === 200, `status=${gtx.status}`);
  const gtxStats = await http('GET', '/admin/global-transactions/stats', { token });
  record('SA-GTX-02', 'P2', 'global transactions stats', gtxStats.status === 200, `status=${gtxStats.status}`);

  // ---------------- USERS / AUDIT ----------------
  const usersList = await http('GET', '/admin/users', { token });
  record('SA-USR-01', 'P1', 'admin users list', usersList.status === 200, `status=${usersList.status}`);
  const audit = await http('GET', '/admin/audit-events', { token });
  record('SA-USR-02', 'P2', 'audit events list', audit.status === 200, `status=${audit.status}`);

  // ---------------- DEVOTEES (safe write lifecycle) ----------------
  const devList = await http('GET', '/admin/devotees', { token });
  record('SA-DEV-01', 'P1', 'devotees list', devList.status === 200, `status=${devList.status}`);

  const badDev = await http('POST', '/admin/devotees', { token, body: { mobile: '12345' } });
  record('SA-DEV-02', 'P1', 'devotee create rejects non-E164 mobile',
    badDev.status === 400, `status=${badDev.status}`);

  const qaMobile = `+9199${Math.floor(10000000 + Math.random() * 89999999)}`;
  const createDev = await http('POST', '/admin/devotees', { token, body: { mobile: qaMobile, name: 'QA Temp Devotee' } });
  const devId = createDev.data?.id;
  record('SA-DEV-03', 'P1', 'devotee create (valid) returns id',
    (createDev.status === 200 || createDev.status === 201) && !!devId, `status=${createDev.status}`);

  if (devId) {
    const patchDev = await http('PATCH', `/admin/devotees/${devId}`, { token, body: { name: 'QA Renamed' } });
    record('SA-DEV-04', 'P2', 'devotee update', patchDev.status === 200, `status=${patchDev.status}`);
    const verifyDev = await http('PATCH', `/admin/devotees/${devId}/verify`, { token, body: { verified: true } });
    record('SA-DEV-05', 'P2', 'devotee verify toggle', verifyDev.status === 200, `status=${verifyDev.status}`);
    const delDev = await http('DELETE', `/admin/devotees/${devId}`, { token });
    record('SA-DEV-06', 'P2', 'devotee delete (cleanup)', delDev.status === 200 || delDev.status === 204, `status=${delDev.status}`);
  }

  // ---------------- MAHARAJ ----------------
  const maharajList = await http('GET', '/admin/maharaj', { token });
  record('SA-MHJ-01', 'P1', 'maharaj list', maharajList.status === 200, `status=${maharajList.status}`);

  // ================================================================
  // VISIBILITY / LIFECYCLE / CUSTOM PLAN / BILLING HISTORY (migration 029)
  // Runs against a throwaway tenant so no real mandir is ever suspended.
  // ================================================================
  await visibilityAndBillingSuite(token);

  // ---------------- SUMMARY ----------------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== SA SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  console.log('\nJSON_RESULTS=' + JSON.stringify(results));
  process.exit(p1Failed.length ? 1 : 0);
}

/**
 * Temple visibility on/off, active/inactive, suspend, soft delete + restore,
 * custom plans, and the subscription / upgrade / receipt-download history
 * (migration 029).
 *
 * Everything runs against a purpose-built throwaway mandir so no real tenant is
 * ever blocked. Cross-app assertions (mandiradmin login refusal, devotee
 * directory hiding) run only when those APIs are reachable, and use their
 * OTP_MOCK login bypass.
 */
async function visibilityAndBillingSuite(token) {
  const MANDIR_API = process.env.E2E_MANDIR_API ?? 'http://localhost:3106/api/v1';
  const DEVOTEE_API = process.env.E2E_DEVOTEE_API ?? 'http://localhost:3107/api/v1';
  const run = Date.now().toString().slice(-6);
  const staffMobile = `+9198${run}77`.slice(0, 13);
  const devoteeMobile = `+9197${run}88`.slice(0, 13);
  // The devotee directory sits behind DevoteeAuthGuard — sign a throwaway
  // devotee in through the OTP_MOCK bypass so the visibility checks are real.
  const devoteeToken = await devoteeLogin(DEVOTEE_API, devoteeMobile);

  // Five cases below (SA-VIS-05/06/06b/07/09b) sit behind `if (devoteeToken)`.
  // When devotee-api is down they do not fail — they simply never record, and
  // the suite prints a smaller green total. Passes of this suite have reported
  // 84, 87 and 93 cases; a green "84/84" and a green "93/93" look equally good
  // and cover different amounts of the product. Asserting the dependency turns
  // that silent shrinkage into a visible failure, which is the whole point of
  // running the suite.
  record('SA-VIS-DEP', 'P1', 'devotee-api is reachable, so the cross-app visibility cases actually run',
    !!devoteeToken,
    devoteeToken ? 'devotee session acquired' : 'devotee-api unreachable — SA-VIS-05/06/06b/07/09b were SKIPPED, not passed');

  // ---- provision a disposable mandir ----
  const created = await http('POST', '/admin/tenants', {
    token,
    body: {
      name: `VIS QA Mandir ${run}`,
      plan: 'standard',
      billing_cycle: 'monthly',
      admin_contact: { name: 'Vis QA Admin', mobile: staffMobile },
      address: { city: 'Pune', state: 'Maharashtra' },
      devotee_visible: true,
    },
  });
  const id = created.data?.id;
  const slug = created.data?.slug;
  record('SA-VIS-00', 'P1', 'throwaway mandir provisioned for the visibility suite',
    (created.status === 200 || created.status === 201) && !!id, `status=${created.status} slug=${slug}`);
  if (!id) return;

  const detail = async () => (await http('GET', `/admin/tenants/${id}`, { token })).data;
  const access = async () => (await http('GET', `/admin/tenants/${id}/access`, { token })).data;

  // ---- baseline ----
  const base = await detail();
  record('SA-VIS-01', 'P1', 'new mandir starts visible, active, not deleted, access allowed',
    base?.devotee_visible === true && base?.is_active === true && base?.is_deleted === false && base?.access_enabled === true,
    `visible=${base?.devotee_visible} active=${base?.is_active} access=${base?.access_enabled}`);

  // ---- 1. devotee visibility OFF (must NOT touch login access) ----
  const hide = await http('PATCH', `/admin/tenants/${id}/visibility`, { token, body: { devotee_visible: false } });
  const afterHide = await access();
  record('SA-VIS-02', 'P1', 'visibility off hides from devotees but keeps staff login working',
    hide.status === 200 && afterHide?.devotee_visible === false && afterHide?.access_enabled === true
      && afterHide?.listed_in_directory === false,
    `access=${afterHide?.access_enabled} listed=${afterHide?.listed_in_directory}`);

  const hideAgain = await http('PATCH', `/admin/tenants/${id}/visibility`, { token, body: { devotee_visible: false } });
  record('SA-VIS-03', 'P2', 'toggling visibility to its current value -> 409',
    hideAgain.status === 409, `status=${hideAgain.status}`);

  const filterHidden = await http('GET', '/admin/tenants?devotee_visible=false&limit=100', { token });
  record('SA-VIS-04', 'P2', 'list filter devotee_visible=false finds the hidden mandir',
    filterHidden.status === 200 && (filterHidden.data ?? []).some((t) => t.id === id),
    `n=${(filterHidden.data ?? []).length}`);

  // devotee-api must not list or serve it
  if (devoteeToken) {
    const dirHidden = await devoteeGet(DEVOTEE_API, devoteeToken, `/temples/directory?q=${encodeURIComponent(`VIS QA Mandir ${run}`)}`);
    record('SA-VIS-05', 'P1', 'devotee directory does not list a hidden mandir',
      dirHidden.status === 200 && !(dirHidden.rows ?? []).some((t) => t.slug === slug),
      `n=${(dirHidden.rows ?? []).length}`);
    const bySlug = await devoteeGet(DEVOTEE_API, devoteeToken, `/temples/${slug}`);
    record('SA-VIS-06', 'P1', 'devotee temple page 404s for a hidden mandir',
      bySlug.status === 404, `status=${bySlug.status}`);
    const pay = await devoteeGet(DEVOTEE_API, devoteeToken, `/temples/${slug}/payment-details`);
    record('SA-VIS-06b', 'P1', 'donating to a hidden mandir is refused',
      pay.status === 404, `status=${pay.status}`);
  } else {
    record('SA-VIS-05', 'P3', 'devotee directory checks skipped (devotee-api not reachable)', true);
  }

  // ---- back ON, then confirm devotees can see it again ----
  await http('PATCH', `/admin/tenants/${id}/visibility`, { token, body: { devotee_visible: true } });
  if (devoteeToken) {
    const dirShown = await devoteeGet(DEVOTEE_API, devoteeToken, `/temples/directory?q=${encodeURIComponent(`VIS QA Mandir ${run}`)}`);
    record('SA-VIS-07', 'P1', 'devotee directory lists the mandir again once visibility is back on',
      (dirShown.rows ?? []).some((t) => t.slug === slug), `n=${(dirShown.rows ?? []).length}`);
  }

  // ---- 2. deactivate (master switch) blocks staff login ----
  const deact = await http('PATCH', `/admin/tenants/${id}/activation`, {
    token,
    body: { is_active: false, reason: 'non_payment' },
  });
  const afterDeact = await access();
  record('SA-VIS-08', 'P1', 'deactivation blocks access and produces a contact message',
    deact.status === 200 && afterDeact?.access_enabled === false && afterDeact?.is_active === false
      && /contact@jainerp\.org/i.test(afterDeact?.block_message ?? ''),
    `msg="${(afterDeact?.block_message ?? '').slice(0, 70)}"`);

  // The mandir staff login must now refuse with that same message.
  const mandirBlocked = await mandirLoginAttempt(MANDIR_API, staffMobile);
  if (mandirBlocked) {
    record('SA-VIS-09', 'P1', 'mandir staff login refused with the contact message',
      mandirBlocked.blocked === true && /contact@jainerp\.org/i.test(mandirBlocked.message ?? ''),
      `code=${mandirBlocked.code} msg="${(mandirBlocked.message ?? '').slice(0, 70)}"`);
  } else {
    record('SA-VIS-09', 'P3', 'mandir login check skipped (mandiradmin-api not reachable)', true);
  }

  if (devoteeToken) {
    const dirDeact = await devoteeGet(DEVOTEE_API, devoteeToken, `/temples/directory?q=${encodeURIComponent(`VIS QA Mandir ${run}`)}`);
    record('SA-VIS-09b', 'P1', 'a deactivated mandir also disappears from the devotee directory',
      !(dirDeact.rows ?? []).some((t) => t.slug === slug), `n=${(dirDeact.rows ?? []).length}`);
  }

  // ---- 3. custom block message overrides the default ----
  await http('PATCH', `/admin/tenants/${id}/activation`, { token, body: { is_active: true } });
  await http('PATCH', `/admin/tenants/${id}/activation`, {
    token,
    body: { is_active: false, reason: 'other', block_message: 'Renewal pending — call Sureshbhai on 9764564185.' },
  });
  const custom = await access();
  record('SA-VIS-10', 'P2', 'custom block message is what staff are shown',
    custom?.block_message === 'Renewal pending — call Sureshbhai on 9764564185.',
    `msg="${custom?.block_message}"`);

  // ---- 4. reactivate restores access ----
  const react = await http('PATCH', `/admin/tenants/${id}/activation`, { token, body: { is_active: true } });
  const afterReact = await access();
  record('SA-VIS-11', 'P1', 'activation restores access and clears the block message',
    react.status === 200 && afterReact?.access_enabled === true && afterReact?.block_message === null,
    `access=${afterReact?.access_enabled}`);

  // ---- 5. suspend is an independent control ----
  const susp = await http('PATCH', `/admin/tenants/${id}/suspend`, { token, body: { reason: 'non_payment' } });
  const afterSusp = await access();
  record('SA-VIS-12', 'P1', 'suspend blocks access even though is_active is still true',
    susp.status === 200 && afterSusp?.access_enabled === false && afterSusp?.is_active === true
      && afterSusp?.status === 'suspended',
    `status=${afterSusp?.status} is_active=${afterSusp?.is_active}`);
  await http('PATCH', `/admin/tenants/${id}/reactivate`, { token, body: {} });

  // ---- 6. soft delete + restore ----
  const badDelete = await http('DELETE', `/admin/tenants/${id}`, { token, body: { confirm_slug: 'wrong-slug' } });
  record('SA-VIS-13', 'P1', 'delete without the matching slug -> 400',
    badDelete.status === 400, `status=${badDelete.status}`);

  const del = await http('DELETE', `/admin/tenants/${id}`, { token, body: { confirm_slug: slug, reason: 'qa cleanup' } });
  const afterDel = await access();
  record('SA-VIS-14', 'P1', 'soft delete blocks access and flags the mandir deleted',
    del.status === 200 && afterDel?.is_deleted === true && afterDel?.access_enabled === false,
    `deleted=${afterDel?.is_deleted}`);

  const defaultList = await http('GET', '/admin/tenants?limit=100', { token });
  record('SA-VIS-15', 'P1', 'a deleted mandir drops out of the default tenant list',
    !(defaultList.data ?? []).some((t) => t.id === id), `n=${(defaultList.data ?? []).length}`);

  const binList = await http('GET', '/admin/tenants?deleted_only=true&limit=100', { token });
  record('SA-VIS-16', 'P2', 'deleted_only=true surfaces it in the recycle bin',
    (binList.data ?? []).some((t) => t.id === id), `n=${(binList.data ?? []).length}`);

  const suspendDeleted = await http('PATCH', `/admin/tenants/${id}/suspend`, { token, body: { reason: 'abuse' } });
  record('SA-VIS-17', 'P2', 'a deleted mandir cannot be suspended -> 409',
    suspendDeleted.status === 409, `status=${suspendDeleted.status}`);

  const restore = await http('PATCH', `/admin/tenants/${id}/restore`, { token, body: {} });
  const afterRestore = await access();
  record('SA-VIS-18', 'P1', 'restore brings the mandir back with access enabled',
    restore.status === 200 && afterRestore?.is_deleted === false && afterRestore?.access_enabled === true,
    `access=${afterRestore?.access_enabled}`);

  const restoreAgain = await http('PATCH', `/admin/tenants/${id}/restore`, { token, body: {} });
  record('SA-VIS-19', 'P2', 'restoring a live mandir -> 409',
    restoreAgain.status === 409, `status=${restoreAgain.status}`);

  // ---- 7. lifecycle audit trail ----
  const lifecycle = await http('GET', `/admin/tenants/${id}/lifecycle-history`, { token });
  const actions = (lifecycle.data ?? []).map((e) => e.action);
  record('SA-VIS-20', 'P1', 'lifecycle history records every visibility/access action',
    lifecycle.status === 200
      && actions.includes('tenant.devotee_visible.off')
      && actions.includes('tenant.deactivate')
      && actions.includes('tenant.soft_delete')
      && actions.includes('tenant.restore'),
    `n=${actions.length}`);

  // ================= CUSTOM PLAN =================
  const planBefore = await http('GET', `/admin/tenants/${id}/effective-plan`, { token });
  record('SA-CP-01', 'P1', 'effective plan with no override matches the assigned plan',
    planBefore.status === 200 && planBefore.data?.is_custom === false && planBefore.data?.plan === 'standard',
    `plan=${planBefore.data?.plan} custom=${planBefore.data?.is_custom}`);

  const emptyOverride = await http('PUT', `/admin/tenants/${id}/custom-plan`, { token, body: {} });
  record('SA-CP-02', 'P1', 'custom plan with no fields -> 400',
    emptyOverride.status === 400, `status=${emptyOverride.status}`);

  const setCustom = await http('PUT', `/admin/tenants/${id}/custom-plan`, {
    token,
    body: {
      label: 'Trust Special',
      price_yearly_paise: 1234500,
      max_users: 42,
      note: 'Negotiated at the trustee meeting',
    },
  });
  const eff = setCustom.data?.effective_plan;
  record('SA-CP-03', 'P1', 'custom plan overrides only the fields sent',
    setCustom.status === 200 && eff?.is_custom === true && eff?.price_yearly_paise === 1234500
      && eff?.max_users === 42 && eff?.display_name === 'Trust Special'
      // untouched fields still fall through to the assigned plan
      && eff?.max_receipts_per_month === planBefore.data?.max_receipts_per_month,
    `overrides=${(eff?.overridden_fields ?? []).join(',')}`);

  const customList = await http('GET', '/admin/tenants?custom_plan_only=true&limit=100', { token });
  record('SA-CP-04', 'P2', 'custom_plan_only filter finds it',
    (customList.data ?? []).some((t) => t.id === id), `n=${(customList.data ?? []).length}`);

  const customInHistory = await http('GET', `/admin/tenants/${id}/plan-changes`, { token });
  record('SA-CP-05', 'P1', 'a custom-plan edit lands in the plan-change history',
    (customInHistory.data ?? []).some((c) => c.changeType === 'custom_plan' || c.change_type === 'custom_plan'),
    `n=${(customInHistory.data ?? []).length}`);

  const clear = await http('DELETE', `/admin/tenants/${id}/custom-plan`, { token });
  record('SA-CP-06', 'P1', 'clearing the override returns the mandir to its plan price',
    clear.status === 200 && clear.data?.effective_plan?.is_custom === false
      && clear.data?.effective_plan?.price_yearly_paise === planBefore.data?.price_yearly_paise,
    `price=${clear.data?.effective_plan?.price_yearly_paise}`);

  const clearAgain = await http('DELETE', `/admin/tenants/${id}/custom-plan`, { token });
  record('SA-CP-07', 'P2', 'clearing a non-existent override -> 404',
    clearAgain.status === 404, `status=${clearAgain.status}`);

  // ================= PLANS MASTER =================
  const planKey = `qa_plan_${run}`;
  const newPlan = await http('POST', '/admin/plans', {
    token,
    body: { name: planKey, display_name: `QA Plan ${run}`, price_monthly_paise: 50000, max_users: 5 },
  });
  record('SA-PLN-01', 'P1', 'create a plan in the master',
    (newPlan.status === 200 || newPlan.status === 201) && !!newPlan.data?.id, `status=${newPlan.status}`);
  const planId = newPlan.data?.id;

  const dupPlan = await http('POST', '/admin/plans', {
    token, body: { name: planKey, display_name: 'dupe' },
  });
  record('SA-PLN-02', 'P1', 'duplicate plan key -> 409', dupPlan.status === 409, `status=${dupPlan.status}`);

  const patchPlan = await http('PATCH', `/admin/plans/${planId}`, {
    token, body: { display_name: `QA Plan ${run} v2`, max_users: 9 },
  });
  // snake_case like every other admin endpoint — this used to read `maxUsers`,
  // matching a leaked TypeORM entity that broke the whole Plans screen.
  record('SA-PLN-03', 'P1', 'update a plan (snake_case response)',
    patchPlan.status === 200 && patchPlan.data?.max_users === 9 && patchPlan.data?.display_name === `QA Plan ${run} v2`,
    `max_users=${patchPlan.data?.max_users} display_name=${patchPlan.data?.display_name}`);

  const planList = await http('GET', '/admin/plans', { token });
  const stdPlan = (planList.data ?? []).find((p) => p.name === 'standard');
  record('SA-PLN-04', 'P1', 'plan list carries live tenant counts',
    planList.status === 200 && typeof stdPlan?.tenant_count === 'number' && stdPlan.tenant_count > 0,
    `standard.tenant_count=${stdPlan?.tenant_count}`);

  const inUse = await http('DELETE', `/admin/plans/${stdPlan?.id}`, { token });
  record('SA-PLN-05', 'P1', 'a plan in use cannot be deleted -> 409 PLAN_IN_USE',
    inUse.status === 409 && inUse.code === 'PLAN_IN_USE', `status=${inUse.status} code=${inUse.code}`);

  const delPlan = await http('DELETE', `/admin/plans/${planId}`, { token });
  record('SA-PLN-06', 'P1', 'an unused plan can be deleted (cleanup)',
    delPlan.status === 200, `status=${delPlan.status}`);

  // ================= BILLING / PURCHASE / RECEIPT HISTORY =================
  const invoices = await http('GET', `/admin/tenants/${id}/invoices`, { token });
  const invoice = (invoices.data ?? [])[0];
  record('SA-HIS-01', 'P1', 'onboarding raised a first subscription invoice',
    !!invoice, `n=${(invoices.data ?? []).length}`);

  if (invoice) {
    const paid = await http('POST', `/admin/invoices/${invoice.id}/mark-paid`, {
      token, body: { payment_method: 'neft', payment_ref: 'UTR12345678', note: 'QA manual settlement' },
    });
    record('SA-HIS-02', 'P1', 'mark-paid records HOW the mandir paid',
      paid.status === 200, `status=${paid.status}`);

    const paidAgain = await http('POST', `/admin/invoices/${invoice.id}/mark-paid`, { token, body: {} });
    record('SA-HIS-03', 'P2', 'marking an already-paid invoice -> 409',
      paidAgain.status === 409, `status=${paidAgain.status}`);

    const voidPaid = await http('POST', `/admin/invoices/${invoice.id}/void`, { token, body: { reason: 'nope' } });
    record('SA-HIS-04', 'P1', 'a paid invoice cannot be voided -> 409',
      voidPaid.status === 409, `status=${voidPaid.status}`);

    // Receipt: HTML out, download recorded in.
    const receipt = await fetch(`${BASE}/admin/invoices/${invoice.id}/receipt?channel=download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const html = await receipt.text();
    record('SA-HIS-05', 'P1', 'receipt renders a GST tax invoice with the payment method',
      receipt.status === 200 && html.includes('TAX INVOICE') && html.includes('NEFT') && html.includes('UTR12345678'),
      `len=${html.length}`);

    const downloads = await http('GET', `/admin/tenants/${id}/receipt-downloads`, { token });
    record('SA-HIS-06', 'P1', 'opening the receipt is recorded in the download history',
      (downloads.data ?? []).some((d) => d.invoice_id === invoice.id && d.actor_type === 'super_admin' && d.channel === 'download'),
      `n=${(downloads.data ?? []).length}`);
  }

  const history = await http('GET', `/admin/tenants/${id}/billing-history`, { token });
  const h = history.data;
  record('SA-HIS-07', 'P1', 'billing history returns subscriptions + upgrades + invoices + downloads + totals',
    history.status === 200 && Array.isArray(h?.subscriptions) && Array.isArray(h?.plan_changes)
      && Array.isArray(h?.invoices) && Array.isArray(h?.receipt_downloads) && !!h?.totals,
    `subs=${h?.subscriptions?.length} inv=${h?.invoices?.length} dl=${h?.receipt_downloads?.length}`);

  record('SA-HIS-08', 'P1', 'lifetime totals reflect the settled invoice',
    (h?.totals?.paid_count ?? 0) >= 1 && (h?.totals?.paid_paise ?? 0) > 0,
    `paid=${h?.totals?.paid_paise} count=${h?.totals?.paid_count}`);

  record('SA-HIS-09', 'P1', 'each invoice carries its plan snapshot + download counters',
    (h?.invoices ?? []).every((i) => 'download_count' in i && 'payment_method' in i && 'plan_name' in i),
    `first.plan=${h?.invoices?.[0]?.plan_name} dl=${h?.invoices?.[0]?.download_count}`);

  // ---- upgrade → history entry ----
  const upgrade = await http('PATCH', `/admin/tenants/${id}/plan`, {
    token, body: { plan: 'premium', effective: 'immediate' },
  });
  const afterUpgrade = await http('GET', `/admin/tenants/${id}/billing-history`, { token });
  record('SA-HIS-10', 'P1', 'a plan upgrade appears in the upgrade history with an invoice',
    upgrade.status === 200
      && (afterUpgrade.data?.plan_changes ?? []).some((c) => c.change_type === 'plan' && c.to_value === 'premium'),
    `changes=${afterUpgrade.data?.plan_changes?.length}`);

  // ---------------- MODERATION QUEUE (change requests) ----------------
  // This queue had no API-level coverage at all until now — which is how
  // DEF-SA-01 (the page white-screened on a double-wrapped envelope) and
  // DEF-SANT-04 (the subject vocabulary) both reached a human before a test.
  //
  // `subject_type` is a discriminator stored as DATA, not as an identifier, so
  // the 2026-08-03 sant rename greped straight past it: migration 034 began
  // writing 'sant' while migration 028 was still storing 'maharaj', leaving two
  // adjacent tables using different words for the same subject. Nothing threw —
  // a query spanning both would simply have returned nothing.
  const queue = await http('GET', '/admin/change-requests?limit=50', { token });
  const queueRows = queue.data?.rows ?? queue.data ?? [];
  record('SA-CR-01', 'P1', 'the moderation queue returns a plain array the page can map over',
    queue.status === 200 && Array.isArray(queueRows),
    `status=${queue.status} type=${Array.isArray(queueRows) ? 'array' : typeof queueRows}`);

  record('SA-CR-02', 'P1', "no correction is still stored under the pre-035 spelling 'maharaj'",
    queueRows.every((r) => r.subject_type !== 'maharaj'),
    `stored: ${[...new Set(queueRows.map((r) => r.subject_type))].join(',') || 'queue empty'}`);

  const asAscetic = await http('GET', '/admin/change-requests?subject_type=sant&limit=50', { token });
  const asLegacy = await http('GET', '/admin/change-requests?subject_type=maharaj&limit=50', { token });
  const nAscetic = (asAscetic.data?.rows ?? asAscetic.data ?? []).length;
  const nLegacy = (asLegacy.data?.rows ?? asLegacy.data ?? []).length;
  record('SA-CR-03', 'P2', 'both spellings resolve to the same queue (rolling-deploy safety)',
    asAscetic.status === 200 && asLegacy.status === 200 && nAscetic === nLegacy,
    `sant=${nAscetic} maharaj=${nLegacy}`);

  // ---- cleanup: leave the estate tidy ----
  await http('DELETE', `/admin/tenants/${id}`, { token, body: { confirm_slug: slug, reason: 'QA suite cleanup' } });
}

/** Devotee OTP_MOCK login → access token (null when devotee-api is down). */
async function devoteeLogin(baseUrl, mobile) {
  try {
    const send = await fetch(`${baseUrl}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile }),
    });
    const otp = (await send.json())?.data?.dev_otp;
    if (!otp) return null;
    const verify = await fetch(`${baseUrl}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, otp, name: 'QA Visibility Devotee' }),
    });
    return (await verify.json())?.data?.access_token ?? null;
  } catch {
    return null;
  }
}

/** GET on devotee-api with the devotee bearer; unwraps { data: { rows } }. */
async function devoteeGet(baseUrl, token, path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => null);
  const data = json?.data;
  return { status: res.status, data, rows: Array.isArray(data) ? data : data?.rows ?? [] };
}

/**
 * Drives the mandir portal's OTP login as far as it will go (OTP_MOCK returns
 * the code, so no SMS is involved). Returns how the API refused, or null when
 * mandiradmin-api is not running.
 */
async function mandirLoginAttempt(baseUrl, mobile) {
  try {
    const send = await fetch(`${baseUrl}/auth/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, purpose: 'login' }),
    });
    const sendJson = await send.json();
    const otp = sendJson?.data?.dev_otp;
    if (!otp) return null; // OTP_MOCK off — cannot drive login without an SMS
    const verify = await fetch(`${baseUrl}/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, otp }),
    });
    const json = await verify.json();
    if (verify.status === 403) {
      return { blocked: true, code: json?.error?.code, message: json?.error?.message };
    }
    // Login got through — the selection step should still refuse a blocked mandir.
    const choice = json?.data?.tenants?.[0];
    if (choice?.blocked) return { blocked: true, code: 'TENANT_INACTIVE', message: choice.block_message };
    return { blocked: false, code: null, message: null };
  } catch {
    return null;
  }
}

main().catch((e) => { console.error('SUITE ERROR:', e); process.exit(2); });
