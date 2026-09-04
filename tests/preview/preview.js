/**
 * スケジュール画面をブラウザで描画して確認するための補助スクリプト。
 *
 *   node tests/preview/preview.js            … プレビュー用HTMLを書き出すだけ
 *   node tests/preview/preview.js --shot     … Chromium で各ビュー・各テーマを撮影する
 *
 * Apps Script にデプロイしなくても、モックデータで表示崩れやJSエラーを確認できる。
 * 撮影には playwright が必要（NODE_PATH にグローバルの node_modules を指定すれば使える）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(__dirname, 'out');

/** GAS の API に依存しないコア関数。編集画面のプレビューを本物の計算で動かすために読み込む */
const CORE_FILES = ['00_config.gs', '01_core_date.gs', '02_core_recurrence.gs', '03_core_schedule.gs'];

function wrap(pageFile, scripts) {
  const page = fs.readFileSync(path.join(ROOT, 'apps-script', pageFile), 'utf8');
  const head = scripts.map(src => '<script>' + src + '</' + 'script>').join('\n');
  return '<!doctype html><html><head><meta charset="utf-8">' + head + '</head><body>'
    + page + '</body></html>';
}

/**
 * json.html は Apps Script のテンプレート（<? ?> / <?= ?>）なので、
 * 指定したモードで展開してから素の HTML にする。
 */
function renderJson(mode, payload) {
  let s = fs.readFileSync(path.join(ROOT, 'apps-script', 'json.html'), 'utf8');
  s = s.replace(/<\? if \(mode === 'export'\) \{ \?>([\s\S]*?)<\? \} else \{ \?>([\s\S]*?)<\? \} \?>/g,
    (m, a, b) => (mode === 'export' ? a : b));
  s = s.replace(/<\?= payload \?>/g, payload || '');
  s = s.replace(/<\?= version \?>/g, 'テスト');
  const left = s.match(/<\?[\s\S]*?\?>/g);
  if (left) throw new Error('json.html に展開できないスクリプトレットがあります: ' + left.join(' '));
  return s;
}

function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const core = CORE_FILES.map(f => fs.readFileSync(path.join(ROOT, 'apps-script', f), 'utf8'));

  const main = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(main, wrap('gantt.html', [read('mock.js')]));

  const editor = path.join(OUT_DIR, 'editor.html');
  fs.writeFileSync(editor, wrap('editor.html', core.concat([read('editor-mock.js')])));

  const jsonMock = read('json-mock.js');
  const jsonImport = path.join(OUT_DIR, 'json-import.html');
  fs.writeFileSync(jsonImport, '<!doctype html><html><head><meta charset="utf-8">'
    + '<script>' + jsonMock + '</' + 'script></head><body>' + renderJson('import', '') + '</body></html>');

  return { main, editor, jsonImport };
}

const SHOTS = [
  ['gantt-paper', 'gantt', 'paper'],
  ['work-paper', 'work', 'paper'],
  ['month-paper', 'month', 'paper'],
  ['month-sakura', 'month', 'sakura'],
  ['work-mint', 'work', 'mint'],
  ['gantt-night', 'gantt', 'night']
];

async function shoot(files) {
  const { chromium } = require('playwright');
  // 環境によっては Playwright 同梱の Chromium が入っていないため、あればそちらを使う
  const preinstalled = '/opt/pw-browsers/chromium';
  const launchOpts = fs.existsSync(preinstalled) ? { executablePath: preinstalled } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // 工程テンプレート編集画面
  await page.setViewportSize({ width: 1150, height: 800 });
  await page.goto('file://' + files.editor);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT_DIR, 'editor.png') });
  console.log('  editor.png');

  // スケジュール画面
  await page.setViewportSize({ width: 1400, height: 880 });
  await page.goto('file://' + files.main);
  await page.waitForTimeout(900);

  for (const [name, v, t] of SHOTS) {
    await page.evaluate(([v, t]) => {
      applyTheme(t, false);
      view = v;
      document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
      movePill();
      renderView();
    }, [v, t]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT_DIR, name + '.png') });
    console.log('  ' + name + '.png');
  }

  await browser.close();
  if (errors.length) {
    console.error('\nJSエラーを検出しました:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('\nJSエラーなし');
}

const files = build();
console.log('プレビュー:');
console.log('  スケジュール画面: ' + files.main);
console.log('  工程テンプレート編集: ' + files.editor);
if (process.argv.includes('--shot')) {
  shoot(files).catch(e => { console.error(e.message); process.exit(1); });
}
