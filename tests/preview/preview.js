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

function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const page = fs.readFileSync(path.join(ROOT, 'apps-script', 'gantt.html'), 'utf8');
  const mock = fs.readFileSync(path.join(__dirname, 'mock.js'), 'utf8');
  const html =
    '<!doctype html><html><head><meta charset="utf-8">'
    + '<script>' + mock + '</' + 'script></head><body>'
    + page + '</body></html>';
  const file = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(file, html);
  return file;
}

const SHOTS = [
  ['gantt-paper', 'gantt', 'paper'],
  ['work-paper', 'work', 'paper'],
  ['month-paper', 'month', 'paper'],
  ['month-sakura', 'month', 'sakura'],
  ['work-mint', 'work', 'mint'],
  ['gantt-night', 'gantt', 'night']
];

async function shoot(file) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 }, deviceScaleFactor: 2 });

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('file://' + file);
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

const file = build();
console.log('プレビュー: ' + file);
if (process.argv.includes('--shot')) {
  shoot(file).catch(e => { console.error(e.message); process.exit(1); });
}
