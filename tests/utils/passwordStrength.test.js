import { describe, expect, it } from 'vitest'
import { passwordStrength, RECOMMENDED_LENGTH } from '../../src/utils/passwordStrength'
import { validateNewPassword } from '../../src/utils/authValidation'

describe('passwordStrength', () => {
  it('says nothing for an empty field rather than shouting "Weak" at nobody', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '', hint: '' })
    expect(passwordStrength(null).score).toBe(0)
    expect(passwordStrength(undefined).score).toBe(0)
  })

  it('withholds the top bar from anything short, however decorated', () => {
    // Every character class, eleven characters.
    const short = passwordStrength('Aa1!Aa1!Aa1')
    expect(short.score).toBeLessThan(4)
    expect(short.hint).toContain(`${RECOMMENDED_LENGTH} characters`)
  })

  it('gives a long, mixed, non-alphabetic password full marks', () => {
    const strong = passwordStrength('correct-Horse-7-battery-staple')
    expect(strong.score).toBe(4)
    expect(strong.label).toBe('Strong')
  })

  // The behaviour that stops the meter teaching the wrong lesson: length is
  // worth more than decoration, so a long passphrase must not score below a
  // short soup of symbols.
  it('rates a long passphrase above a short complex password', () => {
    const passphrase = passwordStrength('the quiet Sunday morning 9')
    const soup = passwordStrength('Aa1!x')
    expect(passphrase.score).toBeGreaterThan(soup.score)
  })

  it('names what is missing rather than only scoring', () => {
    expect(passwordStrength('alllowercaseletters').hint).toContain('mixed case')
    expect(passwordStrength('AllLettersNoDigits').hint).toContain('a number or symbol')
    expect(passwordStrength('Short1!').hint).toContain('characters')
  })

  it('stops nagging once nothing is missing', () => {
    expect(passwordStrength('correct-Horse-7-battery-staple').hint).not.toContain('Add')
  })

  it('keeps the score inside the four bars it renders', () => {
    for (const candidate of ['a', 'Aa', 'Aa1', 'Aa1!', 'a'.repeat(80), 'Zz9!'.repeat(20)]) {
      const { score } = passwordStrength(candidate)
      expect(score, candidate).toBeGreaterThanOrEqual(0)
      expect(score, candidate).toBeLessThanOrEqual(4)
    }
  })
})

// THE BOUNDARY THAT MATTERS. The meter advises; it must never have become the
// thing that accepts or rejects. If someone later wires the score into the
// submit button, this fails — which is the point, because raising the enforced
// minimum from eight is the owner's decision, not a side effect of a repaint.
describe('the meter and the rule are separate', () => {
  it('accepts an eight-character password that the meter calls weak', () => {
    const password = 'passw0rd'
    expect(validateNewPassword(password, password)).toBe('')
    expect(passwordStrength(password).score).toBeLessThan(4)
  })

  it('still refuses a mismatch however strong both halves are', () => {
    expect(validateNewPassword('correct-Horse-7-battery-staple', 'correct-Horse-7-battery-stapl'))
      .toBe('Passwords do not match.')
  })
})
