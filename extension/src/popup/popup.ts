/**
 * Popup: two screens, not a wizard.
 *
 *   setup — shown until a key is saved. Says what the extension does, takes the provider,
 *           model and key in one place, and points at the page you have to open.
 *   home  — the control room. Counts, spend, one primary action, and the settings that
 *           used to be buried behind a third step.
 *
 * The key is write-only from here. The service worker only ever hands back a mask, and
 * that mask is rendered as **text** — putting it into the password field is what made it
 * look like a row of dots and hid the last four characters you need to match a key
 * against your provider's console.
 */

import {
  send,
  subscribe,
  type AccountState,
  type LedgerFile,
  type ReindexQuote,
  type SafeSettings,
  type Stats,
} from '../messaging';
import { IDLE_PROGRESS, type IndexProgress, type ProviderId, type Settings } from '../types';

interface ModelMeta {
  id: string;
  label: string;
  per1kPosts: number;
  supportsVision: boolean;
}

interface ProviderMeta {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keysUrl: string;
  models: ModelMeta[];
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

let providers: ProviderMeta[] = [];
let settings: SafeSettings;
let stats: Stats = {
  total: 0,
  categorized: 0,
  byCategory: {},
  lastRunAt: null,
  ledgerCount: 0,
};
let progress: IndexProgress = IDLE_PROGRESS;
let harvesting = false;

let screen: 'setup' | 'home' = 'setup';
let replacing = false;
/**
 * What a re-index would really cost, fetched whenever the library goes quiet.
 *
 * The finished-state primary button used to send `index:reindex` on the first click,
 * beside a "$0.00 left, at most" readout that was literally true and completely
 * misleading — the estimate is computed from `pending`, and re-index is only ever offered
 * when `pending` is zero. Now the button says the price and asks twice.
 */
let quote: ReindexQuote | null = null;
let confirming: 'reindex' | 'remove' | 'reset' | null = null;

void init();

async function init(): Promise<void> {
  let res: { settings: SafeSettings; providers: ProviderMeta[] };
  try {
    res = await send<{ settings: SafeSettings; providers: ProviderMeta[] }>({
      type: 'settings:get',
    });
  } catch {
    // Nothing below can run without settings, and both sections are `display: none`
    // until one of them is switched on — so an unguarded throw here left a blank
    // 380x560 box with no message and no way out.
    $('setup').classList.add('on');
    $('footLabel').textContent = 'extension not responding — reopen this popup';
    return;
  }
  settings = res.settings;
  providers = res.providers;
  screen = settings.hasKey ? 'home' : 'setup';

  wire();
  await refresh();
  void loadAccount();
  subscribe((msg) => {
    if (msg.type === 'harvest') harvesting = msg.action === 'start';
    else if (msg.type === 'progress') {
      progress = msg.progress;
      if (progress.phase === 'running' || progress.pending > 0) confirming = null;
    }
    else return;
    // Through refresh, not render: `stats.lastRunAt` and the ledger count come from a
    // separate request, so rendering alone left the footer quoting a stale run.
    void refresh();
  });
}

async function refresh(): Promise<void> {
  try {
    [stats, progress] = await Promise.all([
      send<Stats>({ type: 'posts:stats' }),
      send<IndexProgress>({ type: 'index:progress' }),
    ]);
    // Only meaningful once there is nothing left to do — which is exactly when the
    // primary button turns into "Re-index" and needs a price to show.
    quote =
      progress.pending === 0 && progress.total > 0 && progress.phase !== 'running' && !harvesting
        ? await send<ReindexQuote>({ type: 'index:quote' })
        : null;
    setStatus('homeStatus', '', statusLine());
  } catch {
    // Silence here made a broken worker and an empty library render identically: both
    // showed "Nothing captured yet · 0 · 0 · $0.00" with no way to tell them apart.
    setStatus('homeStatus', 'bad', 'Could not reach the extension worker — reopen this popup.');
  }
  render();
}

function statusLine(): string {
  if (progress.phase === 'error' && progress.message) return progress.message;
  if (progress.phase === 'offline' && progress.message) return progress.message;
  if (progress.phase === 'running' && progress.runTotal > 0) {
    return `Indexing ${progress.runTotal} posts detected at the start of this run.`;
  }
  if (harvesting) return 'Scanning the saved feed. New finds wait for the next run.';
  if (progress.phase === 'paused') return 'Paused. Progress is saved.';
  if (!settings.hasKey) return 'Connect a model to index — press Setup above.';
  return stats.lastRunAt ? `Last run ${timeAgo(stats.lastRunAt)}.` : '';
}

// --- wiring -----------------------------------------------------------------

function wire(): void {
  // Provider and model appear on both screens; either copy drives the same setting.
  for (const id of ['provider', 'provider2']) {
    $<HTMLSelectElement>(id).addEventListener('change', (e) => {
      const next = (e.target as HTMLSelectElement).value as ProviderId;
      if (settings.hasKey && next !== settings.provider) {
        (e.target as HTMLSelectElement).value = settings.provider;
        setStatus(
          screen === 'setup' ? 'setupStatus' : 'keyStatus',
          '',
          'Remove the current key before switching providers; keys are provider-specific.',
        );
        return;
      }
      const first = providers.find((p) => p.id === next)?.models[0]?.id;
      void save({ provider: next, ...(first ? { model: first } : {}) });
      setStatus(
        screen === 'setup' ? 'setupStatus' : 'keyStatus',
        '',
        'Not tested — this provider needs its own key.',
      );
    });
  }
  for (const id of ['model', 'model2']) {
    $<HTMLSelectElement>(id).addEventListener('change', (e) => {
      void save({ model: (e.target as HTMLSelectElement).value });
      // Onto whichever status the user can actually see. Writing to keyStatus from the
      // setup screen put the warning inside a `display: none` section while the visible
      // one still read "Connected".
      setStatus(screen === 'setup' ? 'setupStatus' : 'keyStatus', '', 'Not tested since the model changed.');
    });
  }

  $('save').addEventListener('click', () => void onSetupSave());
  $('skip').addEventListener('click', () => {
    screen = 'home';
    render();
  });
  $('navBtn').addEventListener('click', () => {
    screen = screen === 'home' ? 'setup' : 'home';
    render();
  });

  $('primary').addEventListener('click', () => void onPrimary());
  $('test').addEventListener('click', () => void onTest());
  $('replace').addEventListener('click', () => {
    replacing = !replacing;
    render();
    if (replacing) $<HTMLInputElement>('key2').focus();
  });
  $('saveKey2').addEventListener('click', () => void onReplaceSave());
  $('remove').addEventListener('click', () => {
    if (confirming !== 'remove') return arm('remove');
    confirming = null;
    void onRemove();
  });

  $('resetSpend').addEventListener('click', () => {
    // The spend counter is the only record of what this extension has charged. Erasing
    // it on one unconfirmed click, from a link styled exactly like every other link,
    // was the wrong weight for the action.
    if (confirming !== 'reset') return arm('reset');
    confirming = null;
    void send<IndexProgress>({ type: 'spend:reset' })
      .then((p) => {
        progress = p;
        render();
      })
      .catch(fail('homeStatus'));
  });

  $('autoIndex').addEventListener('click', () => void save({ autoIndex: !settings.autoIndex }));
  $('overlay').addEventListener('click', () => {
    void save({ scrubberSkin: settings.scrubberSkin === 'overlay' ? 'native' : 'overlay' });
  });

  $('exportLedger').addEventListener('click', () => void onExport());
  $('importLedger').addEventListener('click', () => $<HTMLInputElement>('importFile').click());
  $<HTMLInputElement>('importFile').addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void onImport(file);
  });

  $<HTMLFormElement>('signedOut').addEventListener('submit', (e) => {
    e.preventDefault();
    void onAccount('account:sign-in', 'Signing in…');
  });
  $('signUp').addEventListener('click', () => void onAccount('account:sign-up', 'Creating your account…'));
  $('syncNow').addEventListener('click', () => void onAccount('account:sync', 'Syncing…'));
  $('signOut').addEventListener('click', () => void onAccount('account:sign-out', 'Signing out…'));
}

