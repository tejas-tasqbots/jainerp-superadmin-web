import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { MaharajProfile, Sangh } from '../api/types';
import { ErrorBox, Modal } from './ui';
import { PhotoPicker } from './PhotoPicker';
import { StateSelect, CitySelect } from './GeoSelect';

/**
 * Add a Sadhu-Sadhvi — a guided form in the same shape as mandir onboarding
 * (components/OnboardingWizard.tsx), replacing the single long dialog.
 *
 * THE ORDER IS THE POINT. Tradition and living/samadhistha come FIRST because
 * they decide everything after: the ranks offered (a Shwetambar Sadhvi is not a
 * Digambar Aryika), the posts a rank may hold, and whether the profile is a
 * living ascetic with a representative and a location or a memorial record.
 * The old form asked the name first and the tradition later, so the rank list
 * was wrong until the curator went back.
 *
 * DUPLICATES are checked while the name is typed — the directory holds 437
 * name-and-rank pairs that may be the same person (migration 078), and adding
 * a third copy is the commonest curation mistake.
 *
 * Saved as: POST /admin/maharaj (the core), then PATCH (the life details the
 * create does not take), then the location or the samadhi — each its own
 * audited call, as on the profile page. If a later call fails the profile
 * already exists, so the form says so and points at it instead of offering a
 * second Create.
 */

const TYPES: Record<string, Array<{ value: string; label: string }>> = {
  digambar: [
    { value: 'muni', label: 'Muni — Maharaj Ji' },
    { value: 'aryika', label: 'Aryika — Mataji' },
    { value: 'ailak', label: 'Ailak Ji' },
    { value: 'kshullak', label: 'Kshullak Ji' },
    { value: 'kshullika', label: 'Kshullika Ji' },
  ],
  shwetambar: [
    { value: 'sadhu', label: 'Sadhu — Maharaj Saheb' },
    { value: 'sadhvi', label: 'Sadhvi — Sadhviji' },
  ],
};
const PADS: Array<{ value: string; label: string; sects: string[]; female?: boolean }> = [
  { value: 'none', label: 'No post', sects: ['digambar', 'shwetambar'] },
  { value: 'acharya', label: 'Acharya', sects: ['digambar', 'shwetambar'] },
  { value: 'upadhyaya', label: 'Upadhyaya', sects: ['digambar', 'shwetambar'] },
  { value: 'elacharya', label: 'Elacharya', sects: ['digambar'] },
  { value: 'bhattarak', label: 'Bhattarak', sects: ['digambar'] },
  { value: 'ganini', label: 'Ganini', sects: ['digambar'], female: true },
  { value: 'panyas', label: 'Panyas', sects: ['shwetambar'] },
  { value: 'gani', label: 'Gani', sects: ['shwetambar'] },
  { value: 'pravartak', label: 'Pravartak', sects: ['shwetambar'] },
  { value: 'pravartini', label: 'Pravartini', sects: ['shwetambar'], female: true },
  { value: 'mahattara', label: 'Mahattara', sects: ['shwetambar'], female: true },
  { value: 'sadhvi_pramukha', label: 'Sadhvi Pramukha', sects: ['shwetambar'], female: true },
];
const FEMALE = ['aryika', 'sadhvi', 'kshullika'];
/** The posts this rank, in this tradition, can actually hold. Kshullak/Kshullika hold none. */
function padsFor(type: string, sect: string) {
  if (type === 'kshullak' || type === 'kshullika') return PADS.filter((p) => p.value === 'none');
  return PADS.filter((p) => p.sects.includes(sect) && (p.value === 'none' || !!p.female === FEMALE.includes(type)));
}

