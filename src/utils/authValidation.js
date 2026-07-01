export function validateNewPassword(password, confirmPassword) {
  if (password !== confirmPassword) {
    return 'Passwords do not match.'
  }

  if (String(password ?? '').length < 8) {
    return 'Password must be at least 8 characters.'
  }

  return ''
}