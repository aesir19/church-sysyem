import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn(() => ({ mockClient: true })))

vi.mock('@supabase/supabase-js', () => ({
  createClient,
}))

describe('supabase client bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('throws when required env vars are missing', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')

    await expect(import('../../src/lib/supabase.js')).rejects.toThrow(
      'Supabase Connection Error: Missing environment variables. Contact Administrator.'
    )
    expect(createClient).not.toHaveBeenCalled()
  })

  it('creates a singleton client when env vars are present', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')

    const module = await import('../../src/lib/supabase.js')

    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'anon-key')
    expect(module.supabase).toEqual({ mockClient: true })
  })
})
