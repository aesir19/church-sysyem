export function buildMemberPayload(formData) {
  const f = formData || {}
  const asText = (value) => {
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return ''
    return String(value)
  }

  return {
    first_name: asText(f.first_name).trim(),
    last_name: asText(f.last_name).trim(),
    middle_name: asText(f.middle_name).trim() || null,
    birthdate: asText(f.birthdate) || null,
    gender: asText(f.gender),
    address: asText(f.address).trim() || null,
    date_joined: asText(f.date_joined) || null,
    contact_number: asText(f.contact_number).trim() || null,
    email: asText(f.email).trim() || null,
    marital_status: asText(f.marital_status),
    wedding_anniversarry: asText(f.wedding_anniversarry) || null,
    facebook_link: asText(f.facebook_link).trim() || null,
    is_one_to_one_completed: !!f.is_one_to_one_completed,
    is_turning_point_completed: !!f.is_turning_point_completed,
    is_baptized: !!f.is_baptized,
  }
}