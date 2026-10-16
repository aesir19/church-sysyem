import { describe, it, expect } from 'vitest'
import { overviewMode, readOverviewChoice, saveOverviewChoice } from '../../src/utils/overviewMode'
import { deriveCapabilities } from '../../src/utils/capabilities'

const caps = p => deriveCapabilities({ role: 'member', ...p })

describe('overviewMode', () => {
  it('gives a leader with no other role the D-Group view only', () => {
    expect(overviewMode(caps({ is_small_group_leader: true }))).toBe('leader')
  })

  it.each(['is_super_admin', 'is_head_pastor', 'is_pastor', 'is_church_leader', 'is_finance', 'is_secretariat', 'is_welcome', 'is_events_team'])(
    'gives a leader who is also %s the switch', flag => {
      expect(overviewMode(caps({ is_small_group_leader: true, [flag]: true }))).toBe('switch')
    })

  it('leaves everyone who leads no group on the church Overview', () => {
    expect(overviewMode(caps({ is_pastor: true }))).toBe('church')
    expect(overviewMode(caps({}))).toBe('church')
  })
})

describe('the remembered switch choice', () => {
  const memory = () => {
    const m = new Map()
    return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }
  }

  it('opens on Church until a choice is made, then remembers it', () => {
    const store = memory()
    expect(readOverviewChoice(store)).toBe('church')
    saveOverviewChoice('dgroup', store)
    expect(readOverviewChoice(store)).toBe('dgroup')
  })

  it('ignores junk and unavailable storage', () => {
    const store = memory()
    store.setItem('udfc.overview.view', 'admin')
    expect(readOverviewChoice(store)).toBe('church')
    const broken = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }
    expect(readOverviewChoice(broken)).toBe('church')
    expect(() => saveOverviewChoice('dgroup', broken)).not.toThrow()
  })
})
