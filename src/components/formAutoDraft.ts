import { loadSession } from '../api/client';

/**
 * Drafts for every ActionForm in the console, without each form wiring them.
 *
 * The form's fields are read straight from the DOM (inputs, selects,
 * textareas, in document order), kept on every change, and written back when
 * the same form opens again — through the native value setter plus an input
 * event, which is what React's controlled inputs listen to, so each form's own
 * state updates exactly as if the person had typed.
 *
 * NEVER kept: passwords, file pickers, one-time codes, and anything whose name
 * or label says bank account, IFSC, PAN, Aadhaar or OTP. Drafts live 7 days in
 * this browser, per signed-in admin.
 */
const PREFIX = 'superadmin.autodraft.';
const TTL = 7 * 24 * 3600 * 1000;
const SENSITIVE = /pass|otp|totp|token|account|ifsc|pan\b|aadhaar|aadhar|card|cvv|secret/i;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
interface Snap { v: Array<string | boolean | null>; savedAt: number }

export function draftKeyFor(form: HTMLFormElement, submitLabel: string): string {
  const dialog = form.closest('[role=dialog]')?.getAttribute('aria-label') ?? '';
  return `${PREFIX}${loadSession()?.user.id ?? 'anon'}.${window.location.pathname}|${dialog}|${submitLabel}`;
}

function fields(form: HTMLFormElement): Field[] {
  return Array.from(form.querySelectorAll<Field>('input, select, textarea')).filter((el) => {
    if (el.closest('[data-no-draft]')) return false;
    const type = (el as HTMLInputElement).type;
    if (['file', 'password', 'hidden', 'submit', 'button', 'reset'].includes(type)) return false;
    const label = el.closest('label')?.textContent ?? '';
    return !SENSITIVE.test(`${el.name} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('autocomplete') ?? ''} ${label}`);
  });
}

export function snapshot(form: HTMLFormElement): Array<string | boolean | null> {
  return fields(form).map((el) => ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio' ? (el as HTMLInputElement).checked : el.value));
}

export function readDraft(key: string): Snap | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw) as Snap;
    if (Date.now() - s.savedAt > TTL) { localStorage.removeItem(key); return null; }
    return s;
  } catch { return null; }
}
export function writeDraft(key: string, v: Array<string | boolean | null>) {
  try { localStorage.setItem(key, JSON.stringify({ v, savedAt: Date.now() })); } catch { /* full or blocked */ }
}
export function dropDraft(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/** Put values back into the form so React sees them as typed. */
export function restore(form: HTMLFormElement, values: Array<string | boolean | null>) {
  const els = fields(form);
  els.forEach((el, i) => {
    const want = values[i];
    if (want === undefined || want === null) return;
    const input = el as HTMLInputElement;
    if (input.type === 'checkbox' || input.type === 'radio') {
      if (input.checked !== want) input.click();
      return;
    }
    if (el.value === want) return;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, want as string);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
