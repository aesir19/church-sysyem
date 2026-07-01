import { describe, expect, it } from 'vitest'
import { validateNewPassword } from '../../src/utils/authValidation'

describe('validateNewPassword', () => {
  it('rejects mismatched passwords', () => {
    expect(validateNewPassword('password123', 'password124')).toBe('Passwords do not match.')
  })

  it('rejects short passwords', () => {
    expect(validateNewPassword('short', 'short')).toBe('Password must be at least 8 characters.')
  })

  it('accepts valid matching passwords', () => {
    expect(validateNewPassword('securePass123', 'securePass123')).toBe('')
  })
})
