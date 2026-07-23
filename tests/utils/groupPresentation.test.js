import { describe, expect, it } from 'vitest'
import {
  GROUP_COLOR_SLOT_CAPACITY,
  getGroupAccentColor,
  getGroupAccentStyle,
  normalizeGroupColorSlot,
} from '../../src/utils/groupPresentation'

describe('group color-slot presentation', () => {
  it('normalizes valid, out-of-range, and malformed slots safely', () => {
    expect(normalizeGroupColorSlot(137)).toBe(137)
    expect(normalizeGroupColorSlot('137')).toBe(137)
    expect(normalizeGroupColorSlot(GROUP_COLOR_SLOT_CAPACITY)).toBe(0)
    expect(normalizeGroupColorSlot(-1)).toBe(GROUP_COLOR_SLOT_CAPACITY - 1)
    expect(normalizeGroupColorSlot(12.9)).toBe(12)
    expect(normalizeGroupColorSlot(null)).toBe(0)
    expect(normalizeGroupColorSlot('invalid')).toBe(0)
  })

  it('maps every saved slot to a distinct HSL color', () => {
    const colors = Array.from(
      { length: GROUP_COLOR_SLOT_CAPACITY },
      (_, slot) => getGroupAccentColor(slot)
    )

    expect(new Set(colors).size).toBe(GROUP_COLOR_SLOT_CAPACITY)
    expect(colors[0]).toBe('hsl(0 64% 30%)')
    expect(colors[1]).toBe('hsl(137 64% 30%)')
    expect(colors[360]).toBe('hsl(0 72% 30%)')
  })

  it('maps a slot to the card CSS custom property with a safe fallback', () => {
    expect(getGroupAccentStyle(2)).toEqual({ '--group-accent': 'hsl(274 64% 30%)' })
    expect(getGroupAccentStyle(undefined)).toEqual({ '--group-accent': 'hsl(0 64% 30%)' })
  })
})
