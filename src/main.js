import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import * as Sentry from '@sentry/vue'
import { scrubEvent, scrubBreadcrumb } from './utils/sentryScrub'
import './style.css'

const app = createApp(App)

// Unset in the Lighthouse CI build and in .env.staging by design: local staging
// sessions and CI builds must never report into the production Sentry project.
// See docs/STAGING.md.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  Sentry.init({
    app,
    dsn: sentryDsn,

    // ADR-0008 makes all of the following a condition of using Sentry at all —
    // this app stores member PII and several of these categories are collected
    // by DEFAULT. Do not relax one without revisiting that record.
    //
    // Vue attaches component props to render errors unless told not to, and in
    // this app a prop is routinely a whole member object.
    attachProps: false,
    // EVERY field is listed deliberately, including the ones that look
    // irrelevant to this app. Passing any `dataCollection` object at all
    // switches the SDK's base from its safe defaults to a fully-permissive
    // DEFAULTS set (verified in @sentry/core 10.69.0
    // resolveDataCollectionOptions.js), so an *omitted* field resolves to
    // `true` — the opposite of what omitting it looks like it means. An
    // incomplete list here is worse than none.
    dataCollection: {
      userInfo: false,
      cookies: false,
      // Requests to PostgREST carry `Authorization: Bearer <JWT>` — the session
      // token itself (ADR-0005). Response headers are off for symmetry.
      httpHeaders: { request: false, response: false },
      // A POST body to /rest/v1/members is a complete member record.
      httpBodies: [],
      // PostgREST puts row filters in the query string (`?first_name=eq.Juan`).
      urlQueryParams: false,
      // Read by the SDK's Supabase integration. Nothing registers that
      // integration today; this is here so that adding it later cannot start
      // shipping query values without a second, deliberate edit.
      databaseQueryData: false,
      // Local variables attached to stack frames — in this app a local is
      // routinely a member row.
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
}

app.use(router)
app.mount('#app')
