<script setup>
/**
 * DEV-ONLY. Registered behind `import.meta.env.DEV` in the router, so this file
 * is never reached by a production build — Rollup drops the branch and with it
 * the dynamic import, contributing zero bytes to `dist/`. Verify that after
 * changing anything here: `npm run build && ls dist/assets | grep -i style`
 * must find nothing.
 *
 * This is REDESIGN.md §0.5's sign-off surface, and the sequencing it exists to
 * serve is the point. The palette below is deliberately the CURRENT blue, not
 * the new cyan: step 3 signs off the component system's MECHANICS on a neutral
 * placeholder, and only then does step 4 repoint the palette in tokens.css
 * alone and re-open this same page for the visual call. A rejected palette then
 * costs a token edit and a look at one throwaway page, instead of a re-review
 * of eleven views.
 *
 * It renders real components in real states — hover, focus, disabled, loading,
 * an actually-open Modal, a genuinely fired Toast — rather than static tiles,
 * so it catches integration bugs a hand-drawn swatch sheet cannot. Both themes
 * are signed off together at step 4; signing off light and discovering dark
 * later is the exact failure the toggle here prevents.
 */
import { ref } from 'vue'
import { useTheme } from '../../composables/useTheme'
import { useToast } from '../../composables/useToast'
import { useSortState } from '../../composables/useSortState'
import { ICON_NAMES } from '../../components/ui/icons/iconPaths'
import AppLogo from '../../components/AppLogo.vue'
import Badge from '../../components/ui/Badge.vue'
import Button from '../../components/ui/Button.vue'
import Card from '../../components/ui/Card.vue'
import Icon from '../../components/ui/icons/Icon.vue'
import Input from '../../components/ui/Input.vue'
import Modal from '../../components/ui/Modal.vue'
import Spinner from '../../components/ui/Spinner.vue'
import TableSortHeader from '../../components/ui/TableSortHeader.vue'
import Toast from '../../components/ui/Toast.vue'
import Alert from '../../components/ui/Alert.vue'

const { theme, toggleTheme } = useTheme()
const { showToast } = useToast()

const modalOpen = ref(false)
const formModalOpen = ref(false)

const text = ref('')
const withError = ref('bad value')
const disabled = ref('Cannot change this')

const { sort, toggleSort, ariaSortFor } = useSortState('last_name')

const ROWS = [
  { last_name: 'Dela Cruz', first_name: 'Juan', stage: 'Baptized' },
  { last_name: 'Lago', first_name: 'Mary', stage: 'Not started' },
  { last_name: 'Santos', first_name: 'Maria', stage: 'Complete' },
]

const VARIANTS = ['primary', 'secondary', 'tertiary', 'danger', 'ghost']
const BADGES = ['neutral', 'accent', 'accent-secondary', 'success', 'warning', 'danger']
const TONES = ['info', 'success', 'warning', 'error']

const SEMANTIC_TOKENS = [
  '--color-bg-page',
  '--color-bg-surface',
  '--color-bg-subtle',
  '--color-bg-selected',
  '--color-border-default',
  '--color-border-strong',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-muted',
  '--color-accent',
  '--color-accent-hover',
  '--color-accent-subtle',
  '--color-accent-text',
  '--color-accent-secondary',
  '--color-accent-secondary-subtle',
  '--color-focus-ring',
  '--color-danger',
  '--color-success',
  '--color-warning',
]
</script>

