/**
 * Popup: connect a provider, pick a model, test the key, run indexing.
 *
 * The key is write-only from here. On load the field shows a mask supplied by the
 * service worker; saving an unchanged mask is treated as "leave the key alone" so
 * toggling an unrelated setting can't wipe it.
 */

import { send, subscribe, type SafeSettings, type Stats } from '../messaging';
import type { IndexProgress, ProviderId } from '../types';

interface ProviderMeta {
  id: ProviderId;
  label: string;
  keyPlaceholder: string;
  keysUrl: string;
  models: { id: string; label: string; costPer1kPosts: number; supportsVision: boolean }[];
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

let providers: ProviderMeta[] = [];
let settings: SafeSettings;
let stats: Stats = { total: 0, categorized: 0, byCategory: {}, lastRunAt: null };
let progress: IndexProgress = { phase: 'idle', total: 0, categorized: 0, message: null };

let step = 1;
let draftProvider: ProviderId = 'anthropic';
let keyTouched = false;

void init();

async function init(): Promise<void> {
  const res = await send<{ settings: SafeSettings; providers: ProviderMeta[] }>({
    type: 'settings:get',
  });
  settings = res.settings;
  providers = res.providers;
  draftProvider = settings.provider;

  // Someone who already has a key lands on the indexing screen, not onboarding.
  step = settings.hasKey ? 3 : 1;

  wireStaticHandlers();
  await refreshStats();
  subscribe((msg) => {
    if (msg.type !== 'progress') return;
    progress = msg.progress;
    void refreshStats();
  });

  render();
}

async function refreshStats(): Promise<void> {
  try {
    stats = await send<Stats>({ type: 'posts:stats' });
    progress = await send<IndexProgress>({ type: 'index:progress' });
  } catch {
    /* worker waking; next push will land */
  }
  render();
}

// --- wiring -----------------------------------------------------------------

function wireStaticHandlers(): void {
  $('toStep2').addEventListener('click', () => {
    void applyProviderDraft().then(() => go(2));
  });
  $('backTo1').addEventListener('click', () => go(1));
  $('settings').addEventListener('click', () => go(settings.hasKey ? 2 : 1));

  $<HTMLSelectElement>('model').addEventListener('change', (e) => {
    const model = (e.target as HTMLSelectElement).value;
    void send<SafeSettings>({ type: 'settings:set', patch: { model } }).then(reloadSettings);
    setStatus('testStatus', '', 'Not tested since the model changed.');
  });

  const key = $<HTMLInputElement>('key');
  key.addEventListener('input', () => {
    keyTouched = true;
    setStatus('testStatus', '', 'Not tested since the key changed.');
  });

  $('toggleKey').addEventListener('click', () => {
    const showing = key.type === 'text';
    key.type = showing ? 'password' : 'text';
    $('toggleKey').textContent = showing ? 'Show' : 'Hide';
  });

  $('test').addEventListener('click', () => void onTest());
  $('save').addEventListener('click', () => void onSave());
  $('primary').addEventListener('click', () => void onPrimary());
  $('idxToggle').addEventListener('click', () => void onPrimary());

  $('autoIndex').addEventListener('click', () => {
    void send<SafeSettings>({
      type: 'settings:set',
      patch: { autoIndex: !settings.autoIndex },
    }).then(reloadSettings);
  });
  $('thinSkin').addEventListener('click', () => {
    const next = settings.scrubberSkin === 'thin' ? 'native' : 'thin';
    void send<SafeSettings>({ type: 'settings:set', patch: { scrubberSkin: next } }).then(
      reloadSettings,
    );
  });
}

async function reloadSettings(next?: SafeSettings): Promise<void> {
  settings = next ?? (await send<{ settings: SafeSettings }>({ type: 'settings:get' })).settings;
  render();
}

async function applyProviderDraft(): Promise<void> {
  if (draftProvider === settings.provider) return;
  const first = providers.find((p) => p.id === draftProvider)?.models[0]?.id;
  const patch = { provider: draftProvider, ...(first ? { model: first } : {}) };
  await reloadSettings(await send<SafeSettings>({ type: 'settings:set', patch }));
}

async function onSave(): Promise<void> {
  const key = $<HTMLInputElement>('key').value.trim();
  const patch: Partial<{ apiKey: string; model: string }> = {
    model: $<HTMLSelectElement>('model').value,
  };
  // An untouched field still holds the mask — never send that as the key.
  if (keyTouched && key) patch.apiKey = key;

  await reloadSettings(await send<SafeSettings>({ type: 'settings:set', patch }));
  keyTouched = false;
  go(3);
}

async function onTest(): Promise<void> {
  const key = $<HTMLInputElement>('key').value.trim();
  if (keyTouched && key) {
    await reloadSettings(await send<SafeSettings>({ type: 'settings:set', patch: { apiKey: key } }));
    keyTouched = false;
  }
  if (!settings.hasKey) {
    setStatus('testStatus', 'bad', 'Paste a key first.');
    return;
  }

  setStatus('testStatus', '', 'Sending one token…');
  try {
    const r = await send<{ ms: number; model: string; provider: string }>({
      type: 'settings:test-key',
    });
    setStatus('testStatus', 'ok', `Connected · ${r.model} responded in ${r.ms}ms`);
  } catch (err) {
    setStatus('testStatus', 'bad', err instanceof Error ? err.message : String(err));
  }
}

async function onPrimary(): Promise<void> {
  if (!settings.hasKey) return go(1);
  const type =
    progress.phase === 'running'
      ? 'index:pause'
      : progress.phase === 'done' && stats.total > 0 && stats.categorized === stats.total
        ? 'index:reindex'
        : 'index:start';
  progress = await send<IndexProgress>({ type });
  render();
}

function go(next: number): void {
  step = next;
  render();
}

// --- render -----------------------------------------------------------------

function render(): void {
  for (const n of [1, 2, 3]) {
    $(`step${n}`).classList.toggle('on', step === n);
    $(`s${n}`).classList.toggle('on', step >= n);
  }

  renderProviders();
  renderModels();
  renderIndexing();

  $('footLabel').textContent = settings.hasKey
    ? `${providerLabel(settings.provider)} · ${settings.keyMask}`
    : 'no key connected';
}

function renderProviders(): void {
  const box = $('providers');
  box.replaceChildren();

  for (const p of providers) {
    const row = document.createElement('button');
    row.className = `row${p.id === draftProvider ? ' on' : ''}`;
    row.innerHTML = '<span class="radio"><i></i></span>';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.label;

    const hint = document.createElement('span');
    hint.className = 'mono';
    hint.textContent = p.keyPlaceholder;

    row.append(name, hint);
    row.addEventListener('click', () => {
      draftProvider = p.id;
      renderProviders();
    });
    box.append(row);
  }
}

function renderModels(): void {
  const provider = providers.find((p) => p.id === settings.provider);
  if (!provider) return;

  const select = $<HTMLSelectElement>('model');
  select.replaceChildren();
  for (const m of provider.models) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    opt.selected = m.id === settings.model;
    select.append(opt);
  }

