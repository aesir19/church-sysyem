import { describe, expect, it } from 'vitest'
import { ariaSortFor, isSortedBy, nextSortState, sortDirectionFor } from '../../src/utils/sortState.js'

const BY_LAST_NAME = { key: 'last_name', direction: 'ascending' }

describe('nextSortState', () => {
  it('sorts a newly chosen column ascending', () => {
    expect(nextSortState(null, 'last_name')).toEqual(BY_LAST_NAME)
  })

  it('flips direction when the active column is chosen again', () => {
    const flipped = nextSortState(BY_LAST_NAME, 'last_name')
    expect(flipped).toEqual({ key: 'last_name', direction: 'descending' })
    expect(nextSortState(flipped, 'last_name')).toEqual(BY_LAST_NAME)
  })

  // The bug this guards: carrying the previous column's direction across means
  // clicking a fresh header can land on descending with no click that asked for
  // it, and the arrow the user sees is the one they did not choose.
  it('restarts at ascending when switching columns, whatever the old direction', () => {
    const descending = { key: 'last_name', direction: 'descending' }
    expect(nextSortState(descending, 'first_name')).toEqual({
      key: 'first_name',
      direction: 'ascending',
    })
  })

  it('does not mutate the state it was given', () => {
    const before = { ...BY_LAST_NAME }
    nextSortState(BY_LAST_NAME, 'last_name')
    expect(BY_LAST_NAME).toEqual(before)
  })

  it('ignores a request to sort by nothing', () => {
    expect(nextSortState(BY_LAST_NAME, '')).toEqual(BY_LAST_NAME)
    expect(nextSortState(BY_LAST_NAME, null)).toEqual(BY_LAST_NAME)
  })

  // A broken direction is displayed as ascending by ariaSortFor, so a click on
  // that header has to move to descending. Recovering to ascending instead
  // would leave the header reading exactly as it did before the click.
  it('recovers from an unrecognised direction the way the header reads it', () => {
    const broken = { key: 'last_name', direction: 'sideways' }
    expect(ariaSortFor(broken, 'last_name')).toBe('ascending')
    expect(nextSortState(broken, 'last_name')).toEqual({
      key: 'last_name',
      direction: 'descending',
    })
  })
})

describe('ariaSortFor', () => {
  // These three strings are the entire accessibility payload of D11's second
  // sub-fix. aria-sort has a closed vocabulary — a typo is not a degraded
  // announcement, it is no announcement, and nothing in a visual check catches
  // it. Hence asserting the literals rather than a round-trip.
  it('returns the exact aria-sort token for the active column', () => {
    expect(ariaSortFor(BY_LAST_NAME, 'last_name')).toBe('ascending')
    expect(ariaSortFor({ key: 'last_name', direction: 'descending' }, 'last_name')).toBe('descending')
  })

  it('returns "none" for every column that is not the active one', () => {
    expect(ariaSortFor(BY_LAST_NAME, 'first_name')).toBe('none')
  })

  it('returns "none" when nothing is sorted', () => {
    expect(ariaSortFor(null, 'last_name')).toBe('none')
    expect(ariaSortFor(undefined, 'last_name')).toBe('none')
  })

  it('never emits a token outside the aria-sort vocabulary', () => {
    const broken = { key: 'last_name', direction: 'sideways' }
    expect(['ascending', 'descending', 'none']).toContain(ariaSortFor(broken, 'last_name'))
  })
})

describe('isSortedBy / sortDirectionFor', () => {
  it('identifies the active column', () => {
    expect(isSortedBy(BY_LAST_NAME, 'last_name')).toBe(true)
    expect(isSortedBy(BY_LAST_NAME, 'first_name')).toBe(false)
    expect(isSortedBy(null, 'last_name')).toBe(false)
  })

  it('reports a direction only for the active column', () => {
    expect(sortDirectionFor(BY_LAST_NAME, 'last_name')).toBe('ascending')
    expect(sortDirectionFor(BY_LAST_NAME, 'first_name')).toBeNull()
    expect(sortDirectionFor(null, 'last_name')).toBeNull()
  })
})