<template>
  <div class="guide">
    <!-- No <ToastHost /> here. App.vue mounts the one host for the whole app
         now (Phase 1b), and the queue is module-scoped — a second host would
         render every toast twice on this route only. -->

    <header class="guide-header">
      <div class="guide-title">
        <AppLogo :size="40" />
        <div>
          <h1>Style guide</h1>
          <p class="muted">
            Brand palette — cyan #0088b0, magenta #d6006c (§0.5 step 4). Toggle the theme:
            both are signed off together. Dev-only route.
          </p>
        </div>
      </div>
      <Button variant="secondary" @click="toggleTheme">
        <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="16" />
        {{ theme === 'dark' ? 'Light' : 'Dark' }}
      </Button>
    </header>

    <section>
      <h2>Semantic tokens</h2>
      <p class="muted">
        Views consume only these. The primitive ramps behind them are referenced from inside
        tokens.css and nowhere else.
      </p>
      <div class="swatches">
        <div v-for="token in SEMANTIC_TOKENS" :key="token" class="swatch">
          <span class="chip" :style="{ background: `var(${token})` }" />
          <code>{{ token }}</code>
        </div>
      </div>
    </section>

    <section>
      <h2>Type scale</h2>
      <p style="font-size: var(--text-3xl); font-weight: var(--font-weight-extrabold)">
        3xl / extrabold — Manrope 800 carries the design
      </p>
      <p style="font-size: var(--text-2xl); font-weight: var(--font-weight-bold)">2xl / bold</p>
      <p style="font-size: var(--text-xl); font-weight: var(--font-weight-semibold)">xl / semibold</p>
      <p style="font-size: var(--text-lg)">lg — form control size</p>
      <p style="font-size: var(--text-base)">base — body copy</p>
      <p style="font-size: var(--text-sm)" class="muted">sm — hints and secondary</p>
      <p style="font-size: var(--text-xs)" class="muted">xs — badges</p>
    </section>

    <section>
      <h2>Buttons</h2>
      <div class="row">
        <Button v-for="variant in VARIANTS" :key="variant" :variant="variant">
          {{ variant }}
        </Button>
      </div>
      <h3>States</h3>
      <div class="row">
        <Button disabled>disabled</Button>
        <Button loading>saving…</Button>
        <Button variant="danger" loading>deleting…</Button>
        <Button size="sm">small</Button>
        <Button size="lg">large</Button>
      </div>
      <div class="row narrow">
        <Button block>block</Button>
      </div>
    </section>

    <section>
      <h2>Badges</h2>
      <div class="row">
        <Badge v-for="variant in BADGES" :key="variant" :variant="variant">{{ variant }}</Badge>
      </div>
    </section>

    <section>
      <h2>Alerts</h2>
      <p class="muted">
        The standing, in-page half of the state vocabulary. A toast reports what just
        happened and leaves; an alert reports the state the page is in and stays.
      </p>
      <div class="stack">
        <Alert v-for="tone in TONES" :key="tone" :tone="tone">
          {{ tone }} — a message classified by the data module, never `error.message`.
        </Alert>
      </div>
    </section>

    <section>
      <h2>Spinners</h2>
      <div class="row">
        <Spinner size="sm" />
        <Spinner size="md" />
        <Spinner size="lg" label="Loading" />
      </div>
    </section>

    <section>
      <h2>Icons</h2>
      <div class="row icons">
        <div v-for="name in ICON_NAMES" :key="name" class="icon-tile">
          <Icon :name="name" :size="20" />
          <code>{{ name }}</code>
        </div>
      </div>
    </section>

    <section>
      <h2>Fields</h2>
      <div class="fields">
        <Input v-model="text" label="Email address" type="email" placeholder="you@example.com" hint="We never share this." />
        <Input v-model="withError" label="Amount" error="Enter an amount greater than zero." required />
        <Input v-model="disabled" label="Church" disabled />
      </div>
    </section>

    <section>
      <h2>Cards</h2>
      <div class="row cards">
        <Card elevation="none"><strong>none</strong><p class="muted">flat</p></Card>
        <Card elevation="sm"><strong>sm</strong><p class="muted">default</p></Card>
        <Card elevation="md"><strong>md</strong><p class="muted">raised</p></Card>
        <Card elevation="lg"><strong>lg</strong><p class="muted">floating</p></Card>
      </div>
    </section>

    <section>
      <h2>Sortable table</h2>
      <p class="muted">
        Tab to a header and press Enter — a real button inside the <code>&lt;th&gt;</code>, with
        <code>aria-sort</code> on the <code>&lt;th&gt;</code> itself. That is D11's second sub-fix.
      </p>
      <table class="demo-table">
        <thead>
          <tr>
            <TableSortHeader sort-key="last_name" :aria-sort="ariaSortFor('last_name')" @sort="toggleSort">
              Last name
            </TableSortHeader>
            <TableSortHeader sort-key="first_name" :aria-sort="ariaSortFor('first_name')" @sort="toggleSort">
              First name
            </TableSortHeader>
            <th scope="col" class="plain">Journey</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in ROWS" :key="row.last_name">
            <td>{{ row.last_name }}</td>
            <td>{{ row.first_name }}</td>
            <td><Badge :variant="row.stage === 'Complete' ? 'success' : 'neutral'">{{ row.stage }}</Badge></td>
          </tr>
        </tbody>
      </table>
      <p class="muted">Sorted by: <code>{{ sort?.key }} / {{ sort?.direction }}</code></p>
    </section>

    <section>
      <h2>Toasts</h2>
      <p class="muted">
        Rendered statically here so every variant is reviewable at a glance; the buttons below
        exercise the real queue, its stacking cap and its transitions.
      </p>
      <div class="toast-samples">
        <Toast message="Member saved." type="success" />
        <Toast message="That change was refused. You may not edit this record." type="error" />
        <Toast message="Showing 200 of 412 — refine your search." type="info" />
      </div>
      <div class="row">
        <Button variant="secondary" @click="showToast('Member saved.', 'success')">success</Button>
        <Button variant="secondary" @click="showToast('That change was refused. You may not edit this record.', 'error')">error</Button>
        <Button variant="secondary" @click="showToast('Showing 200 of 412 — refine your search.', 'info')">info</Button>
      </div>
    </section>

    <section>
      <h2>Modal</h2>
      <p class="muted">
        Open one and press Tab repeatedly: focus stays inside, Escape closes, and focus returns to
        the button that opened it. None of the four hand-rolled modals in the app does this today.
      </p>
      <div class="row">
        <Button @click="modalOpen = true">Confirmation modal</Button>
        <Button variant="secondary" @click="formModalOpen = true">Form modal</Button>
      </div>

      <Modal
        v-model:open="modalOpen"
        title="Delete Small Group"
        description="This permanently removes the group and its member associations."
      >
        <p>Individual member records are not affected.</p>
        <template #footer>
          <Button variant="secondary" @click="modalOpen = false">Cancel</Button>
          <Button variant="danger" @click="modalOpen = false; showToast('Small group deleted.')">
            Confirm delete
          </Button>
        </template>
      </Modal>

      <Modal
        v-model:open="formModalOpen"
        title="Add Small Group"
        size="wide"
        :close-on-outside-click="false"
      >
        <div class="fields">
          <Input v-model="text" label="Group name" required />
          <Input v-model="text" label="Meeting day" as="select">
            <option>Sunday</option>
            <option>Wednesday</option>
          </Input>
        </div>
        <template #footer>
          <Button variant="secondary" @click="formModalOpen = false">Cancel</Button>
          <Button @click="formModalOpen = false; showToast('Small group saved.')">Save</Button>
        </template>
      </Modal>
    </section>
  </div>
