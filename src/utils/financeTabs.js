// The Finance workspace's three tabs, and who may see which.
//
// Collections, Expenses and the Funds Report used to be three sidebar items in the
// flat nine (see 9 - Finance.dc.html: "three sidebar items become one"). They are now
// one "Finance" destination with a three-way switch inside it. This module holds the
// switch's logic as pure functions so the gating is unit-tested apart from the view.
//
// THE GATE IS THE SAME ONE THE THREE SCREENS ALWAYS CARRIED. Collections and Expenses
// need canWriteFinance (SuperAdmin / Finance ministry); the Report needs only
// canViewFinance (adds the oversight three — Head Pastor, Pastor, Church Leader). Since
// canWriteFinance is a strict subset of canViewFinance, everyone who reaches the Finance
// item can see the Report, and only finance staff also get the two entry forms. A
// view-only caller sees a single tab, not two they cannot use — matching the
// hidden-not-locked rule the nav already follows (docs/decisions/0016-hide-out-of-scope-nav.md).

export const FINANCE_TABS = [
  {
    key: 'collections',
    label: 'Collections',
    sub: 'Tithes and offering, entered per service date',
    needs: 'canWriteFinance',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    sub: 'Charged against the church share of the allocation',
    needs: 'canWriteFinance',
  },
  {
    // "Funds Report", not the handoff's bare "Report", at the owner's direction.
    key: 'report',
    label: 'Funds Report',
    sub: 'The monthly collectives report',
    needs: null,
  },
]

// The tabs a caller may actually open, in fixed order. An item with a `needs` key it
// fails is dropped; the ungated Report is always present for anyone who got this far.
export function visibleFinanceTabs(caps) {
  const c = caps || {}
  return FINANCE_TABS.filter((tab) => !tab.needs || c[tab.needs])
}

// Where "Finance" lands when no tab is named: the entry form for staff who record,
// the report for the oversight roles who only read.
export function financeLandingTab(caps) {
  return (caps && caps.canWriteFinance) ? 'collections' : 'report'
}

// Resolve a requested tab key (from the URL) against what the caller may see. An
// unknown key, or one the caller lacks the capability for, falls back to the landing
// tab — so a view-only caller who deep-links /finance/collections is redirected to the
// report rather than shown an entry form the database would refuse to accept.
export function resolveFinanceTab(requested, caps) {
  const allowed = visibleFinanceTabs(caps).map((tab) => tab.key)
  return allowed.includes(requested) ? requested : financeLandingTab(caps)
}
