import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * The one header every console page uses: where you are (breadcrumb on a
 * detail page), what the page is, one line on what it is for, and its actions
 * on the right — the layout Stripe, Shopify and Chargebee admin pages share,
 * so a super admin never has to look for the primary button.
 */
export function PageHeader({ title, subtitle, actions, crumbs, badges }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Parent pages, nearest last: [{ to: '/mandirs', label: 'Manage Mandir' }]. */
  crumbs?: Array<{ to: string; label: string }>;
  /** Status pills beside the title (a detail page's state). */
  badges?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs && crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c) => (
              <span key={c.to}><Link to={c.to}>{c.label}</Link><span aria-hidden="true"> / </span></span>
            ))}
          </nav>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1>{title}</h1>
          {badges}
        </div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** A table body's "nothing here" row: what is empty, and what to do about it. */
export function EmptyRow({ colSpan, title, children }: { colSpan: number; title: string; children?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="empty"><b>{title}</b>{children}</div>
      </td>
    </tr>
  );
}
