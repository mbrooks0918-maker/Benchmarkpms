export type UserRole = 'owner' | 'manager'

export interface Profile {
  id: string
  full_name: string | null
  role: UserRole
}

/**
 * A project's category slug (e.g. 'new_build', 'renovation', 'roofing'). Matches
 * a row in project_types.slug. Open-ended so org-defined custom types work.
 */
export type ProjectType = string

/** An org-defined project category (dashboard section / creation source). */
export interface OrgProjectType {
  id: string
  name: string
  slug: string
  default_template_id: string | null
  sequence_order: number
}

export type ProjectStatus = 'active' | 'on_hold' | 'complete'

export interface Project {
  id: string
  name: string
  type: ProjectType
  status: ProjectStatus | string | null
  client_name: string | null
  address: string | null
  total_amount: number | null
  original_amount: number | null
  start_date: string | null
  target_completion_date: string | null
  completed_at: string | null
  baseline_locked_at: string | null
  notes: string | null
  /** PM-written headline of where the job stands now; overwritten as it changes. */
  status_note: string | null
  status_note_updated_at: string | null
  /** Client-facing selections: the client's email and unique public link token. */
  client_email: string | null
  share_token: string | null
  created_at: string
}

export interface NewProjectInput {
  name: string
  client_name: string | null
  address: string | null
  total_amount: number | null
  start_date: string | null
  target_completion_date: string | null
}

/**
 * How a draw's amount_value should be interpreted. The DB stores a text value;
 * we treat 'percent' specially (show as a %) and render anything else as USD.
 */
export type AmountType = 'percent' | 'fixed' | string

// ── Scope templates (the seeded "Standard New Build") ───────────────────────

export interface ScopeTemplate {
  id: string
  name: string
  type: ProjectType
  is_default: boolean
}

export interface TemplatePhase {
  id: string
  template_id: string
  name: string
  sequence_order: number
  nahb_code: string | null
  default_duration_days: number | null
}

export interface TemplateBenchmark {
  id: string
  template_phase_id: string
  name: string
  sequence_order: number
  is_inspection: boolean
  is_procurement: boolean
}

export interface TemplateDraw {
  id: string
  template_id: string
  label: string
  sequence_order: number
  template_phase_id: string | null
  template_benchmark_id: string | null
  amount_type: AmountType
  amount_value: number
}

// ── Live project rows ───────────────────────────────────────────────────────

export interface Phase {
  id: string
  project_id: string
  name: string
  sequence_order: number
  nahb_code: string | null
  progress_pct: number
  status: string | null
  target_start: string | null
  target_end: string | null
  baseline_start: string | null
  baseline_end: string | null
  actual_start: string | null
  actual_end: string | null
}

export interface Benchmark {
  id: string
  phase_id: string
  name: string
  sequence_order: number
  is_inspection: boolean
  completed: boolean
  completed_date: string | null
  completed_by: string | null
  not_applicable: boolean
  /** Ordering/scheduling reminder ("Order:"/"Schedule:"/"Confirm:") vs. physical work. */
  is_procurement: boolean
}

export interface Draw {
  id: string
  project_id: string
  label: string
  sequence_order: number
  phase_id: string | null
  benchmark_id: string | null
  amount_type: AmountType
  amount_value: number
  released: boolean
  released_date: string | null
}

/**
 * A signed change order. `amount` is positive for an add, negative for a
 * credit. When present, `document_id` points at the uploaded signed CO in the
 * `documents` table.
 */
export interface ChangeOrder {
  id: string
  project_id: string
  phase_id: string | null
  co_number: string | null
  description: string | null
  amount: number
  co_date: string | null
  document_id: string | null
  created_by: string | null
  created_at: string
  /** E-signature fields. A signed CO is locked from edits (DB-enforced). */
  sign_token: string | null
  signed_at: string | null
  signed_name: string | null
  signature_image: string | null
  signed_ip: string | null
  voided: boolean
}

export interface Photo {
  id: string
  project_id: string
  phase_id: string | null
  benchmark_id: string | null
  storage_path: string
  taken_by: string | null
  created_at: string
}

/** A free-text note logged against a single benchmark. */
export interface ProgressUpdate {
  id: string
  project_id: string
  phase_id: string | null
  benchmark_id: string | null
  author_id: string | null
  note: string
  created_at: string
}

/** Read-only VIEW: the most recent activity timestamp per project. */
export interface ProjectLastActivity {
  project_id: string
  last_activity: string | null
}

export interface ProjectProgress {
  project_id: string
  overall_pct: number | null
  current_phase: string | null
}

export type DocumentCategory =
  | 'Contract'
  | 'Bank Estimate'
  | 'Permit'
  | 'Invoice'
  | 'Photo'
  | 'Other'

export interface ProjectDocument {
  id: string
  project_id: string
  category: DocumentCategory | string
  file_name: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}

export type VendorDocType =
  | 'Invoice'
  | 'Quote'
  | 'COI'
  | 'W-9'
  | 'Lien Waiver'
  | 'Other'

/**
 * A document received FROM a vendor/contractor (invoice, quote, COI, W-9, lien
 * waiver, etc.), kept separate from the job's own Documents. `amount` is a
 * recorded reference only — it does NOT feed the contract total or any draw.
 */
export interface VendorDoc {
  id: string
  project_id: string
  phase_id: string | null
  vendor_name: string
  doc_type: VendorDocType | string
  amount: number | null
  doc_date: string | null
  file_name: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  uploaded_by: string | null
  created_at: string
}

/** The kind of answer a selection question expects. */
export type SelectionQType = 'radio' | 'text' | 'yesno'

/**
 * A single client-facing selection question (the "SelectSheet" catalog). Global
 * and seeded — shared across all New Build projects. `options` holds the choices
 * for a 'radio' question.
 */
export interface CatalogCategory {
  id: string
  section: string
  sort_order: number
  label: string
  help: string | null
  qtype: SelectionQType | string
  options: string[] | null
  upcharge_note: string | null
}

/**
 * A client's answer to one catalog question for one project. `value` is the
 * chosen option / typed text / 'yes'|'no'; `is_na` marks "not applicable".
 * `image_url` references the selection-photos bucket.
 */
export interface Selection {
  id: string
  project_id: string
  category_id: string
  value: string | null
  is_other: boolean
  is_na: boolean
  note: string | null
  image_url: string | null
  updated_at: string
}

/**
 * A read-only public share link for an "interested party" (banker, homeowner,
 * investor). The public viewer reads ONLY via the get_project_view RPC; this
 * row is owner-managed. No financials/documents are ever exposed through it.
 */
export interface ProjectViewLink {
  id: string
  project_id: string
  token: string
  label: string | null
  revoked: boolean
  created_at: string
  created_by: string | null
}

/** Read-only VIEW reconciling the sum of draws against the contract total. */
export interface ProjectDrawCheck {
  project_id: string
  total_amount: number | null
  draw_sum: number | null
  difference: number | null
  matches: boolean
}
