import { describe, expect, it } from 'vitest'
import {
  hasUnencodedAtInCredentials,
  isSupabasePoolerUrl,
  validatePrismaEnv,
} from '../../scripts/prisma/env-utils.js'

describe('isSupabasePoolerUrl', () => {
  it('returns true for supabase pooler host', () => {
    expect(isSupabasePoolerUrl('postgresql://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres')).toBe(true)
  })

  it('returns true for port 6543', () => {
    expect(isSupabasePoolerUrl('postgresql://user:pass@db.example.com:6543/postgres')).toBe(true)
  })

  it('returns false for direct host and port 5432', () => {
    expect(isSupabasePoolerUrl('postgresql://user:pass@db.supabase.co:5432/postgres')).toBe(false)
  })
})

describe('validatePrismaEnv', () => {
  it('requires DATABASE_URL for pull mode', () => {
    const result = validatePrismaEnv({}, 'pull')

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/DATABASE_URL is required/i)
  })

  it('requires DIRECT_URL for migrate mode', () => {
    const result = validatePrismaEnv(
      {
        DATABASE_URL: 'postgresql://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
      },
      'migrate'
    )

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/DIRECT_URL is required/i)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('warns if migrate direct URL appears pooled', () => {
    const result = validatePrismaEnv(
      {
        DATABASE_URL: 'postgresql://user:pass@db.supabase.co:5432/postgres',
        DIRECT_URL: 'postgresql://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
      },
      'migrate'
    )

    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toMatch(/DIRECT_URL appears to use Supabase pooler/i)
  })

  it('passes migrate mode with direct URL', () => {
    const result = validatePrismaEnv(
      {
        DATABASE_URL: 'postgresql://user:pass@aws-1-us-east-1.pooler.supabase.com:6543/postgres',
        DIRECT_URL: 'postgresql://user:pass@db.supabase.co:5432/postgres',
      },
      'migrate'
    )

    expect(result.errors).toHaveLength(0)
  })

  it('errors when URL has unencoded @ in credentials', () => {
    const result = validatePrismaEnv(
      {
        DATABASE_URL: 'postgresql://user:pass@word@db.supabase.co:5432/postgres',
        DIRECT_URL: 'postgresql://user:pass@db.supabase.co:5432/postgres',
      },
      'pull'
    )

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/unencoded @/i)
  })
})

describe('hasUnencodedAtInCredentials', () => {
  it('returns true when credentials contain raw @', () => {
    expect(hasUnencodedAtInCredentials('postgresql://user:pa@ss@db.supabase.co:5432/postgres')).toBe(true)
  })

  it('returns false when @ is URL-encoded', () => {
    expect(hasUnencodedAtInCredentials('postgresql://user:pa%40ss@db.supabase.co:5432/postgres')).toBe(false)
  })
})
