/**
 * スケジュール画面の操作テスト
 *   node tests/preview/gantt.js
 */
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'out');
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

async function main() {
  const { chromium } = require('playwright');
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('file://' + path.join(OUT, 'index.html'));
  await page.waitForSelector('.lane');
  await page.waitForTimeout(700);

  // ---- B. 完了にした結果がその場で反映されること ----
  console.log('\n完了の即時反映');
  const before = await page.evaluate(() => {
    // 期限超過の1件目を開く
    document.querySelector('#side .card.overdue').click();
    return {
      overdue: DATA.digest.overdue.length,
      total: DATA.digest.total,
      calls: window.MOCK_CALLS.getGanttData || 0,
      marks: document.querySelectorAll('#grid .mark.done').length
    };
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#detail .actions button')]
      .find(b => b.textContent === '完了');
    btn.click();
  });
  // サーバー応答1回ぶんだけ待つ（全体の取り直しは待たない）
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    overdue: DATA.digest.overdue.length,
    total: DATA.digest.total,
    calls: window.MOCK_CALLS.getGanttData || 0,
    marks: document.querySelectorAll('#grid .mark.done').length,
    cards: document.querySelectorAll('#side .card.overdue').length,
    detailOpen: !!document.getElementById('detail').className
  }));
  check('左パネルから消える', after.overdue === before.overdue - 1,
    before.overdue + ' → ' + after.overdue);
  check('件数が減る', after.total === before.total - 1, before.total + ' → ' + after.total);
  check('ガントの丸が完了表示になる', after.marks === before.marks + 1,
    before.marks + ' → ' + after.marks);
  check('全体の取り直しをしない', after.calls === before.calls,
    'getGanttData が ' + (after.calls - before.calls) + ' 回呼ばれた');
  check('詳細が閉じる', !after.detailOpen);

  // ---- I. 検索と担当の絞り込み ----
  console.log('\n検索と担当の絞り込み');
  await page.fill('#q', '発送');
  await page.waitForTimeout(400);
  const q = await page.evaluate(() => ({
    note: !!document.querySelector('.filter-note'),
    marks: document.querySelectorAll('#grid .mark').length,
    names: [...document.querySelectorAll('#grid .mark')].map(m => m.title),
    side: document.querySelectorAll('#side .card').length
  }));
  check('絞り込み中の注記が出る', q.note);
  check('該当する工程だけ残る', q.marks > 0 && q.names.every(t => t.includes('発送')),
    q.marks + '件 / ' + JSON.stringify(q.names.slice(0, 3)));
  check('左パネルにも効く', q.side === 0, q.side + '件残っている');

  // 月間・業務別にも効くこと
  for (const v of ['month', 'work']) {
    await page.evaluate((v) => {
      view = v;
      document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
      movePill(); renderView();
    }, v);
    await page.waitForTimeout(250);
    const ok = await page.evaluate(() => !!document.querySelector('.filter-note'));
    check((v === 'month' ? '月間' : '業務別') + 'ビューにも効く', ok);
  }

  await page.evaluate(() => { view = 'gantt'; renderView(); clearFilter(); });
  await page.waitForTimeout(350);
  const cleared = await page.evaluate(() => ({
    note: !!document.querySelector('.filter-note'),
    q: document.getElementById('q').value
  }));
  check('「すべて表示に戻す」で解除できる', !cleared.note && cleared.q === '');

  // 担当での絞り込み
  const owners = await page.evaluate(() => [...document.getElementById('ownerSel').options].map(o => o.value));
  check('担当の選択肢が実データから作られる', owners.length > 1, JSON.stringify(owners));
  await page.selectOption('#ownerSel', owners[1]);
  await page.waitForTimeout(300);
  const byOwner = await page.evaluate(() => {
    const names = [];
    DATA.lanes.forEach(l => laneItems(l).forEach(i => names.push(i.owner)));
    return { all: names, note: !!document.querySelector('.filter-note') };
  });
  check('担当で絞り込める', byOwner.note && byOwner.all.every(o => o === owners[1]),
    JSON.stringify(byOwner.all.slice(0, 5)));
  await page.evaluate(() => clearFilter());
  await page.waitForTimeout(300);

  // ---- H. 回次まるごとの操作 ----
  console.log('\n回次まるごとの操作');
  await page.evaluate(() => {
    view = 'work';
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === 'work'));
    movePill(); renderView();
  });
  await page.waitForTimeout(300);
  const bulkBefore = await page.evaluate(() => {
    const lane = DATA.lanes.find(l => l.workId === selectedWork);
    return { notDone: lane.items.filter(i => i.status !== '完了').length, laneKey: lane.laneKey };
  });
  await page.evaluate(() => {
    document.querySelector('.kase-bulk button').click();
  });
  await page.waitForTimeout(300);
  const bulkAfter = await page.evaluate(() => {
    const lane = DATA.lanes.find(l => l.laneKey === DATA.lanes.find(x => x.workId === selectedWork).laneKey);
    return {
      notDone: lane.items.filter(i => i.status !== '完了').length,
      doneCount: lane.doneCount,
      total: lane.items.length,
      calls: window.MOCK_CALLS.updateItemsStatus || 0
    };
  });
  check('まとめて完了で全件が完了になる', bulkAfter.notDone === 0,
    bulkBefore.notDone + ' → ' + bulkAfter.notDone);
  check('進捗の分子が更新される', bulkAfter.doneCount === bulkAfter.total,
    bulkAfter.doneCount + '/' + bulkAfter.total);
  check('一括更新は1回の呼び出しで済む', bulkAfter.calls === 1, bulkAfter.calls + ' 回');

  // ---- D. 基準日はカレンダーで選ぶ ----
  console.log('\n基準日の変更');
  const anchor = await page.evaluate(() => {
    const a = [...document.querySelectorAll('.kase-anchor a')][0];
    if (!a) return null;
    a.click();
    return true;
  });
  await page.waitForTimeout(250);
  const dlg = await page.evaluate(() => {
    const d = document.getElementById('dateDialog');
    if (!d) return null;
    const input = d.querySelector('input[type=date]');
    return { open: true, type: input.type, value: input.value };
  });
  check('基準日リンクでダイアログが開く', anchor && dlg && dlg.open);
  check('日付はカレンダーで選ぶ（prompt ではない）', dlg && dlg.type === 'date', dlg && dlg.type);
  check('いまの基準日が入っている', dlg && /^\d{4}-\d{2}-\d{2}$/.test(dlg.value), dlg && dlg.value);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => !document.getElementById('dateDialog'));
  check('Escape で閉じる', closed);

  await page.screenshot({ path: path.join(OUT, 'gantt-filter.png') });
  await browser.close();

  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