// --- account ----------------------------------------------------------------

async function loadAccount(): Promise<void> {
  try {
    renderAccount(await send<AccountState>({ type: 'account:get' }));
  } catch (err) {
    fail('accountStatus')(err);
  }
}

type AccountRequest = 'account:sign-in' | 'account:sign-up' | 'account:sync' | 'account:sign-out';

async function onAccount(type: AccountRequest, pending: string): Promise<void> {
  setStatus('accountStatus', '', pending);
  try {
    const credentials = {
      email: $<HTMLInputElement>('email').value,
      password: $<HTMLInputElement>('password').value,
    };
    const state = await send<AccountState>(
      type === 'account:sign-in' || type === 'account:sign-up' ? { type, ...credentials } : { type },
    );
    $<HTMLInputElement>('password').value = '';
    renderAccount(state);
  } catch (err) {
    fail('accountStatus')(err);
  }
}

function renderAccount(state: AccountState): void {
  const signedIn = state.email !== null;
  $('signedOut').hidden = signedIn;
  $('signedIn').hidden = !signedIn;
  $('accountNote').hidden = signedIn;
  $('accountState').textContent = state.email ?? 'not signed in';

  if (state.confirmEmail) {
    setStatus('accountStatus', 'ok', 'Check your inbox to confirm your email, then sign in.');
  } else if (state.error) {
    setStatus('accountStatus', 'bad', `Sync failed: ${state.error}`);
  } else if (signedIn && state.lastSyncAt) {
    setStatus('accountStatus', 'ok', `${state.synced} posts synced, ${timeAgo(state.lastSyncAt)}.`);
  } else {
    setStatus('accountStatus', '', signedIn ? 'Not synced yet.' : '');
  }
}

