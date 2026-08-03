export const ANONYMOUS_LABEL = 'Anonymous'
export const UNKNOWN_LABEL = 'Unknown'

// `from` is always present in the payload, never omitted. Omitting it is what
// broke anonymous entry before 0011_collections_anonymous_from: the column's
// gen_random_uuid() default fired and the foreign key rejected the insert with
// 23503. The default is gone now, but sending an explicit null keeps this
// correct regardless of what the column defaults to.
export function buildCollectionPayload(form, churchId) {
  const f = form || {}

  return {
    from: f.memberId || null,
    amount: f.amount,
    is_tithes: f.type === 'tithes',
    collectedOn: f.date,
    from_church: churchId,
  }
}

// Three distinct states, and they must not collapse into one label:
//   from IS NULL          → an anonymous gift; nobody claimed it.
//   from set, member set  → a named contributor.
//   from set, member null → a member the caller cannot read (RLS filtered the
//                           embed, or the row was archived out of the join).
export function contributorLabel(row) {
  if (!row) return UNKNOWN_LABEL
  if (row.from == null) return ANONYMOUS_LABEL

  const member = row.members
  if (!member) return UNKNOWN_LABEL

  const name = `${member.first_name || ''} ${member.last_name || ''}`.trim()
  return name || UNKNOWN_LABEL
}

export function isAnonymousRow(row) {
  return !!row && row.from == null
}
