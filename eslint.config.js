import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

// ── The write-seam rule ──────────────────────────────────────────────────────
//
// PostgREST enforces RLS by FILTERING, not by raising. An UPDATE or DELETE whose
// USING clause excludes the target row returns { error: null, data: [] } — which
// reads as success. Nine of nineteen write sites in this app got that wrong and
// three reported a refused write to the user as saved.
//
// src/lib/data/write.js closes that by owning the `.select()` and the row count.
// This rule is what stops the hole being reopened: convention already failed once.
//
// Why a custom rule rather than `no-restricted-syntax`: views still CONSTRUCT the
// builder and hand it to write(), so the mutation call appears in correct code
// too. The filter chain (`.eq().eq()`) sits between the mutation and its argument
// position, so no stock selector separates
//
//   await write(supabase.from('g').update(p).eq('id', x), {...})   ← correct
//   await supabase.from('g').update(p).eq('id', x)                 ← the bug
//
// This walks the chain instead: flag a mutation whose receiver roots at
// `supabase.from(...)` unless it is lexically inside a `write(...)` argument.

/**
 * Re-emit a shared config with every rule at `warn`.
 *
 * Exactly one rule in this repo gates CI — the write-seam rule below. The
 * recommended sets are a 1,400-finding backlog across code that had never been
 * linted, and gating on them would block changes that have nothing to do with
 * them. Promote by dropping this wrapper, once the backlog is worked.
 */
function demoteToWarnings(config) {
  return {
    ...config,
    rules: Object.fromEntries(Object.keys(config.rules ?? {}).map((rule) => [rule, 'warn'])),
  }
}

const MUTATION_METHODS = new Set(['insert', 'update', 'delete', 'upsert'])

/** Does this expression chain bottom out at `supabase.from(...)`? */
function rootsAtSupabaseFrom(node) {
  let current = node
  while (current) {
    if (
      current.type === 'CallExpression' &&
      current.callee.type === 'MemberExpression' &&
      current.callee.property.name === 'from' &&
      current.callee.object.type === 'Identifier' &&
      current.callee.object.name === 'supabase'
    ) {
      return true
    }
    if (current.type === 'CallExpression') current = current.callee
    else if (current.type === 'MemberExpression') current = current.object
    else return false
  }
  return false
}

const writeSeamPlugin = {
  rules: {
    'writes-through-seam': {
      meta: {
        type: 'problem',
        docs: { description: 'PostgREST mutations must go through the write seam' },
        schema: [],
        messages: {
          unwrapped:
            "This .{{method}}() must be passed to write() from src/lib/data/write.js. PostgREST enforces RLS by filtering, so an unwrapped mutation reports a write the database refused as a success.",
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee
            if (callee.type !== 'MemberExpression') return
            if (!MUTATION_METHODS.has(callee.property.name)) return
            if (!rootsAtSupabaseFrom(callee.object)) return

            // Walk up. If we reach a `write(...)` call with the subtree we came
            // from sitting in its arguments, this mutation is wrapped.
            let child = node
            let parent = node.parent
            while (parent) {
              if (
                parent.type === 'CallExpression' &&
                parent.callee.type === 'Identifier' &&
                parent.callee.name === 'write' &&
                parent.arguments.includes(child)
              ) {
                return
              }
              child = parent
              parent = parent.parent
            }

            context.report({
              node,
              messageId: 'unwrapped',
              data: { method: callee.property.name },
            })
          },
        }
      },
    },
  },
}

export default [
  { ignores: ['dist/**', 'node_modules/**', '.netlify/**', '.lighthouseci/**'] },

  // js.configs.recommended ships its rules at `error`. Left as-is, an unused
  // import in an unrelated PR turns CI red — which is precisely what the
  // warn-level decision was meant to prevent. Demote the whole set explicitly.
  demoteToWarnings(js.configs.recommended),

  // eslint-plugin-vue 10 makes Vue 3 the default, so this is the Vue 3 set. This
  // variant already reports at `warn`; `flat/recommended-error` is the same rules
  // at `error`, which is the promotion to make once the backlog is worked.
  ...pluginVue.configs['flat/recommended'],

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: { 'write-seam': writeSeamPlugin },
    rules: {
      // `try { localStorage… } catch {}` is a deliberate idiom throughout this
      // codebase: storage throws in private mode and there is nothing to do
      // about it. See useActiveChurch.js and DashboardLayout.vue.
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // The ONLY rule that gates CI. Everything inherited above is a warning:
      // 15,000 lines had never been linted, and a backlog of pre-existing
      // findings must not block the change that closes a live defect.
      'write-seam/writes-through-seam': 'error',
    },
  },

  // The seam itself is where mutations are supposed to be constructed.
  {
    files: ['src/lib/data/**'],
    rules: { 'write-seam/writes-through-seam': 'off' },
  },

  // `vue/multi-word-component-names` arrives from flat/recommended at `error`,
  // unlike the rest of that set — so it gates CI, which contradicts the rule
  // above about write-seam being the only thing that does. It never fired
  // before because every component in this app was already multi-word.
  //
  // `src/components/ui/` is where it stops being right. That directory holds
  // domain-blind primitives — Button, Card, Modal, Toast, Badge, Input,
  // Spinner, Icon — named for exactly what they are, and read
  // at every call site as `<Button>`. The rule exists to stop a component
  // colliding with a current or future HTML element; none of these do, and the
  // directory is the boundary that keeps that true. Domain components in
  // `src/components/` proper are still held to the rule.
  {
    files: ['src/components/ui/**'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },

  {
    files: ['tests/**', 'scripts/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
