export interface DashboardStats {
  temples: {
    total: number;
    active: number;
    inactive: number;
    provisioning: number;
    /** Visibility / lifecycle breakdown (migration 029). */
    usable?: number;
    suspended?: number;
    deactivated?: number;
    deleted?: number;
    devotee_visible?: number;
    devotee_hidden?: number;
    custom_plan?: number;
  };
  subscriptions: {
    mrr_paise: number;
    arr_paise: number;
    pending_amount_paise: number;
    pending_invoices: number;
    past_due_tenants: number;
  };
  growth: { signups_this_month: number; churned_this_month: number };
  devotees: { total: number; verified: number };
}

export interface PendingSubscriptionRow {
  tenant_id: string;
  tenant_name: string;
  plan: string;
  overdue_invoices: number;
  pending_amount_paise: number;
  oldest_due_date: string;
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  temple_type: string;
  status: string;
  plan: string;
  plan_display?: string;
  is_custom_plan?: boolean;
  tenancy_tier: string;
  global_sync_enabled: boolean;
  /** Visibility / lifecycle controls (migration 029). */
  devotee_visible: boolean;
  is_active: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  /** Generated gate: status=active AND is_active AND not soft-deleted. */
  access_enabled: boolean;
  access_block_reason: string | null;
  address: Record<string, string>;
  pending_amount_paise: number;
  created_at: string;
}

/** Assigned plan merged with any per-tenant override. */
export interface EffectivePlan {
  plan: string;
  display_name: string;
  is_custom: boolean;
  overridden_fields: string[];
  price_monthly_paise: number;
  price_yearly_paise: number;
  max_users: number;
  max_devices: number;
  max_receipts_per_month: number;
  max_sms_per_month: number;
  max_storage_mb: number;
  features: Record<string, unknown>;
}

export interface CustomPlanOverride {
  price_monthly_paise?: number;
  price_yearly_paise?: number;
  max_users?: number;
  max_devices?: number;
  max_receipts_per_month?: number;
  max_sms_per_month?: number;
  max_storage_mb?: number;
  features?: Record<string, unknown>;
}

/** Everything that decides login access + devotee visibility for one temple. */
export interface TenantAccessState {
  id: string;
  action?: string;
  status: string;
  is_active: boolean;
  devotee_visible: boolean;
  is_deleted: boolean;
  access_enabled: boolean;
  listed_in_directory: boolean;
  access_block_reason: string | null;
  block_message: string | null;
}

export interface Trustee {
  id: string;
  name: string;
  designation: string | null;
  mobile: string | null;
  email: string | null;
  sinceYear: number | null;
  isActive: boolean;
}

export interface Requirement {
  id: string;
  text: string;
  status: string;
  note: string | null;
  createdAt: string;
}

export interface TenantDetail {
  id: string;
  slug: string;
  name: string;
  temple_type: string;
  status: string;
  plan: string;
  tenancy_tier: string;
  db_cluster_ref: string;
  global_sync_enabled: boolean;
  /** Set once the platform has verified bank/80G/PAN; while set the mandir
      cannot edit those fields directly (migration 028). */
  sensitive_verified_at: string | null;
  custom_domain: string | null;
  /** Visibility / lifecycle controls (migration 029). */
  devotee_visible: boolean;
  is_active: boolean;
  is_deleted: boolean;
  deleted_at: string | null;
  deactivated_at: string | null;
  suspended_at: string | null;
  access_enabled: boolean;
  access_block_reason: string | null;
  access_block_message: string | null;
  /** Exactly what blocked staff see on the login screen. */
  effective_block_message: string | null;
  /** Assigned plan merged with any per-tenant override. */
  effective_plan: EffectivePlan | null;
  custom_plan: CustomPlanOverride | null;
  custom_plan_label: string | null;
  custom_plan_note: string | null;
  custom_plan_set_at: string | null;
  profile: {
    address: Record<string, string>;
    contact: Record<string, string>;
    gstin: string | null;
    pan: string | null;
    registration_80g: string | null;
    registration_12a: string | null;
    trustees: Trustee[];
    requirements: Requirement[];
  };
  subscription: {
    status: string;
    billing_cycle: string;
    current_period_start: string | null;
    current_period_end: string | null;
    auto_debit: string;
  } | null;
  pending_amount_paise: number;
  provisioned_at: string | null;
  created_at: string;
}

