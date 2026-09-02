/**
 * 工程テンプレート編集画面の操作テスト
 *
 * 入力中に再描画が走ると、打った文字が消えたりカレンダーが閉じたりする。
 * 実際にキーを打って、値が残っていること・DOM が作り直されていないことを確かめる。
 *   node tests/preview/interact.js
 */
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'out');
const EDITOR = 'file://' + path.join(OUT, 'editor.html');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

async function main() {
  if (!fs.existsSync(path.join(OUT, 'editor.html'))) {
    console.error('先に node tests/preview/preview.js を実行してください');
    process.exit(1);
  }
  const { chromium } = require('playwright');
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await browser.newPage({ viewport: { width: 1150, height: 860 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(EDITOR);
  await page.waitForSelector('.step');
  await page.waitForTimeout(600);

  // ---- 工程名を打っている間、DOM が作り直されないこと ----
  console.log('\n工程名の入力');
  await page.evaluate(() => {
    const inp = document.querySelector('.step .name-row input');
    inp.__mark = 'keepme';
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  });
  await page.keyboard.type('あいうえお', { delay: 40 });
  await page.waitForTimeout(900); // プレビューの待ち時間より長く待つ
  const nameState = await page.evaluate(() => {
    const inp = document.querySelector('.step .name-row input');
    return { value: inp.value, same: inp.__mark === 'keepme', focused: document.activeElement === inp };
  });
  check('打った文字が残る', nameState.value.endsWith('あいうえお'), nameState.value);
  check('入力欄が作り直されない', nameState.same);
  check('フォーカスが外れない', nameState.focused);

  // ---- 日付欄：プレビュー更新をまたいでも同じ要素のままであること ----
  console.log('\n日付の入力');
  await page.evaluate(() => {
    // 日付指定の工程（研修期間）を探す
    const cards = [...document.querySelectorAll('.step')];
    const card = cards.find(c => c.querySelector('input[type=date]'));
    const d = card.querySelector('input[type=date]');
    d.__mark = 'keepme';
    d.focus();
    window.__dateIndex = card.dataset.index;
  });
  await page.evaluate(() => {
    const d = document.querySelector('.step input[type=date]');
    d.value = '2026-10-05';
    d.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  const dateState = await page.evaluate(() => {
    const d = document.querySelector('.step input[type=date]');
    return { value: d.value, same: d.__mark === 'keepme', focused: document.activeElement === d };
  });
  check('入れた日付が残る', dateState.value === '2026-10-05', dateState.value);
  check('日付欄が作り直されない（カレンダーが閉じない）', dateState.same);
  check('フォーカスが外れない', dateState.focused);

  // ---- 集計行が重複しないこと（応答が前後しても） ----
  console.log('\nプレビューの集計行');
  await page.evaluate(() => {
    // 1回目の応答をわざと遅らせ、2回目が先に返るようにする
    let n = 0;
    window.MOCK_DELAY = () => (++n === 1 ? 400 : 20);
  });
  await page.evaluate(() => { preview(); preview(); });
  await page.waitForTimeout(900);
  const sum = await page.evaluate(() => ({
    summaries: document.querySelectorAll('#pvSummary .pv-summary').length,
    lists: document.querySelectorAll('#preview .pv-list').length
  }));
  check('「◯工程 全体で◯日間」が1つだけ', sum.summaries === 1, '見つかった数: ' + sum.summaries);
  check('工程一覧が1つだけ', sum.lists === 1, '見つかった数: ' + sum.lists);
  await page.evaluate(() => { window.MOCK_DELAY = () => 10; });

  // ---- 起点の日が無い業務 ----
  console.log('\n起点の日がない業務');
  await page.selectOption('#workSel', 'W4');
  await page.waitForTimeout(900);
  const noAnchor = await page.evaluate(() => ({
    anchorInput: document.getElementById('anchorInput').value,
    waiting: document.querySelectorAll('#preview .pv-waiting').length,
    waitBadges: document.querySelectorAll('.step .due.wait').length,
    dated: [...document.querySelectorAll('#preview .pv-item .pv-name')].map(e => e.textContent)
  }));
  check('起点の入力欄が空になる', noAnchor.anchorInput === '', noAnchor.anchorInput);
  check('日付指定の工程は日付が出る', noAnchor.dated.length === 2, JSON.stringify(noAnchor.dated));
  check('起点が要る工程は案内が出る', noAnchor.waiting === 1);
  check('その工程のバッジが「起点の日が必要」', noAnchor.waitBadges === 1);
  await page.screenshot({ path: path.join(OUT, 'editor-noanchor.png') });

  // ---- 業務の追加で前の入力が残らないこと ----
  console.log('\n業務の追加');
  await page.evaluate(() => { window.prompt = () => 'テスト業務'; });
  await page.click('#btnAddWork');
  await page.waitForTimeout(1000);
  const added = await page.evaluate(() => ({
    selected: document.getElementById('workSel').value,
    label: document.getElementById('workSel').selectedOptions[0].textContent,
    steps: document.querySelectorAll('.step').length,
    pvItems: document.querySelectorAll('#preview .pv-item').length,
    summaries: document.querySelectorAll('#pvSummary .pv-summary').length
  }));
  check('新しい業務が選ばれる', added.label === 'テスト業務', added.label + ' / ' + added.selected);
  check('工程が引き継がれない', added.steps === 0, added.steps + ' 件残っている');
  check('プレビューが空になる', added.pvItems === 0 && added.summaries === 0);

  // ---- 工程を追加したときの既定 ----
  console.log('\n工程の既定');
  await page.click('#btnAddRow');
  await page.waitForTimeout(400);
  const def = await page.evaluate(() => {
    const card = document.querySelector('.step');
    return {
      mode: card.querySelector('.sentence select').value,
      date: (card.querySelector('input[type=date]') || {}).value
    };
  });
  check('既定は「日付指定」', def.mode === '日付指定', def.mode);
  check('日付に今日が入る', def.date === '2026-09-09', def.date);

  // ---- 前の工程を基準にできること ----
  console.log('\n他の工程を基準にする');
  await page.selectOption('#workSel', 'NAN');
  await page.waitForTimeout(700);
  const baseSel = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('[data-focus="base"]')];
    // 前の工程を基準にしている行（「審査結果の整理・記録作成」など）を見る
    const sel = sels.find(s => s.value !== '') || sels[0];
    return {
      groups: [...sel.querySelectorAll('optgroup')].map(g => g.label),
      steps: [...sel.querySelectorAll('optgroup')].slice(1).flatMap(
        g => [...g.querySelectorAll('option')].map(o => o.value)),
      value: sel.value
    };
  });
  check('「起点」と「他の工程」が分かれている', baseSel.groups.length === 2, JSON.stringify(baseSel.groups));
  check('他の工程が選択肢に並ぶ', baseSel.steps.length > 3, baseSel.steps.length + ' 件');
  check('前の工程が基準として選ばれている', baseSel.value !== '', baseSel.value);

  // ---- 打っている最中は計算し直さないこと ----
  console.log('\n入力中は再計算しない');
  const before = await page.evaluate(() => {
    document.querySelector('.step .name-row input').focus();
    return window.MOCK_CALLS.previewSchedule || 0;
  });
  await page.keyboard.type('かきくけこ', { delay: 60 });
  await page.waitForTimeout(700);
  const duringTyping = await page.evaluate(() => window.MOCK_CALLS.previewSchedule || 0);
  check('打っている間は1回も計算しない', duringTyping === before,
    (duringTyping - before) + ' 回呼ばれた');
  const stale = await page.evaluate(() => document.getElementById('preview').classList.contains('stale'));
  check('未反映であることが見て分かる', stale);
  await page.evaluate(() => document.querySelector('.step .name-row input').blur());
  await page.waitForTimeout(500);
  const afterBlur = await page.evaluate(() => window.MOCK_CALLS.previewSchedule || 0);
  check('欄から離れたら1回だけ計算する', afterBlur - before === 1, (afterBlur - before) + ' 回');
  const cleared = await page.evaluate(() => document.getElementById('preview').classList.contains('stale'));
  check('反映されたら薄い表示が戻る', !cleared);

  await page.screenshot({ path: path.join(OUT, 'editor-interact.png'), fullPage: false });
  await browser.close();

  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
