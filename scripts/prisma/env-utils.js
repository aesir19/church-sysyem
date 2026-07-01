export function isSupabasePoolerUrl(connectionString) {
  if (!connectionString) return false

  return (
    connectionString.includes('pooler.supabase.com') ||
    connectionString.includes(':6543')
  )
}

export function hasUnencodedAtInCredentials(connectionString) {
  if (!connectionString || !connectionString.includes('://')) return false

  const withoutProtocol = connectionString.split('://')[1]
  if (!withoutProtocol) return false

  const atIndex = withoutProtocol.lastIndexOf('@')
  if (atIndex === -1) return false

  const credentials = withoutProtocol.slice(0, atIndex)

  // A literal @ inside credentials should be URL-encoded as %40.
  return credentials.includes('@')
}

export function validatePrismaEnv(env, mode = 'pull') {
  const errors = []
  const warnings = []

  const databaseUrl = env.DATABASE_URL
  const directUrl = env.DIRECT_URL

  if (!databaseUrl) {
    errors.push('DATABASE_URL is required. Set it to your Supabase Postgres connection string.')
  } else if (hasUnencodedAtInCredentials(databaseUrl)) {
    errors.push(
      'DATABASE_URL contains an unencoded @ in username/password. Encode it as %40 in the connection string.'
    )
  }

  if (directUrl && hasUnencodedAtInCredentials(directUrl)) {
    errors.push(
      'DIRECT_URL contains an unencoded @ in username/password. Encode it as %40 in the connection string.'
    )
  }

  if (mode === 'migrate') {
    if (!directUrl) {
      errors.push(
        'DIRECT_URL is required for migrations. Use the non-pooling Supabase Postgres URL (usually port 5432).'
      )
    } else if (isSupabasePoolerUrl(directUrl)) {
      warnings.push(
        'DIRECT_URL appears to use Supabase pooler. This can work (session mode on port 5432), but if migrations fail prefer the direct db.<project-ref>.supabase.co:5432 URL.'
      )
    }
  }

  if (databaseUrl && isSupabasePoolerUrl(databaseUrl) && mode === 'migrate' && !directUrl) {
    warnings.push(
      'DATABASE_URL looks like a pooled connection. Keep DATABASE_URL pooled for app traffic, but set DIRECT_URL to a direct connection for Prisma migrations.'
    )
  }

  return { errors, warnings }
}
