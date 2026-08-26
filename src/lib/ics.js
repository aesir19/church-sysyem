// ICS export — a calendar file generated entirely in the browser (frames 7k, 7s).
// Spec #87.
//
// NO SERVER, NO FEED (rule 1). This is the one-off download only: the whole month, or a
// single event, turned into an .ics the viewer's own calendar app imports. The
// subscription/feed link (7k's hosted udfc.app/cal/…ics) is deliberately out of scope —
// it needs an unauthenticated hosted endpoint. Everything here is a pure string builder;
// the view wraps the result in a Blob and hands it to a download.
//
// Times are emitted as UTC instants (the trailing Z form), which every calendar app reads
// correctly and which sidesteps shipping a VTIMEZONE block for Asia/Manila.

const PRODID = '-//UDFC Church Dashboard//Calendar//EN'

/** RFC 5545 text escaping: backslash, comma, semicolon, and newlines. */
function esc(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** A Date/ISO → the UTC basic format 20260612T093000Z. */
export function toIcsUtc(value) {
  const d = new Date(value)
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/** One event → a VEVENT block (array of lines). An event with no end uses start+1h so the
 *  imported entry has a sensible duration. `uid` is stable per event id so re-importing
 *  updates rather than duplicates. */
export function eventToVevent(event, { stamp } = {}) {
  const start = event.starts_at
  const end = event.ends_at || new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString()
  const lines = [
    'BEGIN:VEVENT',
    `UID:${event.id}@udfc`,
    `DTSTAMP:${toIcsUtc(stamp || new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${esc(event.title)}`,
  ]
  if (event.location) lines.push(`LOCATION:${esc(event.location)}`)
  if (event.description) lines.push(`DESCRIPTION:${esc(event.description)}`)
  if (event.status === 'cancelled') lines.push('STATUS:CANCELLED')
  lines.push('END:VEVENT')
  return lines
}

/**
 * Build a complete .ics document from one or more events. Events without a start
 * (dateless drafts) are skipped — a calendar file entry needs a time. Returns the file
 * text; the caller downloads it.
 */
export function buildIcs(events, { stamp } = {}) {
  const list = (Array.isArray(events) ? events : [events]).filter((e) => e && e.starts_at)
  const body = list.flatMap((e) => eventToVevent(e, { stamp }))
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    ...body,
    'END:VCALENDAR',
  ].join('\r\n')
}

/** A filesystem-safe .ics filename from a label (e.g. an event title or 'August-2026'). */
export function icsFilename(label) {
  const safe = String(label ?? 'calendar').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${safe || 'calendar'}.ics`
}
