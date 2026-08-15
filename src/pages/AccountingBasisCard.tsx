import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { ErrorBox } from '../components/ui';

/**
 * The accounting basis a trust's books are kept on.
 *
 * This used to be a tab in the mandir's own Settings, which is the wrong place
 * for it: flipping it mid-year silently restates every statement the trust has
 * already handed to its CA. Cash counts only money that actually moved;
 * accrual recognises income when earned and shows unpaid bills as liabilities.
 * The same year's Income & Expenditure comes out differently under each.
 *
 * So it lives here, and mandir-api refuses the field on its profile PATCH —
 * hiding the control without enforcing it would have left the change one API
 * call away.
 */
interface Basis {
  tenant_id: string;
  tenant_name: string;
  accounting_basis: 'cash' | 'accrual';
  enable_depreciation: boolean;
}

export function AccountingBasisCard({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<Basis | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState<'cash' | 'accrual' | null>(null);

  const load = useCallback(() => {
    api<Basis>(`/admin/tenants/${tenantId}/accounting-basis`)
      .then((r) => setState(r.data))
      .catch(setError);
  }, [tenantId]);
  useEffect(load, [load]);

  async function apply(basis: 'cash' | 'accrual') {
    setSaving(true);
    setError(null);
    try {
      const r = await api<Basis>(`/admin/tenants/${tenantId}/accounting-basis`, {
        method: 'PATCH',
        body: { accounting_basis: basis },
      });
      setState(r.data);
      setConfirming(null);
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  if (!state) return null;

  return (
    <div className="card">
      <h2>Accounting basis</h2>
      <p className="muted">
        How this trust's books are kept. Cash counts only money that actually moved; accrual
        recognises income when earned and shows unpaid bills as liabilities. Changing it partway
        through a year restates every statement the trust has already filed — check with them first.
      </p>
      <ErrorBox error={error} />

      <div className="toolbar">
        {(['cash', 'accrual'] as const).map((b) => (
          <button
            key={b}
            className={state.accounting_basis === b ? 'btn primary' : 'btn'}
            disabled={saving || state.accounting_basis === b}
            onClick={() => setConfirming(b)}
          >
            {b === 'cash' ? 'Cash basis' : 'Accrual basis'}
            {state.accounting_basis === b ? ' (current)' : ''}
          </button>
        ))}
      </div>

      {confirming && (
        <div className="muted" style={{ marginTop: 12 }}>
          <p>
            Switch <strong>{state.tenant_name}</strong> to{' '}
            <strong>{confirming === 'cash' ? 'cash' : 'accrual'} basis</strong>? Their Income &amp;
            Expenditure and Balance Sheet will change for the current year, including any period
            already reported.
          </p>
          <div className="toolbar">
            <button className="btn" onClick={() => setConfirming(null)}>Cancel</button>
            <button className="btn danger" disabled={saving} onClick={() => apply(confirming)}>
              Yes, switch to {confirming}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
