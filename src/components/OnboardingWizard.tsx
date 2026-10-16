import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudIcon, HardDrive, Layers } from 'lucide-react';
import { api, formatPaise } from '../api/client';
import type { Deployment } from '../api/types';
import { ErrorBox, Modal } from './ui';
import { ModulePicker } from './ModulePicker';

/**
 * Onboard a mandir — online, offline, or both — in one guided form.
 *
 * It replaces two forms on two pages (Manage Mandir's 35-field dialog and
 * Offline Mandirs' short one). The first question is the one that decides
 * everything after it: how will this mandir run JainERP?
 *
 *   online   a cloud tenant (POST /admin/tenants) — logins, devotee app, billing
 *   offline  a JainERP Offline record (POST /admin/offline-mandirs) + licence
 *   both     the tenant, then an offline record LINKED to it (tenant_id), so the
 *            directory shows one mandir — and the licence
 *
 * DRAFTS, TWO KINDS
 *  - Every keystroke is kept in this browser tab (sessionStorage), as before:
 *    closing the dialog by accident never loses anything.
 *  - "Save as draft" keeps it on the SERVER (onboarding_drafts, migration 094):
 *    it survives the browser, shows in Manage Mandir → Drafts, and another
 *    super admin can finish it.
 *
 * "Both" is two calls. If the tenant is created and the offline record then
 * fails, the tenant id is kept (in the draft too), and Create retries only the
 * offline half — never a second tenant.
 */

const TEMPLE_TYPES = ['jain', 'hindu', 'sikh', 'buddhist', 'gurudwara', 'church'];
const TIERS = ['pooled', 'dedicated'];
const FULL_MANDIR_DEFAULT = [
  'dharamshala', 'bhojanshala', 'prasad', 'seva', 'events', 'bolis', 'annadaan',
  'compliance', 'certificates', 'creditors', 'fixed_assets', 'sant', 'frontdesk',
];
const TERMS = [
  ['30', '30 days (trial)'], ['90', '3 months'], ['180', '6 months'], ['365', '1 year'], ['730', '2 years'], ['1095', '3 years'],
];

export const EMPTY_ONBOARDING = {
  name: '', temple_type: 'jain', plan: 'standard', billing_cycle: 'monthly', tenancy_tier: 'pooled',
  admin_name: '', admin_mobile: '', admin_email: '',
  line1: '', line2: '', state: '', city: '', pincode: '',
  mandir_mobile: '', mandir_email: '', website: '',
  gstin: '', pan: '', tan: '', reg_80g_number: '', reg_12a_number: '', reg_12ab_number: '',
  registration_number: '', darpan_number: '',
  upi_id: '', bank_account_name: '', bank_account_no: '', bank_ifsc: '', bank_name: '',
  sect: '', sub_sect: '',
  global_sync_enabled: false,
  devotee_visible: true,
  // JainERP Offline: the licence issued with the onboarding (optional).
  licence_now: true, licence_days: '365', licence_amount: '', licence_payment: 'unpaid', licence_mode: '', licence_reference: '',
  notes: '',
};
export type OnboardingForm = typeof EMPTY_ONBOARDING;

interface Draft {
  deployment: Deployment | null;
  form: OnboardingForm;
  modules: string[];
  step: number;
  /** Server draft this came from / was saved to. */
  draftId: string | null;
  /** "Both": the tenant already created, when the offline half still has to be done. */
  tenantId: string | null;
  savedAt: number;
}

/** The tab's working copy (sessionStorage: survives a reload, not the tab). */
const LOCAL_KEY = 'superadmin.onboarding-draft.v1';
function readLocal(): Draft | null {
  try {
    const raw = sessionStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    // v1 drafts (before the online/offline question) were all online.
    return {
      deployment: d.deployment ?? 'online', form: { ...EMPTY_ONBOARDING, ...(d.form ?? {}) },
      modules: d.modules ?? FULL_MANDIR_DEFAULT, step: d.step ?? 1, draftId: d.draftId ?? null,
      tenantId: d.tenantId ?? null, savedAt: d.savedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}
function writeLocal(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(LOCAL_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(LOCAL_KEY);
  } catch { /* storage blocked — the form still works, it just is not kept */ }
}
export function hasOnboardingDraft(): boolean {
  return readLocal() !== null;
}

/** Send only filled-in optional fields so the API keeps them null otherwise. */
function pick<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null)) as Partial<T>;
}

