#!/usr/bin/env node
'use strict';

// Renders e2e-admin/results/dashboard.json into a single self-contained HTML
// page (e2e-admin/results/dashboard.html) for publishing as an Artifact.
//
// The reporter decides WHAT is true; this file only decides how it reads.
// Keep it that way - no test knowledge here, so the page can be regenerated
// from any run's json without re-running anything.
//
// Ordering is by severity, not by area id: what needs attention sorts to the
// top. That is the only structural device on the page, and it encodes
// something true rather than decorating.

const fs = require('node:fs');
const path = require('node:path');

const RESULTS_DIR = path.join(__dirname, '..', 'e2e-admin', 'results');
const IN = path.join(RESULTS_DIR, 'dashboard.json');
const OUT = path.join(RESULTS_DIR, 'dashboard.html');

if (!fs.existsSync(IN)) {
  console.error(`No results at ${IN} - run \`npm run e2e:admin\` first.`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(IN, 'utf8'));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const RANK = { red: 0, unknown: 1, yellow: 2, green: 3 };
const areas = [...data.areas].sort(
  (a, b) => RANK[a.status] - RANK[b.status] || a.title.localeCompare(b.title));

const STATUS_WORD = {
  red: 'Broken', yellow: 'Unreliable', green: 'Healthy', unknown: 'Untested',
};

const fmtDuration = (ms) => {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

const generated = new Date(data.generatedAt);
const stamp = generated.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const t = data.totals;

const summaryCards = [
  ['broken', t.red, 'Broken', 'areas with a failing test'],
  ['unreliable', t.yellow, 'Unreliable', 'flaky or partly skipped'],
  ['healthy', t.green, 'Healthy', 'every test passing'],
  ['untested', t.unknown, 'Untested', 'no test covers this yet'],
].map(([cls, n, label, hint]) => `
      <div class="tile tile--${cls}">
        <div class="tile__n">${n}</div>
        <div class="tile__label">${label}</div>
        <div class="tile__hint">${esc(hint)}</div>
      </div>`).join('');

const areaCards = areas.map((a) => {
  const counts = [
    a.passed ? `${a.passed} passed` : null,
    a.failed ? `${a.failed} failed` : null,
    a.flaky ? `${a.flaky} flaky` : null,
    a.skipped ? `${a.skipped} skipped` : null,
  ].filter(Boolean).join(' · ') || 'no tests ran';

  const failures = a.failures.map((f) => `
        <div class="failure">
          <div class="failure__head">
            <span class="failure__kind">${esc(f.kind)}</span>
            <span class="failure__test">${esc(f.test)}</span>
          </div>
          <p class="failure__what"><span class="lbl">What broke</span>${esc(f.explanation)}</p>
          <p class="failure__fix"><span class="lbl">Suggested fix</span>${esc(f.suggestion)}</p>
          <div class="failure__where">${esc(f.file)}:${f.line}</div>
          <pre class="failure__raw">${esc(f.raw)}</pre>
        </div>`).join('');

  const body = a.status === 'unknown'
    ? `<p class="area__none">Nothing in this suite exercises this area yet, so its state is unknown — not green. Treat an untested area as a gap, not as working.</p>`
    : failures || `<p class="area__ok">Every check in this area passed.</p>`;

  const note = a.dataCoveredBy
    ? `<p class="area__layer"><span class="lbl">Data covered elsewhere</span>${esc(a.dataCoveredBy)} — this suite only asserts what the browser can uniquely break.</p>`
    : '';

  return `
      <article class="area area--${a.status}">
        <header class="area__head">
          <div class="area__title-row">
            <h2 class="area__title">${esc(a.title)}</h2>
            <span class="pill pill--${a.status}">${STATUS_WORD[a.status]}</span>
          </div>
          <p class="area__owns">${esc(a.owns)}</p>
          <div class="area__meta">
            <span class="counts">${esc(counts)}</span>
            <span class="dur">${fmtDuration(a.durationMs)}</span>
          </div>
        </header>
        ${note}
        <div class="area__body">${body}</div>
      </article>`;
}).join('');

const html = `<title>Admin Suite Health</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
  /* Light palette on bare :root. Neutrals carry a blue bias toward the
     admin app's own navy identity rather than sitting at pure grey. */
  :root {
    --paper: #f6f7f9;
    --surface: #ffffff;
    --surface-2: #eef1f5;
    --ink: #151a22;
    --ink-2: #4a5462;
    --ink-3: #7b8595;
    --rule: #dde2e9;
    --accent: #3f5f96;
    --ok: #2e7d54;
    --warn: #a8731a;
    --bad: #a93b32;
    --ok-bg: #e8f3ec;
    --warn-bg: #f8f0dd;
    --bad-bg: #f8e9e7;
    --unknown-bg: #eceff4;
    --shadow: 0 1px 2px rgba(21, 26, 34, .06), 0 4px 16px rgba(21, 26, 34, .05);
  }
  /* System-dark (no stamp) - guarded so an explicit light choice wins. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper: #0e1218;
      --surface: #161c25;
      --surface-2: #1e2632;
      --ink: #e7ecf3;
      --ink-2: #a8b3c2;
      --ink-3: #6f7c8d;
      --rule: #29323f;
      --accent: #7d9dd4;
      --ok: #5fc08a;
      --warn: #dfa945;
      --bad: #e07a70;
      --ok-bg: #14261c;
      --warn-bg: #2a2213;
      --bad-bg: #2a1917;
      --unknown-bg: #1c2330;
      --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 4px 16px rgba(0, 0, 0, .25);
    }
  }
  /* Explicit dark choice wins in the other direction. */
  :root[data-theme="dark"] {
    --paper: #0e1218;
    --surface: #161c25;
    --surface-2: #1e2632;
    --ink: #e7ecf3;
    --ink-2: #a8b3c2;
    --ink-3: #6f7c8d;
    --rule: #29323f;
    --accent: #7d9dd4;
    --ok: #5fc08a;
    --warn: #dfa945;
    --bad: #e07a70;
    --ok-bg: #14261c;
    --warn-bg: #2a2213;
    --bad-bg: #2a1917;
    --unknown-bg: #1c2330;
    --shadow: 0 1px 2px rgba(0, 0, 0, .3), 0 4px 16px rgba(0, 0, 0, .25);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  .wrap {
    max-width: 1040px;
    margin: 0 auto;
    padding: 48px 24px 96px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  .lbl {
    display: block;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-bottom: 3px;
  }

  /* ---- masthead ---- */
  .masthead { display: flex; flex-direction: column; gap: 10px; }
  .eyebrow {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11px; font-weight: 600; letter-spacing: .14em;
    text-transform: uppercase; color: var(--accent);
  }
  h1 {
    margin: 0;
    font-size: clamp(30px, 4.4vw, 42px);
    font-weight: 700;
    letter-spacing: -.022em;
    text-wrap: balance;
  }
  .standfirst {
    margin: 0; max-width: 64ch; color: var(--ink-2); font-size: 16px;
  }
  .runline {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 12px; color: var(--ink-3);
    display: flex; flex-wrap: wrap; gap: 6px 18px;
    padding-top: 6px; border-top: 1px solid var(--rule); margin-top: 6px;
  }

  /* ---- summary tiles ---- */
  .tiles {
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }
  .tile {
    background: var(--surface); border: 1px solid var(--rule);
    border-radius: 10px; padding: 16px 18px;
    display: flex; flex-direction: column; gap: 2px;
    border-left-width: 4px; box-shadow: var(--shadow);
  }
  .tile--broken { border-left-color: var(--bad); }
  .tile--unreliable { border-left-color: var(--warn); }
  .tile--healthy { border-left-color: var(--ok); }
  .tile--untested { border-left-color: var(--ink-3); }
  .tile__n {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 30px; font-weight: 600; line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }
  .tile--broken .tile__n { color: var(--bad); }
  .tile--unreliable .tile__n { color: var(--warn); }
  .tile--healthy .tile__n { color: var(--ok); }
  .tile__label { font-weight: 600; font-size: 14px; }
  .tile__hint { font-size: 12.5px; color: var(--ink-3); }

  /* ---- area cards ---- */
  .areas { display: flex; flex-direction: column; gap: 16px; }
  .section-head {
    display: flex; align-items: baseline; gap: 12px;
    border-bottom: 1px solid var(--rule); padding-bottom: 8px;
  }
  .section-head h2 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  .section-head .hint { font-size: 13px; color: var(--ink-3); }

  .area {
    background: var(--surface); border: 1px solid var(--rule);
    border-left: 4px solid var(--ink-3);
    border-radius: 10px; padding: 20px 22px;
    display: flex; flex-direction: column; gap: 14px;
    box-shadow: var(--shadow);
  }
  .area--red { border-left-color: var(--bad); }
  .area--yellow { border-left-color: var(--warn); }
  .area--green { border-left-color: var(--ok); }
  .area--unknown { border-left-color: var(--ink-3); }

  .area__head { display: flex; flex-direction: column; gap: 6px; }
  .area__title-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .area__title { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -.015em; }
  .area__owns { margin: 0; color: var(--ink-2); max-width: 70ch; }
  .area__meta {
    display: flex; gap: 16px; flex-wrap: wrap;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums;
  }

  .pill {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 10.5px; font-weight: 600; letter-spacing: .09em;
    text-transform: uppercase; padding: 3px 9px; border-radius: 999px;
    white-space: nowrap;
  }
  .pill--red { background: var(--bad-bg); color: var(--bad); }
  .pill--yellow { background: var(--warn-bg); color: var(--warn); }
  .pill--green { background: var(--ok-bg); color: var(--ok); }
  .pill--unknown { background: var(--unknown-bg); color: var(--ink-2); }

  .area__ok, .area__none { margin: 0; color: var(--ink-3); font-size: 14px; }
  .area__layer {
    margin: 0; font-size: 13px; color: var(--ink-2);
    background: var(--surface-2); border-radius: 8px; padding: 10px 12px;
  }

  .area__body { display: flex; flex-direction: column; gap: 12px; }

  .failure {
    background: var(--bad-bg); border: 1px solid var(--rule);
    border-radius: 8px; padding: 14px 16px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .failure__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .failure__kind {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 10.5px; font-weight: 600; letter-spacing: .08em;
    text-transform: uppercase; color: var(--bad);
    border: 1px solid currentColor; border-radius: 4px; padding: 1px 6px;
  }
  .failure__test { font-weight: 600; font-size: 14.5px; }
  .failure p { margin: 0; font-size: 14px; }
  .failure__where {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 12px; color: var(--ink-3);
  }
  .failure__raw {
    margin: 0; padding: 10px 12px;
    background: var(--surface); border: 1px solid var(--rule); border-radius: 6px;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11.5px; line-height: 1.5; color: var(--ink-2);
    overflow-x: auto; white-space: pre; max-height: 260px; overflow-y: auto;
  }

  footer {
    border-top: 1px solid var(--rule); padding-top: 16px;
    font-size: 13px; color: var(--ink-3);
    display: flex; flex-direction: column; gap: 6px;
  }
  footer code {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 12px; color: var(--ink-2);
  }

  @media (max-width: 640px) {
    .wrap { padding: 32px 16px 64px; gap: 28px; }
  }
</style>

<div class="wrap">
  <header class="masthead">
    <div class="eyebrow">Impact Suite · Admin</div>
    <h1>Admin Suite Health</h1>
    <p class="standfirst">
      ${areas.length} functional areas of the admin back office, each exercised in a real browser
      against the Firebase emulator. An area is red when a person cannot do the thing
      it names.
    </p>
    <div class="runline">
      <span>Run ${esc(stamp)}</span>
      <span>${fmtDuration(data.durationMs)}</span>
      <span>${t.passed} passed · ${t.failed} failed · ${t.flaky} flaky · ${t.skipped} skipped</span>
      <span>project demo-impact</span>
    </div>
  </header>

  <section class="tiles">${summaryCards}
  </section>

  <section class="areas">
    <div class="section-head">
      <h2>By functional area</h2>
      <span class="hint">ordered by what needs attention first</span>
    </div>${areaCards}
  </section>

  <footer>
    <div>Regenerate: <code>npm run emu</code> · <code>npm run emu:seed</code> · <code>npm run e2e:admin</code> · <code>npm run e2e:admin:dashboard</code></div>
    <div>Source of truth is <code>e2e-admin/results/dashboard.json</code>; this page is rendered from it and holds no test knowledge of its own.</div>
  </footer>
</div>
`;

fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log(`Wrote ${OUT}`);
console.log(`  ${t.red} red · ${t.yellow} yellow · ${t.green} green · ${t.unknown} untested`);
