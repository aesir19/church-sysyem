// Fails the build when the VITE_* values baked into a production bundle are
// missing or malformed.
//
// This exists because the failure it catches is invisible until a user loads
// the site. Vite substitutes whatever it is given at build time, so a wrong
// value produces a perfectly successful build and a white screen in
// production — `src/lib/supabase.js` throws in the *browser*, which is far too
// late. A GitHub Actions `vars.*` reference to a variable that does not exist
// silently expands to an empty string, so a typo in the variable name looks
// identical to a correct setup right up until deploy.
//
// Run as a step before `npm run build` in the deploy job.

const errors = []
const warnings = []

// Printed on every run, pass or fail. Deliberately properties and never the
// value: a length or a boolean survives log masking, whereas the value itself
// is redacted to `***` and tells you nothing. Diagnosing a bad build from the
// deployed bundle instead of from here is guesswork — this is the evidence.
function describe(name) {
  const raw = process.env[name]
  if (raw === undefined) return `${name}: UNSET (variable does not exist)`
  const parts = [
    `len=${raw.length}`,
    `https=${raw.startsWith('https://')}`,
    `masked=${raw.includes('*')}`,
    `quoted=${/^["']|["']$/.test(raw)}`,
    `trimmed=${raw === raw.trim()}`,
  ]
  return `${name}: ${parts.join(' ')}`
}

console.log('[build-env] inputs seen by this build:')
for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_SENTRY_DSN']) {
  console.log(`  ${describe(name)}`)
}

function requirePresent(name) {
  const value = process.env[name]
  if (!value || !value.trim()) {
    errors.push(`${name} is missing or empty.`)
    return null
  }
  if (value !== value.trim()) {
    errors.push(`${name} has leading or trailing whitespace — check for a stray newline.`)
    return null
  }
  if (/^["']|["']$/.test(value)) {
    errors.push(`${name} is wrapped in quotes. Store the raw value, without quotes.`)
    return null
  }
  return value
}

const supabaseUrl = requirePresent('VITE_SUPABASE_URL')
if (supabaseUrl) {
  let parsed
  try {
    parsed = new URL(supabaseUrl)
  } catch {
    errors.push(
      `VITE_SUPABASE_URL is not a valid URL: "${supabaseUrl}". ` +
        'It must include the scheme, e.g. https://<project-ref>.supabase.co'
    )
  }
  if (parsed && parsed.protocol !== 'https:') {
    errors.push(`VITE_SUPABASE_URL must use https, got "${parsed.protocol}".`)
  }
}

const anonKey = requirePresent('VITE_SUPABASE_ANON_KEY')
if (anonKey && anonKey.startsWith('http')) {
  errors.push('VITE_SUPABASE_ANON_KEY looks like a URL — the URL and key are probably swapped.')
}

// Not fatal: an unset DSN disables Sentry by design (ADR-0008), which is
// correct for the Lighthouse build but almost certainly a mistake for a
// production deploy.
if (!process.env.VITE_SENTRY_DSN) {
  warnings.push('VITE_SENTRY_DSN is unset — this build will ship with Sentry disabled.')
}

for (const warning of warnings) {
  console.warn(`[build-env] warning: ${warning}`)
}

if (errors.length > 0) {
  console.error('[build-env] refusing to build:')
  for (const error of errors) console.error(`  - ${error}`)
  console.error(
    '\nThese come from GitHub Actions repository VARIABLES ' +
      '(Settings > Secrets and variables > Actions > Variables tab), not Secrets.'
  )
  process.exit(1)
}

// Host only — the anon key is public by design but there is no reason to print
// it into a build log.
console.log(`[build-env] ok — Supabase host: ${new URL(supabaseUrl).host}`)