async function save(patch: Partial<Settings>): Promise<void> {
  try {
    settings = await send<SafeSettings>({ type: 'settings:set', patch });
  } catch (err) {
    // A `void`-ed rejection here left a toggle that simply never moved.
    return fail(screen === 'setup' ? 'setupStatus' : 'keyStatus')(err);
  }
  await refresh();
}

/** First click arms a destructive action, second performs it. */
function arm(what: NonNullable<typeof confirming>): void {
  confirming = what;
  render();
}

function fail(statusId: string): (err: unknown) => void {
  return (err) => setStatus(statusId, 'bad', err instanceof Error ? err.message : String(err));
}

// --- the ledger -------------------------------------------------------------

/**
 * Hand the file straight to the browser. An extension page can make an object URL and
 * click its own link, so portability costs no permission at all — `chrome.downloads`
 * would have added a "Manage your downloads" line to the install prompt for nothing.
 */
async function onExport(): Promise<void> {
  try {
    const file = await send<LedgerFile>({ type: 'ledger:export' });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(file)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `saved-index-ledger-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('ledgerStatus', 'ok', `Saved ${file.verdicts.length} summaries.`);
  } catch (err) {
    fail('ledgerStatus')(err);
  }
}

async function onImport(file: File): Promise<void> {
  setStatus('ledgerStatus', '', 'Reading…');
  try {
    const parsed: unknown = JSON.parse(await file.text());
    const { imported, skipped } = await send<{ imported: number; skipped: number }>({
      type: 'ledger:import',
      file: parsed,
    });
    setStatus(
      'ledgerStatus',
      'ok',
      imported === 0
        ? 'Nothing new — everything in that file was already here.'
        : `Restored ${imported} summaries${skipped ? `, skipped ${skipped} already on file` : ''}.`,
    );
    await refresh();
  } catch (err) {
    fail('ledgerStatus')(err);
  } finally {
    // Let the same file be chosen twice in a row.
    $<HTMLInputElement>('importFile').value = '';
  }
}

// --- actions ----------------------------------------------------------------

async function onSetupSave(): Promise<void> {
  const field = $<HTMLInputElement>('key');
  const key = field.value.trim();
  if (!key) return setStatus('setupStatus', 'bad', 'Paste a key first.');

  await saveAndTest(key, 'setupStatus', () => {
    field.value = '';
    screen = 'home';
  });
}

async function onReplaceSave(): Promise<void> {
  const field = $<HTMLInputElement>('key2');
  const key = field.value.trim();
  if (!key) return setStatus('keyStatus', 'bad', 'Paste a key first.');

  await saveAndTest(key, 'keyStatus', () => {
    field.value = '';
    replacing = false;
  });
}

/**
 * Save then immediately test. A key that saves but doesn't work is the worst outcome —
 * indexing would fail much later with no obvious cause — so the two are one action.
 */
async function saveAndTest(apiKey: string, statusId: string, onOk: () => void): Promise<void> {
  setStatus(statusId, '', 'Testing…');
  try {
    const r = await send<{ ms: number; model: string }>({
      type: 'settings:test-candidate',
      provider: settings.provider,
      model: settings.model,
      apiKey,
    });
    settings = await send<SafeSettings>({ type: 'settings:set', patch: { apiKey } });
    setStatus(statusId, 'ok', `Connected · ${r.model} answered in ${r.ms}ms`);
    onOk();
  } catch (err) {
    setStatus(statusId, 'bad', err instanceof Error ? err.message : String(err));
  }
  await refresh();
}

async function onTest(): Promise<void> {
  setStatus('keyStatus', '', 'Sending one token…');
  try {
    const r = await send<{ ms: number; model: string }>({ type: 'settings:test-key' });
    setStatus('keyStatus', 'ok', `Connected · ${r.model} answered in ${r.ms}ms`);
  } catch (err) {
    setStatus('keyStatus', 'bad', err instanceof Error ? err.message : String(err));
  }
}

async function onRemove(): Promise<void> {
  settings = await send<SafeSettings>({ type: 'settings:clear-key' });
  replacing = false;
  screen = 'setup';
  await refresh();
  setStatus('setupStatus', '', 'Key removed. Everything already indexed is still here.');
}

async function onPrimary(): Promise<void> {
  if (!settings.hasKey) {
    screen = 'setup';
    return render();
  }

  const active = progress.phase === 'running' || harvesting;
  const finished = progress.pending === 0 && progress.total > 0 && !active;
  if (!active && finished && confirming !== 'reindex') {
    return arm('reindex');
  }
  confirming = null;

  const type =
    active ? 'index:pause' : finished ? 'index:reindex' : 'index:start';

  try {
    progress = await send<IndexProgress>({ type });
  } catch (err) {
    return fail('homeStatus')(err);
  }

  if (type === 'index:start' && progress.total === 0) {
    setStatus(
      'homeStatus',
      '',
      'Open your saved posts on Instagram — there is nothing captured to index yet.',
    );
  }
  render();
}

// --- render -----------------------------------------------------------------

function render(): void {
  $('setup').classList.toggle('on', screen === 'setup');
  $('home').classList.toggle('on', screen === 'home');
  // One account card, shown on whichever screen is visible. Moved only when the screen
  // changes: re-appending on every progress push would blur a half-typed email.
  const slot = $(screen === 'setup' ? 'accountSlotSetup' : 'accountSlotHome');
  if ($('account').parentElement !== slot) slot.append($('account'));
  // Always available from the home screen. Hiding it when there was no key meant a user
  // who pressed "Skip" had no route back to setup at all — and the disabled primary
  // button's own recovery branch was unreachable for the same reason.
  $<HTMLButtonElement>('navBtn').hidden = screen === 'setup' && !settings.hasKey;
  $('navBtn').textContent = screen === 'home' ? 'Setup' : 'Done';

  renderSelects();
  renderSetup();
  renderHome();

  $('footLabel').textContent = settings.hasKey
    ? `${providerLabel(settings.provider)} · ${settings.keyMask}`
    : 'No key connected';
}

/**
 * Rebuilt only when the options actually changed.
 *
 * `render()` runs on every progress push — several a second during a run — and an
 * unconditional `replaceChildren` closed the Model dropdown the moment the user opened it
 * to check what they were paying for.
 */
function renderSelects(): void {
  sync(['provider', 'provider2'], providers.map((p) => [p.id, p.label]), settings.provider);
  const models = currentProvider()?.models ?? [];
  sync(['model', 'model2'], models.map((m) => [m.id, m.label]), settings.model);
}

function sync(ids: string[], items: [string, string][], selected: string): void {
  for (const id of ids) {
    const el = $<HTMLSelectElement>(id);
    const same =
      el.options.length === items.length &&
      items.every(([value], i) => el.options[i]?.value === value);
    if (!same) el.replaceChildren(...items.map(([v, label]) => option(v, label, v === selected)));
    el.value = selected;
  }
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  opt.selected = selected;
  return opt;
}

function renderSetup(): void {
  const provider = currentProvider();
  if (!provider) return;

  $<HTMLInputElement>('key').placeholder = provider.keyPlaceholder;
  $<HTMLAnchorElement>('keysUrl').href = provider.keysUrl;

  const model = currentModel();
  $('priceHint').textContent = model
    ? `About ${fmtUsd(model.per1kPosts)} per 1,000 posts${model.supportsVision ? '' : ' · text only'}`
    : '';

  $('privacy').textContent =
    `Your key stays in this browser's extension storage, out of reach of instagram.com, ` +
    `and is sent only to ${provider.label}.`;
}

function renderHome(): void {
  const { total, categorized, pending, spentUsd, estimateUsd } = progress;
  const running = progress.phase === 'running';
  const active = running || harvesting;

  $('fCaptured').textContent = String(total);
  $('fIndexed').textContent = String(categorized);
  $('fQueued').textContent = String(
    progress.phase === 'running'
      ? Math.max(0, progress.runTotal - progress.runCompleted)
      : pending,
  );
  $('fQueuedCap').textContent = progress.phase === 'running' ? 'This run' : 'Waiting';
  $('fSpent').textContent = fmtUsd(spentUsd);

  // When there is nothing pending, "left, at most" is $0.00 and the button beside it
  // starts a full re-index. Show what that button would cost instead.
  const finished = pending === 0 && total > 0 && !active;
  $('fLeft').textContent = fmtUsd(finished && quote ? quote.usd : estimateUsd);
  $('fLeftCap').textContent = finished ? 'To re-index everything' : 'Left, at most';
  const progressTotal = progress.runTotal || total;
  const progressDone = progress.runTotal ? progress.runCompleted : categorized;
  const percent = Math.round(progressTotal ? (progressDone / progressTotal) * 100 : 0);
  $('fill').style.width = `${percent}%`;
  $('track').setAttribute('aria-valuenow', String(percent));

  $('homeTitle').textContent =
    harvesting && total === 0
      ? 'Scanning saved posts'
      : total === 0
      ? 'Nothing captured yet'
      : running
        ? `Indexing ${progress.runTotal} detected posts`
        : harvesting
          ? 'Scanning saved posts'
          : pending > 0
            ? `${pending} post${pending === 1 ? '' : 's'} waiting`
            : 'Everything captured is indexed';

  $('homeBody').textContent =
    harvesting && total === 0
      ? 'Keep the Instagram tab open. Posts found in this scan will wait for the next indexing run.'
      : total === 0
      ? 'Open your saved posts on Instagram. Posts are captured as they load, so the ' +
        'library fills as you scroll — or press the button below and it scrolls for you.'
      : running
        ? `This run stops after its starting set. New posts found while scanning wait for the next run.`
        : harvesting
          ? 'Keep the Instagram tab open. Scanning does not send extra Instagram requests.'
          : pending > 0
            ? 'Captured but not summarised yet. Indexing always resumes where it stopped.'
            : 'New saves are captured as you scroll and categorised in the background.';

  const primary = $<HTMLButtonElement>('primary');
  primary.classList.toggle('danger', confirming === 'reindex');
  primary.textContent = active
    ? 'Pause'
    : pending > 0
      ? `Index ${pending} post${pending === 1 ? '' : 's'}`
      : total > 0
        ? confirming === 'reindex'
          ? `Confirm — re-index ${total} posts`
          : `Re-index everything${quote ? ` · ${reindexPrice(quote)}` : ''}`
        : 'Index now';
  primary.disabled = !settings.hasKey;

  if (confirming === 'reindex' && quote) {
    setStatus(
      'homeStatus',
      'bad',
      quote.billable === 0
        ? 'Every summary is already on file, so this costs nothing. Press again to run it.'
        : `${quote.billable} of ${quote.total} posts would be sent to the model again — about ${fmtUsd(quote.usd)}. Press again to confirm.`,
    );
  }

  $('ledgerState').textContent = String(stats.ledgerCount);
  $('remove').textContent = confirming === 'remove' ? 'Click again to remove the key' : 'Remove Key';
  $('resetSpend').textContent =
    confirming === 'reset' ? 'Click again to erase the spend record' : 'Reset Spend Counter';
  $('keyMask').textContent = settings.keyMask || 'none';
  $('keyState').textContent = settings.hasKey ? 'saved in this browser' : 'not set';
  $('replace').textContent = replacing ? 'Cancel' : 'Replace Key';
  $<HTMLElement>('replaceBox').hidden = !replacing;

  // aria-checked drives the visual state as well as the announced one, so the two can
  // never disagree — see the [aria-checked="true"] rules in popup.html.
  $('autoIndex').setAttribute('aria-checked', String(settings.autoIndex));
  $('overlay').setAttribute('aria-checked', String(settings.scrubberSkin === 'overlay'));
}

// --- helpers ----------------------------------------------------------------

function currentProvider(): ProviderMeta | undefined {
  return providers.find((p) => p.id === settings.provider);
}

function currentModel(): ModelMeta | undefined {
  const provider = currentProvider();
  return provider?.models.find((m) => m.id === settings.model) ?? provider?.models[0];
}

function reindexPrice(q: ReindexQuote): string {
  return q.billable === 0 ? 'free — all on file' : `~${fmtUsd(q.usd)}`;
}

/**
 * Provider errors carry a friendly sentence followed by up to 400 characters of raw
 * body. Showing the whole thing at 11.5px in a 380px column buried the actionable half
 * and jumped the layout, so the tail moves to the tooltip.
 */
function setStatus(id: string, kind: '' | 'ok' | 'bad', message: string): void {
  const el = $(id);
  el.className = `status${kind ? ` ${kind}` : ''}`;
  const cut = message.search(/[{\n]/);
  const head = cut > 0 ? message.slice(0, cut).trim() : message;
  const msg = el.querySelector('.msg');
  if (msg) {
    msg.textContent = head;
    if (head !== message) el.title = message;
    else el.removeAttribute('title');
  }
}

function providerLabel(id: ProviderId): string {
  return providers.find((p) => p.id === id)?.label ?? id;
}

function fmtUsd(usd: number): string {
  if (usd <= 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
