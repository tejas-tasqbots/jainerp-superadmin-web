import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useCan } from '../auth/permissions';

/**
 * Delete a test or duplicate enquiry — a lead, registration, custom-plan or
 * demo request (Leads & Enquiries, 2026-10-17).
 *
 * Only for `platform.manage` (Super admins): deleting is permanent. The server
 * refuses what must stay — anything paid, invoiced, onboarded or won — and says
 * why; that message is shown here instead of a generic failure. A website
 * request and the lead made from it are one entry, so `note` tells the operator
 * when deleting one removes the other.
 */
export function DeleteEntryButton({ path, what, note, onDeleted, onError, small = true }: {
  /** e.g. `/admin/leads/<id>` */
  path: string;
  /** How the confirmation names it: "lead LEAD-0004". */
  what: string;
  note?: string;
  onDeleted: (message: string) => void;
  onError: (e: unknown) => void;
  small?: boolean;
}) {
  const canDelete = useCan('platform.manage');
  const [busy, setBusy] = useState(false);
  if (!canDelete) return null;
  return (
    <button
      type="button"
      className={`btn danger${small ? ' sm' : ''}`}
      data-testid="delete-entry"
      disabled={busy}
      title={`Delete ${what}`}
      onClick={async () => {
        const msg = `Delete ${what}? This cannot be undone.${note ? `\n\n${note}` : ''}\n\nUse this only for test or duplicate entries — a copy is kept in the audit log.`;
        if (!window.confirm(msg)) return;
        setBusy(true);
        try {
          await api(path, { method: 'DELETE' });
          onDeleted(`Deleted ${what}.`);
        } catch (e) {
          onError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 size={13} style={{ verticalAlign: '-2px' }} /> Delete
    </button>
  );
}
