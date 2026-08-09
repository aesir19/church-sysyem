// Run a .sql file against DIRECT_URL rather than DATABASE_URL.
//
// WHY THIS EXISTS
// `prisma db execute` with only --file resolves the datasource's `url`, which is
// DATABASE_URL — Supabase's POOLED connection (port 6543). A pooler in
// transaction mode hands a different backend to each transaction, so anything
// session-scoped can vanish between statements. scripts/sql/seed-staging-attendance.sql
// depends on exactly that: it sets `request.jwt.claims` once at session scope so
// auth.uid() resolves for the provenance triggers, and every source='staff' row it
// inserts violates attendance_recorder_check the moment that setting is lost.
// DIRECT_URL (port 5432) bypasses the pooler, which is the same reason Prisma's own
// migrate commands use it.
//
// The redirect is done by overriding DATABASE_URL in the CHILD ENVIRONMENT rather
// than passing `--url`. Two reasons: npm scripts run under cmd.exe on Windows and
// sh elsewhere, so neither `%VAR%` nor `$VAR` expands in both; and a connection
// string on the command line lands in the process argument list, readable by any
// other local account. with-env-file.js passes credentials the same way, for the
// same reason.
//
// Usage: node scripts/prisma/db-execute.js <file.sql>

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'

const [file] = process.argv.slice(2)

if (!file) {
  console.error('[db-execute] usage: node scripts/prisma/db-execute.js <file.sql>')
  process.exit(1)
}

if (!existsSync(file)) {
  console.error(`[db-execute] error: ${file} not found.`)
  process.exit(1)
}

const url = process.env.DIRECT_URL

if (!url) {
  console.error(
    '[db-execute] error: DIRECT_URL is not set. Run this through scripts/prisma/with-env-file.js so the env file wins — see package.json.'
  )
  process.exit(1)
}

// Host only, never the credentials — the operator's confirmation of which database
// is about to be written to. Split on the LAST '@': Supabase passwords routinely
// contain an unencoded '@'.
const afterCredentials = url.slice(url.lastIndexOf('@') + 1)
const host = afterCredentials.match(/^([^:/?]+)/)?.[1] ?? '(unparseable)'
console.log(`[db-execute] ${file} -> direct connection, host: ${host}`)

// shell: true for the same reason with-env-file.js needs it — npx/prisma resolve to
// .cmd shims on Windows, which cannot be spawned without a shell since Node 18.20.
//
// prisma.config.js reads process.env.DATABASE_URL and the datasource is
// env("DATABASE_URL"), so overriding it here is what routes this off the pooler.
// dotenv never overwrites an already-set variable, so this wins over .env.
const child = spawn(`npx prisma db execute --file "${file}" --schema prisma/schema.prisma`, {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: url },
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', (err) => {
  console.error(`[db-execute] error: failed to run prisma db execute: ${err.message}`)
  process.exit(1)
})
