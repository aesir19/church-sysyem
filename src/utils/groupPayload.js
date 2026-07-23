export function buildSmallGroupCreatePayload(form, churchId) {
  return {
    name: String(form?.name || '').trim(),
    type: 'Small Group',
    church_id: churchId,
  }
}

export function buildSmallGroupUpdatePayload(form) {
  return {
    name: String(form?.name || '').trim(),
  }
}
