/**
 * 業務がたくさんあるときの表示のテスト
 *   node tests/preview/scale.js
 *
 * 業務25個・工程350のモック（stress-mock.js）で、
 * 凡例と吹き出しがガント本体の高さを食い潰さないことを見る。
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
  // 縦680px。ノートPCでよくある高さで、いちばん厳しい条件になる
  const page = await browser.newPage({ viewport: { width: 1400, height: 680 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => { errors.push('ネイティブの ' + d.type() + ' が出た'); d.dismiss(); });

  await page.goto('file://' + path.join(OUT, 'stress.html'));
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(900);

  /** いまの高さの内訳と、実際に何行見えているか */
  const shape = () => page.evaluate(() => {
    const H = e => (e ? Math.round(e.getBoundingClientRect().height) : 0);
    const sc = document.querySelector('.scroll');
    const box = sc.getBoundingClientRect();
    const lanes = [].slice.call(document.querySelectorAll('#grid .lane'));
    return {
      mode: labelMode,
      legend: H(document.querySelector('.legend')),
      legendRows: new Set([].slice.call(document.querySelectorAll('.legend .chip'))
        .map(c => Math.round(c.getBoundingClientRect().top))).size,
      scroll: H(sc),
      laneMax: Math.max.apply(null, lanes.map(H)),
      visible: lanes.filter(l => {
        const r = l.getBoundingClientRect();
        return r.bottom > box.top + 1 && r.top < box.bottom - 1;
      }).length,
      stack: Math.max(0, ...lanes.map(l => {
        const ls = [].slice.call(l.querySelectorAll('.plabel')).filter(x => !x.hidden);
        return ls.length ? new Set(ls.map(x => x.style.bottom)).size : 0;
      })),
      clipped: document.querySelectorAll('.lane-sub .clipped').length,
      btn: document.getElementById('btnLabels').textContent
    };
  });

  // ---- 凡例 ----
  console.log('\n凡例（業務25個）');
  const s0 = await shape();
  check('凡例は1行に収まる', s0.legendRows === 1, s0.legendRows + '行 / ' + s0.legend + 'px');
  check('高さを取りすぎない', s0.legend <= 60, s0.legend + 'px');
  check('チップは横スクロールで全部たどれる',
    await page.evaluate(() => {
      const st = document.querySelector('.legend-strip');
      return st.scrollWidth > st.clientWidth
        && st.querySelectorAll('.chip').length === DATA.works.length;
    }));
  check('［業務を選ぶ］が出ている',
    await page.evaluate(() => !!document.querySelector('.legend-pick')));
  check('工程名OFFで8行前後見える', s0.visible >= 7, s0.visible + '行 / 本体 ' + s0.scroll + 'px');

  // ---- 吹き出しの3段階 ----
  console.log('\n工程名（なし／4段／全部）');
  check('既定はなし', s0.mode === 'off' && s0.btn === '工程名', s0.btn);

  await page.click('#btnLabels');
  await page.waitForTimeout(700);
  const s1 = await shape();
  check('［4段］に替わる', s1.mode === 'cap' && s1.btn === '工程名 4段', s1.btn);
  check('段数が4を超えない', s1.stack <= 4, s1.stack + '段');
  check('1行が高くなりすぎない', s1.laneMax <= 130, s1.laneMax + 'px');
  check('隠した件数を業務名の欄に出す', s1.clipped > 0, s1.clipped + '行に表示');
  check('4段でも5行前後見える', s1.visible >= 4, s1.visible + '行');

  await page.click('#btnLabels');
  await page.waitForTimeout(700);
  const s2 = await shape();
  check('［全部］に替わる', s2.mode === 'all' && s2.btn === '工程名 全部', s2.btn);
  check('段数の上限が外れる', s2.stack > 4, s2.stack + '段');
  check('隠した件数の表示は消える', s2.clipped === 0, s2.clipped + '行');
  check('丸は全部残っている',
    await page.evaluate(() => document.querySelectorAll('#grid .mark').length > 300));

  await page.click('#btnLabels');
  await page.waitForTimeout(500);
  check('3回目でなしに戻る', (await shape()).mode === 'off');

  // ---- ［業務を選ぶ］ ----
  console.log('\n業務を選ぶ');
  await page.click('.legend-pick');
  await page.waitForTimeout(400);
  check('全業務が一覧に出る',
    await page.evaluate(() => document.querySelectorAll('.pk-row').length === DATA.works.length));
  await page.fill('.picker input[type=search]', '20260917');
  await page.waitForTimeout(300);
  const found = await page.evaluate(() => document.querySelectorAll('.pk-row').length);
  check('業務名で絞り込める', found > 0 && found < 25, found + '件');

  // ［なし］は絞り込んで見えているものだけに効く
  await page.evaluate(() => {
    [].slice.call(document.querySelectorAll('.picker .find button'))
      .filter(b => b.textContent === 'なし')[0].click();
  });
  await page.waitForTimeout(250);
  check('［なし］は表示中の業務にだけ効く',
    (await page.evaluate(() => document.querySelector('.picker .count').textContent))
      === '25 件中 ' + (25 - found) + ' 件を表示');

  const beforeLanes = await page.evaluate(() => document.querySelectorAll('#grid .lane').length);
  check('［適用］を押すまで画面は変わらない', beforeLanes === 25, String(beforeLanes));

  await page.evaluate(() => {
    [].slice.call(document.querySelectorAll('.picker .row button'))
      .filter(b => b.textContent === '適用')[0].click();
  });
  await page.waitForTimeout(700);
  const applied = await page.evaluate(() => ({
    lanes: document.querySelectorAll('#grid .lane').length,
    pick: document.querySelector('.legend-pick').textContent,
    saved: (localStorage.getItem('schedule.hidden') || '').split(',').filter(Boolean).length,
    open: document.querySelectorAll('#workPicker').length
  }));
  check('適用すると行が減る', applied.lanes === 25 - found, applied.lanes + '行');
  check('モーダルが閉じる', applied.open === 0);
  check('何件表示中かがボタンに出る',
    applied.pick.indexOf((25 - found) + '/25') >= 0, applied.pick);
  check('選んだ内容が保存される', applied.saved === found, applied.saved + '件を記憶');

  // 開き直しても同じ絞り込みで始まる
  await page.reload();
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(800);
  check('開き直しても絞り込みが残る',
    await page.evaluate(() => document.querySelectorAll('#grid .lane').length) === 25 - found);

  // ---- 月間・業務別も同じ仕組みか ----
  console.log('\n月間と業務別');
  await page.click('#tabs button[data-view="month"]');
  await page.waitForTimeout(600);
  check('月間にも［業務を選ぶ］がある',
    await page.evaluate(() => !!document.querySelector('.legend-pick')));
  check('月間の凡例も1行',
    await page.evaluate(() => new Set([].slice.call(document.querySelectorAll('.legend .chip'))
      .map(c => Math.round(c.getBoundingClientRect().top))).size) === 1);

  await page.click('#tabs button[data-view="work"]');
  await page.waitForTimeout(600);
  check('業務別にも［業務を選ぶ］がある',
    await page.evaluate(() => !!document.querySelector('.legend-pick')));
  await page.click('.legend-pick');
  await page.waitForTimeout(400);
  const single = await page.evaluate(() => ({
    title: document.querySelector('.picker h3').textContent,
    radios: document.querySelectorAll('.pk-row input[type=radio]').length,
    bulk: document.querySelectorAll('.picker .find button').length
  }));
  check('業務別は1つだけ選ぶ形になる', single.radios === 25, String(single.radios));
  check('見出しが「見る業務を選ぶ」', single.title === '見る業務を選ぶ', single.title);
  check('［すべて］［なし］は出さない', single.bulk === 0, String(single.bulk));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  check('Escape で閉じる',
    await page.evaluate(() => document.querySelectorAll('#workPicker').length === 0));

  await page.click('#tabs button[data-view="gantt"]');
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'scale-gantt.png') });
  await browser.close();

  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
