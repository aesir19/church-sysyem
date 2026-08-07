// Run a command with DATABASE_URL/DIRECT_URL forced to come from a named env
// file, then print the host that actually resolved.
//
// WHY THIS EXISTS
// `dotenv` never overwrites a variable that is already present in process.env.
// Pointing it at a different file (DOTENV_CONFIG_PATH) therefore does NOT make
// that file win — it only changes which file is consulted for variables that
// are still unset. So if DATABASE_URL is already exported in the shell, set as
// a Windows user/system variable, or injected by an IDE run-config, then
// `npm run prisma:migrate:deploy:staging` would quietly ignore .env.staging and
// migrate whatever that ambient value points at. Which, realistically, is
// production. There is no output difference when this happens: dotenv's
// "already defined, not overwritten" notice only appears with debug enabled.
//
// This wrapper closes that hole by loading the file with `override: true` and
// exporting the result to the child process, so the file always wins. It then
// echoes the resolved host, so targeting the wrong database is visible rather
// than inferred.
//
// Usage: node scripts/prisma/with-env-file.js <env-file> <command> [args...]

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import dotenv from 'dotenv'

const [envFile, ...command] = process.argv.slice(2)

if (!envFile || command.length === 0) {
  console.error('[prisma-env] usage: node scripts/prisma/with-env-file.js <env-file> <command> [args...]')
  process.exit(1)
}

if (!existsSync(envFile)) {
  console.error(`[prisma-env] error: ${envFile} not found. See docs/STAGING.md for the variables it needs.`)
  process.exit(1)
}

const { parsed, error } = dotenv.config({ path: envFile, override: true })

if (error) {
  console.error(`[prisma-env] error: could not read ${envFile}: ${error.message}`)
  process.exit(1)
}

for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (!parsed?.[key]) {
    console.error(`[prisma-env] error: ${envFile} does not define ${key}.`)
    process.exit(1)
  }
}

// Host only — never the credentials. This line is the operator's confirmation
// of which database is about to be touched, so it prints on every run.
// Split on the LAST '@': Supabase passwords routinely contain an unencoded '@',
// and matching the first one would print a fragment of the password instead of
// the host.
const afterCredentials = parsed.DATABASE_URL.slice(parsed.DATABASE_URL.lastIndexOf('@') + 1)
const host = afterCredentials.match(/^([^:/?]+)/)?.[1] ?? '(unparseable)'
console.log(`[prisma-env] using ${envFile} — database host: ${host}`)

// A shell is unavoidable here: `npm` on Windows is npm.cmd, and since Node
// 18.20 spawning a .cmd without a shell fails outright with EINVAL. Pass the
// command as ONE string rather than an args array — `shell: true` combined with
// an args array is deprecated (DEP0190) precisely because the args are
// concatenated unescaped, so building the string ourselves is the honest form of
// what would happen anyway. The command comes from this repo's package.json,
// never from user input.
const child = spawn(command.join(' '), {
  stdio: 'inherit',
  shell: true,
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', (err) => {
  console.error(`[prisma-env] error: failed to run "${command.join(' ')}": ${err.message}`)
  process.exit(1)
})
