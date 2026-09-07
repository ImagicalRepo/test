/**
 * スマホ幅でのスケジュール画面のテスト
 *   node tests/preview/mobile.js
 *
 * 幅390px（スマホ）と幅1400px（PC）の両方を見る。
 * PC側は「スマホ対応を入れて元の見た目が壊れていないか」の確認。
 */
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'out');
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1400, height: 900 };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

/**
 * 画面の外へはみ出している要素の名前を拾う。
 * 空でなければ横スクロールが出ているということ。
 */
function overflowIn(page) {
  return page.evaluate(() => [].slice.call(document.querySelectorAll('*'))
    .filter(function (e) {
      var r = e.getBoundingClientRect();
      if (r.width <= 0 || r.right <= document.documentElement.clientWidth + 2) return false;
      // 横スクロールさせる入れ物（ガントの .scroll、凡例など）の中身は、
      // はみ出していて当たり前なので数えない
      for (var a = e.parentElement; a; a = a.parentElement) {
        var ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll') return false;
      }
      return true;
    })
    .map(function (e) { return e.tagName.toLowerCase() + '.' + (e.className || ''); })
    .filter(function (v, i, a) { return a.indexOf(v) === i; })
    .slice(0, 8));
}

async function main() {
  const { chromium } = require('playwright');
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const errors = [];

  /** 指定した大きさで画面を開く。スマホのときは実機同様タッチ扱いにする */
  async function open(size, mobile) {
    const ctx = await browser.newContext({
      viewport: size, deviceScaleFactor: 2, isMobile: !!mobile, hasTouch: !!mobile
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('dialog', d => { errors.push('ネイティブの ' + d.type() + ' が出た'); d.dismiss(); });
    await page.goto('file://' + path.join(OUT, 'index.html'));
    await page.waitForTimeout(900);
    return { ctx, page };
  }

  // ================= スマホ =================
  console.log('\nスマホ（390×844）');
  let { ctx, page } = await open(PHONE, true);

  const first = await page.evaluate(() => ({
    view: view,
    docW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    tabs: [].slice.call(document.querySelectorAll('#tabs button')).map(b => b.textContent),
    asideShown: document.querySelector('aside').offsetParent !== null,
    headH: Math.round(document.querySelector('header.top').getBoundingClientRect().height),
    cards: document.querySelectorAll('.side-view .card').length,
    labelW: getComputedStyle(document.documentElement).getPropertyValue('--label-w').trim(),
    sc: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc'))
  }));

  check('ページが横にはみ出さない', first.docW <= first.clientW + 1,
    first.docW + 'px / 画面 ' + first.clientW + 'px');
  check('［予定］が最初に開く', first.view === 'side', first.view);
  check('タブが4つになる', first.tabs.join('/') === 'ガント/業務別/月間/予定', first.tabs.join('/'));
  check('左パネルは隠れる', first.asideShown === false);
  check('［予定］に今日やることが並ぶ', first.cards > 0, first.cards + '件');
  check('ヘッダーが2段に収まる', first.headH <= 110, first.headH + 'px');
  check('ラベル列が狭くなる', first.labelW === '132px', first.labelW);
  check('文字の倍率が下がりすぎない', first.sc >= 1.14, String(first.sc));

  // 操作のまとめ（⋯）
  console.log('\n［⋯］');
  check('畳んだ状態では操作が見えない',
    await page.evaluate(() => document.getElementById('btnReload').offsetHeight === 0));
  await page.click('#btnMore');
  await page.waitForTimeout(250);
  const toolState = await page.evaluate(() => ({
    open: document.getElementById('tools').classList.contains('open'),
    aria: document.getElementById('btnMore').getAttribute('aria-expanded'),
    printShown: document.getElementById('btnPrint').offsetHeight > 0
  }));
  check('押すと開く', toolState.open && toolState.printShown);
  check('開いたことが読み上げにも伝わる', toolState.aria === 'true');
  const toolsOver = await overflowIn(page);
  check('開いても横にはみ出さない', toolsOver.length === 0, toolsOver.join(' / '));
  await page.click('#btnMore');
  await page.waitForTimeout(200);
  check('もう一度押すと畳む',
    await page.evaluate(() => !document.getElementById('tools').classList.contains('open')));

  // 月間＝日ごとのリスト
  console.log('\n月間（日ごとのリスト）');
  await page.click('#tabs button[data-view="month"]');
  await page.waitForTimeout(500);
  const month = await page.evaluate(() => {
    const rows = [].slice.call(document.querySelectorAll('.day-row'));
    return {
      grid: document.querySelectorAll('.cal-grid').length,
      rows: rows.length,
      empties: rows.filter(r => !r.querySelectorAll('.ev').length).length,
      today: document.querySelectorAll('.day-row.today').length,
      bar: document.querySelectorAll('.cal-bar').length
    };
  });
  month.over = await overflowIn(page);
  check('7列のマス目にはならない', month.grid === 0);
  check('日ごとの行が並ぶ', month.rows > 0, month.rows + '行');
  check('予定の無い日は出さない', month.empties === 0, month.empties + '行が空');
  check('今日の行が目立つ', month.today === 1, month.today + '行');
  check('月の切り替えは残る', month.bar === 1);
  check('横にはみ出さない', month.over.length === 0, month.over.join(' / '));

  await page.click('.cal-bar button');   // ◀ 前の月へ
  await page.waitForTimeout(400);
  check('前の月に移れる', await page.evaluate(() => document.querySelectorAll('.day-row').length >= 0));

  // ガント
  console.log('\nガント');
  await page.click('#tabs button[data-view="gantt"]');
  await page.waitForSelector('#grid .lane');
  await page.waitForTimeout(500);
  const gantt = await page.evaluate(() => {
    const sc = document.querySelector('.scroll');
    return {
      scrollable: sc.scrollWidth > sc.clientWidth,
      laneMax: Math.max.apply(null, [].slice.call(document.querySelectorAll('.lane'))
        .map(l => Math.round(l.getBoundingClientRect().height))),
      dayW: dayW
    };
  });
  gantt.over = await overflowIn(page);
  check('日付軸は横スクロールで見る', gantt.scrollable);
  check('既定は［小］', gantt.dayW === 18, String(gantt.dayW));
  check('業務名が伸びて行が縦長にならない', gantt.laneMax <= 150, gantt.laneMax + 'px');
  check('横にはみ出さない', gantt.over.length === 0, gantt.over.join(' / '));

  // 詳細カード＝下からのシート
  console.log('\n詳細カード');
  await page.evaluate(() => document.querySelector('#grid .mark').click());
  await page.waitForTimeout(400);
  const sheet = await page.evaluate(() => {
    const b = document.getElementById('detail');
    const r = b.getBoundingClientRect();
    return {
      sheet: b.classList.contains('sheet'),
      inside: r.left >= 0 && r.right <= document.documentElement.clientWidth + 1
        && r.bottom <= window.innerHeight + 1,
      box: Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
    };
  });
  check('下からのシートで開く', sheet.sheet);
  check('画面の中に収まる', sheet.inside, sheet.box);

  await page.screenshot({ path: path.join(OUT, 'phone-gantt.png') });
  await ctx.close();

  // ================= PC（退行の確認） =================
  console.log('\nPC（1400×900）で今までどおりか');
  ({ ctx, page } = await open(DESKTOP, false));
  const pc = await page.evaluate(() => ({
    view: view,
    asideW: Math.round(document.querySelector('aside').getBoundingClientRect().width),
    sideTabShown: document.querySelector('#tabs button[data-view="side"]').offsetParent !== null,
    moreShown: document.getElementById('btnMore').offsetParent !== null,
    reloadShown: document.getElementById('btnReload').offsetHeight > 0,
    // 折り返していないか。折り返すとヘッダーは一番高い操作の2倍以上になる
    headH: Math.round(document.querySelector('header.top').getBoundingClientRect().height),
    tallest: Math.round(Math.max.apply(null,
      [].slice.call(document.querySelectorAll('header.top > *, #tools > *'))
        .filter(e => e.offsetParent !== null && e.id !== 'tools')
        .map(e => e.getBoundingClientRect().height))),
    labelW: getComputedStyle(document.documentElement).getPropertyValue('--label-w').trim()
  }));
  check('ガントが最初に開く', pc.view === 'gantt', pc.view);
  check('左パネルは今までの幅', pc.asideW === 296, pc.asideW + 'px');
  check('［予定］タブは出さない', pc.sideTabShown === false);
  check('［⋯］も出さない', pc.moreShown === false);
  check('操作は畳まずそのまま並ぶ', pc.reloadShown);
  check('ヘッダーは1段のまま', pc.headH < pc.tallest * 2,
    'ヘッダー ' + pc.headH + 'px / 一番高い操作 ' + pc.tallest + 'px');
  check('ラベル列は260px', pc.labelW === '260px', pc.labelW);

  await page.click('#tabs button[data-view="month"]');
  await page.waitForTimeout(400);
  const pcMonth = await page.evaluate(() => ({
    grid: document.querySelectorAll('.cal-grid').length,
    cols: getComputedStyle(document.querySelector('.cal-grid')).gridTemplateColumns.split(' ').length,
    list: document.querySelectorAll('.day-list').length
  }));
  check('月間は7列のカレンダーのまま', pcMonth.grid === 1 && pcMonth.cols === 7,
    pcMonth.cols + '列');
  check('日ごとのリストにはならない', pcMonth.list === 0);
  await ctx.close();

  // ================= 幅をまたいだとき =================
  console.log('\n幅をまたいだとき');
  ({ ctx, page } = await open(PHONE, false));
  check('狭いときは［予定］', await page.evaluate(() => view) === 'side');
  await page.setViewportSize(DESKTOP);
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({
    view: view,
    aside: document.querySelector('aside').offsetParent !== null,
    lanes: document.querySelectorAll('#grid .lane').length
  }));
  check('広げると［予定］に取り残されない', back.view === 'gantt', back.view);
  check('左パネルが戻る', back.aside);
  check('ガントが組み直される', back.lanes > 0, back.lanes + '行');

  await page.setViewportSize(PHONE);
  await page.waitForTimeout(600);
  const again = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    sc: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sc'))
  }));
  check('狭めても横にはみ出さない', again.docW <= again.clientW + 1,
    again.docW + 'px / ' + again.clientW + 'px');
  check('文字の倍率が当て直される', again.sc >= 1.14, String(again.sc));
  await ctx.close();

  await browser.close();
  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
