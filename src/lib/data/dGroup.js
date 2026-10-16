import { supabase } from '../supabase'

// Reads for the D-Group leader view (docs/specs/d-group-leader-view.md, Phase 1).
//
// ONE CALL. d_group_dashboard() (0055) returns the caller's led groups, their last four
// Sunday services and every member's attendance, serving and journey in one round
// trip, scoped in the database to the groups the caller leads. A non-leader gets empty
// lists, never an error — so "leads nothing" is an ordinary, permitted result here.
//
// summarizeDGroup() turns that into what the screen draws. It is pure so the rules the
// owner agreed — who to check on, what counts as this week — are tested without a
// database. All dates are Manila dates; "today" is passed in.

const MESSAGES = {
  loadFailed: 'Your D-Group could not be loaded. Please try again.'
}

const empty = { groups: [], services: [], members: [] }

export async function fetchDGroupDashboard () {
  const { data, error } = await supabase.rpc('d_group_dashboard')
  if (error) return { ok: false, message: MESSAGES.loadFailed, permitted: false, cause: error, ...empty }

  // Leading nothing is permitted too: the function answers with empty lists.
  const d = data || {}
  return {
    ok: true,
    message: '',
    permitted: true,
    cause: null,
    groups: (d.groups || []).map(g => ({ id: g.id, name: g.name, startedAt: g.started_at ?? null })),
    services: (d.services || []).map(s => ({ id: s.id, churchId: s.church_id, label: s.label, serviceDate: s.service_date })),
    members: (d.members || []).map(m => ({
      id: m.member_id,
      groupId: m.group_id,
      name: m.name,
      joinedAt: m.joined_at ?? null,
      birthMonth: m.birth_month,
      birthDay: m.birth_day,
      isBaptized: !!m.is_baptized,
      isOneToOneCompleted: !!m.is_one_to_one_completed,
      isTurningPointCompleted: !!m.is_turning_point_completed,
      attendance: (m.attendance || []).map(a => ({ serviceId: a.service_id, status: a.status })),
      servedRecent: m.served_recent ?? 0,
      servingThisWeek: (m.serving_this_week || []).map(x => ({ role: x.role, eventTitle: x.event_title, startsAt: x.starts_at }))
    }))
  }
}

const DAY = 86_400_000
const MANILA_OFFSET = 8 * 3_600_000
const NEW_JOINER_DAYS = 30
const STALE_AFTER_DAYS = 14

// The Manila calendar date of an instant, as YYYY-MM-DD.
function manilaDate (instant) {
  return new Date(new Date(instant).getTime() + MANILA_OFFSET).toISOString().slice(0, 10)
}

// A YYYY-MM-DD date moved by whole days. Dates only, so no timezone is involved.
function shiftDate (isoDate, days) {
  return new Date(Date.parse(isoDate) + days * DAY).toISOString().slice(0, 10)
}

const joinNames = names => names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * What the D-Group view draws, from a fetchDGroupDashboard() result.
 *
 * `rows` keeps one row per membership, each naming its own group. Everything that
 * counts PEOPLE — last Sunday, Check on, This week, progress — counts a member who sits
 * in two led groups once, using their longest membership (it decides which services
 * they were in the group for) and naming every group they share with the leader.
 *
 * @param {object} dashboard — a successful fetchDGroupDashboard() result
 * @param {{ now?: Date, groupId?: string|null }} options — groupId narrows to one group
 */