const EMPTY = {
  sect: '' as '' | 'digambar' | 'shwetambar',
  status: 'living' as 'living' | 'samadhistha',
  name_en: '', name_hi: '', type: '', pad: 'none', sub_sect: '', samuday: '', photo_base64: '',
  guru_name: '', diksha_year: '', diksha_date: '', diksha_place: '', name_before_diksha: '', birth_date: '',
  sangh_id: '', is_sangh_head: false, bio: '', bio_hi: '',
  state: '', city: '',
  stay_place: '', stay_city: '', stay_state: '', stay_from: '', stay_to: '', chaturmas: false,
  samadhi_date: '', samadhi_place: '', tithi_note: '',
  rep_mobile: '', rep_name: '',
  publish: false, checked: false,
};
type Form = typeof EMPTY;
type StepKey = 'tradition' | 'identity' | 'diksha' | 'place' | 'rep' | 'review';
const LABEL: Record<StepKey, string> = { tradition: 'Tradition', identity: 'Name & rank', diksha: 'Diksha & sangh', place: 'Where', rep: 'Sanghpati admin', review: 'Review' };
const LOCAL = 'superadmin.sant-draft.v1';

const readLocal = (): { form: Form; step: number } | null => {
  try { const r = sessionStorage.getItem(LOCAL); return r ? JSON.parse(r) : null; } catch { return null; }
};
const writeLocal = (v: { form: Form; step: number } | null) => {
  try { if (v) sessionStorage.setItem(LOCAL, JSON.stringify(v)); else sessionStorage.removeItem(LOCAL); } catch { /* not kept */ }
};
export const hasSantDraft = () => readLocal() !== null;

function errorsFor(step: StepKey, f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (step === 'tradition' && !f.sect) e.sect = 'Choose the tradition — it decides the ranks and posts offered.';
  if (step === 'identity') {
    if (!f.name_en.trim() && !f.name_hi.trim()) e.name_en = 'Enter the name in at least one script.';
    if (f.name_hi && /[A-Za-z]/.test(f.name_hi)) e.name_hi = 'Devanagari only here — the English name has its own field.';
    if (!f.type) e.type = 'Choose the rank.';
  }
  if (step === 'diksha') {
    if (f.diksha_year && !/^(19|20|21)\d{2}$/.test(f.diksha_year)) e.diksha_year = 'A four-digit year.';
    if (f.diksha_date && f.diksha_year && !f.diksha_date.startsWith(f.diksha_year)) e.diksha_date = 'Does not match the diksha year.';
  }
  if (step === 'place' && f.status === 'living' && f.stay_from && f.stay_to && f.stay_to < f.stay_from) e.stay_to = 'Ends before it starts.';
  if (step === 'rep' && f.rep_mobile && !/^\d{10}$/.test(f.rep_mobile)) e.rep_mobile = 'A 10-digit mobile number.';
  return e;
}

