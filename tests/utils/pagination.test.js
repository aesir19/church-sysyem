// The arithmetic behind the members list's server-side pagination.
//
// Pulled out of the view because off-by-one is the entire risk here and it is
// invisible: PostgREST's `.range()` bounds are INCLUSIVE, so page 2 of 50 is
// rows 50–99, not 50–100. A one-row overlap shows the same member twice across
// a page boundary and a one-row gap hides someone entirely — neither of which
// looks like a bug on screen. This is exactly the pure logic CLAUDE.md wants in
// src/utils/ where it can be tested without mounting a view.

import { describe, expect, it } from 'vitest'
import { clampPage, pageCount, pageNumbers, rangeFor, rangeLabel } from '../../src/utils/pagination'

describe('pageCount', () => {
  it('counts whole and partial pages', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(1, 50)).toBe(1)
    expect(pageCount(50, 50)).toBe(1)
    expect(pageCount(51, 50)).toBe(2)
    expect(pageCount(150, 50)).toBe(3)
  })

  // An empty list still has a page 1. Returning 0 makes every clamp below it
  // produce page 0, which asks the database for rows -50 to -1.
  it('never returns less than one page', () => {
    expect(pageCount(0, 50)).toBe(1)
    expect(pageCount(-10, 50)).toBe(1)
  })

  it('survives a missing or nonsense total, which is what a failed count is', () => {
    expect(pageCount(null, 50)).toBe(1)
    expect(pageCount(undefined, 50)).toBe(1)
    expect(pageCount(Number.NaN, 50)).toBe(1)
  })
})

describe('clampPage', () => {
  it('keeps a page inside the list', () => {
    expect(clampPage(1, 150, 50)).toBe(1)
    expect(clampPage(3, 150, 50)).toBe(3)
  })

  // The concrete case: you are on page 3, you type a search that matches four
  // people, and page 3 of one page does not exist. Without this the list is
  // empty and looks like "no results".
  it('pulls a page past the end back to the last real one', () => {
    expect(clampPage(9, 150, 50)).toBe(3)
    expect(clampPage(9, 0, 50)).toBe(1)
  })

  it('refuses page zero and below', () => {
    expect(clampPage(0, 150, 50)).toBe(1)
    expect(clampPage(-4, 150, 50)).toBe(1)
    expect(clampPage(Number.NaN, 150, 50)).toBe(1)
  })
})

describe('rangeFor', () => {
  // PostgREST's range is inclusive at BOTH ends. 0–49 is fifty rows.
  it('produces inclusive bounds of exactly one page', () => {
    expect(rangeFor(1, 50)).toEqual({ from: 0, to: 49 })
    expect(rangeFor(2, 50)).toEqual({ from: 50, to: 99 })
    expect(rangeFor(3, 50)).toEqual({ from: 100, to: 149 })
  })

  it('starts at zero for any page below one', () => {
    expect(rangeFor(0, 50)).toEqual({ from: 0, to: 49 })
    expect(rangeFor(Number.NaN, 50)).toEqual({ from: 0, to: 49 })
  })
})

describe('rangeLabel', () => {
  it('describes the slice actually on screen', () => {
    expect(rangeLabel(1, 50, 137)).toBe('1–50 of 137')
    expect(rangeLabel(3, 50, 137)).toBe('101–137 of 137')
  })

  it('says nothing rather than "1–0 of 0" for an empty list', () => {
    expect(rangeLabel(1, 50, 0)).toBe('')
  })

  it('never claims more rows than there are', () => {
    expect(rangeLabel(1, 50, 12)).toBe('1–12 of 12')
  })
})

describe('pageNumbers', () => {
  it('lists every page while they fit', () => {
    expect(pageNumbers(1, 150, 50)).toEqual([1, 2, 3])
  })

  it('always offers the first and last page, whatever is in between', () => {
    const slots = pageNumbers(10, 1000, 50) // 20 pages
    expect(slots[0]).toBe(1)
    expect(slots[slots.length - 1]).toBe(20)
    expect(slots).toContain(10)
  })

  it('marks the elided stretches, so the pager cannot claim pages that are not there', () => {
    expect(pageNumbers(10, 1000, 50)).toEqual([1, '…', 9, 10, 11, '…', 20])
  })

  it('does not elide a single missing page — the gap costs more than the number', () => {
    // 6 pages, current 3: 1 2 3 4 … 6 would elide only page 5.
    expect(pageNumbers(3, 300, 50)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps the window inside the list at both ends', () => {
    expect(pageNumbers(1, 1000, 50)).toEqual([1, 2, 3, '…', 20])
    expect(pageNumbers(20, 1000, 50)).toEqual([1, '…', 18, 19, 20])
  })

  it('is a single page when there is nothing to page through', () => {
    expect(pageNumbers(1, 0, 50)).toEqual([1])
  })
})
