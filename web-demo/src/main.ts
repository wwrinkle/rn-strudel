// rn-strudel's web reference: the example app's feature rows, played by stock Strudel in the browser (through
// rn-strudel's web entry, the same initStrudel() API). "Play" loops a row's pattern; "Test" plays it briefly and checks
// that sound came out, exactly as the app does.
import { bundledSamples, initStrudel, loadDefaultSamples } from 'rn-strudel';
import { BUNDLED_SAMPLES } from '../../conformance/bundled';
import { GROUPS, ROWS } from '../../conformance/rows';
import { runStrudelRow, summarizeStrudel } from '../../conformance/runner';
import type { StrudelResult, StrudelRow, StrudelTestEnv } from '../../conformance/types';

const env: StrudelTestEnv = {
  platform: 'web',
  engine: () => initStrudel(),
  loadSamples: loadDefaultSamples,
  loadBundled: () => bundledSamples(BUNDLED_SAMPLES),
  audible: true,
  playMs: 3000,
};

const results = new Map<string, StrudelResult>();
const app = document.getElementById('app')!;
const summary = document.createElement('div');
let playing: { id: string; button: HTMLButtonElement } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Minimal markdown for names and `how`: `code` and [text](link).
function inline(md: string): string {
  return md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
}

async function stopPlaying(): Promise<void> {
  if (!playing) return;
  (await initStrudel()).scheduler.stop();
  playing.button.textContent = 'Play';
  playing = null;
}

async function play(row: StrudelRow, button: HTMLButtonElement): Promise<void> {
  const wasThis = playing?.id === row.id;
  await stopPlaying();
  if (wasThis) return;
  const engine = await initStrudel();
  try {
    if (row.needsSamples) await loadDefaultSamples();
    if (row.needsBundled) await bundledSamples(BUNDLED_SAMPLES);
    engine.scheduler.setPattern(await engine.evaluate(row.code!));
    engine.scheduler.start();
    playing = { id: row.id, button };
    button.textContent = 'Stop';
  } catch (err) {
    show(row.id, { ok: false, detail: String((err as Error)?.message ?? err), ms: 0 });
  }
}

const bar = el('div', 'bar');
const runAll = el('button', undefined, 'Test all');
const audible = el('label');
const box = el('input');
box.type = 'checkbox';
box.checked = true;
box.onchange = () => (env.audible = box.checked);
audible.append(box, ' sound during tests');
bar.append(runAll, audible, summary);
app.append(bar);

const resultEls = new Map<string, HTMLDivElement>();
for (const group of GROUPS) {
  app.append(el('h2', undefined, group));
  for (const row of ROWS.filter((r) => r.group === group)) {
    const card = el('div', 'row');
    const name = el('div', 'name');
    name.innerHTML = inline(row.name) + `<span class="badge ${row.covered}">${row.covered}</span>`;
    const buttons = el('div', 'buttons');
    const how = el('div', 'how');
    how.innerHTML = inline(row.how);
    const result = el('div', 'result');
    resultEls.set(row.id, result);
    card.append(name, buttons, how);
    if (row.code) {
      // The web plays every row; the badge says whether React Native can.
      const playButton = el('button', undefined, 'Play');
      playButton.onclick = () => void play(row, playButton);
      const testButton = el('button', undefined, 'Test');
      testButton.onclick = async () => {
        await stopPlaying();
        testButton.disabled = true;
        result.textContent = 'testing…';
        show(row.id, await runStrudelRow(row, env));
        testButton.disabled = false;
      };
      buttons.append(playButton, testButton);
      card.append(el('code', 'pattern', row.code));
    } else {
      const none = el('button', undefined, 'Not implemented on React Native');
      none.disabled = true;
      buttons.append(none);
    }
    card.append(result);
    app.append(card);
  }
}

function show(id: string, r: StrudelResult): void {
  results.set(id, r);
  const e = resultEls.get(id)!;
  e.className = `result ${r.ok ? 'ok' : 'fail'}`;
  e.textContent = `${r.ok ? 'PASS' : 'FAIL'}: ${r.detail} (${r.ms} ms)`;
  summary.textContent = summarizeStrudel(results, ROWS);
}

async function testAll(): Promise<void> {
  await stopPlaying();
  for (const row of ROWS) {
    if (!row.code) continue;
    resultEls.get(row.id)!.textContent = 'testing…';
    show(row.id, await runStrudelRow(row, env));
  }
}

runAll.onclick = async () => {
  runAll.disabled = true;
  await testAll();
  runAll.disabled = false;
};

// `#run` in the URL: test everything on load, silently (for headless/automated checks), and expose the results.
if (location.hash === '#run') {
  env.audible = false;
  env.playMs = 2500;
  void (async () => {
    await testAll();
    (window as unknown as { __results: unknown }).__results = Object.fromEntries(results);
    document.title = 'DONE';
  })();
}
