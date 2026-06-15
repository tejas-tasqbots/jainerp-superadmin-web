export interface DashboardStats {
  temples: { total: number; active: number; inactive: number; provisioning: number };
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
  tenancy_tier: string;
  global_sync_enabled: boolean;
  address: Record<string, string>;
  pending_amount_paise: number;
  created_at: string;
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
  custom_domain: string | null;
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