export function summarizeDGroup (dashboard, { now = new Date(), groupId = null } = {}) {
  const groupName = new Map(dashboard.groups.map(g => [g.id, g.name]))
  const serviceDate = new Map(dashboard.services.map(s => [s.id, s.serviceDate]))
  const today = manilaDate(now)
  const newJoinerSince = shiftDate(today, -NEW_JOINER_DAYS)

  const rows = dashboard.members
    .filter(m => !groupId || m.groupId === groupId)
    .map(m => ({
      ...m,
      groupName: groupName.get(m.groupId) || '',
      isNewJoiner: !!m.joinedAt && manilaDate(m.joinedAt) >= newJoinerSince
    }))

  // One entry per person: the longest membership (an unknown join date is the oldest).
  const byPerson = new Map()
  for (const row of rows) {
    const seen = byPerson.get(row.id)
    if (!seen) { byPerson.set(row.id, { ...row, groupNames: [row.groupName] }); continue }
    seen.groupNames.push(row.groupName)
    if (seen.joinedAt && (!row.joinedAt || row.joinedAt < seen.joinedAt)) {
      byPerson.set(row.id, { ...row, groupNames: seen.groupNames })
    }
  }
  const people = [...byPerson.values()].map(p => ({ ...p, groupName: joinNames(p.groupNames) }))
  const lastStatus = p => p.attendance.at(-1)?.status

  // Last Sunday: each person's latest service, counted only if they were in the group.
  let lastSunday = null
  if (dashboard.services.length && people.some(p => p.attendance.length)) {
    const inGroup = people.filter(p => p.attendance.length && lastStatus(p) !== 'not_in_group')
    lastSunday = {
      present: inGroup.filter(p => lastStatus(p) === 'present').length,
      of: inGroup.length,
      date: dashboard.services.map(s => s.serviceDate).sort().at(-1),
      notThere: inGroup.filter(p => lastStatus(p) === 'missed').map(p => p.name)
    }
  }

  // Check on: missed 2+ of the last four Sunday services held since they joined.
  const checkOn = people
    .map(p => ({
      id: p.id,
      name: p.name,
      groupName: p.groupName,
      missedDates: p.attendance.filter(a => a.status === 'missed').map(a => serviceDate.get(a.serviceId)).filter(Boolean)
    }))
    .filter(p => p.missedDates.length >= 2)
    .sort((a, b) => b.missedDates.at(-1).localeCompare(a.missedDates.at(-1)) || a.name.localeCompare(b.name))

  // This week: the Manila week (Monday–Sunday) holding today.
  const monday = shiftDate(today, -((new Date(today).getUTCDay() + 6) % 7))
  const sunday = shiftDate(monday, 6)
  const inWeek = date => date >= monday && date <= sunday

  const birthdays = []
  for (const p of people) {
    for (const year of new Set([monday.slice(0, 4), sunday.slice(0, 4)])) {
      const date = `${year}-${String(p.birthMonth).padStart(2, '0')}-${String(p.birthDay).padStart(2, '0')}`
      if (inWeek(date)) birthdays.push({ kind: 'birthday', id: p.id, name: p.name, groupName: p.groupName, date })
    }
  }
  // Upcoming only: serving from today on, not what already happened this week.
  const serving = people.flatMap(p => p.servingThisWeek
    .filter(x => manilaDate(x.startsAt) >= today)
    .map(x => ({ kind: 'serving', id: p.id, name: p.name, groupName: p.groupName, role: x.role, date: x.startsAt })))
  // A join belongs to a membership, so it names that group; one line per person.
  const latestJoin = new Map()
  for (const r of rows.filter(r => r.isNewJoiner)) {
    if (!latestJoin.has(r.id) || r.joinedAt > latestJoin.get(r.id).joinedAt) latestJoin.set(r.id, r)
  }
  const joined = [...latestJoin.values()].map(r => ({ kind: 'joined', id: r.id, name: r.name, groupName: r.groupName, date: r.joinedAt }))
  const byDate = (a, b) => a.date.localeCompare(b.date)

  // Attendance is only as fresh as the last service someone recorded. Past two weeks,
  // say so, rather than let "Check on" send a leader after months-old absences.
  const newestService = dashboard.services.map(s => s.serviceDate).sort().at(-1)
  const staleSince = newestService && newestService < shiftDate(today, -STALE_AFTER_DAYS) ? newestService : null

  return {
    staleSince,
    rows,
    lastSunday,
    checkOn,
    week: { from: monday, to: sunday },
    nextSunday: shiftDate(today, (7 - new Date(today).getUTCDay()) % 7),
    thisWeek: [...birthdays.sort(byDate), ...serving.sort(byDate), ...joined.sort(byDate)],
    progress: {
      total: people.length,
      baptized: people.filter(p => p.isBaptized).length,
      oneToOne: people.filter(p => p.isOneToOneCompleted).length,
      turningPoint: people.filter(p => p.isTurningPointCompleted).length
    }
  }
}
