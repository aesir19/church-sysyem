import { describe, expect, it } from 'vitest'
import {
  validateMemberForm,
  errorsOnTab,
  REQUIRED_FIELDS,
  FIELD_TAB,
} from '../../src/utils/memberValidation'

const TODAY = '2026-08-12'

const filled = (overrides = {}) => ({
  last_name: 'Villanueva',
  first_name: 'Ramon',
  middle_name: '',
  birthdate: '1990-06-14',
  gender: 'Male',
  marital_status: 'Single',
  address: '',
  contact_number: '',
  email: '',
  ...overrides,
})

describe('validateMemberForm', () => {
  it('accepts a record carrying the five required columns', () => {
    expect(validateMemberForm(filled(), { today: TODAY })).toEqual({})
  })

  it('rejects each required field when it is missing', () => {
    for (const field of REQUIRED_FIELDS) {
      const errors = validateMemberForm(filled({ [field]: '' }), { today: TODAY })
      expect(Object.keys(errors), field).toEqual([field])
      expect(errors[field], field).toBeTruthy()
    }
  })

  // Whitespace is not a name. Postgres would take ' ' happily — the column is
  // NOT NULL, not CHECK (btrim(x) <> '') — so this is the only thing standing
  // between the roll and a member called " ".
  it('treats a whitespace-only name as absent', () => {
    const errors = validateMemberForm(filled({ first_name: '   ' }), { today: TODAY })
    expect(errors.first_name).toBeTruthy()
  })

  it('refuses a birthdate in the future but allows today', () => {
    expect(validateMemberForm(filled({ birthdate: '2026-08-13' }), { today: TODAY }).birthdate)
      .toBeTruthy()
    expect(validateMemberForm(filled({ birthdate: TODAY }), { today: TODAY }).birthdate)
      .toBeUndefined()
  })

  // Regression guard for the fix that is easy to undo. Comparing ISO strings is
  // deliberate: `new Date('2026-08-12')` is UTC midnight, which is still the
  // 11th in Manila for eight hours of every day — so a Date round-trip would
  // reject a birthdate of today for most of a working morning.
  it('compares dates without a Date round-trip, so the timezone cannot shift the boundary', () => {
    const boundary = validateMemberForm(filled({ birthdate: '2026-08-12' }), { today: '2026-08-12' })
    expect(boundary.birthdate).toBeUndefined()
  })

  it('reports every problem at once rather than one at a time', () => {
    const errors = validateMemberForm(
      { last_name: '', first_name: '', birthdate: '', gender: '', marital_status: '' },
      { today: TODAY },
    )
    expect(Object.keys(errors)).toHaveLength(5)
  })

  it('survives a null form rather than throwing', () => {
    expect(() => validateMemberForm(null, { today: TODAY })).not.toThrow()
    expect(Object.keys(validateMemberForm(null, { today: TODAY }))).toHaveLength(5)
  })

  // Postgres hands `contact_number` back as a Decimal, so form state is not
  // uniformly strings and `.trim()` on a raw field would throw.
  it('does not choke on a non-string value', () => {
    const form = filled({ contact_number: 9171234567, last_name: 12345 })
    expect(() => validateMemberForm(form, { today: TODAY })).not.toThrow()
    // A numeric surname is nonsense but it is not EMPTY, and rejecting it is
    // not this function's call — the column takes it.
    expect(validateMemberForm(form, { today: TODAY }).last_name).toBeUndefined()
  })

  // Nothing outside the five is invented. The mockup draws "a mobile number is
  // required" and "the address is too short for visitation"; adopting either
  // would start rejecting records that save fine today.
  it('imposes no rule on the optional fields', () => {
    const errors = validateMemberForm(
      filled({ address: '', contact_number: '', email: '', facebook_link: '' }),
      { today: TODAY },
    )
    expect(errors).toEqual({})
  })
})

describe('errorsOnTab', () => {
  it('counts only the fields belonging to the tab asked about', () => {
    const errors = validateMemberForm({}, { today: TODAY })
    expect(errorsOnTab(errors, 'personal')).toBe(5)
    expect(errorsOnTab(errors, 'contact')).toBe(0)
    expect(errorsOnTab(errors, 'journey')).toBe(0)
  })

  it('is empty for a valid form and safe on null', () => {
    expect(errorsOnTab(validateMemberForm(filled(), { today: TODAY }), 'personal')).toBe(0)
    expect(errorsOnTab(null, 'personal')).toBe(0)
  })

  // The map is what stops the tab badge silently going quiet: a new rule whose
  // field has no entry would count as being on no tab at all, so the summary
  // would say "one field needs attention" and every tab badge would read zero.
  it('places every validated field on a tab', () => {
    for (const field of REQUIRED_FIELDS) {
      expect(FIELD_TAB[field], field).toBeTruthy()
    }
  })
})
