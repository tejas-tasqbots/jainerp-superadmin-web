# JainERP Super Admin Web Console

Frontend for `superadmin-tmis.tasqbots.com`. React 18 + Vite + TypeScript, no UI
framework — hand-rolled admin styling. Talks to **apps/superadmin-api** through the
envelope client in [src/api/client.ts](src/api/client.ts) (bearer auth + transparent
refresh-once on 401).

## Pages ↔ API coverage (all 36 endpoints wired)

| Page | Flows |
|---|---|
| **Login** | password → first-login TOTP enrolment (QR + 10 recovery codes shown once) → TOTP verify, or recovery-code fallback |
| **Dashboard** | platform stats (temples, MRR/ARR, pending dues, signups/churn, devotees) + pending-subscriptions drill-down |
| **Manage Mandir** | filterable list, onboarding modal; detail tabs: Overview (profile, plan change, tenancy-tier migration, suspend/reactivate, global-sync toggle, slug-confirmed cancel), Billing (subscription, invoices, payment link, mark-paid, void, auto-debit setup/revoke), Trustees & Requirements, Licenses (issue/revoke) |
| **Manage Devotees** | search/filter, create, edit, verify/un-verify, DPDPA delete |
| **Settings** | super-admin users (create w/ set-password token, reset MFA, reset password, deactivate), audit trail, my account (change password, regenerate recovery codes) |

## Run

```bash
cd apps/superadmin-api && docker compose up -d && npm start   # API on :3105
cd apps/superadmin-web
npm install
npm run dev        # http://localhost:5180 (proxies /api → :3105, see vite.config.ts)
```

Login with the seeded admin from `superadmin-api/.env.local` (`SEED_ADMIN_EMAIL` /
`SEED_ADMIN_PASSWORD`). First login walks through authenticator-app enrolment.

## E2E tests

`npm run e2e` drives system Google Chrome (Playwright) through **24 steps** covering
every page and API call above — including real TOTP codes computed from the secret
shown during enrolment, and a recovery-code login at the end. Screenshots land in
`e2e/screens/`. Prereqs: API on :3105, web dev server on :5180, and the admin's MFA
un-enrolled (full first-login flow):

```sql
UPDATE public.super_admin_credentials
SET totp_secret_enc=NULL, totp_enrolled_at=NULL, recovery_codes_hash='{}', recovery_codes_used=0;
```
