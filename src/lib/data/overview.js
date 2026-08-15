import { supabase } from '../supabase'

// Reads for the Overview screen.
//
// EGRESS IS THE CONSTRAINT, NOT LATENCY. Every count here is issued with
// `head: true`, which asks PostgREST for the Content-Range header and NO rows.
// The alternative — selecting a column and counting client-side — would put
// roughly 1,800 attendance ids and 250 member ids on the wire on every visit to
// the app's landing page. Rule 1 is a monthly bandwidth number, so a handful of
// extra round-trips that each transfer nothing is the cheaper trade.
//
// Everything is church-scoped explicitly. RLS returns every church to a
// SuperAdmin or Head Pastor, so the app does the scoping — see useActiveChurch.

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

function isoDate (d) {
  return d.toISOString().slice(0, 10)
}

async function countOf (build) {
  const { count, error } = await build()
  if (error) throw error
  return count ?? 0
}

/**
 * Active and archived member counts, plus how many joined this calendar month —
 * the tiles carry a delta, not just a figure, and "+6 joined this month" is the
 * line that makes 254 mean something.
 */
export async function fetchMemberCounts (churchId) {
  const monthStart = isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1))

  const [active, archived, joinedThisMonth] = await Promise.all([
    countOf(() => supabase.from('members')
      .select('id', { count: 'exact', head: true })
      .eq('member_of', churchId).is('archived_at', null)),
    countOf(() => supabase.from('members')
      .select('id', { count: 'exact', head: true })
      .eq('member_of', churchId).not('archived_at', 'is', null)),
    countOf(() => supabase.from('members')
      .select('id', { count: 'exact', head: true })
      .eq('member_of', churchId).is('archived_at', null)
      .gte('date_joined', monthStart))
  ])
  return { active, archived, joinedThisMonth }
}

/**
 * The three "Needs attention" rows.
 *
 * "In no ministry or group" cannot be a count query: PostgREST has no NOT
 * EXISTS, and the relationship lives in a join table. It is derived from two id
 * lists instead — bounded by the roster size, and the only place on this screen
 * that transfers rows.
 */
export async function fetchNeedsAttention (churchId) {
  const cutoff = isoDate(new Date(Date.now() - NINETY_DAYS_MS))

  const [noOneToOne, notBaptized, memberIds, assignedIds] = await Promise.all([
    countOf(() => supabase.from('members')
      .select('id', { count: 'exact', head: true })
      .eq('member_of', churchId).is('archived_at', null)
      .eq('is_one_to_one_completed', false)
      .lt('date_joined', cutoff)),
    countOf(() => supabase.from('members')
      .select('id', { count: 'exact', head: true })
      .eq('member_of', churchId).is('archived_at', null)
      .eq('is_baptized', false)),
    supabase.from('members').select('id')
      .eq('member_of', churchId).is('archived_at', null)
      .then(r => (r.data || []).map(m => m.id)),
    // Both membership tables, since 0026 split them. Only the member ids matter
    // here — this tile asks "is this person in any group at all", and a person in
    // a ministry and a small group must not be counted as unassigned by one query
    // just because the other found them.
    Promise.all([
      supabase.from('ministry_members').select('member_id'),
      supabase.from('small_group_members').select('member_id')
    ]).then(([ministries, smallGroups]) => [
      ...(ministries.data || []).map(g => g.member_id),
      ...(smallGroups.data || []).map(g => g.member_id)
    ])
  ])

  const assigned = new Set(assignedIds)
  const inNoGroup = memberIds.filter(id => !assigned.has(id)).length

  return { noOneToOne, notBaptized, inNoGroup }
}

/** The last `limit` services with a present-count each, oldest first. */
export async function fetchRecentServices (churchId, limit = 10) {
  const { data, error } = await supabase
    .from('services')
    .select('id, label, service_date')
    .eq('church_id', churchId)
    .order('service_date', { ascending: false })
    .limit(limit)
  if (error) throw error

  const services = (data || []).slice().reverse()

  const counts = await Promise.all(
    services.map(s => countOf(() => supabase.from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', s.id)))
  )

  return services.map((s, i) => ({ ...s, present: counts[i] }))
}

/**
 * Collections total for a calendar month, read from the aggregate view rather
 * than by summing rows in the browser.
 */
export async function fetchMonthFunds (churchId, monthStart) {
  const start = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1)
  const end = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)

  const { data, error } = await supabase
    .from('collectives_service_totals')
    .select('tithes, offering, expenses, service_date')
    .eq('from_church', churchId)
    .gte('service_date', isoDate(start))
    .lt('service_date', isoDate(end))
  if (error) throw error

  return (data || []).reduce(
    (acc, row) => ({
      tithes: acc.tithes + Number(row.tithes || 0),
      offering: acc.offering + Number(row.offering || 0),
      expenses: acc.expenses + Number(row.expenses || 0),
      total: acc.total + Number(row.tithes || 0) + Number(row.offering || 0)
    }),
    { tithes: 0, offering: 0, expenses: 0, total: 0 }
  )
}

/** The service that is open right now, if any — drives the live banner. */
export async function fetchOpenService (churchId) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('services')
    .select('id, label, opens_at, closes_at')
    .eq('church_id', churchId)
    .lte('opens_at', now)
    .gte('closes_at', now)
    .order('opens_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data || null
}
