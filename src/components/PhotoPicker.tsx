import { useRef, useState } from 'react';
import { compressImage } from '../lib/imageCompress';

/**
 * Pick a photo from the machine, compress it in the browser, hand back a
 * `data:` URI.
 *
 * The console used to offer a bare "Photo URL" text box, which quietly assumed
 * the curator already had the photograph hosted somewhere — so in practice no
 * profile added here ever got a picture. The sant portal has had a real picker
 * since migration 026; this is the same thing, writing the same
 * `sant_profiles.photo_base64` column, so both sides behave alike.
 *
 * 800px / 150 KB per doc-v2/Images_And_Photos.md §5.2, matching
 * sant-web's ProfileDetailPage — the API caps the payload at ~200 KB of
 * base64 and would reject a camera original outright.
 */
export function PhotoPicker({
  value,
  onChange,
  label = 'Photo',
  hint = 'JPEG or PNG. Stored with the profile — no hosting needed.',
}: {
  /** Current image: a data: URI or an external URL. Empty for none. */
  value: string;
  /** Receives the compressed data: URI, or '' when the photo is cleared. */
  onChange: (dataUri: string) => void;
  label?: string;
  hint?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(file: File) {
    setBusy(true);
    setError('');
    try {
      onChange(await compressImage(file, { maxDim: 800, maxBytes: 150_000 }));
    } catch {
      setError('Could not read that image. Try a JPEG or PNG.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {value ? (
          <img
            src={value}
            alt=""
            style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '1px solid #e2e8f0' }}
          />
        ) : (
          <div
            style={{
              width: 64, height: 64, borderRadius: '50%', background: '#f1f5f9',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94a3b8', fontSize: 22,
            }}
            aria-hidden="true"
          >
            ☺
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? 'Compressing…' : value ? 'Change photo' : 'Upload photo'}
            </button>
            {value && (
              <button type="button" className="btn sm danger" disabled={busy} onClick={() => onChange('')}>
                Remove
              </button>
            )}
          </div>
          <span className="muted" style={{ fontSize: 12 }}>{hint}</span>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
        }}
      />
      {error && <span style={{ color: '#b91c1c', fontSize: 12 }}>{error}</span>}
    </div>
  );
}