  const model = provider.models.find((m) => m.id === settings.model) ?? provider.models[0];
  $('modelHint').textContent = model
    ? `$${model.costPer1kPosts.toFixed(2)} per 1,000 posts${model.supportsVision ? '' : ' · text only'}`
    : '';

  const key = $<HTMLInputElement>('key');
  key.placeholder = provider.keyPlaceholder;
  if (!keyTouched) key.value = settings.keyMask;

  $('keyHint').textContent = settings.hasKey ? 'saved in this browser' : 'not set';
  $<HTMLAnchorElement>('keysUrl').href = provider.keysUrl;
  $('privacy').textContent =
    `The key is stored in this browser's extension storage, where only the extension can ` +
    `read it. It is sent to ${provider.label} and nowhere else — we have no server.`;
}

function renderIndexing(): void {
  const { total, categorized } = stats;
  const pending = Math.max(0, total - categorized);
  const model = providers
    .find((p) => p.id === settings.provider)
    ?.models.find((m) => m.id === settings.model);

  $('tSaved').textContent = String(total);
  // ~25 posts per request, ~3 in flight, ~2s per request — a rough order-of-magnitude
  // figure, deliberately shown as a range-free estimate rather than a promise.
  $('tTime').textContent = pending ? `${Math.max(1, Math.ceil(pending / 25 / 3 * 2 / 60))}m` : '—';
  $('tCost').textContent =
    pending && model ? `$${((pending / 1000) * model.costPer1kPosts).toFixed(2)}` : '—';

  const pct = total ? (categorized / total) * 100 : 0;
  $('idxFill').style.width = `${pct}%`;
  $('idxCount').textContent = `${categorized} of ${total} categorized`;

  const running = progress.phase === 'running';
  $('idxToggle').textContent = running ? 'Pause' : 'Resume';
  $('idxToggle').style.visibility = total === 0 ? 'hidden' : 'visible';

  const done = total > 0 && categorized === total;
  $('idxTitle').textContent = done ? 'Everything is indexed' : 'Index your saved posts';
  $('idxBody').textContent =
    total === 0
      ? 'Open your saved posts on Instagram and scroll — posts are picked up automatically as they load.'
      : done
        ? 'New saves are picked up as you scroll and categorised in the background.'
        : 'Indexing reads each caption once and writes a one-line summary.';

  $('primary').textContent = running
    ? 'Pause indexing'
    : done
      ? 'Re-index everything'
      : pending > 0
        ? `Index ${pending} post${pending === 1 ? '' : 's'}`
        : 'Start indexing';
  $<HTMLButtonElement>('primary').disabled = !settings.hasKey || (total === 0 && !running);

  if (progress.phase === 'error' && progress.message) {
    setStatus('idxStatus', 'bad', progress.message);
  } else if (running) {
    setStatus('idxStatus', 'ok', 'Running in the background.');
  } else if (progress.phase === 'paused') {
    setStatus('idxStatus', '', 'Paused. Progress is saved.');
  } else {
    setStatus('idxStatus', '', stats.lastRunAt ? `Last run ${timeAgo(stats.lastRunAt)}.` : '');
  }

  $('autoIndex').classList.toggle('on', settings.autoIndex);
  $('thinSkin').classList.toggle('on', settings.scrubberSkin === 'thin');
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

function timeAgo(ms: number): string {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} day(s) ago`;
}
