import { useEffect, useState } from 'react'
import { api } from '../api/client'

/**
 * International phone entry: country dial-code dropdown + national number.
 * Value in/out is always full E.164 ('+919876543210') or '' — every API
 * stores mobiles in E.164, so callers never prepend '+91' themselves.
 * The dial-code list comes from GET /geo/countries (India first); a small
 * static fallback keeps the login screen usable if that call fails.
 */

export interface DialOption { name: string; dial: string; iso2: string }

const FALLBACK_DIALS: DialOption[] = [
  { name: 'India', dial: '91', iso2: 'IN' },
  { name: 'United Arab Emirates', dial: '971', iso2: 'AE' },
  { name: 'United States', dial: '1', iso2: 'US' },
  { name: 'United Kingdom', dial: '44', iso2: 'GB' },
  { name: 'Singapore', dial: '65', iso2: 'SG' },
  { name: 'Australia', dial: '61', iso2: 'AU' },
]

// Module-level cache — one lookup per session, shared by every PhoneInput
// and by splitE164 (longest-prefix matching needs the full list).
let DIALS: DialOption[] = FALLBACK_DIALS
let dialsPromise: Promise<DialOption[]> | null = null

export function loadDialCodes(): Promise<DialOption[]> {
  if (!dialsPromise) {
    dialsPromise = api<DialOption[]>('/admin/geo/countries')
      .then((r) => {
        const list = (r as any).data ?? r
        if (Array.isArray(list) && list.length) DIALS = list as DialOption[]
        return DIALS
      })
      .catch(() => { dialsPromise = null; return DIALS })
  }
  return dialsPromise
}

/** Flag emoji from an ISO2 code (renders as letter pairs on Windows — fine). */
function flag(iso2: string): string {
  return iso2.replace(/./g, c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Split an E.164 value into dial code + national digits (longest-prefix match). */
export function splitE164(value?: string | null): { dial: string; national: string } {
  if (!value) return { dial: '91', national: '' }
  const digits = value.replace(/\D/g, '')
  if (!value.trim().startsWith('+')) return { dial: '91', national: digits }
  const byLength = [...DIALS].sort((a, b) => b.dial.length - a.dial.length)
  const hit = byLength.find(d => digits.startsWith(d.dial))
  return hit ? { dial: hit.dial, national: digits.slice(hit.dial.length) } : { dial: '91', national: digits }
}

/** True when the national number is plausible for the dial code (strict only for India). */
export function isValidPhone(e164: string): boolean {
  const { dial, national } = splitE164(e164)
  if (dial === '91') return /^[6-9]\d{9}$/.test(national)
  return /^\d{4,14}$/.test(national) && (dial + national).length <= 15
}

interface PhoneInputProps {
  value: string
  onChange: (e164: string) => void
  /** Forwarded to the number input so forms and E2E selectors can target it. */
  name?: string
  required?: boolean
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
  selectClassName?: string
  inputClassName?: string
}

export function PhoneInput({
  value, onChange, name, required, disabled, autoFocus, placeholder,
  selectClassName = '',
  inputClassName = '',
}: PhoneInputProps) {
  const [dials, setDials] = useState<DialOption[]>(DIALS)
  useEffect(() => { loadDialCodes().then(l => setDials([...l])) }, [])

  // Remember the chosen dial code while the number part is still empty
  // (an empty value would otherwise snap the dropdown back to +91).
  const [emptyDial, setEmptyDial] = useState('91')
  const parsed = value ? splitE164(value) : { dial: emptyDial, national: '' }

  // One option per dial code; countries sharing a code (US/Canada, RU/KZ)
  // are shown together on a single line.
  const byDial = new Map<string, DialOption[]>()
  for (const d of dials) {
    const arr = byDial.get(d.dial)
    if (arr) arr.push(d)
    else byDial.set(d.dial, [d])
  }

  function update(dial: string, rawNational: string) {
    setEmptyDial(dial)
    const national = rawNational.replace(/\D/g, '')
    onChange(national ? `+${dial}${national}` : '')
  }

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {/* The open list shows flag + code + country name; the closed control
          shows only the dial code (long labels overflow the narrow select),
          via a transparent native select overlaid on a compact display. */}
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <span aria-hidden="true" className={selectClassName} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#f8fafc', minWidth: 64, justifyContent: 'center' }}>
          +{parsed.dial}
          <span className="ml-1 text-xs opacity-60">▾</span>
        </span>
        <select
          aria-label="Country code"
          style={{ position: 'absolute', inset: 0, height: '100%', width: '100%', opacity: 0, cursor: 'pointer' }}
          value={parsed.dial}
          disabled={disabled}
          onChange={e => update(e.target.value, parsed.national)}
        >
          {[...byDial.entries()].map(([dial, group]) => (
            <option key={dial} value={dial}>
              {flag(group[0].iso2)} +{dial} {group.map(g => g.name).join(' / ')}
            </option>
          ))}
        </select>
      </div>
      <input
        type="tel"
        name={name}
        inputMode="numeric"
        className={inputClassName}
        placeholder={placeholder ?? (parsed.dial === '91' ? '9876543210' : 'Phone number')}
        maxLength={parsed.dial === '91' ? 10 : 14}
        value={parsed.national}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={e => update(parsed.dial, e.target.value)}
      />
    </div>
  )
}
