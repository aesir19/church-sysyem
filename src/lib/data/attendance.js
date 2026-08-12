// Attendance reads that are not the roster.
//
// The roster itself still lives in AttendanceView — it is one query bound to one
// selected service and it has never been re-derived anywhere else. What is here
// is the chart's data, which is new with the redesign and is the one place the
// screen can quietly become expensive.

import { supabase } from '../supabase'

/**
 * Total attendance for each of the given services.
 *
 * ONE HEAD REQUEST PER SERVICE, run in parallel, rather than one request that
 * selects every row and counts them in the browser. Ten services at a Sunday
 * turnout of ~130 is ~1,300 rows of uuid to move across the wire on every visit
 * to this page; ten `head: true` counts move no rows at all — the number comes
 * back in the Content-Range header. Rule 1 is the reason: Supabase's free tier
 * is metered on egress, and this screen is opened repeatedly during a service.
 *
 * The fan-out is bounded by the caller's list, which is the ten services the
 * chart draws. Do not hand this an unbounded id list.
 *
 * A count that fails is LEFT OUT of the map rather than recorded as zero, so the
 * chart can draw it as unknown. See buildServiceBars.
 *
 * @param {{ serviceIds: string[] }} params
 * @returns {Promise<{ counts: Map<string, number>, failed: string[] }>}
 */
export async function countAttendanceByService ({ serviceIds }) {
  const ids = (Array.isArray(serviceIds) ? serviceIds : []).filter(Boolean)
  const counts = new Map()
  const failed = []

  if (!ids.length) return { counts, failed }

  const results = await Promise.all(
    ids.map((id) =>
      supabase
        .from('attendance')
        .select('id', { count: 'exact', head: true })
        .eq('service_id', id)
    )
  )

  results.forEach((result, index) => {
    // No church filter here, deliberately. `attendance` is scoped by service,
    // and a service belongs to exactly one church — RLS on both tables is what
    // stops another church's service being counted at all, and re-stating it
    // through an embed would turn each head request into a join for nothing.
    if (result.error || result.count === null || result.count === undefined) {
      failed.push(ids[index])
      return
    }
    counts.set(ids[index], result.count)
  })

  return { counts, failed }
}