export function SantWizard({ sanghs, onClose, onCreated }: { sanghs: Sangh[]; onClose: () => void; onCreated: (id: string, name: string) => void }) {
  const [restored] = useState(readLocal);
  const [form, setForm] = useState<Form>(restored?.form ?? EMPTY);
  const [stepIdx, setStepIdx] = useState(restored?.step ?? 0);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [dupes, setDupes] = useState<MaharajProfile[]>([]);
  const done = useRef(false);

  const steps: StepKey[] = form.status === 'samadhistha'
    ? ['tradition', 'identity', 'diksha', 'place', 'review']
    : ['tradition', 'identity', 'diksha', 'place', 'rep', 'review'];
  const step = steps[Math.min(stepIdx, steps.length - 1)];
  const errors = touched ? errorsFor(step, form) : {};
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const inp = (k: keyof Form, transform?: (v: string) => string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    set(k, (transform ? transform(e.target.value) : e.target.value) as never);

  useEffect(() => {
    if (done.current) return;
    writeLocal(JSON.stringify(form) === JSON.stringify(EMPTY) ? null : { form, step: stepIdx });
  }, [form, stepIdx]);

  // Live duplicate check — both scripts, debounced.
  useEffect(() => {
    const name = (form.name_hi || form.name_en).trim();
    if (name.length < 4) { setDupes([]); return; }
    const t = setTimeout(() => {
      const core = name.replace(/^(muni|aryika|acharya|shri|sadhvi|ganini|upadhyaya|maharaj|mataji|ji)\s+/gi, '').split(/\s+/).slice(0, 2).join(' ');
      api<MaharajProfile[]>(`/admin/maharaj?limit=6&q=${encodeURIComponent(core || name)}`).then((r) => setDupes(r.data ?? [])).catch(() => setDupes([]));
    }, 350);
    return () => clearTimeout(t);
  }, [form.name_en, form.name_hi]);

  const goto = (i: number) => {
    setError(null);
    if (i > stepIdx) for (let s = stepIdx; s < i; s++) {
      if (Object.keys(errorsFor(steps[s], form)).length) { setStepIdx(s); setTouched(true); return; }
    }
    setTouched(false);
    setStepIdx(i);
  };
  const chooseSect = (sect: 'digambar' | 'shwetambar') =>
    setForm((f) => ({ ...f, sect, type: TYPES[sect].some((t) => t.value === f.type) ? f.type : '', pad: 'none' }));
  const chooseType = (type: string) => setForm((f) => ({ ...f, type, pad: padsFor(type, f.sect).some((p) => p.value === f.pad) ? f.pad : 'none' }));
  const sanghName = useMemo(() => sanghs.find((s) => s.id === form.sangh_id)?.name_en ?? '', [sanghs, form.sangh_id]);

  async function create() {
    for (let i = 0; i < steps.length; i++) {
      if (Object.keys(errorsFor(steps[i], form)).length) { setStepIdx(i); setTouched(true); return; }
    }
    setBusy(true); setError(null);
    let id = createdId;
    try {
      if (!id) {
        const r = await api<{ id: string }>('/admin/maharaj', {
          method: 'POST',
          body: {
            name: form.name_en || form.name_hi,
            name_en: form.name_en || undefined, name_hi: form.name_hi || undefined,
            type: form.type, sect: form.sect, pad: form.pad,
            sub_sect: form.sub_sect || undefined, samuday: form.samuday || undefined,
            state: form.state || undefined, city: form.city || undefined,
            diksha_year: form.diksha_year ? Number(form.diksha_year) : undefined,
            guru_name: form.guru_name || undefined, bio: form.bio || undefined,
            photo_base64: form.photo_base64 || undefined,
            rep_mobile: form.status === 'living' && form.rep_mobile ? form.rep_mobile : undefined,
            verified: form.publish,
          },
        });
        id = r.data.id;
        setCreatedId(id);
      }
      // What the create does not take.
      const extra = Object.fromEntries(Object.entries({
        diksha_date: form.diksha_date, diksha_place: form.diksha_place, name_before_diksha: form.name_before_diksha,
        birth_date: form.birth_date, bio_hi: form.bio_hi,
        sangh_id: form.sangh_id || undefined, is_sangh_head: form.sangh_id ? form.is_sangh_head : undefined,
      }).filter(([, v]) => v !== '' && v !== undefined));
      if (Object.keys(extra).length) await api(`/admin/maharaj/${id}`, { method: 'PATCH', body: extra });
      if (form.status === 'samadhistha') {
        await api(`/admin/maharaj/${id}/samadhi`, { method: 'PATCH', body: { samadhi: true, samadhi_date: form.samadhi_date || undefined, tithi_note: [form.samadhi_place, form.tithi_note].filter(Boolean).join(' · ') || undefined } });
      } else if (form.stay_place.trim()) {
        await api(`/admin/maharaj/${id}/location`, { method: 'PUT', body: {
          place: form.stay_place.trim(), city: form.stay_city || undefined, state: form.stay_state || undefined,
          from_date: form.stay_from || undefined, to_date: form.stay_to || undefined, chaturmas: form.chaturmas,
        } });
      }
      if (form.checked) await api(`/admin/maharaj/${id}/attest`, { method: 'PATCH', body: { verified: true } });
      done.current = true;
      writeLocal(null);
      onCreated(id!, form.name_hi || form.name_en);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const fld = (k: keyof Form, label: string, input: React.ReactNode, o: { span?: boolean; hint?: string } = {}) => (
    <label className={`field${o.span ? ' span-2' : ''}${errors[k] ? ' invalid' : ''}`}>
      <span>{label}</span>{input}
      {errors[k] ? <span className="err">{errors[k]}</span> : o.hint ? <span className="hint">{o.hint}</span> : null}
    </label>
  );
  const isLast = stepIdx >= steps.length - 1;
  const typeLabel = TYPES[form.sect || 'digambar']?.find((t) => t.value === form.type)?.label ?? '—';

  return (
    <Modal title="Add Sadhu-Sadhvi" onClose={onClose} wide confirmDiscard={false}>
      {restored && stepIdx === restored.step && !createdId && JSON.stringify(restored.form) !== JSON.stringify(EMPTY) && (
        <div className="draft-note">
          <span>Picked up where you left off.</span>
          <button type="button" className="btn sm" onClick={() => { if (window.confirm('Clear every field and start again?')) { writeLocal(null); setForm(EMPTY); setStepIdx(0); } }}>Start over</button>
        </div>
      )}
      {createdId && (
        <div className="notice"><span>The profile is already created. <b>Create</b> again only finishes the remaining details.</span></div>
      )}
      <div className="stepper" role="tablist">
        {steps.map((s, i) => (
          <button key={s} type="button" role="tab" aria-selected={i === stepIdx} disabled={!form.sect && i > 0}
            className={`st${i === stepIdx ? ' current' : i < stepIdx ? ' done' : ''}`} onClick={() => goto(i)}>
            <span className="n">{i < stepIdx ? '✓' : i + 1}</span>{LABEL[s]}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />

      <form noValidate onSubmit={(e) => { e.preventDefault(); if (isLast) void create(); else goto(stepIdx + 1); }}>
        {step === 'tradition' && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>The tradition decides which ranks and posts are offered next.</p>
            <div className="choice-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {(['digambar', 'shwetambar'] as const).map((s) => (
                <button key={s} type="button" data-testid={`sect-${s}`} className={`choice${form.sect === s ? ' selected' : ''}`} onClick={() => chooseSect(s)}>
                  <div className="t">{s === 'digambar' ? 'Digambar' : 'Shwetambar'}</div>
                  <div className="d">{s === 'digambar' ? 'Muni, Aryika, Ailak, Kshullak, Kshullika — Acharya, Upadhyaya, Elacharya, Ganini…' : 'Sadhu (Maharaj Saheb), Sadhvi — Acharya, Panyas, Gani, Pravartini, Mahattara…'}</div>
                </button>
              ))}
            </div>
            {errors.sect && <p style={{ color: 'var(--color-danger)', fontSize: 12 }}>{errors.sect}</p>}
            <div className="choice-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {(['living', 'samadhistha'] as const).map((s) => (
                <button key={s} type="button" data-testid={`status-${s}`} className={`choice${form.status === s ? ' selected' : ''}`} onClick={() => set('status', s)}>
                  <div className="t">{s === 'living' ? 'Living' : 'Samadhistha'}</div>
                  <div className="d">{s === 'living' ? 'Has a sangh representative and a current location devotees can follow.' : 'A memorial record: no representative, no location — stays visible to devotees.'}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 'identity' && (
          <>
            <div className="form-grid">
              {fld('name_hi', 'Name in Hindi (Devanagari)', <input lang="hi" value={form.name_hi} onChange={inp('name_hi')} placeholder={form.sect === 'shwetambar' ? 'साध्वी श्री …' : 'मुनि श्री क्षमासागर जी'} autoFocus />, { hint: 'As devotees read it. Never transliterated from English.' })}
              {fld('name_en', 'Name in English', <input value={form.name_en} onChange={inp('name_en')} placeholder={form.sect === 'shwetambar' ? 'Sadhvi Shri …' : 'Muni Shri Kshamasagar Ji'} />, { hint: 'At least one of the two is required.' })}
            </div>
            {dupes.length > 0 && (
              <div className="notice" data-testid="sant-dupes" style={{ display: 'block' }}>
                <b>Already in the directory?</b> {dupes.length} similar profile{dupes.length === 1 ? '' : 's'} — check before adding another:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {dupes.slice(0, 5).map((d) => (
                    <li key={d.id}>{d.name_hi || d.name_en || d.name} <span className="muted">· {d.type}{d.pad && d.pad !== 'none' ? ` · ${d.pad}` : ''}{d.city ? ` · ${d.city}` : ''}{d.sangh_name ? ` · ${d.sangh_name}` : ''}</span></li>
                  ))}
                </ul>
              </div>
            )}
            <h4 className="form-section">Rank & post</h4>
            <div className="form-grid">
              {fld('type', 'Rank *', (
                <select value={form.type} onChange={(e) => chooseType(e.target.value)} name="type">
                  <option value="">Choose…</option>
                  {(TYPES[form.sect] ?? []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              ))}
              {fld('pad', 'Post (pad)', (
                <select value={form.pad} onChange={inp('pad')} disabled={!form.type}>
                  {padsFor(form.type, form.sect).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              ), { hint: 'A post, not a rank: an Acharya is still a Muni.' })}
              {fld('sub_sect', form.sect === 'digambar' ? 'Panth' : 'Gaccha / tradition', <input value={form.sub_sect} onChange={inp('sub_sect')} placeholder={form.sect === 'digambar' ? 'Bisapanth, Terapanth…' : 'Tapagachha, Kharatargachha, Sthanakvasi…'} />)}
              {fld('samuday', 'Samuday (community)', <input value={form.samuday} onChange={inp('samuday')} placeholder="Oswal, Porwal, Agarwal…" />)}
            </div>
            <PhotoPicker value={form.photo_base64} onChange={(v) => set('photo_base64', v)} />
          </>
        )}

        {step === 'diksha' && (
          <>
            <div className="form-grid">
              {fld('guru_name', 'Diksha guru', <input value={form.guru_name} onChange={inp('guru_name')} placeholder="Acharya Shri Vidyasagar Ji" />, { span: true })}
              {fld('diksha_year', 'Diksha year', <input inputMode="numeric" maxLength={4} value={form.diksha_year} onChange={inp('diksha_year', (v) => v.replace(/\D/g, ''))} placeholder="1998" />)}
              {fld('diksha_date', 'Diksha date (if known)', <input type="date" value={form.diksha_date} onChange={(e) => setForm((f) => ({ ...f, diksha_date: e.target.value, diksha_year: f.diksha_year || e.target.value.slice(0, 4) }))} />)}
              {fld('diksha_place', 'Diksha place', <input value={form.diksha_place} onChange={inp('diksha_place')} />)}
              {fld('name_before_diksha', 'Name before diksha', <input value={form.name_before_diksha} onChange={inp('name_before_diksha')} />)}
              {fld('birth_date', 'Date of birth', <input type="date" value={form.birth_date} onChange={inp('birth_date')} />)}
            </div>
            <h4 className="form-section">Sangh</h4>
            <div className="form-grid">
              {fld('sangh_id', 'Sangh', (
                <select value={form.sangh_id} onChange={inp('sangh_id')}>
                  <option value="">Not in a sangh / not known</option>
                  {sanghs.map((s) => <option key={s.id} value={s.id}>{s.name_en}{s.members_count ? ` (${s.members_count})` : ''}</option>)}
                </select>
              ), { hint: 'A new sangh is created on the Sanghs page first.' })}
              {form.sangh_id && (
                <label className="field-check" style={{ alignSelf: 'end', marginBottom: 18 }}>
                  <input type="checkbox" checked={form.is_sangh_head} onChange={(e) => set('is_sangh_head', e.target.checked)} />
                  <span>Heads this sangh (a sangh may have several)</span>
                </label>
              )}
            </div>
            <h4 className="form-section">About</h4>
            <div className="form-grid">
              {fld('bio_hi', 'Short bio (Hindi)', <textarea lang="hi" rows={3} value={form.bio_hi} onChange={inp('bio_hi')} />)}
              {fld('bio', 'Short bio (English)', <textarea rows={3} value={form.bio} onChange={inp('bio')} />)}
            </div>
          </>
        )}

        {step === 'place' && form.status === 'living' && (
          <>
            <h4 className="form-section">Home base</h4>
            <div className="form-grid">
              {fld('state', 'State', <StateSelect value={form.state} onChange={(s) => setForm((f) => ({ ...f, state: s, city: '' }))} />)}
              {fld('city', 'City', <CitySelect state={form.state} value={form.city} onChange={(c) => set('city', c)} />)}
            </div>
            <h4 className="form-section">Where they are now (optional)</h4>
            <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Devotees who follow this sant see it. The sangh representative keeps it up to date afterwards.</p>
            <div className="form-grid">
              {fld('stay_place', 'Place (mandir, dharamshala…)', <input value={form.stay_place} onChange={inp('stay_place')} placeholder="Shri Digambar Jain Mandir, Kundalpur" />, { span: true })}
              {fld('stay_state', 'State', <StateSelect value={form.stay_state} onChange={(s) => setForm((f) => ({ ...f, stay_state: s, stay_city: '' }))} />)}
              {fld('stay_city', 'City', <CitySelect state={form.stay_state} value={form.stay_city} onChange={(c) => set('stay_city', c)} />)}
              {fld('stay_from', 'From', <input type="date" value={form.stay_from} onChange={inp('stay_from')} />)}
              {fld('stay_to', 'To', <input type="date" value={form.stay_to} onChange={inp('stay_to')} />)}
            </div>
            <label className="field-check"><input type="checkbox" checked={form.chaturmas} onChange={(e) => set('chaturmas', e.target.checked)} /><span>This stay is the Chaturmas</span></label>
          </>
        )}
        {step === 'place' && form.status === 'samadhistha' && (
          <div className="form-grid">
            {fld('samadhi_date', 'Samadhi date (if recorded)', <input type="date" value={form.samadhi_date} onChange={inp('samadhi_date')} />, { hint: 'Leave blank when only the fact is known — most historical records.' })}
            {fld('samadhi_place', 'Samadhi place', <input value={form.samadhi_place} onChange={inp('samadhi_place')} />)}
            {fld('tithi_note', 'Tithi / note', <input value={form.tithi_note} onChange={inp('tithi_note')} placeholder="Magh Shukla Ashtami" />, { span: true })}
            {fld('state', 'State (home base)', <StateSelect value={form.state} onChange={(s) => setForm((f) => ({ ...f, state: s, city: '' }))} />)}
            {fld('city', 'City', <CitySelect state={form.state} value={form.city} onChange={(c) => set('city', c)} />)}
          </div>
        )}

        {step === 'rep' && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              The <b>Sanghpati admin</b> signs in to the sant app and manages this sant's other representatives without coming back to us.
              They are invited by WhatsApp or SMS. Leave blank to add one later from the profile.
            </p>
            <div className="form-grid">
              {fld('rep_mobile', 'Sanghpati admin mobile', <input inputMode="tel" value={form.rep_mobile} onChange={inp('rep_mobile', (v) => { let d = v.replace(/\D/g, ''); if (d.length > 10 && d.startsWith('91')) d = d.slice(2); return d.slice(0, 10); })} placeholder="9876543210" />, { hint: 'Their name is taken from their own sign-in.' })}
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="review">
              <section>
                <h5>Profile <button type="button" onClick={() => goto(1)}>Edit</button></h5>
                <dl>
                  <dt>Name</dt><dd><b>{form.name_hi || '—'}</b><br />{form.name_en || '—'}</dd>
                  <dt>Tradition</dt><dd>{form.sect === 'digambar' ? 'Digambar' : 'Shwetambar'}{form.sub_sect ? ` · ${form.sub_sect}` : ''}</dd>
                  <dt>Rank / post</dt><dd>{typeLabel}{form.pad !== 'none' ? ` · ${PADS.find((p) => p.value === form.pad)?.label}` : ''}</dd>
                  <dt>Status</dt><dd>{form.status === 'living' ? 'Living' : 'Samadhistha'}</dd>
                </dl>
              </section>
              <section>
                <h5>Diksha & sangh <button type="button" onClick={() => goto(2)}>Edit</button></h5>
                <dl>
                  <dt>Guru</dt><dd>{form.guru_name || '—'}</dd>
                  <dt>Diksha</dt><dd>{[form.diksha_date || form.diksha_year, form.diksha_place].filter(Boolean).join(', ') || '—'}</dd>
                  <dt>Sangh</dt><dd>{sanghName || '—'}{form.is_sangh_head && sanghName ? ' (head)' : ''}</dd>
                </dl>
              </section>
              <section>
                <h5>Where <button type="button" onClick={() => goto(3)}>Edit</button></h5>
                <dl>
                  <dt>Home base</dt><dd>{[form.city, form.state].filter(Boolean).join(', ') || '—'}</dd>
                  {form.status === 'living'
                    ? <><dt>Now</dt><dd>{form.stay_place ? `${form.stay_place}${form.stay_city ? `, ${form.stay_city}` : ''}${form.chaturmas ? ' · Chaturmas' : ''}` : '—'}</dd></>
                    : <><dt>Samadhi</dt><dd>{[form.samadhi_date, form.samadhi_place].filter(Boolean).join(', ') || 'date not recorded'}</dd></>}
                </dl>
              </section>
              {form.status === 'living' && (
                <section>
                  <h5>Sanghpati admin <button type="button" onClick={() => goto(4)}>Edit</button></h5>
                  <dl><dt>Mobile</dt><dd>{form.rep_mobile ? `+91 ${form.rep_mobile} — invited on create` : 'add later from the profile'}</dd></dl>
                </section>
              )}
            </div>
            <h4 className="form-section">Before devotees see it</h4>
            <label className="field-check"><input type="checkbox" data-testid="sant-publish" checked={form.publish} onChange={(e) => set('publish', e.target.checked)} /><span><b>Publish</b> — visible to devotees in the app now</span></label>
            <label className="field-check"><input type="checkbox" data-testid="sant-checked" checked={form.checked} onChange={(e) => set('checked', e.target.checked)} /><span><b>Data checked</b> against a source — devotees see a blue tick</span></label>
            <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>Two different things: publishing makes it visible; the blue tick says someone checked it.</p>
          </>
        )}

        <div className="actions">
          <span className="muted" style={{ fontSize: 12, marginRight: 'auto', alignSelf: 'center' }}>Kept in this tab if you close.</span>
          <button type="button" className="btn" onClick={onClose}>Close</button>
          {stepIdx > 0 && <button type="button" className="btn" onClick={() => goto(stepIdx - 1)}>Back</button>}
          <button type="submit" className="btn primary" disabled={busy} data-testid={isLast ? 'sant-create' : 'sant-next'}>
            {busy ? 'Saving…' : isLast ? (createdId ? 'Finish' : 'Create profile') : 'Next'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
