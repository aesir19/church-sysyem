// Refresh src/data/holidays.json from Nager.Date (MIT), a reliable open holiday source.
//
// WHY A BUILD SCRIPT AND NOT A RUNTIME CALL (Q13, rules 1 + 2). The app must never call a
// holiday API from a member's browser: it would put a third party in the path of a
// members-facing page, add an external dependency that can go paid or vanish, and leak who
// is viewing the calendar. So the network call happens HERE — once, when a release is cut —
// and the result is committed as a static file the app bundles. Run this before a release
// to roll the covered years forward:
//
//   node scripts/build-holidays.js            # current year-1 .. year+1
//   node scripts/build-holidays.js 2025 2028  # explicit inclusive range
//
// Nager gives public (regular) holidays; PH special non-working proclamations are not
// fully represented there, so everything it returns is typed 'regular'. A curated
// 'special' overlay can be layered later without changing the app — the file shape already
// carries a `type`. This is a deliberate v1 limitation, noted so it is not mistaken for
// completeness.

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'src', 'data', 'holidays.json')

const now = new Date().getFullYear()
const [argFrom, argTo] = process.argv.slice(2).map(Number)
const fromYear = argFrom || now - 1
const toYear = argTo || now + 1

async function fetchYear(year) {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/PH`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Nager.Date ${year} returned ${res.status}`)
  const rows = await res.json()
  return rows.map((r) => ({
    date: r.date,          // YYYY-MM-DD
    name: r.name || r.localName, // English name (r.name); localName is the Filipino form.
    type: 'regular',       // Nager exposes public holidays; special non-working is out of its scope.
  }))
}

async function main() {
  const all = []
  for (let y = fromYear; y <= toYear; y++) {
    process.stdout.write(`[holidays] fetching ${y}… `)
    const rows = await fetchYear(y)
    all.push(...rows)
    process.stdout.write(`${rows.length} holidays\n`)
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  await writeFile(OUT, JSON.stringify(all, null, 2) + '\n', 'utf8')
  console.log(`[holidays] wrote ${all.length} holidays (${fromYear}–${toYear}) to ${OUT}`)
}

main().catch((err) => {
  console.error(`[holidays] failed: ${err.message}`)
  process.exit(1)
})
