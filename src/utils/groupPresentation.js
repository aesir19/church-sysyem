export const GROUP_COLOR_SLOT_CAPACITY = 3240

const HUE_COUNT = 360
const HUE_STEP = 137
const SATURATION_BANDS = Object.freeze([64, 72, 80])
const LIGHTNESS_BANDS = Object.freeze([30, 35, 40])

export function normalizeGroupColorSlot(slot) {
  if (slot === '' || slot === null || slot === undefined) return 0

  const parsed = Number(slot)
  if (!Number.isFinite(parsed)) return 0

  const integer = Math.trunc(parsed)
  return ((integer % GROUP_COLOR_SLOT_CAPACITY) + GROUP_COLOR_SLOT_CAPACITY)
    % GROUP_COLOR_SLOT_CAPACITY
}

export function getGroupAccentColor(slot) {
  const normalized = normalizeGroupColorSlot(slot)
  const hue = (normalized * HUE_STEP) % HUE_COUNT
  const band = Math.floor(normalized / HUE_COUNT)
  const saturation = SATURATION_BANDS[band % SATURATION_BANDS.length]
  const lightness = LIGHTNESS_BANDS[Math.floor(band / SATURATION_BANDS.length)]

  return `hsl(${hue} ${saturation}% ${lightness}%)`
}

export function getGroupAccentStyle(slot) {
  return { '--group-accent': getGroupAccentColor(slot) }
}
