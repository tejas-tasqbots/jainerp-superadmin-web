import { useEffect, useState } from 'react';
import { api } from '../api/client';

export interface ModuleDef {
  key: string;
  display_name: string;
  description?: string | null;
  is_core: boolean;
  requires: string[];
  applies_to: string[];
  sort_order: number;
}

export interface ModulePreset {
  key: string;
  label: string;
  description: string;
  modules: string[];
}

interface Registry {
  modules: ModuleDef[];
  presets: ModulePreset[];
  setup_checklist: Record<string, string[]>;
}

/**
 * Fetches the module registry once and caches it for the session.
 *
 * The registry is a DB table (migration 031), not a hardcoded list, so a module
 * added by a seed row appears here without a console release. Nothing in this
 * file enumerates module keys for that reason.
 */
let cached: Registry | null = null;
export function useModuleRegistry() {
  const [registry, setRegistry] = useState<Registry | null>(cached);
  useEffect(() => {
    if (cached) return;
    api<Registry>('/admin/modules')
      .then((r) => { cached = r.data; setRegistry(r.data); })
      .catch(() => setRegistry({ modules: [], presets: [], setup_checklist: {} }));
  }, []);
  return registry;
}

/**
 * Preset buttons + a checkbox grid of the optional modules.
 *
 * Core modules are not shown at all: they cannot be revoked, so a ticked,
 * disabled checkbox would only invite an operator to try. Dependencies are
 * enforced here as well as server-side, because discovering "gaushala needs
 * donations" through a 400 after pressing Save is a poor way to learn it.
 */
export function ModulePicker({
  value,
  onChange,
  templeType,
  disabled,
}: {
  value: string[];
  onChange: (modules: string[]) => void;
  templeType?: string;
  disabled?: boolean;
}) {
  const registry = useModuleRegistry();
  if (!registry) return <p className="muted">Loading modules…</p>;

  const optional = registry.modules
    .filter((m) => !m.is_core)
    .filter((m) => !m.applies_to.length || !templeType || m.applies_to.includes(templeType));

  const byKey = new Map(registry.modules.map((m) => [m.key, m]));

  function toggle(key: string) {
    if (disabled) return;
    if (value.includes(key)) {
      // Removing a module also removes anything that depends on it, so the
      // selection can never describe a state the server would reject.
      const dependents = optional.filter((m) => m.requires.includes(key)).map((m) => m.key);
      onChange(value.filter((k) => k !== key && !dependents.includes(k)));
    } else {
      const deps = (byKey.get(key)?.requires ?? []).filter(
        (d) => !byKey.get(d)?.is_core && !value.includes(d),
      );
      onChange([...new Set([...value, key, ...deps])]);
    }
  }

  const activePreset = registry.presets.find(
    (p) => p.modules.length === value.length && p.modules.every((m) => value.includes(m)),
  );

  return (
    <div className="module-picker">
      <div className="module-presets">
        {registry.presets.map((p) => (
          <button
            key={p.key}
            type="button"
            disabled={disabled}
            title={p.description}
            className={activePreset?.key === p.key ? 'chip chip-active' : 'chip'}
            onClick={() => onChange([...p.modules])}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>
        Core modules — donations, donors, expenses, accounting, reports, registers,
        masters, settings and users — are always included and are not listed here.
      </p>
      <div className="module-grid">
        {optional.map((m) => (
          <label key={m.key} className="module-item" title={m.description ?? undefined}>
            <input
              type="checkbox"
              checked={value.includes(m.key)}
              disabled={disabled}
              onChange={() => toggle(m.key)}
            />
            <span>
              {m.display_name}
              {m.requires.filter((r) => !byKey.get(r)?.is_core).length > 0 && (
                <em className="muted" style={{ fontSize: 11 }}>
                  {' '}needs {m.requires.filter((r) => !byKey.get(r)?.is_core).join(', ')}
                </em>
              )}
            </span>
          </label>
        ))}
      </div>
      <SetupChecklist modules={value} checklist={registry.setup_checklist} />
    </div>
  );
}

/**
 * What the trust still has to do before a granted module is usable.
 *
 * Granting is not the same as working: `tenant-seed.sql` creates donation and
 * expense categories, accounts, one sample seva and the invoice series — but no
 * rooms, halls, prasad items or cattle. A Dharamshala trust that opens an empty
 * Rooms screen concludes the product is broken, so say it here instead.
 */
export function SetupChecklist({
  modules,
  checklist,
}: {
  modules: string[];
  checklist: Record<string, string[]>;
}) {
  const relevant = modules.filter((m) => checklist[m]?.length);
  if (!relevant.length) return null;
  return (
    <div className="setup-checklist">
      <strong style={{ fontSize: 12 }}>Before these can be used:</strong>
      {relevant.map((m) => (
        <div key={m} style={{ marginTop: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{m}</span>
          <ul style={{ margin: '2px 0 0 18px', fontSize: 12 }}>
            {checklist[m].map((step) => <li key={step}>{step}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}