/**
 * A platform subscription invoice.
 *
 * camelCase because this list endpoint returns TypeORM entities directly,
 * unlike the snake_case admin endpoints — the field names here must match
 * BillingInvoice's property names, not its column names.
 */
export interface Invoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  subtotalPaise: number;
  gstAmountPaise: number;
  totalPaise: number;
  status: string;
  paidAt: string | null;
  // ---- migration 038 ----
  discountPaise: number;
  additionalChargesPaise: number;
  discountNote: string | null;
  currency: string;
  /** Money-received acknowledgement; null while unpaid. */
  receiptNumber: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  /** The exact Payment Link last sent for this invoice, so it can be resent. */
  paymentLinkUrl: string | null;
  paymentLinkExpiresAt: string | null;
}

export interface License {
  id: string;
  keyString: string;
  edition: string;
  deviceLimit: number;
  validUntil: string;
  status: string;
}

export interface Devotee {
  id: string;
  name: string | null;
  mobile: string;
  email: string | null;
  city: string | null;
  state: string | null;
  verified: boolean;
  verified_at: string | null;
  verified_method: string | null;
  created_at: string;
}

export interface MaharajProfile {
  id: string;
  rep_user_id: string | null;
  /**
   * The canonical display value every reader falls back to. Migration 044 added
   * `name_en` and `name_hi`; this stays because audit rows, comms templates and
   * clients in the field all read it, and it is never empty.
   */
  name: string;
  /** Latin and Devanagari. Either may be null — readers fall back to the other. */
  name_en: string | null;
  name_hi: string | null;
  // The canonical RANK, which is what the column stores and what migration 024's
  // CHECK enforces. It previously read `'maharaj' | 'mataji'` — two values the
  // API can no longer send and the database actively rejects. Nothing caught it
  // because the rank `<select>` is typed `{ value: string }[]`, so TypeScript
  // never compared the two; the only visible effect was that a correct test like
  // `p.type === 'muni'` was rejected as an impossible comparison.
  // "Maharaj" is a form of ADDRESS for a Muni, not a rank — it is rendered from
  // this value, never stored.
  // Digambara ranks, then the Shwetambar pair added by migration 040.
  type: 'muni' | 'aryika' | 'kshullak' | 'kshullika' | 'ailak' | 'sadhu' | 'sadhvi';
  /** Community (Oswal, Porwal, Agarwal…). NOT the sect — migration 024 split these apart. */
  samuday: string | null;
  /** Sampradaya (digambar|shwetambar). Selected by the API's list and detail queries. */
  sect: 'digambar' | 'shwetambar' | null;
  /** Panth/gaccha (Terapanth, Bisapanth, Tapagachha…). Free text by design. */
  sub_sect: string | null;
  /**
   * Post held — a POST, not the rank (migration 039, widened by 044). An
   * Acharya is still a Muni, which is why this is a separate column.
   */
  pad: string | null;
  /**
   * `is_samadhistha` is the state (migration 045); `samadhi_date` is optional
   * detail. Most historical entries record that an ascetic attained samadhi and
   * nothing more, so NEVER infer the state from the date — the profile is then
   * a record: it keeps its history and stays visible, but has no
   * sangh representatives and no current location.
   */
  samadhi_date: string | null;
  is_samadhistha: boolean;
  /** How many people can act for this profile — the moderation queue reads it. */
  reps_count: number;
  /** Requests a Sanghpati admin has not decided. Non-zero means somebody is waiting. */
  pending_rep_requests: number;
  /** Home/base city and its state. NOT where the ascetic is now. */
  city: string | null;
  state: string | null;
  /**
   * Where the ascetic is now, denormalised from the current location row.
   *
   * These two go together and `current_city` must NEVER be paired with `state`:
   * that pairing rendered "Sangli, Jammu and Kashmir" for an ascetic based in
   * J&K who is presently in Maharashtra. `current_state` arrived with migration
   * 046 precisely because the value was not being carried out of the location.
   */
  current_city: string | null;
  current_state: string | null;
  diksha_year: number | null;
  guru_name: string | null;
  verified: boolean;
  verified_at: string | null;
  followers_count: number;
  created_at: string;
  /** Sangh membership (migration 047). Null is normal — many are unaffiliated. */
  sangh_id: string | null;
  sangh_name: string | null;
  /** One of this sangh's head ascetics. A sangh commonly has several. */
  is_sangh_head: boolean;
}

