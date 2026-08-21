import { supabase } from '../supabase'

// Reads for the Overview screen.
//
// ONE ROUND-TRIP PER INTENT. The member figures and the recent-services chart
// each come from a single database function (0029) rather than a fan-out of
// PostgREST calls. This screen used to fire ~19 round-trips — three member
// counts, four needs-attention queries, and one attendance COUNT per service —
// and on free-tier Nano compute each round-trip pays full network latency, so
// the fan-out, not egress, was the cost. The functions fold that work server-side.
//
// It also fixes a correctness gap: the counts were plain SELECTs on `members`,
// subject to the members SELECT policy (can_see_member_detail). A Welcome Team
// account fails that check, so every tile read 0 while the Members page — reading
// through the SECURITY DEFINER directory_search() — showed a full roster.
// overview_member_stats() is the matching definer-scoped read, so the two agree.
//
// Everything stays church-scoped explicitly. RLS returns every church to a
// SuperAdmin or Head Pastor, so the app does the scoping — see useActiveChurch.

function isoDate (d) {
  return d.toISOString().slice(0, 10)
}

/**
 * Every member-derived Overview figure — active/archived/joined-this-month plus
 * the three "Needs attention" counts — in one call. Returned as a single row by
 * overview_member_stats(), which is church-scoped and gated by
 * has_directory_access() (a scopeless account gets zeros).
 */
export async function fetchOverviewStats (churchId) {
  const { data, error } = await supabase
    .rpc('overview_member_stats', { p_church_id: churchId })
    .maybeSingle()
  if (error) throw error
  const r = data || {}
  return {
    active: r.active ?? 0,
    archived: r.archived ?? 0,
    joinedThisMonth: r.joined_this_month ?? 0,
    noOneToOne: r.no_one_to_one ?? 0,
    notBaptized: r.not_baptized ?? 0,
    inNoGroup: r.in_no_group ?? 0
  }
}

/** The last `limit` services with a present-count each, oldest first. */
export async function fetchRecentServices (churchId, limit = 10) {
  const { data, error } = await supabase
    .rpc('overview_recent_services', { p_church_id: churchId, p_limit: limit })
  if (error) throw error

  // The function returns newest-first (LIMIT wants an order); the chart reads
  // left-to-right oldest-first.
  return (data || []).slice().reverse().map(s => ({
    id: s.id,
    label: s.label,
    service_date: s.service_date,
    present: s.present ?? 0
  }))
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
