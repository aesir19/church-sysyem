// Database-level test harness. These tests talk to a real Postgres and assert what
// RLS actually does, which is the only place authorization is enforced (ADR-0001).
//
// WHY THIS EXISTS
// Every other suite in this repo mocks `supabase`. That is right for testing the app's
// own logic, and useless for testing a policy: a mock answers whatever it was told to.
// The split of `groups` into two tables (#74) rewrites every policy protecting member
// PII, and the 584 mocked tests cannot see a permission widening. These can.
//
// HOW A TEST RUNS
// Each test opens one transaction, builds its own church / members / groups inside it,
// switches to the `authenticated` role with a chosen account's claims, asserts, and
// then ROLLS BACK. Consequences:
//
//   * Nothing is ever written. The suite can be pointed at staging without seeding it,
//     and a failed run leaves no wreckage to clean up.
//   * No standing test logins and no credentials in the repo — principals are created
//     per test and cease to exist with the rollback. `auth.users` needs only an id.
//   * Tests are order-independent and can be read on their own, because each one
//     states its whole world.
//
// The connection uses DIRECT_URL, not DATABASE_URL. The pooler runs in transaction
// mode and hands out a different backend per transaction, which breaks `SET LOCAL`
// and interactive transactions — the same reason scripts/prisma/db-execute.js exists.
//
// ON DEMAND, NOT IN CI. Rule 1 makes CI minutes a cost. `npm run test:db` runs this
// directory against .env.staging; `npm test` never does.
//
// THE OPT-IN IS A SAFETY GATE, NOT A CONVENIENCE. It would be easier to run whenever a
// connection string happens to be present, and that is precisely the hole
// scripts/prisma/with-env-file.js was written to close: dotenv never overwrites a
// variable already in process.env, so an exported DATABASE_URL wins over every env
// file, and "realistically, that is production". vitest.config.js globs
// `tests/**/*.test.js`, so this directory is in the default suite — keyed on the
// presence of a URL alone, a developer with DATABASE_URL exported would have had
// `npm test` create auth users and rename the Finance ministry on production. Rolled
// back, but holding locks on production and one defect away from not rolling back.
// Fail closed (rule 2): run only when someone deliberately asked, via `npm run test:db`.

import { PrismaClient } from '@prisma/client'

// Set by the test:db script and by nothing else. Ambient environment cannot turn this
// suite on.
const requested = process.env.RUN_DB_TESTS === '1'

// DIRECT_URL specifically, with no fallback to DATABASE_URL. The pooler runs in
// transaction mode and hands out a different backend per transaction, which breaks
// `SET LOCAL` — and it breaks it *quietly*, as tests that fail for reasons having
// nothing to do with the policy they name. Better to refuse to start.
const url = process.env.DIRECT_URL

if (requested && !url) {
  throw new Error(
    'RUN_DB_TESTS=1 but DIRECT_URL is not set. Run `npm run test:db`, which supplies it ' +
    'from .env.staging. Refusing to start rather than reporting a pass for a suite that ' +
    'asserted nothing.'
  )
}

if (requested) {
  // The same confirmation line with-env-file.js prints, for the same reason: which
  // database is about to be touched should be visible, not inferred. Host only, never
  // the credentials — split on the LAST '@', since Supabase passwords routinely
  // contain an unencoded one.
  const host = url.slice(url.lastIndexOf('@') + 1).match(/^([^:/?]+)/)?.[1] ?? '(unparseable)'
  console.log(`[test:db] running against database host: ${host}`)
}

/**
 * Skip gate. `describe.skipIf(!hasDatabase())` keeps `npm test` green and, more to the
 * point, keeps it away from whatever database happens to be in the ambient environment.
 */
export function hasDatabase () {
  return requested && !!url
}

let client = null

function prisma () {
  if (!client) client = new PrismaClient({ datasourceUrl: url })
  return client
}

export async function disconnect () {
  if (client) {
    await client.$disconnect()
    client = null
  }
}

