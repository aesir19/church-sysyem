const MEMBER_FORM_FIELDS = [
  'first_name',
  'last_name',
  'middle_name',
  'birthdate',
  'gender',
  'address',
  'date_joined',
  'contact_number',
  'email',
  'marital_status',
  'wedding_anniversarry',
  'facebook_link',
  'is_one_to_one_completed',
  'is_turning_point_completed',
  'is_baptized',
]

const BOOLEAN_FIELDS = new Set([
  'is_one_to_one_completed',
  'is_turning_point_completed',
  'is_baptized',
])

export function snapshotMemberForm(formData) {
  const form = formData || {}

  return Object.fromEntries(MEMBER_FORM_FIELDS.map((field) => [
    field,
    BOOLEAN_FIELDS.has(field) ? Boolean(form[field]) : String(form[field] ?? ''),
  ]))
}

export function isMemberFormDirty(formData, initialFormData) {
  const current = snapshotMemberForm(formData)
  const initial = snapshotMemberForm(initialFormData)

  return MEMBER_FORM_FIELDS.some((field) => current[field] !== initial[field])
}