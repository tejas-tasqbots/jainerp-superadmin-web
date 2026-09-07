import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorBox, Modal } from '../components/ui';

/**
 * Ascetics who may be one person recorded twice.
 *
 * ── WHY A REPORT AND NOT A MERGE BUTTON ─────────────────────────────────────
 * 160 name+rank keys carry more than one profile. Folding them together
 * automatically would be wrong: Digambara ascetics take their names from a
 * shared pool, so two Muni Sagar-names are routinely two different people —
 * `importNameKey`'s own notes record a Kshullak and a Muni who share one and
 * had to be kept apart. A merge on a name match would fuse two ascetics, and
 * nothing in the data would then say it had happened.
 *
 * So this page ranks the evidence and leaves the judgement to a person. Each
 * group shows what actually distinguishes the rows — the city, the diksha
 * year, the sangh, the guru, and whether either carries a photograph.
 *
 * ── READING THE SCORE ───────────────────────────────────────────────────────
 * `confidence` is a sort order, not a probability. It rises when the rows
 * agree or one is clearly a half-finished second entry, and FALLS when they
 * carry different diksha years or different gurus — which is evidence of two
 * people, not of one. The bottom of this list is as informative as the top:
 * those are the ones to leave alone.
 *
 * ── MERGING (2026-09) ───────────────────────────────────────────────────────
 * There is now a real Merge, because the previous instruction — "Set sangh to
 * move members across, then Delete the duplicate" — was not a merge. Delete
 * CASCADES: it took the losing profile's locations, followers, representatives,
 * events and diksha stages with it, so the curator was told to destroy exactly
 * the data a merge is supposed to preserve, and the only thing that moved
 * across was whatever they retyped by hand.
 *
 * `POST /admin/maharaj/merge` moves every child row onto the keeper, fills the
 * keeper's empty fields from the loser, and snapshots the whole losing row into
 * `sant_merges` first — so a wrong merge is recoverable and "where did this
 * profile go?" has an answer.
 *
 * Migration 078 §3 already merged the 15 pairs where nothing disagreed AND the
 * diksha guru matched. What is left on this page needs a person.
 */
interface DupProfile {
  id: string;
  name: string;
  name_en: string | null;
  name_hi: string | null;
  type: string;
  pad: string | null;
  city: string | null;
  state: string | null;
  diksha_year: number | null;
  guru_name: string | null;
  sangh_name: string | null;
  has_photo: boolean;
  is_samadhistha: boolean;
}
interface DupGroup { key: string; confidence: number; profiles: DupProfile[] }

