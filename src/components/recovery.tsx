/**
 * Recovery-code presentation + download, matching what Google/Microsoft do:
 * codes are shown once and offered as a plain .txt file the user can save.
 */

export function downloadRecoveryCodes(codes: string[], accountLabel?: string) {
  const header = [
    'JainERP Super Admin — Two-factor recovery codes',
    accountLabel ? `Account: ${accountLabel}` : null,
    `Generated: ${new Date().toLocaleString('en-IN')}`,
    '',
    'Keep these codes somewhere safe. Each code can be used once to sign in',
    'if you lose access to your authenticator app. After using a code it is',
    'consumed; regenerate a new set from Settings → My account when low.',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  const body = codes.map((c, i) => `${String(i + 1).padStart(2, '0')}. ${c}`).join('\n');
  const blob = new Blob([`${header}${body}\n`], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'jainerp-superadmin-recovery-codes.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RecoveryCodes({ codes, accountLabel }: { codes: string[]; accountLabel?: string }) {
  return (
    <div>
      <div className="recovery-codes" data-testid="recovery-codes">
        {codes.map((c) => (
          <code key={c}>{c}</code>
        ))}
      </div>
      <button
        type="button"
        className="btn sm"
        style={{ marginTop: 10 }}
        onClick={() => downloadRecoveryCodes(codes, accountLabel)}
      >
        ⬇ Download codes (.txt)
      </button>
    </div>
  );
}
