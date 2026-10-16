import { useEffect, useRef } from 'react';
import { Bold, Heading3, Italic, Link2, List, ListOrdered, Quote, RemoveFormatting, Underline } from 'lucide-react';

/**
 * A small rich text editor — bold, italic, underline, a heading, lists, a
 * quote, links — with no library behind it: a contentEditable box and the
 * browser's own editing commands. Enough for "About this book"; nothing that
 * needs a 200 KB dependency.
 *
 * The HTML it produces is cleaned again by the API (superadmin-api
 * common/rich-text.ts) to the same small set, so the toolbar is a convenience
 * and never the safety boundary. Pasted text arrives as plain text, which is
 * what stops a paste from Word bringing its fonts and colours along.
 */
export function RichTextEditor({ value, onChange, placeholder, lang, minHeight = 140, testId }: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  lang?: string;
  minHeight?: number;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Only push a value in from outside when it differs — writing innerHTML on
  // every keystroke would throw the caret to the start.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value || '';
  }, [value]);

  /**
   * Run an editing command where the caret IS. Focusing the box again (which
   * the first version did) can drop the selection, so a list made after typing
   * a line put the caret at its start and the next words landed in front of it.
   * The range is kept and restored around the command instead.
   */
  const exec = (cmd: string, arg?: string) => {
    const el = ref.current;
    if (!el) return;
    const sel = window.getSelection();
    const saved = sel && sel.rangeCount && el.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
    if (document.activeElement !== el) el.focus();
    if (saved && sel) { sel.removeAllRanges(); sel.addRange(saved); }
    else if (sel) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    document.execCommand('defaultParagraphSeparator', false, 'p');
    document.execCommand(cmd, false, arg);
    onChange(el.innerHTML);
  };
  const tools: Array<[React.ReactNode, string, () => void]> = [
    [<Bold size={15} />, 'Bold (Ctrl+B)', () => exec('bold')],
    [<Italic size={15} />, 'Italic (Ctrl+I)', () => exec('italic')],
    [<Underline size={15} />, 'Underline (Ctrl+U)', () => exec('underline')],
    [<Heading3 size={15} />, 'Heading', () => exec('formatBlock', 'h3')],
    [<List size={15} />, 'Bulleted list', () => exec('insertUnorderedList')],
    [<ListOrdered size={15} />, 'Numbered list', () => exec('insertOrderedList')],
    [<Quote size={15} />, 'Quote', () => exec('formatBlock', 'blockquote')],
    [<Link2 size={15} />, 'Link', () => {
      const url = window.prompt('Link to (https://…)');
      if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) exec('createLink', url.trim());
    }],
    [<RemoveFormatting size={15} />, 'Plain paragraph / clear formatting', () => { exec('removeFormat'); exec('formatBlock', 'p'); }],
  ];

  return (
    <div className="rte">
      <div className="rte-bar" role="toolbar" aria-label="Formatting">
        {tools.map(([icon, label, fn]) => (
          <button key={label} type="button" title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={fn}>{icon}</button>
        ))}
      </div>
      <div
        ref={ref}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-testid={testId}
        lang={lang}
        data-placeholder={placeholder}
        style={{ minHeight }}
        onFocus={() => document.execCommand('defaultParagraphSeparator', false, 'p')}
        onInput={() => onChange(ref.current?.innerHTML ?? '')}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
      />
    </div>
  );
}

/** Show stored (already-cleaned) rich text. */
export function RichText({ html, lang }: { html: string | null | undefined; lang?: string }) {
  if (!html) return null;
  return <div className="rte-view" lang={lang} dangerouslySetInnerHTML={{ __html: html }} />;
}
