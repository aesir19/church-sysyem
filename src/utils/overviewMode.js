// Which Overview a person gets (docs/specs/d-group-leader-view.md, "Who sees it").
//
//   'leader' — leads a D-Group and holds no other elevated role: the D-Group view only.
//   'switch' — leads a D-Group AND holds an elevated role: a Church | My D-Group switch.
//   'church' — leads no D-Group: the church Overview, unchanged.
//
// UI choice only. What the D-Group view shows is scoped in the database (0055).

const KEY = 'udfc.overview.view'
const CHOICES = ['church', 'dgroup']

export function overviewMode (caps) {
  if (!caps?.isDGroupLeader) return 'church'
  const elevated = caps.isSuperAdmin || caps.isHeadPastor || caps.isPastor || caps.isChurchLeader ||
    caps.isFinance || caps.isSecretariat || caps.isWelcome || caps.isEventsTeam
  return elevated ? 'switch' : 'leader'
}

function storage (store) {
  if (store) return store
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** The switch's last choice on this device; Church until one is made. */
export function readOverviewChoice (store) {
  try {
    const value = storage(store)?.getItem(KEY)
    return CHOICES.includes(value) ? value : 'church'
  } catch {
    return 'church'
  }
}

export function saveOverviewChoice (choice, store) {
  try { storage(store)?.setItem(KEY, choice) } catch { /* private mode or blocked storage */ }
}
