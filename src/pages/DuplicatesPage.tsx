import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorBox } from '../components/ui';

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
 * Merging uses the tools that already exist — "Set sangh" on the Sadhu-Sadhvi
 * list to move members across, then Delete on whichever record the curator has
 * decided is the duplicate.
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
        To merge: use <strong>Set sangh</strong> on the Sadhu-Sadhvi list to move any members
        across, then <strong>Delete profile</strong> on the record you have decided is the
        duplicate. Nothing on this page changes any data.
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
                    {p.name_en ?? p.name}
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
                    {/* Opens the Sadhu-Sadhvi list filtered to this name, where
                        Manage and Delete already live. Deliberately not a
                        delete button here: this page is for deciding, not for
                        acting in one click on a judgement it cannot make. */}
                    <a className="btn sm" href={`/maharaj?q=${encodeURIComponent(p.name_en ?? p.name)}`}>
                      Open
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