</template>

<style scoped>
.guide {
  min-height: 100vh;
  background: var(--color-bg-page);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  padding: var(--space-8);
  display: flex;
  flex-direction: column;
  gap: var(--space-10);
}

.guide-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.guide-title {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

h1 {
  font-size: var(--text-3xl);
  font-weight: var(--font-weight-extrabold);
  line-height: var(--leading-tight);
}

h2 {
  font-size: var(--text-xl);
  font-weight: var(--font-weight-bold);
  margin-bottom: var(--space-3);
}

h3 {
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-secondary);
  margin: var(--space-5) 0 var(--space-2);
}

section {
  border-top: 1px solid var(--color-border-default);
  padding-top: var(--space-5);
}

.muted {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: var(--leading-normal);
  margin-bottom: var(--space-3);
}

.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}

.row.narrow {
  max-width: 280px;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  max-width: 520px;
}

.row.cards > * {
  width: 160px;
}

.fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-width: 420px;
}

.toast-samples {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.swatches {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}

.swatch {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.chip {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border-strong);
  flex-shrink: 0;
}

.icon-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  width: 92px;
  padding: var(--space-3);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  background: var(--color-bg-surface);
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.demo-table {
  width: 100%;
  max-width: 560px;
  border-collapse: collapse;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.demo-table th.plain {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  background: var(--color-bg-subtle);
  border-bottom: 1px solid var(--color-border-default);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.demo-table td {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border-subtle);
}

.demo-table tbody tr:last-child td {
  border-bottom: none;
}
</style>
