// What may be written when a small group is created or renamed.
//
// An allowlist, not a filter: the payload is built from scratch rather than by
// deleting keys off the form, so a field added to the form later cannot reach the
// database by default. The column grants in 0026 enforce the same narrowing a
// second time — insert may set (name, church_id), update may set (name) — and this
// exists so a rejected write is a bug we can see rather than a 403 a user meets.
//
// `type` is gone as of 0026_split_groups. There is no groups table and no type
// column: a small group is a row in `small_groups`, and which table you insert
// into is what used to be the type. Sending it now would be rejected as an unknown
// column, which is a better failure than the old one — where a wrong `type` was a
// data error the CHECK constraint had to catch.

export function buildSmallGroupCreatePayload(form, churchId) {
  return {
    name: String(form?.name || '').trim(),
    church_id: churchId,
  }
}

export function buildSmallGroupUpdatePayload(form) {
  return {
    name: String(form?.name || '').trim(),
  }
}
