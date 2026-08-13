// Run the database-level suite, with the opt-in flag set.
//
// WHY A SCRIPT RATHER THAN AN INLINE ENV ASSIGNMENT
// `RUN_DB_TESTS=1 vitest ...` in an npm script works on sh and fails on cmd.exe, and
// this repo is developed on Windows — the same portability reason
// scripts/prisma/with-env-file.js passes credentials through the child environment
// instead of the command line.
//
// The flag is what tests/db/helpers/database.js keys on. It exists so that the suite
// cannot be switched on by an ambient DATABASE_URL: vitest globs `tests/**/*.test.js`,
// so without a deliberate opt-in a developer with a connection string exported would
// have `npm test` writing to whatever it points at.

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Spawn vitest's ESM entrypoint with this same Node binary, rather than `npx vitest`.
// On Windows npx is npx.cmd, and since Node 18.20 spawning a .cmd without a shell fails
// with EINVAL — while `shell: true` plus an args array is deprecated (DEP0190) because
// the arguments get concatenated unescaped. Calling the .mjs directly sidesteps both:
// no shell, no quoting, no platform branch. with-env-file.js has to use a shell because
// it runs an arbitrary npm command; this does not.
const vitest = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))

const child = spawn(
  process.execPath,
  [vitest, 'run', 'tests/db', '--testTimeout=60000'],
  {
    stdio: 'inherit',
    // DATABASE_URL and DIRECT_URL have already been forced to come from .env.staging by
    // with-env-file.js, which also echoed the host.
    env: { ...process.env, RUN_DB_TESTS: '1' }
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', error => {
  console.error(`[test:db] error: failed to start vitest: ${error.message}`)
  process.exit(1)
})