export function DuplicatesPage() {
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [meta, setMeta] = useState<{ total?: number; redundant?: number }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [minConfidence, setMinConfidence] = useState(0);
  /** The keeper chosen within one group. Keyed by group so two open groups do not fight. */
  const [keepBy, setKeepBy] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ keep: DupProfile; drop: DupProfile } | null>(null);

  async function merge(keep: DupProfile, drop: DupProfile) {
    setMerging(drop.id);
    try {
      await api('/admin/maharaj/merge', {
        method: 'POST',
        body: { keep_id: keep.id, merge_id: drop.id },
      });
      setConfirm(null);
      load();
    } catch (e) {
      setError(e);
    } finally {
      setMerging(null);
    }
  }

  const load = useCallback(() => {
    setLoading(true);
    api<DupGroup[]>('/admin/maharaj/duplicates')
      .then((r) => { setGroups(r.data ?? []); setMeta((r.meta ?? {}) as any); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorBox error={error} />;
  if (loading) return <p className="muted">Loading…</p>;

  const shown = groups.filter((g) => g.confidence >= minConfidence);

  return (
    <div>
      <h1>Possible duplicate profiles</h1>
      <p className="muted" style={{ maxWidth: 760 }}>
        {meta.total ?? groups.length} name-and-rank groups hold more than one profile
        ({meta.redundant ?? 0} rows beyond the first). These are <strong>candidates</strong>,
        not confirmed duplicates: Digambara ascetics take their names from a shared pool,
        so two Sagar-names are often two different people. The evidence below is what tells
        them apart — a second row with no city, no diksha year and no photograph is usually
        a half-finished entry; two rows with different cities or different diksha years are
        usually two ascetics.
      </p>
      <p className="muted" style={{ maxWidth: 760 }}>
        To merge: pick the record to <strong>keep</strong> in each group, then press
        <strong> Merge into kept</strong> on the row that is the duplicate. Every location,
        follower, representative and event moves across, any field the kept record is missing
        is filled from the other, and the whole losing row is saved first — so a mistake can
        be undone from <span className="mono">sant_merges</span>.
      </p>
      <p className="muted" style={{ maxWidth: 760 }}>
        Merge only what you are sure of. Two rows with different diksha years, different gurus
        or different cities are almost always two different ascetics.
      </p>

      <label className="field" style={{ maxWidth: 320 }}>
        <span>Show groups scoring at least</span>
        <select value={minConfidence} onChange={(e) => setMinConfidence(Number(e.target.value))}>
          <option value={-99}>everything ({groups.length})</option>
          <option value={0}>0 — plausible</option>
          <option value={3}>3 — strong</option>
          <option value={5}>5 — near certain</option>
        </select>
      </label>

      <p className="muted" style={{ fontSize: 12 }}>{shown.length} group(s)</p>

      {shown.map((g) => (
        <div key={g.key} className="card" style={{ marginBottom: 12, padding: 12 }}>
          <div style={{ fontSize: 12, marginBottom: 6 }}>
            <span
              style={{
                fontWeight: 700,
                color: g.confidence >= 5 ? '#b45309' : g.confidence >= 3 ? '#65758b' : '#94a3b8',
              }}
            >
              score {g.confidence >= 0 ? `+${g.confidence}` : g.confidence}
            </span>
            <span className="muted"> · {g.profiles.length} profiles</span>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Name</th><th>City / State</th><th>Diksha</th>
                <th>Guru</th><th>Sangh</th><th>Photo</th><th></th>
              </tr>
            </thead>
            <tbody>
              {g.profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    {/* Choosing the KEEPER first, and separately from pressing
                        Merge, is deliberate. A single "merge into…" dropdown on
                        each row makes the direction easy to get backwards, and
                        the direction is the whole decision: get it wrong and the
                        richer record is the one that disappears. */}
                    <label style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <input
                        type="radio"
                        name={`keep-${g.key}`}
                        checked={(keepBy[g.key] ?? g.profiles[0]?.id) === p.id}
                        onChange={() => setKeepBy((k) => ({ ...k, [g.key]: p.id }))}
                        aria-label={`Keep ${p.name_en ?? p.name}`}
                      />
                      <span>{p.name_en ?? p.name}</span>
                    </label>
                    {p.name_hi && <div className="muted" style={{ fontSize: 11 }}>{p.name_hi}</div>}
                    {p.is_samadhistha && (
                      <div className="muted" style={{ fontSize: 11 }}>samadhistha</div>
                    )}
                  </td>
                  <td>{[p.city, p.state].filter(Boolean).join(', ') || <span className="muted">—</span>}</td>
                  <td>{p.diksha_year ?? <span className="muted">—</span>}</td>
                  <td style={{ fontSize: 12 }}>{p.guru_name ?? <span className="muted">—</span>}</td>
                  <td style={{ fontSize: 12 }}>{p.sangh_name ?? <span className="muted">—</span>}</td>
                  <td>{p.has_photo ? 'yes' : <span className="muted">no</span>}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {/* Opens the Sadhu-Sadhvi list filtered to this name,
                          where Manage and Delete already live. */}
                      <a className="btn sm" href={`/maharaj?q=${encodeURIComponent(p.name_en ?? p.name)}`}>
                        Open
                      </a>
                      {/* Absent on the row that IS the keeper — a "merge this
                          into itself" button is a refusal waiting to happen. */}
                      {(keepBy[g.key] ?? g.profiles[0]?.id) !== p.id && (
                        <button
                          className="btn sm"
                          disabled={merging === p.id}
                          onClick={() => {
                            const keepId = keepBy[g.key] ?? g.profiles[0]?.id;
                            const keep = g.profiles.find((x) => x.id === keepId);
                            if (keep) setConfirm({ keep, drop: p });
                          }}
                        >
                          {merging === p.id ? 'Merging…' : 'Merge into kept'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* A merge removes a profile a devotee may have followed and a
          representative may manage, so it is confirmed by name — never by row
          position, which is what a bare "are you sure?" amounts to. */}
      {confirm && (
        <Modal title="Merge these two profiles" onClose={() => setConfirm(null)}>
          <p>
            <strong>{confirm.drop.name_en ?? confirm.drop.name}</strong> will be merged into{' '}
            <strong>{confirm.keep.name_en ?? confirm.keep.name}</strong> and will no longer exist.
          </p>
          <p className="muted">
            Locations, followers, representatives, events and diksha stages move to the kept
            profile. Anything the kept profile is missing — a photograph, a biography, a
            diksha year — is filled in from the other. The complete losing record is saved to{' '}
            <span className="mono">sant_merges</span> first.
          </p>
          {confirm.keep.diksha_year && confirm.drop.diksha_year
            && confirm.keep.diksha_year !== confirm.drop.diksha_year && (
            <p style={{
              margin: '8px 0', padding: 10, borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca', fontSize: 13,
            }}>
              <strong>These record different diksha years</strong>{' '}
              ({confirm.keep.diksha_year} and {confirm.drop.diksha_year}). That is usually
              evidence of two different ascetics who share a name, not of one entered twice.
            </p>
          )}
          <div className="actions">
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="btn primary"
              disabled={!!merging}
              onClick={() => merge(confirm.keep, confirm.drop)}
            >
              {merging ? 'Merging…' : 'Merge'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