// Thrown to unwind the transaction once assertions are done. Carries no message a
// reader could mistake for a real failure.
const ROLLBACK = Symbol('rollback')

/**
 * Run `fn` inside a transaction that is always rolled back.
 *
 * `fn` receives a `tx` whose helpers are attached by fixtures.js. An assertion
 * failure propagates as itself; the rollback still happens, because it happens on
 * any throw.
 */
export async function withRollback (fn) {
  let assertionError = null

  try {
    await prisma().$transaction(
      async tx => {
        try {
          await fn(tx)
        } catch (error) {
          assertionError = error
        }
        // Unconditional: a passing test must roll back too.
        throw ROLLBACK
      },
      // Generous but bounded. A fixture world plus a handful of statements is well
      // inside this; a hang should fail the test rather than the suite.
      { timeout: 30_000, maxWait: 10_000 }
    )
  } catch (error) {
    if (error !== ROLLBACK) throw error
  }

  if (assertionError) throw assertionError
}

/**
 * Become `authenticated`, carrying this account's claims.
 *
 * Everything after this call is subject to RLS. The owner role that Prisma connects
 * as is the table owner and would otherwise bypass every policy — which would make
 * the whole suite pass vacuously, so this is the load-bearing line.
 *
 * auth.uid() reads request.jwt.claims->>'sub'; setting it is exactly what a real JWT
 * does. SET LOCAL means it dies with the transaction.
 */
export async function asPrincipal (tx, accountId) {
  await tx.$queryRawUnsafe(
    `SELECT set_config('request.jwt.claims', $1, true)`,
    JSON.stringify({ sub: accountId, role: 'authenticated' })
  )
  await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated')
}

/** A signed-in request carrying no account at all — the fail-closed baseline. */
export async function asAnonymousAuthenticated (tx) {
  await tx.$queryRawUnsafe(`SELECT set_config('request.jwt.claims', '', true)`)
  await tx.$executeRawUnsafe('SET LOCAL ROLE authenticated')
}

/**
 * The public role — nobody signed in at all.
 *
 * Distinct from asAnonymousAuthenticated, and the difference is the point: `anon` is a
 * different Postgres role with different grants, so a policy that correctly returns
 * nothing to a claimless `authenticated` request says nothing about what `anon` can
 * reach. 0009 exists because revoking from PUBLIC does not remove anon's default
 * EXECUTE, so this is a mistake the repo has already made once.
 */
export async function asAnon (tx) {
  await tx.$queryRawUnsafe(`SELECT set_config('request.jwt.claims', '', true)`)
  await tx.$executeRawUnsafe('SET LOCAL ROLE anon')
}

/** Back to the owner, so a test can build more fixtures after asserting as a role. */
export async function asOwner (tx) {
  await tx.$executeRawUnsafe('RESET ROLE')
  await tx.$queryRawUnsafe(`SELECT set_config('request.jwt.claims', '', true)`)
}

/**
 * Assert a statement is refused, and return the message so a test can be specific
 * about *why*.
 *
 * Reads are not refused — RLS filters them to nothing — so this is for writes. A
 * statement that unexpectedly succeeds fails loudly rather than silently passing,
 * which is the failure mode that matters in a permissions suite.
 *
 * THE SAVEPOINT IS NOT OPTIONAL. Postgres aborts the whole transaction on any error,
 * and every later statement then fails with 25P02 regardless of what it asked for.
 * Without this, a test could only ever assert one refusal, and — worse — a refusal
 * followed by an assertion that something IS permitted would fail for the wrong
 * reason, which is exactly the shape of the Finance carve-out test.
 */
export async function refusalMessage (tx, fn) {
  const savepoint = `sp_${Math.random().toString(36).slice(2, 10)}`
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`)

  try {
    await fn()
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    return String(error.message || error)
  }

  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`)
  throw new Error('expected the statement to be refused, but it succeeded')
}

/** True when the refusal came from RLS or a column grant rather than a bad statement. */
export function isAuthorizationFailure (message) {
  return /row-level security|permission denied|not authorized|42501/i.test(message)
}
