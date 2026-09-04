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
  // 確認は画面内のダイアログで出す。ネイティブのものが出たら不具合とみなす
  // （スプレッドシートのダイアログでは window.confirm が無視されるため）
  page.on('dialog', d => { errors.push('ネイティブの ' + d.type() + ' が出た: ' + d.message()); d.dismiss(); });
  const answerConfirm = () => page.evaluate(() => {
    const d = document.getElementById('confirmDialog');
    if (!d) return false;
    d.querySelectorAll('.row button')[1].click();
    return true;
  });

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
  await page.waitForTimeout(250);
  check('まとめて完了は画面内の確認を挟む', await answerConfirm());
  await page.waitForTimeout(400);
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

  // ---- スケジュール名 ----
  console.log('\nスケジュール名');
  await page.evaluate(() => document.querySelector('#tabs button[data-view="gantt"]').click());
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(300);
  const named = await page.evaluate(() => ({
    h1: document.getElementById('appTitle').textContent,
    data: DATA.title
  }));
  check('見出しが設定の名前になる', named.h1 === named.data && !!named.data, named.h1);

  const printTitle = await page.evaluate(() => {
    window.print = function () {};
    startPrint();
    const t = document.querySelector('.print-head .t').textContent;
    endPrint();
    return t;
  });
  await page.waitForTimeout(500);
  check('印刷の見出しにも名前が入る',
    printTitle.indexOf(named.data) === 0 && printTitle.indexOf('ガント') > 0, printTitle);

  // ---- 表示サイズ（小・中・大）----
  console.log('\n表示サイズ');
  // 直前のテストで業務別ビューにいるので、ガントに戻す
  await page.evaluate(() => document.querySelector('#tabs button[data-view="gantt"]').click());
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(400);
  const size = s => page.evaluate(v => {
    [...document.querySelectorAll('#zoom button')].find(b => b.textContent === v).click();
  }, s);
  const snap = () => page.evaluate(() => {
    const g = document.getElementById('grid'), sc = document.getElementById('scroll');
    return {
      tick: parseFloat(getComputedStyle(g.querySelector('.tick')).fontSize),
      title: parseFloat(getComputedStyle(g.querySelector('.lane-title')).fontSize),
      dayW: window.dayW,
      labels: g.querySelectorAll('.plabel').length,
      leaders: g.querySelectorAll('.pleader').length,
      used: g.offsetHeight,
      avail: sc.clientHeight,
      laneH: Number(document.querySelector('#zoom button.on').getAttribute('data-h') || 0),
      minLane: Math.min(...[...g.querySelectorAll('.lane')].map(l => l.offsetHeight))
    };
  });

  await size('中'); await page.waitForTimeout(400);
  const mid = await snap();
  await size('大'); await page.waitForTimeout(400);
  const big = await snap();
  await size('小'); await page.waitForTimeout(400);
  const sm = await snap();

  check('大きくすると1日の幅が広がる', big.dayW > mid.dayW && mid.dayW > sm.dayW,
    sm.dayW + ' / ' + mid.dayW + ' / ' + big.dayW);
  check('大きくすると文字も大きくなる', big.tick > mid.tick && big.title > mid.title,
    '目盛り ' + mid.tick + '→' + big.tick + ' / 業務名 ' + mid.title + '→' + big.title);
  check('目盛りが 12px 以上ある（従来は 10px）', mid.tick >= 12, String(mid.tick));
  check('業務名が 15px 以上ある（従来は 12px）', mid.title >= 15, String(mid.title));
  check('行が縦の余白ぶん広がる', mid.laneH > 0 && mid.minLane > mid.laneH,
    mid.minLane + ' > ' + mid.laneH);
  check('広げても画面からはみ出さない', mid.used <= mid.avail, mid.used + ' / ' + mid.avail);

  // 選んだサイズが次回に引き継がれること
  const saved = await page.evaluate(() => localStorage.getItem('schedule.size'));
  check('選んだサイズが保存される', saved === '小', String(saved));
  await size('中');
  await page.waitForTimeout(300);

  // ---- 工程名の ON/OFF ----
  console.log('\n工程名の表示');
  const off0 = await snap();
  check('既定では工程名を出さない', off0.labels === 0, String(off0.labels));

  await page.click('#btnLabels');
  await page.waitForTimeout(400);
  const on = await snap();
  check('［工程名］で吹き出しが出る', on.labels > 0, String(on.labels));
  check('引き出し線が吹き出しと同数', on.leaders === on.labels, on.leaders + ' vs ' + on.labels);
  check('押している状態が見て分かる',
    await page.evaluate(() => {
      const b = document.getElementById('btnLabels');
      return b.classList.contains('on') && b.getAttribute('aria-pressed') === 'true';
    }));
  check('ON にしても画面からはみ出さない', on.used <= on.avail, on.used + ' / ' + on.avail);
  // ラベルが行の高さぶん伸びないと、背景が欠けて裏の土日の網掛けが透けて見える
  const labelFit = await page.evaluate(() => [...document.querySelectorAll('#grid .lane')]
    .map(l => Math.round(l.getBoundingClientRect().height
      - l.querySelector('.lane-label').getBoundingClientRect().height)));
  check('業務名の列が行の高さいっぱいに広がる', labelFit.every(d => d <= 1), JSON.stringify(labelFit));

  await page.click('#btnLabels');
  await page.waitForTimeout(400);
  const off1 = await snap();
  check('もう一度押すと消える', off1.labels === 0 && off1.leaders === 0,
    off1.labels + ' / ' + off1.leaders);
  check('ON/OFF が保存される',
    await page.evaluate(() => localStorage.getItem('schedule.labels')) === 'off');

  await page.evaluate(() => document.querySelector('#tabs button[data-view="month"]').click());
  await page.waitForTimeout(300);
  check('ガント以外では［工程名］を隠す',
    await page.evaluate(() => document.getElementById('btnLabels').hidden));
  await page.evaluate(() => document.querySelector('#tabs button[data-view="gantt"]').click());
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(OUT, 'gantt-filter.png') });
  await browser.close();

  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
