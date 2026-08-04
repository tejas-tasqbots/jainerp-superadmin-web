import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { ErrorBox } from '../components/ui';

interface Readiness {
  enforced: boolean;
  ready_to_enforce: boolean;
  outstanding: number;
  temples: {
    applicable: number;
    missing: number;
    not_applicable: number;
    rows: { id: string; slug: string; name: string; temple_type: string; city: string | null }[];
  };
  devotees: { total: number; missing: number };
  ascetics: { total: number; missing: number; rows: { id: string; name: string; type: string; city: string | null }[] };
}

/**
 * The "sect not set" report — the gate for turning sect filtering on.
 *
 * Sect scoping cannot be enabled until this reaches zero. Everything starts
 * NULL (migration 032), so flipping the flag early would empty the devotee app:
 * no temple would match any devotee. This page exists so that decision is made
 * against real numbers rather than a guess, and so the backfill has somewhere
 * obvious to happen.
 */
export function SectReadinessPage() {
  const [data, setData] = useState<Readiness | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Readiness>('/admin/sect-readiness')
      .then((r) => { setData(r.data); setErr(null); })
      .catch(setErr);
  }, []);
  useEffect(load, [load]);

  async function setSect(id: string, sect: string) {
    if (!sect) return;
    setBusy(id);
    try {
      await api(`/admin/tenants/${id}/sect`, { method: 'PATCH', body: { sect } });
      load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Same inline fix for a sant. `PATCH /admin/sant/:id` is a partial update over
   * an allow-list that already includes `sect`, so sending it alone is safe.
   *
   * This row used to be a bare link to the sant list, which meant hunting for
   * the name by hand — and until the console's sant form gained a Sampradaya
   * control it was a dead end, since there was nowhere to set the value once
   * you arrived. That made this report un-actionable for the one population it
   * could actually fix on someone's behalf.
   */
  async function setAsceticSect(id: string, sect: string) {
    if (!sect) return;
    setBusy(id);
    try {
      await api(`/admin/sant/${id}`, { method: 'PATCH', body: { sect } });
      load();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  }

  if (err) return <ErrorBox error={err} />;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <h1>Sampradaya readiness</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        {data.enforced ? (
          <>
            <strong>Sect filtering is ON.</strong> Devotees see only their own tradition.
            {data.outstanding > 0 && (
              <> {data.outstanding} record(s) still have no sampradaya — those stay visible to
              everyone, which is the intended safe behaviour, but they are not being segregated.</>
            )}
          </>
        ) : data.ready_to_enforce ? (
          <>
            <strong>Ready to enable.</strong> Every temple, devotee and sant has a sampradaya
            recorded. Set <code>SECT_FILTER_ENFORCED=true</code> on superadmin-api and
            devotee-api to turn segregation on. Keep it as config for a release so it can be
            rolled back without a deploy.
          </>
        ) : (
          <>
            <strong>Not ready — {data.outstanding} record(s) have no sampradaya.</strong>{' '}
            Enabling the filter now would hide nothing (unknown always stays visible), but the
            segregation would be incomplete. Backfill these first.
          </>
        )}
      </div>

      <div className="toolbar">
        <Stat label="Temples missing" value={data.temples.missing} of={data.temples.applicable} />
        <Stat label="Devotees missing" value={data.devotees.missing} of={data.devotees.total} />
        <Stat label="Sants missing" value={data.ascetics.missing} of={data.ascetics.total} />
        <Stat label="Not applicable" value={data.temples.not_applicable} hint="non-Jain trusts — never outstanding" />
      </div>

      <h2 style={{ marginTop: 20 }}>Temples with no sampradaya</h2>
      {data.temples.rows.length === 0 ? (
        <p className="muted">None — every Jain trust has one.</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Mandir</th><th>City</th><th style={{ width: 260 }}>Set sampradaya</th></tr>
          </thead>
          <tbody>
            {data.temples.rows.map((t) => (
              <tr key={t.id}>
                <td><Link to={`/mandirs/${t.id}`}>{t.name}</Link></td>
                <td>{t.city ?? '—'}</td>
                <td>
                  <button className="btn" disabled={busy === t.id} onClick={() => setSect(t.id, 'digambar')}>
                    Digambar
                  </button>{' '}
                  <button className="btn" disabled={busy === t.id} onClick={() => setSect(t.id, 'shwetambar')}>
                    Shwetambar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 20 }}>Sants with no sampradaya</h2>
      {data.ascetics.rows.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Rank</th><th>City</th><th style={{ width: 260 }}>Set sampradaya</th></tr>
          </thead>
          <tbody>
            {data.ascetics.rows.map((a) => (
              <tr key={a.id}>
                <td><Link to="/maharaj">{a.name}</Link></td>
                <td>{a.type}</td>
                <td>{a.city ?? '—'}</td>
                <td>
                  <button className="btn" disabled={busy === a.id} onClick={() => setAsceticSect(a.id, 'digambar')}>
                    Digambar
                  </button>{' '}
                  <button className="btn" disabled={busy === a.id} onClick={() => setAsceticSect(a.id, 'shwetambar')}>
                    Shwetambar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.devotees.missing > 0 && (
        <p className="muted" style={{ marginTop: 16 }}>
          {data.devotees.missing} devotee(s) have not chosen a sampradaya. They are asked at
          registration and can set it in their profile — there is deliberately no way to guess
          it on their behalf. Until they do, they keep seeing every tradition.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, of, hint }: { label: string; value: number; of?: number; hint?: string }) {
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>
        {value}
        {of !== undefined && <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> / {of}</span>}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}
