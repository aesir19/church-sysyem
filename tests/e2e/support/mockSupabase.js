import { buildSession } from './session.js'

// A network double for the Supabase client, installed with page.route().
//
// The dashboard talks to Supabase over two APIs: PostgREST (`/rest/v1/...`) for
// tables and RPCs, and GoTrue (`/auth/v1/...`) for auth. This answers both from
// in-memory fixtures instead of a real project — which is what keeps the E2E
// suite deterministic, free of member PII, and free to run in CI (rules 1 & 2).
//
// It is deliberately a THIN emulation of PostgREST — enough to drive a screen,
// not a database. It does not evaluate the `?col=eq.x` filters in the query
// string; a test hands over exactly the rows a table should return and owns that
// correctness itself. Config:
//
//   user           the signed-in user GoTrue's /user endpoint returns
//   rpc[name]      body for POST /rest/v1/rpc/<name>   — a value, or (ctx) => value
//   tables[name]   rows for GET  /rest/v1/<name>       — an array, or (ctx) => array
//   onWrite(ctx)   body for a POST/PATCH/DELETE on a table (see defaultWrite)
//
// Anything not configured returns an empty, successful result: the safe
// direction for a read, and visible on screen as "nothing there" rather than a
// hang or an error.

const REST_TABLE = /\/rest\/v1\/([^/?]+)/
const REST_RPC = /\/rest\/v1\/rpc\/([^/?]+)/

function safeJson(request) {
  try {
    return request.postDataJSON()
  } catch {
    return null
  }
}

function resolve(value, ctx) {
  return typeof value === 'function' ? value(ctx) : value
}

// PostgREST returns an array for a normal select and a bare object when the
// caller asked for one row (`.single()` / `.maybeSingle()`), which it signals
// with this Accept type. Honouring it keeps the two cardinalities correct for
// every caller without the test having to say which it used.
function wantsSingleObject(request) {
  return (request.headers()['accept'] || '').includes('application/vnd.pgrst.object+json')
}

// The default a write returns when a test does not override onWrite. `write()`
// in src/lib/data/write.js only needs at least one row back to treat a mutation
// as succeeded, so echoing the request body (with an id) satisfies the happy
// path. Tests that consume the returned row — e.g. the linked attendance row
// that repaints the roster — pass their own onWrite.
function defaultWrite({ method, body }) {
  if (method === 'DELETE') return [{ id: 'deleted' }]
  const row = body && typeof body === 'object' ? body : {}
  return [{ id: 'written', ...row }]
}

export async function installSupabaseMock(page, config = {}) {
  const { user = null, rpc = {}, tables = {}, onWrite } = config

  // The router gates every /dashboard route on isAccountLinked() — a
  // `user_accounts` lookup by the signed-in user's id (src/router/index.js).
  // A signed-in user is, by definition, linked here, so default that row in
  // rather than make every module's scenario restate it. A test can still
  // override `tables.user_accounts` (e.g. [] ) to exercise the pending screen.
  const resolvedTables = { ...tables }
  if (user && resolvedTables.user_accounts === undefined) {
    resolvedTables.user_accounts = [{ id: user.id }]
  }

  await page.route('**/auth/v1/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/token')) {
      // Password sign-in and refresh both land here; both want a session back.
      return route.fulfill({ json: buildSession(user || undefined) })
    }
    if (url.includes('/user')) {
      // getUser() re-validates against the server on every call.
      return route.fulfill({ json: user || {} })
    }
    if (url.includes('/logout')) {
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill({ json: {} })
  })

  await page.route('**/rest/v1/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const url = new URL(request.url())
    const path = url.pathname

    const rpcMatch = path.match(REST_RPC)
    if (rpcMatch) {
      const name = rpcMatch[1]
      const value = resolve(rpc[name], { request, url, body: safeJson(request) })
      return route.fulfill({ json: value ?? null })
    }

    const table = (path.match(REST_TABLE) || [])[1] || ''

    // head:true count request — supabase-js reads the total from Content-Range,
    // not from a body. The `*/N` form is valid even when N is 0.
    if (method === 'HEAD') {
      const rows = resolve(resolvedTables[table], { request, url }) || []
      return route.fulfill({
        status: 200,
        headers: { 'content-range': `*/${rows.length}` },
        body: '',
      })
    }

    if (method === 'GET') {
      const rows = resolve(resolvedTables[table], { request, url }) || []
      if (wantsSingleObject(request)) {
        return route.fulfill({ json: rows[0] ?? null })
      }
      // Include Content-Range so a `count: 'exact'` select (paginated lists like
      // members) reads a total back, not null. Harmless when no count was asked.
      const range = rows.length ? `0-${rows.length - 1}/${rows.length}` : `*/0`
      return route.fulfill({ json: rows, headers: { 'content-range': range } })
    }

    const body = safeJson(request)
    const result = onWrite
      ? await onWrite({ table, method, body, url, request })
      : defaultWrite({ method, body })
    return route.fulfill({ json: result })
  })
}
