create table if not exists workbooks (
  id text primary key,
  name text not null,
  owner text not null,
  status text not null,
  created_at timestamptz not null,
  last_reviewed_at timestamptz not null,
  latest_version_id text not null,
  tags_json jsonb not null default '[]'::jsonb,
  sketch_json jsonb not null default '{}'::jsonb
);

alter table if exists workbooks
  add column if not exists tags_json jsonb not null default '[]'::jsonb;

alter table if exists workbooks
  add column if not exists sketch_json jsonb not null default '{}'::jsonb;

create table if not exists workbook_access_assignments (
  workbook_id text not null references workbooks(id) on delete cascade,
  reviewer_profile_id text not null,
  reviewer_handle text not null,
  reviewer_display_name text not null,
  assignment_role text not null,
  scopes_json jsonb not null default '[]'::jsonb,
  sheet_scopes_json jsonb not null default '[]'::jsonb,
  range_scopes_json jsonb not null default '[]'::jsonb,
  assigned_at timestamptz not null,
  assigned_by text not null,
  primary key (workbook_id, reviewer_profile_id)
);

alter table if exists workbook_access_assignments
  add column if not exists scopes_json jsonb not null default '[]'::jsonb;

alter table if exists workbook_access_assignments
  add column if not exists sheet_scopes_json jsonb not null default '[]'::jsonb;

alter table if exists workbook_access_assignments
  add column if not exists range_scopes_json jsonb not null default '[]'::jsonb;

create index if not exists workbook_access_assignments_workbook_id_idx
  on workbook_access_assignments (workbook_id, assigned_at asc, reviewer_profile_id asc);

create table if not exists workbook_versions (
  id text primary key,
  workbook_id text not null references workbooks(id) on delete cascade,
  created_at timestamptz not null,
  created_by text not null,
  note text not null,
  artifact_path text
);

create index if not exists workbook_versions_workbook_id_idx
  on workbook_versions (workbook_id, created_at desc);

create table if not exists workbook_library_views (
  id text primary key,
  name text not null,
  updated_at timestamptz not null,
  updated_by text not null,
  archived_at timestamptz,
  archived_by text,
  description text,
  search_query text,
  tags_json jsonb not null default '[]'::jsonb,
  sort_by text not null,
  sort_direction text not null,
  pinned boolean not null default false
);

alter table if exists workbook_library_views
  add column if not exists archived_at timestamptz;

alter table if exists workbook_library_views
  add column if not exists archived_by text;

create index if not exists workbook_library_views_updated_at_idx
  on workbook_library_views (updated_at desc, id desc);

create index if not exists workbook_library_views_archived_at_idx
  on workbook_library_views (archived_at desc, updated_at desc, id desc);

create table if not exists workbook_sheets (
  workbook_version_id text not null references workbook_versions(id) on delete cascade,
  name text not null,
  rows integer not null,
  columns_count integer not null,
  formula_cells integer not null,
  populated_cells integer not null,
  risk_count integer not null,
  sample_rows_json jsonb not null default '[]'::jsonb,
  primary key (workbook_version_id, name)
);

create table if not exists workbook_named_ranges (
  workbook_version_id text not null references workbook_versions(id) on delete cascade,
  name text not null,
  sheet_name text,
  reference text not null,
  primary key (workbook_version_id, name)
);

create table if not exists workbook_risks (
  workbook_version_id text not null references workbook_versions(id) on delete cascade,
  id text not null,
  label text not null,
  severity text not null,
  location text not null,
  summary text not null,
  primary key (workbook_version_id, id)
);

create table if not exists proposals (
  id text primary key,
  workbook_id text not null references workbooks(id) on delete cascade,
  workbook_version_id text not null references workbook_versions(id) on delete cascade,
  title text not null,
  status text not null,
  created_at timestamptz not null,
  requested_by text not null,
  summary text not null,
  approval_required boolean not null,
  reviewer text,
  reviewed_at timestamptz,
  review_comment text,
  applied_at timestamptz,
  applied_by text,
  applied_version_id text
);

create index if not exists proposals_workbook_id_idx
  on proposals (workbook_id, created_at desc);

create table if not exists proposal_items (
  id text primary key,
  proposal_id text not null references proposals(id) on delete cascade,
  kind text not null,
  cell text not null,
  before_value text,
  after_value text,
  rationale text not null,
  status text not null,
  reviewer text,
  reviewed_at timestamptz,
  review_comment text,
  comments_json jsonb not null default '[]'::jsonb
);

alter table if exists proposal_items
  add column if not exists comments_json jsonb not null default '[]'::jsonb;

create index if not exists proposal_items_proposal_id_idx
  on proposal_items (proposal_id);

create table if not exists audit_events (
  id text primary key,
  workbook_id text not null references workbooks(id) on delete cascade,
  actor text not null,
  action text not null,
  detail text not null,
  created_at timestamptz not null
);

create index if not exists audit_events_workbook_id_idx
  on audit_events (workbook_id, created_at desc);

create table if not exists reviewer_notifications (
  id text primary key,
  reviewer text not null,
  title text not null,
  body text not null,
  action text not null,
  created_at timestamptz not null,
  read_at timestamptz,
  workbook_id text references workbooks(id) on delete cascade,
  proposal_id text references proposals(id) on delete cascade,
  proposal_item_id text references proposal_items(id) on delete cascade,
  metadata_json jsonb not null default '{}'::jsonb
);

alter table if exists reviewer_notifications
  add column if not exists read_at timestamptz;

alter table if exists reviewer_notifications
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;

create index if not exists reviewer_notifications_reviewer_idx
  on reviewer_notifications (reviewer, created_at desc, id desc);

create index if not exists reviewer_notifications_unread_idx
  on reviewer_notifications (reviewer, read_at, created_at desc);

create table if not exists reviewer_profiles (
  handle text primary key,
  name text not null,
  role text not null,
  team text,
  email text,
  active boolean not null default true
);

create table if not exists workbook_access_assignments (
  workbook_id text not null references workbooks(id) on delete cascade,
  reviewer_profile_id text not null references reviewer_profiles(handle) on delete cascade,
  reviewer_handle text not null,
  reviewer_display_name text not null,
  assignment_role text not null,
  scopes_json jsonb not null default '[]'::jsonb,
  sheet_scopes_json jsonb not null default '[]'::jsonb,
  range_scopes_json jsonb not null default '[]'::jsonb,
  assigned_at timestamptz not null,
  assigned_by text not null,
  primary key (workbook_id, reviewer_profile_id)
);

create index if not exists workbook_access_assignments_workbook_id_idx
  on workbook_access_assignments (workbook_id, assigned_at asc);

create table if not exists reviewer_sessions (
  session_key text primary key,
  reviewer_handle text not null references reviewer_profiles(handle) on delete cascade,
  signed_in_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table if exists reviewer_sessions
  add column if not exists updated_at timestamptz not null default now();
