# Plan: Member CRUD + Archiving

Add Create / Update / Archive (soft-delete) to the UDFC dashboard. The existing details modal becomes tri-mode (`view` / `edit` / `create`). Archiving uses **nullable columns + a partial index** on `members` — the most storage-efficient pattern that also accommodates the `archive_reason` field (NULLs cost ~1 bit each in Postgres' null bitmap; the partial index excludes archived rows entirely so its size scales with *active* members only).

## Phase 1 — Database (Supabase SQL)

1. Add columns to `members`: `middle_name TEXT`, `address TEXT`, `archived_at TIMESTAMPTZ`, `archive_reason TEXT` (all nullable).
2. Create partial index `members_active_church_idx ON members(member_of) WHERE archived_at IS NULL`.
3. Replace the SELECT policy → `member_of = get_my_church_id() AND archived_at IS NULL` (hides archived from dashboard).
4. Add INSERT policy → `with check (member_of = get_my_church_id() AND archived_at IS NULL)`.
5. Add UPDATE policy → `using/with check (member_of = get_my_church_id())` (allows edits + archiving but blocks reassigning to another church).
6. No DELETE policy — archive is the only deletion path.

## Phase 2 — Frontend: Create *(parallel with Phase 3)*

1. Add primary **"+ Add Member"** button to the page-header in [DashboardView.vue](../src/views/DashboardView.vue).
2. Introduce `modalMode` (`'view' | 'edit' | 'create' | null`), `formData`, `formError`, `formSaving` state.
3. Refactor the modal: in `create` / `edit` modes, render `<input>` / `<select>` instead of `.detail-value` spans (one shared `<form>` markup).
4. Form fields (per spec): First Name\*, Last Name\*, Middle Name, Birthdate\*, Gender\* (Male/Female), Address\*, Date Joined, Contact Number\*, Email\*, Member of (read-only — auto-filled with the user's church UUID).
5. `handleCreate` → `supabase.from('members').insert({...}).select('*, churches(name)').single()` → prepend to `members.value`, close modal.

## Phase 3 — Frontend: Update *(parallel with Phase 2)*

1. Add **Edit** button to modal header (next to `×`) when `mode === 'view'`.
2. Click Edit → copy `selectedMember` → `formData`, switch to `mode = 'edit'`. Footer shows **Cancel** / **Save Changes**.
3. `handleUpdate` → `supabase.update(...).eq('id', id).select('*, churches(name)').single()` → splice the row in `members.value` by id, return modal to `view` mode.
4. Add **Middle Name** and **Address** rows to the read-only view template.

## Phase 4 — Frontend: Archive *(depends on Phase 3 — shares the modal)*

1. Add subtle red **Archive** button to the modal footer-left (view mode only).
2. Click → swap modal body to an in-modal confirmation panel: heading + optional "Reason for leaving" textarea + Cancel / Confirm Archive (no native `confirm()`, no second modal).
3. `handleArchive` → `supabase.update({ archived_at: now, archive_reason })` → filter row out of `members.value`, close modal.

## Phase 5 — Documentation *(depends on 1–4)*

1. Update [ARCHITECTURE.md](../ARCHITECTURE.md): §5.4 (modal modes + handlers), §6.1 (new columns), §6.2 (new policies), new "Archiving Model" subsection (storage rationale), §9 (replace "No CRUD UI"), §11 (new flows).
2. Update [README.md](../README.md): Features, schema table, RLS migration SQL block.

## Relevant files

- [src/views/DashboardView.vue](../src/views/DashboardView.vue) — primary surface; reuse existing `.modal` / `.detail-row` / palette tokens.
- [src/lib/supabase.js](../src/lib/supabase.js) — no changes (shared client suffices).
- [ARCHITECTURE.md](../ARCHITECTURE.md) — §5.4, §6.1, §6.2, §9, §11.
- [README.md](../README.md) — schema + RLS sections.
- Supabase SQL editor — migration + RLS (SQL also committed to README).

## Verification

1. `\d public.members` confirms 5 new columns; `pg_relation_size('members_active_church_idx')` is small.
2. Insert with a foreign church UUID → RLS rejects; with own church UUID → succeeds.
3. Click "+ Add Member" → submit → row appears at top, badge increments, persists after reload.
4. Click row → Edit → change name → Save → modal flips to view mode with new value, table updates without refresh.
5. Click row → Archive → enter reason → Confirm → row disappears, badge decrements; in DB, `archived_at` + `archive_reason` are populated; reload does not bring it back.
6. Empty First Name on Create → inline form error, no Supabase call. Invalid email → browser-native block.

## Further considerations

1. **Auth-user creation per new member?** Members aren't login accounts; current README treats `user_accounts` linking as a manual SQL step. Recommend keeping it manual this iteration. *Option A: manual (recommended). Option B: add a "create login" button (out of scope).*
2. **`archive_reason` as enum lookup?** A `SMALLINT` FK to a reasons table would save bytes at huge scale, but at congregation scale the savings are negligible. *Option A: keep `TEXT NULL` (recommended). Option B: lookup table (premature).*
3. **Optimistic vs pessimistic UI updates?** Plan uses pessimistic-success (mutate state only after Supabase confirms) so RLS rejections never desync the UI. *Option A: pessimistic (recommended). Option B: true optimistic with rollback.*