/** A monastic group. Its heads are members flagged `is_sangh_head`. */
export interface SanghHead {
  id: string;
  name: string;
  name_en: string | null;
  name_hi: string | null;
  type: string;
  pad: string | null;
}

export interface Sangh {
  id: string;
  slug: string;
  name_en: string;
  name_hi: string | null;
  parampara: string | null;
  sect: string | null;
  about: string | null;
  verified: boolean;
  verified_at: string | null;
  created_at: string;
  members_count: number;
  heads_count: number;
  heads: SanghHead[];
  /**
   * Ids of other sanghs whose name keys the same — the import split
   * several across two spellings. A FLAG for a curator, never a merge:
   * one such pair is an Acharya's sangh beside an Aryika of the same
   * name, who is a different person.
   */
  duplicate_of?: string[];
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  mobile: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  action: string;
  tenantId: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

// ---------- Subscription / purchase history (migration 029) ----------

export interface HistorySubscription {
  id: string;
  status: string;
  billing_cycle: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string;
  plan: string;
  plan_display: string;
  pending_plan: string | null;
  pending_billing_cycle: string | null;
  pending_effective_at: string | null;
  razorpay_subscription_id?: string | null;
  failure_count?: number;
}

export interface PlanChangeRow {
  id: string;
  change_type: 'plan' | 'billing_cycle' | 'tenancy_tier' | 'custom_plan';
  from_value: string;
  to_value: string;
  effective: string;
  effective_at: string | null;
  proration_credit_paise: number;
  invoice_id: string | null;
  invoice_number: string | null;
  note: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  created_at: string;
}

export interface HistoryInvoice {
  id: string;
  invoice_number: string;
  period_start: string;
  period_end: string;
  subtotal_paise: number;
  gst_rate: string;
  gst_amount_paise: number;
  total_paise: number;
  status: string;
  payment_method: string | null;
  payment_ref: string | null;
  razorpay_payment_id: string | null;
  plan_name: string | null;
  billing_cycle: string | null;
  paid_at: string | null;
  voided_at: string | null;
  note: string | null;
  created_at: string;
  download_count: number;
  last_downloaded_at: string | null;
}

export interface ReceiptDownload {
  id: string;
  invoice_id: string;
  invoice_number: string;
  total_paise: number;
  invoice_status: string;
  actor_type: 'temple' | 'super_admin' | 'system';
  actor_name: string | null;
  channel: string;
  ip: string | null;
  created_at: string;
}

export interface BillingHistory {
  tenant: { id: string; slug: string; name: string; customer_since: string };
  effective_plan: EffectivePlan | null;
  subscriptions: HistorySubscription[];
  plan_changes: PlanChangeRow[];
  invoices: HistoryInvoice[];
  receipt_downloads: ReceiptDownload[];
  totals: {
    paid_paise: number;
    outstanding_paise: number;
    voided_paise: number;
    paid_count: number;
    unpaid_count: number;
    first_invoice_at: string | null;
    last_paid_at: string | null;
  };
}

export interface LifecycleEvent {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
}