const DEPLOY_CHOICES: Array<{ key: Deployment; title: string; icon: React.ReactNode; text: string }> = [
  { key: 'online', title: 'Online', icon: <CloudIcon size={16} />, text: 'Cloud JainERP — staff sign in from any computer or phone, devotee app, WhatsApp receipts, monthly or yearly subscription.' },
  { key: 'offline', title: 'Offline', icon: <HardDrive size={16} />, text: 'JainERP Offline — runs on one computer with no internet. No cloud account; you issue a licence they paste into the app.' },
  { key: 'both', title: 'Both', icon: <Layers size={16} />, text: 'A cloud account AND an offline computer (e.g. a counter with no internet). One mandir in the directory, a subscription and a licence.' },
];

type StepKey = 'type' | 'mandir' | 'contact' | 'legal' | 'modules' | 'licence' | 'review';
const STEP_LABEL: Record<StepKey, string> = {
  type: 'How it runs', mandir: 'Mandir & plan', contact: 'Admin & address', legal: 'Tax & bank',
  modules: 'Modules', licence: 'Offline licence', review: 'Review',
};
function stepsFor(d: Deployment | null): StepKey[] {
  if (d === 'offline') return ['type', 'mandir', 'contact', 'licence', 'review'];
  if (d === 'both') return ['type', 'mandir', 'contact', 'legal', 'modules', 'licence', 'review'];
  return ['type', 'mandir', 'contact', 'legal', 'modules', 'review'];
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field errors for one step. Light checks — the API validates for real. */
function errorsFor(step: StepKey, d: Deployment | null, f: OnboardingForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 'type' && !d) e.deployment = 'Choose how this mandir will run JainERP.';
  if (step === 'mandir' && f.name.trim().length < 3) e.name = 'Enter the mandir name (at least 3 letters).';
  if (step === 'contact') {
    const needAdmin = d !== 'offline';
    if (needAdmin && !f.admin_name.trim()) e.admin_name = 'Who will sign in as Temple Admin?';
    if ((needAdmin || f.admin_mobile) && !/^\d{10}$/.test(f.admin_mobile)) e.admin_mobile = 'A 10-digit mobile number.';
    if (f.admin_email && !EMAIL.test(f.admin_email)) e.admin_email = 'Not an email address.';
    if (f.pincode && !/^\d{6}$/.test(f.pincode)) e.pincode = 'A 6-digit PIN code.';
    if (f.mandir_mobile && !/^\d{10}$/.test(f.mandir_mobile)) e.mandir_mobile = 'A 10-digit number.';
    if (f.mandir_email && !EMAIL.test(f.mandir_email)) e.mandir_email = 'Not an email address.';
    if (f.website && !/^https?:\/\//i.test(f.website)) e.website = 'Start with https://';
  }
  if (step === 'legal') {
    if (f.pan && !PAN.test(f.pan)) e.pan = 'PAN looks like AAATR1234C.';
    if (f.gstin && !GSTIN.test(f.gstin)) e.gstin = 'GSTIN is 15 characters, e.g. 27AAATR1234C1Z0.';
    if (f.bank_ifsc && !IFSC.test(f.bank_ifsc)) e.bank_ifsc = 'IFSC looks like SBIN0001234.';
  }
  if (step === 'licence' && f.licence_now) {
    if (f.licence_amount && !(Number(f.licence_amount) >= 0)) e.licence_amount = 'An amount in rupees.';
  }
  return e;
}

export function OnboardingWizard({ draftId: openDraftId, prefill, onClose, onCreated }: {
  /** Open this server draft instead of the tab's working copy. */
  draftId?: string | null;
  /** Start from these details (a lead being onboarded) instead of the tab's copy. */
  prefill?: { deployment?: Deployment | null; form: Partial<OnboardingForm> } | null;
  onClose: () => void;
  onCreated: (r: { tenantId: string | null; offlineId: string | null; deployment: Deployment }) => void;
}) {
  const [restored] = useState(() => (openDraftId || prefill ? null : readLocal()));
  const [deployment, setDeployment] = useState<Deployment | null>(restored?.deployment ?? prefill?.deployment ?? null);
  const [form, setForm] = useState<OnboardingForm>(restored?.form ?? (prefill ? { ...EMPTY_ONBOARDING, ...prefill.form } : EMPTY_ONBOARDING));
  const [modules, setModules] = useState<string[]>(restored?.modules ?? FULL_MANDIR_DEFAULT);
  const [stepIdx, setStepIdx] = useState(restored?.step ?? 0);
  const [draftId, setDraftId] = useState<string | null>(restored?.draftId ?? null);
  const [tenantId, setTenantId] = useState<string | null>(restored?.tenantId ?? null);
  const [showRestored, setShowRestored] = useState(!!restored);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'create'>('');
  const [error, setError] = useState<unknown>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(!!openDraftId);
  const created = useRef(false);

  const steps = stepsFor(deployment);
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const errors = touched ? errorsFor(step, deployment, form) : {};

  // A server draft opened from the Drafts list.
  useEffect(() => {
    if (!openDraftId) return;
    api<{ id: string; deployment: Deployment; form: Partial<Draft> & Partial<OnboardingForm>; step: number; tenant_id: string | null; updated_at: string }>(`/admin/onboarding-drafts/${openDraftId}`)
      .then((r) => {
        // This tab may hold a NEWER copy of the same draft (edited after its
        // last Save, then the page reloaded): that one wins, or the reload
        // would silently throw away every step since the save.
        const local = readLocal();
        if (local && local.draftId === r.data.id && local.savedAt > new Date(r.data.updated_at).getTime()) {
          setDeployment(local.deployment); setForm(local.form); setModules(local.modules);
          setStepIdx(local.step); setDraftId(local.draftId); setTenantId(local.tenantId ?? r.data.tenant_id);
          setSavedAt(new Date(r.data.updated_at).getTime());
          return;
        }
        const saved = r.data.form as { form?: OnboardingForm; modules?: string[] };
        setDeployment(r.data.deployment);
        setForm({ ...EMPTY_ONBOARDING, ...(saved.form ?? {}) });
        setModules(saved.modules ?? FULL_MANDIR_DEFAULT);
        setStepIdx(r.data.step);
        setDraftId(r.data.id);
        setTenantId(r.data.tenant_id);
        setSavedAt(new Date(r.data.updated_at).getTime());
      })
      .catch(setError)
      .finally(() => setLoadingDraft(false));
  }, [openDraftId]);

  // The tab's working copy, on every change. An untouched form is not a draft.
  useEffect(() => {
    if (created.current || loadingDraft) return;
    const untouched = !deployment && JSON.stringify(form) === JSON.stringify(EMPTY_ONBOARDING)
      && JSON.stringify(modules) === JSON.stringify(FULL_MANDIR_DEFAULT);
    writeLocal(untouched ? null : { deployment, form, modules, step: stepIdx, draftId, tenantId, savedAt: Date.now() });
  }, [deployment, form, modules, stepIdx, draftId, tenantId, loadingDraft]);

  // Reference data.
  const [states, setStates] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [plans, setPlans] = useState<Array<{ name: string; display_name: string; price_monthly_paise: number; price_yearly_paise: number; is_active: boolean }>>([]);
  const [signer, setSigner] = useState<{ configured: boolean } | null>(null);
  useEffect(() => {
    api<string[]>('/admin/geo/states').then((r) => setStates(r.data)).catch(() => setStates([]));
    api<typeof plans>('/admin/plans').then((r) => setPlans(r.data.filter((p) => p.is_active))).catch(() => setPlans([]));
    api<{ configured: boolean }>('/admin/offline-mandirs/signer').then((r) => setSigner(r.data)).catch(() => setSigner(null));
  }, []);
  useEffect(() => {
    if (!form.state) { setCities([]); return; }
    api<string[]>(`/admin/geo/states/${encodeURIComponent(form.state)}/cities`).then((r) => setCities(r.data)).catch(() => setCities([]));
  }, [form.state]);

  const set = (k: keyof OnboardingForm, transform?: (v: string) => string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: transform ? transform(e.target.value) : e.target.value }));
  const upper = (v: string) => v.toUpperCase().replace(/\s/g, '');
  const digits = (v: string) => v.replace(/\D/g, '');
  /** A pasted "+91 98220 13579" or "098220 13579" keeps its 10 digits. */
  const mobile = (v: string) => {
    let d = digits(v);
    if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
    if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
    return d.slice(0, 10);
  };
  const setTempleType = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const temple_type = e.target.value;
    // A non-Jain trust has no Jain sampradaya; hiding the section must clear it too.
    setForm((f) => ({ ...f, temple_type, ...(temple_type === 'jain' ? {} : { sect: '', sub_sect: '' }) }));
  };

  function goto(i: number) {
    setError(null);
    // Forward only through valid steps; backward always.
    if (i > stepIdx) {
      for (let s = stepIdx; s < i; s++) {
        if (Object.keys(errorsFor(steps[s], deployment, form)).length) { setStepIdx(s); setTouched(true); return; }
      }
    }
    setTouched(false);
    setStepIdx(i);
  }

  function startOver() {
    if (!window.confirm('Clear every field and start this onboarding again?')) return;
    writeLocal(null);
    setDeployment(null); setForm(EMPTY_ONBOARDING); setModules(FULL_MANDIR_DEFAULT);
    setStepIdx(0); setDraftId(null); setTenantId(null); setShowRestored(false); setSavedAt(null);
  }

  async function saveDraft() {
    setBusy('save'); setError(null);
    try {
      const body = { deployment: deployment ?? 'online', step: stepIdx, tenant_id: tenantId, form: { form, modules } };
      const r = draftId
        ? await api<{ id: string }>(`/admin/onboarding-drafts/${draftId}`, { method: 'PUT', body })
        : await api<{ id: string }>('/admin/onboarding-drafts', { method: 'POST', body });
      setDraftId(r.data.id);
      setSavedAt(Date.now());
    } catch (err) {
      // A draft that went away (finished elsewhere) is saved as a new one.
      if (draftId && (err as { status?: number }).status === 404) { setDraftId(null); }
      setError(err);
    } finally {
      setBusy('');
    }
  }

  const offlineMobile = form.admin_mobile ? `+91${form.admin_mobile}` : undefined;
  const address = [form.line1, form.line2].filter(Boolean).join(', ');

  async function createOffline(linkTo: string | null): Promise<string> {
    const r = await api<{ id: string }>('/admin/offline-mandirs', {
      method: 'POST',
      body: pick({
        name: form.name.trim(), contact_name: form.admin_name, mobile: offlineMobile, email: form.admin_email,
        address, city: form.city, state: form.state, pincode: form.pincode,
        sect: form.temple_type === 'jain' ? form.sect : '', notes: form.notes, tenant_id: linkTo ?? undefined,
      }),
    });
    const id = r.data.id;
    if (form.licence_now && signer?.configured) {
      await api(`/admin/offline-mandirs/${id}/licences`, {
        method: 'POST',
        body: pick({
          kind: Number(form.licence_days) <= 30 ? 'trial' : 'new',
          days: form.licence_days,
          amount_paise: form.licence_amount ? String(Math.round(Number(form.licence_amount) * 100)) : '0',
          payment_status: Number(form.licence_amount) > 0 ? form.licence_payment : 'free',
          payment_mode: form.licence_payment === 'paid' ? form.licence_mode : '',
          payment_reference: form.licence_payment === 'paid' ? form.licence_reference : '',
        }),
      });
    }
    return id;
  }

  async function create() {
    // Every step must be valid, not only the last one looked at.
    for (let i = 0; i < steps.length; i++) {
      if (Object.keys(errorsFor(steps[i], deployment, form)).length) { setStepIdx(i); setTouched(true); return; }
    }
    setBusy('create'); setError(null);
    let madeTenant = tenantId;
    try {
      if (deployment !== 'offline' && !madeTenant) {
        const r = await api<{ id: string }>('/admin/tenants', {
          method: 'POST',
          body: {
            name: form.name.trim(), temple_type: form.temple_type, plan: form.plan, billing_cycle: form.billing_cycle,
            tenancy_tier: form.tenancy_tier,
            admin_contact: pick({ name: form.admin_name, mobile: form.admin_mobile, email: form.admin_email }),
            address: pick({ line1: form.line1, line2: form.line2, state: form.state, city: form.city, pincode: form.pincode }),
            global_sync_enabled: form.global_sync_enabled, devotee_visible: form.devotee_visible, modules,
            ...pick({ sect: form.sect, sub_sect: form.sub_sect }),
            ...pick({
              mandir_mobile: form.mandir_mobile, mandir_email: form.mandir_email, website: form.website,
              gstin: form.gstin, pan: form.pan, tan: form.tan,
              reg_80g_number: form.reg_80g_number, reg_12a_number: form.reg_12a_number, reg_12ab_number: form.reg_12ab_number,
              registration_number: form.registration_number, darpan_number: form.darpan_number,
              upi_id: form.upi_id, bank_account_name: form.bank_account_name, bank_account_no: form.bank_account_no,
              bank_ifsc: form.bank_ifsc, bank_name: form.bank_name,
            }),
          },
        });
        madeTenant = r.data.id;
        setTenantId(madeTenant);
      }
      let offlineId: string | null = null;
      if (deployment !== 'online') {
        try {
          offlineId = await createOffline(deployment === 'both' ? madeTenant : null);
        } catch (err) {
          if (deployment === 'both' && madeTenant) {
            // Keep the half that worked, on the server too, so nobody creates it twice.
            const body = { deployment, step: stepIdx, tenant_id: madeTenant, form: { form, modules } };
            await (draftId
              ? api(`/admin/onboarding-drafts/${draftId}`, { method: 'PUT', body })
              : api<{ id: string }>('/admin/onboarding-drafts', { method: 'POST', body }).then((r) => setDraftId(r.data.id))
            ).catch(() => undefined);
          }
          throw err;
        }
      }
      created.current = true;
      writeLocal(null);
      if (draftId) await api(`/admin/onboarding-drafts/${draftId}?finished=true`, { method: 'DELETE' }).catch(() => undefined);
      onCreated({ tenantId: madeTenant, offlineId, deployment: deployment! });
    } catch (err) {
      setError(err);
    } finally {
      setBusy('');
    }
  }

  const fld = (k: keyof OnboardingForm, label: string, input: React.ReactNode, opts: { span?: boolean; hint?: string } = {}) => (
    <label className={`field${opts.span ? ' span-2' : ''}${errors[k] ? ' invalid' : ''}`}>
      <span>{label}</span>
      {input}
      {errors[k] ? <span className="err">{errors[k]}</span> : opts.hint ? <span className="hint">{opts.hint}</span> : null}
    </label>
  );
  const price = (p: (typeof plans)[number]) =>
    form.billing_cycle === 'yearly' ? `${formatPaise(p.price_yearly_paise)}/yr` : `${formatPaise(p.price_monthly_paise)}/mo`;
  const planLabel = useMemo(() => plans.find((p) => p.name === form.plan), [plans, form.plan]);

  const isLast = stepIdx >= steps.length - 1;
  const title = deployment === 'offline' ? 'Onboard an offline mandir' : deployment === 'both' ? 'Onboard a mandir — online and offline' : 'Onboard a mandir';

  return (
    // The tab's working copy is the safety net, so closing needs no "are you sure".
    <Modal title={title} onClose={onClose} wide confirmDiscard={false}>
      {showRestored && restored && (
        <div className="draft-note" data-testid="onboarding-draft-restored">
          <span>Picked up where you left off — {new Date(restored.savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.</span>
          <button type="button" className="btn sm" onClick={startOver}>Start over</button>
        </div>
      )}
      {tenantId && deployment === 'both' && (
        <div className="notice" role="status">
          <span>The online mandir is already created. <b>Create</b> now finishes only the offline record and licence.</span>
        </div>
      )}

      <div className="stepper" role="tablist" aria-label="Onboarding steps">
        {steps.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={i === stepIdx}
            className={`st${i === stepIdx ? ' current' : i < stepIdx ? ' done' : ''}`}
            disabled={!deployment && i > 0} onClick={() => goto(i)}>
            <span className="n">{i < stepIdx ? '✓' : i + 1}</span>{s === 'mandir' && deployment === 'offline' ? 'Mandir' : STEP_LABEL[s]}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {loadingDraft && <p className="muted">Opening the draft…</p>}

      <form onSubmit={(e) => { e.preventDefault(); if (isLast) void create(); else goto(stepIdx + 1); }} noValidate>
        {step === 'type' && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>How will this mandir use JainERP? This decides what is set up — it can be extended later.</p>
            <div className="choice-grid" role="radiogroup" aria-label="Deployment">
              {DEPLOY_CHOICES.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={deployment === c.key} data-testid={`deploy-${c.key}`}
                  className={`choice${deployment === c.key ? ' selected' : ''}`} onClick={() => { setDeployment(c.key); setError(null); }}>
                  <div className="t">{c.icon} {c.title}</div>
                  <div className="d">{c.text}</div>
                </button>
              ))}
            </div>
            {errors.deployment && <p className="err" style={{ color: 'var(--color-danger)', fontSize: 12 }}>{errors.deployment}</p>}
            {deployment !== 'online' && deployment && signer && !signer.configured && (
              <div className="notice">This server cannot sign offline licences yet (OFFLINE_LICENCE_PRIVATE_KEY). The mandir is still recorded; issue the licence later.</div>
            )}
          </>
        )}

        {step === 'mandir' && (
          <>
            <div className="form-grid">
              {fld('name', 'Mandir name *', <input name="name" value={form.name} onChange={set('name')} autoFocus placeholder="Shri Parshwanath Digambar Jain Mandir" />,
                { span: true, hint: deployment !== 'online' ? 'Exactly as it should print — it is signed into the offline licence.' : 'As it should appear on receipts and in the directory.' })}
              {fld('temple_type', 'Temple type', <select name="temple_type" value={form.temple_type} onChange={setTempleType}>{TEMPLE_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select>)}
              {form.temple_type === 'jain' && fld('sect', 'Sampradaya', (
                <select name="sect" value={form.sect} onChange={set('sect')}>
                  <option value="">Not recorded</option><option value="digambar">Digambar</option><option value="shwetambar">Shwetambar</option>
                </select>
              ), { hint: 'Leave blank if unsure — a wrong value hides the trust from the devotees it serves.' })}
              {form.temple_type === 'jain' && deployment !== 'offline' && fld('sub_sect', 'Panth / Gaccha (optional)', <input name="sub_sect" value={form.sub_sect} onChange={set('sub_sect')} placeholder="Terapanth, Bisapanth, Murtipujak…" />)}
            </div>
            {deployment !== 'offline' && (
              <>
                <h4 className="form-section">Subscription</h4>
                <div className="form-grid">
                  {fld('billing_cycle', 'Billing cycle', (
                    <select name="billing_cycle" value={form.billing_cycle} onChange={set('billing_cycle')}>
                      <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                    </select>
                  ))}
                  {fld('plan', 'Plan', (
                    <select name="plan" value={form.plan} onChange={set('plan')}>
                      {plans.length === 0 && <option value={form.plan}>{form.plan}</option>}
                      {plans.map((p) => <option key={p.name} value={p.name}>{p.display_name} — {price(p)}</option>)}
                    </select>
                  ))}
                  {fld('tenancy_tier', 'Database', (
                    <select name="tenancy_tier" value={form.tenancy_tier} onChange={set('tenancy_tier')}>
                      {TIERS.map((t) => <option key={t} value={t}>{t === 'pooled' ? 'Shared (standard)' : 'Dedicated (large mandir)'}</option>)}
                    </select>
                  ), { hint: 'Dedicated gives a big mandir its own database.' })}
                </div>
              </>
            )}
          </>
        )}

        {step === 'contact' && (
          <>
            <h4 className="form-section">{deployment === 'offline' ? 'Contact person' : 'Temple Admin (signs in to JainERP)'}</h4>
            <div className="form-grid">
              {fld('admin_name', deployment === 'offline' ? 'Name' : 'Name *', <input name="admin_name" value={form.admin_name} onChange={set('admin_name')} />)}
              {fld('admin_mobile', deployment === 'offline' ? 'Mobile' : 'Mobile *', <input name="admin_mobile" value={form.admin_mobile} onChange={set('admin_mobile', mobile)} inputMode="tel" autoComplete="off" placeholder="9876543210" />, { hint: '10 digits, India.' })}
              {fld('admin_email', 'Email', <input name="admin_email" type="email" value={form.admin_email} onChange={set('admin_email')} />, { span: true })}
            </div>
            <h4 className="form-section">Address</h4>
            <div className="form-grid">
              {fld('line1', 'Address line 1', <input name="line1" value={form.line1} onChange={set('line1')} />)}
              {fld('line2', 'Address line 2', <input name="line2" value={form.line2} onChange={set('line2')} />)}
              {fld('state', 'State', (
                <select name="state" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value, city: '' }))}>
                  <option value="">Select state…</option>
                  {states.map((s) => <option key={s}>{s}</option>)}
                </select>
              ))}
              {fld('city', 'City', (
                <select name="city" value={form.city} disabled={!form.state} onChange={set('city')}>
                  <option value="">{form.state ? 'Select city…' : 'Pick a state first'}</option>
                  {(form.city && !cities.includes(form.city) ? [form.city, ...cities] : cities).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              ))}
              {fld('pincode', 'PIN code', <input name="pincode" value={form.pincode} onChange={set('pincode', digits)} inputMode="numeric" maxLength={6} placeholder="411001" />)}
            </div>
            {deployment !== 'offline' && (
              <>
                <h4 className="form-section">Mandir contact (on receipts & directory)</h4>
                <div className="form-grid">
                  {fld('mandir_mobile', 'Mandir phone', <input name="mandir_mobile" value={form.mandir_mobile} onChange={set('mandir_mobile', mobile)} inputMode="tel" placeholder="defaults to the admin's" />)}
                  {fld('mandir_email', 'Mandir email', <input name="mandir_email" type="email" value={form.mandir_email} onChange={set('mandir_email')} />)}
                  {fld('website', 'Website', <input name="website" value={form.website} onChange={set('website')} placeholder="https://…" />, { span: true })}
                </div>
              </>
            )}
            {deployment === 'offline' && fld('notes', 'Notes (internal)', <textarea rows={2} value={form.notes} onChange={set('notes')} />, { span: true })}
          </>
        )}

        {step === 'legal' && (
          <>
            {/* The API checks each of these (common/statutory-id.dto). Leave any
                the trust does not hold empty — "0" or "NA" is refused. */}
            <h4 className="form-section">Legal & tax (for 80G receipts)</h4>
            <div className="form-grid">
              {fld('pan', 'PAN', <input name="pan" value={form.pan} onChange={set('pan', upper)} maxLength={10} placeholder="AAATR1234C" />)}
              {fld('gstin', 'GSTIN (only if GST-registered)', <input name="gstin" value={form.gstin} onChange={set('gstin', upper)} maxLength={15} placeholder="27AAATR1234C1Z0" />)}
              {fld('tan', 'TAN', <input name="tan" value={form.tan} onChange={set('tan', upper)} maxLength={10} placeholder="MUMT12345A" />)}
              {fld('reg_80g_number', '80G registration (URN)', <input name="reg_80g_number" value={form.reg_80g_number} onChange={set('reg_80g_number', upper)} maxLength={16} placeholder="AAATR1234CF20214" />)}
              {fld('reg_12ab_number', '12AB registration (URN)', <input name="reg_12ab_number" value={form.reg_12ab_number} onChange={set('reg_12ab_number', upper)} maxLength={16} placeholder="AAATR1234CE20214" />)}
              {fld('reg_12a_number', '12A number (before 2021)', <input name="reg_12a_number" value={form.reg_12a_number} onChange={set('reg_12a_number')} maxLength={50} />)}
              {fld('registration_number', 'Trust registration no.', <input name="registration_number" value={form.registration_number} onChange={set('registration_number')} maxLength={60} placeholder="SOC/2015/CITY/000123" />)}
              {fld('darpan_number', 'Darpan no.', <input name="darpan_number" value={form.darpan_number} onChange={set('darpan_number')} maxLength={40} placeholder="XX/2015/0123456" />)}
            </div>
            <h4 className="form-section">Bank & UPI (printed on receipts)</h4>
            <div className="form-grid">
              {fld('upi_id', 'UPI ID', <input name="upi_id" value={form.upi_id} onChange={set('upi_id')} placeholder="mandir@upi" />)}
              {fld('bank_account_name', 'Account name', <input name="bank_account_name" value={form.bank_account_name} onChange={set('bank_account_name')} />)}
              {fld('bank_account_no', 'Account no.', <input name="bank_account_no" value={form.bank_account_no} onChange={set('bank_account_no', digits)} inputMode="numeric" />)}
              {fld('bank_ifsc', 'IFSC', <input name="bank_ifsc" value={form.bank_ifsc} onChange={set('bank_ifsc', upper)} maxLength={11} placeholder="SBIN0001234" />)}
              {fld('bank_name', 'Bank name', <input name="bank_name" value={form.bank_name} onChange={set('bank_name')} />, { span: true })}
            </div>
          </>
        )}

        {step === 'modules' && (
          <>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Not every trust is a full temple. Pick a preset or tick exactly what this one runs — it can be changed later from the mandir's page.</p>
            <ModulePicker value={modules} onChange={setModules} templeType={form.temple_type} />
            <h4 className="form-section">Directory</h4>
            <label className="field-check">
              <input type="checkbox" name="devotee_visible" checked={form.devotee_visible} onChange={(e) => setForm((f) => ({ ...f, devotee_visible: e.target.checked }))} />
              <span>Show this mandir to devotees (searchable in the devotee app)</span>
            </label>
            <label className="field-check">
              <input type="checkbox" checked={form.global_sync_enabled} onChange={(e) => setForm((f) => ({ ...f, global_sync_enabled: e.target.checked }))} />
              <span>Mirror donations to the global ledger (global sync)</span>
            </label>
          </>
        )}

        {step === 'licence' && (
          <>
            <label className="field-check">
              <input type="checkbox" checked={form.licence_now} onChange={(e) => setForm((f) => ({ ...f, licence_now: e.target.checked }))} disabled={!!signer && !signer.configured} />
              <span>Issue the JainERP Offline licence now</span>
            </label>
            {signer && !signer.configured && <p className="muted" style={{ fontSize: 12 }}>This server cannot sign licences yet — issue it from the mandir's page once it can.</p>}
            {form.licence_now && signer?.configured !== false && (
              <div className="form-grid">
                {fld('licence_days', 'Term', <select value={form.licence_days} onChange={set('licence_days')}>{TERMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>)}
                {fld('licence_amount', 'Amount (₹)', <input type="number" min={0} step="0.01" value={form.licence_amount} onChange={set('licence_amount')} placeholder="0 = free" />)}
                {Number(form.licence_amount) > 0 && fld('licence_payment', 'Payment', (
                  <select value={form.licence_payment} onChange={set('licence_payment')}>
                    <option value="unpaid">Not paid yet</option><option value="paid">Paid</option>
                  </select>
                ))}
                {Number(form.licence_amount) > 0 && form.licence_payment === 'paid' && fld('licence_mode', 'Paid by', (
                  <select value={form.licence_mode} onChange={set('licence_mode')}>
                    <option value="">—</option>{['UPI', 'Bank transfer', 'Cheque', 'Cash', 'Other'].map((m) => <option key={m}>{m}</option>)}
                  </select>
                ))}
                {Number(form.licence_amount) > 0 && form.licence_payment === 'paid' && fld('licence_reference', 'Reference (UTR / cheque no.)', <input value={form.licence_reference} onChange={set('licence_reference')} />)}
              </div>
            )}
            <p className="muted" style={{ fontSize: 12 }}>After creating, the licence is on the mandir's page — copy or download it and send it to the mandir.</p>
          </>
        )}

        {step === 'review' && (
          <div className="review">
            <section>
              <h5>How it runs <button type="button" onClick={() => goto(0)}>Change</button></h5>
              <dl><dt>Deployment</dt><dd><span className={`dep ${deployment}`}>{DEPLOY_CHOICES.find((c) => c.key === deployment)?.title}</span></dd></dl>
            </section>
            <section>
              <h5>Mandir <button type="button" onClick={() => goto(steps.indexOf('mandir'))}>Edit</button></h5>
              <dl>
                <dt>Name</dt><dd><b>{form.name || '—'}</b></dd>
                <dt>Type</dt><dd>{cap(form.temple_type)}{form.sect ? ` · ${cap(form.sect)}` : ''}</dd>
                {deployment !== 'offline' && <><dt>Plan</dt><dd>{planLabel ? `${planLabel.display_name} — ${price(planLabel)}` : form.plan} · {form.billing_cycle}</dd></>}
              </dl>
            </section>
            <section>
              <h5>{deployment === 'offline' ? 'Contact' : 'Temple Admin'} <button type="button" onClick={() => goto(steps.indexOf('contact'))}>Edit</button></h5>
              <dl>
                <dt>Name</dt><dd>{form.admin_name || '—'}</dd>
                <dt>Mobile</dt><dd>{form.admin_mobile ? `+91 ${form.admin_mobile}` : '—'}</dd>
                <dt>Email</dt><dd>{form.admin_email || '—'}</dd>
                <dt>Address</dt><dd>{[address, form.city, form.state, form.pincode].filter(Boolean).join(', ') || '—'}</dd>
              </dl>
            </section>
            {deployment !== 'offline' && (
              <section>
                <h5>Tax, bank & modules <button type="button" onClick={() => goto(steps.indexOf('legal'))}>Edit</button></h5>
                <dl>
                  <dt>PAN / GSTIN</dt><dd>{form.pan || '—'} / {form.gstin || '—'}</dd>
                  <dt>80G / 12AB</dt><dd>{form.reg_80g_number || '—'} / {form.reg_12ab_number || '—'}</dd>
                  <dt>Bank</dt><dd>{form.bank_account_no ? `${form.bank_name || 'Account'} ····${form.bank_account_no.slice(-4)}` : '—'}{form.upi_id ? ` · ${form.upi_id}` : ''}</dd>
                  <dt>Modules</dt><dd>{modules.length} selected</dd>
                  <dt>Devotee app</dt><dd>{form.devotee_visible ? 'Listed' : 'Hidden'}</dd>
                </dl>
              </section>
            )}
            {deployment !== 'online' && (
              <section>
                <h5>Offline licence <button type="button" onClick={() => goto(steps.indexOf('licence'))}>Edit</button></h5>
                <dl>
                  {form.licence_now && signer?.configured ? (
                    <>
                      <dt>Term</dt><dd>{TERMS.find(([v]) => v === form.licence_days)?.[1]}</dd>
                      <dt>Amount</dt><dd>{Number(form.licence_amount) > 0 ? `₹${Number(form.licence_amount).toLocaleString('en-IN')} · ${form.licence_payment === 'paid' ? 'paid' : 'not paid yet'}` : 'Free'}</dd>
                    </>
                  ) : <><dt>Licence</dt><dd>Issue later</dd></>}
                </dl>
              </section>
            )}
          </div>
        )}

        <div className="actions">
          <span className="muted" style={{ fontSize: 12, marginRight: 'auto', alignSelf: 'center' }}>
            {savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` : 'Kept in this tab if you close — Save as draft to keep it for later.'}
          </span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn" data-testid="save-draft" disabled={busy !== '' || !deployment && !form.name} onClick={saveDraft}>
            {busy === 'save' ? 'Saving…' : 'Save as draft'}
          </button>
          {stepIdx > 0 && <button type="button" className="btn" onClick={() => goto(stepIdx - 1)}>Back</button>}
          <button type="submit" className="btn primary" disabled={busy !== ''} data-testid={isLast ? 'create-mandir' : 'next-step'}>
            {busy === 'create' ? 'Creating…' : isLast ? (deployment === 'offline' ? 'Create offline mandir' : 'Create mandir') : 'Next'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
