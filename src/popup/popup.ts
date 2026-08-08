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

import { send, subscribe, type SafeSettings, type Stats } from '../messaging';
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
let stats: Stats = { total: 0, categorized: 0, byCategory: {}, lastRunAt: null };
let progress: IndexProgress = IDLE_PROGRESS;

let screen: 'setup' | 'home' = 'setup';
let replacing = false;

void init();

async function init(): Promise<void> {
  const res = await send<{ settings: SafeSettings; providers: ProviderMeta[] }>({
    type: 'settings:get',
  });
  settings = res.settings;
  providers = res.providers;
  screen = settings.hasKey ? 'home' : 'setup';

  wire();
  await refresh();
  subscribe((msg) => {
    if (msg.type !== 'progress') return;
    progress = msg.progress;
    render();
  });
}

async function refresh(): Promise<void> {
  try {
    [stats, progress] = await Promise.all([
      send<Stats>({ type: 'posts:stats' }),
      send<IndexProgress>({ type: 'index:progress' }),
    ]);
  } catch {
    /* worker waking; the next push will land */
  }
  render();
}

// --- wiring -----------------------------------------------------------------

function wire(): void {
  // Provider and model appear on both screens; either copy drives the same setting.
  for (const id of ['provider', 'provider2']) {
    $<HTMLSelectElement>(id).addEventListener('change', (e) => {
      const next = (e.target as HTMLSelectElement).value as ProviderId;
      const first = providers.find((p) => p.id === next)?.models[0]?.id;
      void save({ provider: next, ...(first ? { model: first } : {}) });
    });
  }
  for (const id of ['model', 'model2']) {
    $<HTMLSelectElement>(id).addEventListener('change', (e) => {
      void save({ model: (e.target as HTMLSelectElement).value });
      setStatus('keyStatus', '', 'Not tested since the model changed.');
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
  $('remove').addEventListener('click', () => void onRemove());

  $('resetSpend').addEventListener('click', () => {
    void send<IndexProgress>({ type: 'spend:reset' }).then((p) => {
      progress = p;
      render();
    });
  });

  $('autoIndex').addEventListener('click', () => void save({ autoIndex: !settings.autoIndex }));
  $('overlay').addEventListener('click', () => {
    void save({ scrubberSkin: settings.scrubberSkin === 'overlay' ? 'native' : 'overlay' });
  });
}

async function save(patch: Partial<Settings>): Promise<void> {
  settings = await send<SafeSettings>({ type: 'settings:set', patch });
  await refresh();
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
  setStatus(statusId, '', 'Saving and testing…');
  try {
    settings = await send<SafeSettings>({ type: 'settings:set', patch: { apiKey } });
    const r = await send<{ ms: number; model: string }>({ type: 'settings:test-key' });
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
  const type =
    progress.phase === 'running'
      ? 'index:pause'
      : progress.pending === 0 && progress.total > 0
        ? 'index:reindex'
        : 'index:start';
  progress = await send<IndexProgress>({ type });
  render();
}

// --- render -----------------------------------------------------------------

function render(): void {
  $('setup').classList.toggle('on', screen === 'setup');
  $('home').classList.toggle('on', screen === 'home');
  $<HTMLButtonElement>('navBtn').hidden = !settings.hasKey;
  $('navBtn').textContent = screen === 'home' ? 'Setup' : 'Done';

  renderSelects();
  renderSetup();
  renderHome();

  $('footLabel').textContent = settings.hasKey
    ? `${providerLabel(settings.provider)} · ${settings.keyMask}`
    : 'no key connected';
}

function renderSelects(): void {
  for (const id of ['provider', 'provider2']) {
    $<HTMLSelectElement>(id).replaceChildren(
      ...providers.map((p) => option(p.id, p.label, p.id === settings.provider)),
    );
  }
  const models = currentProvider()?.models ?? [];
  for (const id of ['model', 'model2']) {
    $<HTMLSelectElement>(id).replaceChildren(
      ...models.map((m) => option(m.id, m.label, m.id === settings.model)),
    );
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

  $<HTMLInputElement>('key').placeholder =
    `Paste your ${provider.label} key — ${provider.keyPlaceholder}`;
  $<HTMLAnchorElement>('keysUrl').href = provider.keysUrl;

  const model = currentModel();
  $('priceHint').textContent = model
    ? `about ${fmtUsd(model.per1kPosts)} per 1,000 posts${model.supportsVision ? '' : ' · text only'}`
    : '';

  $('privacy').textContent =
    `Your key is stored in this browser's extension storage, which scripts on ` +
    `instagram.com cannot read. Every model call is made by the extension's background ` +
    `worker and goes to ${provider.label} and nowhere else — there is no server in between.`;
}

function renderHome(): void {
  const { total, categorized, pending, spentUsd, estimateUsd } = progress;

  $('fCaptured').textContent = String(total);
  $('fIndexed').textContent = String(categorized);
  $('fQueued').textContent = String(pending);
  $('fSpent').textContent = fmtUsd(spentUsd);
  $('fLeft').textContent = fmtUsd(estimateUsd);
  $('fill').style.width = `${total ? (categorized / total) * 100 : 0}%`;

  const running = progress.phase === 'running';
  $('homeTitle').textContent =
    total === 0
      ? 'Nothing captured yet'
      : running
        ? 'Indexing'
        : pending > 0
          ? `${pending} post${pending === 1 ? '' : 's'} waiting`
          : 'Everything captured is indexed';

  $('homeBody').textContent =
    total === 0
      ? 'Open your saved posts on Instagram. Posts are captured as they load, so the ' +
        'library fills as you scroll — or press the button below and it scrolls for you.'
      : running
        ? 'Running in the background. You can close this popup.'
        : pending > 0
          ? 'Captured but not summarised yet. Indexing always resumes where it stopped.'
          : 'New saves are captured as you scroll and categorised in the background.';

  const primary = $<HTMLButtonElement>('primary');
  primary.textContent = running
    ? 'Pause indexing'
    : pending > 0
      ? `Index ${pending} post${pending === 1 ? '' : 's'}`
      : total > 0
        ? 'Re-index everything'
        : 'Index now';
  primary.disabled = !settings.hasKey;

  if (progress.phase === 'error' && progress.message) {
    setStatus('homeStatus', 'bad', progress.message);
  } else if (running) {
    setStatus('homeStatus', 'ok', 'Running in the background.');
  } else if (progress.phase === 'paused') {
    setStatus('homeStatus', '', 'Paused. Progress is saved.');
  } else {
    setStatus('homeStatus', '', stats.lastRunAt ? `Last run ${timeAgo(stats.lastRunAt)}.` : '');
  }

  $('keyMask').textContent = settings.keyMask || 'none';
  $('keyState').textContent = settings.hasKey ? 'saved in this browser' : 'not set';
  $('replace').textContent = replacing ? 'Cancel' : 'Replace';
  $<HTMLElement>('replaceBox').hidden = !replacing;

  $('autoIndex').classList.toggle('on', settings.autoIndex);
  $('overlay').classList.toggle('on', settings.scrubberSkin === 'overlay');
}

// --- helpers ----------------------------------------------------------------

function currentProvider(): ProviderMeta | undefined {
  return providers.find((p) => p.id === settings.provider);
}

function currentModel(): ModelMeta | undefined {
  const provider = currentProvider();
  return provider?.models.find((m) => m.id === settings.model) ?? provider?.models[0];
}

function setStatus(id: string, kind: '' | 'ok' | 'bad', message: string): void {
  const el = $(id);
  el.className = `status${kind ? ` ${kind}` : ''}`;
  const msg = el.querySelector('.msg');
  if (msg) msg.textContent = message;
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
