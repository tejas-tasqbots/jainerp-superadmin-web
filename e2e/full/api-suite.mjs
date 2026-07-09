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

  // ---------------- SUMMARY ----------------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  const p1Failed = failed.filter((r) => r.pri === 'P1');
  console.log(`\n=== SA SUMMARY: ${passed}/${results.length} passed, ${failed.length} failed (${p1Failed.length} P1) ===`);
  if (failed.length) console.log('FAILURES:', failed.map((r) => r.id).join(', '));
  console.log('\nJSON_RESULTS=' + JSON.stringify(results));
  process.exit(p1Failed.length ? 1 : 0);
}

main().catch((e) => { console.error('SUITE ERROR:', e); process.exit(2); });
