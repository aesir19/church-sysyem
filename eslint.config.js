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

  js.configs.recommended,
  // eslint-plugin-vue 10 makes Vue 3 the default, so this is the Vue 3 set. The
  // plain variant reports at `warn`; `flat/recommended-error` is the same rules
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
      'no-empty': ['error', { allowEmptyCatch: true }],

      // The one rule that gates CI. Everything inherited above is a warning:
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

  {
    files: ['tests/**', 'scripts/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
]
