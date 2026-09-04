/**
 * 印刷レイアウトの検証
 *
 * 紙に出したときだけ起きるズレは画面では見えないので、
 * print メディアをエミュレートして実際の座標を測る。
 *   node tests/preview/printcheck.js
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

  await page.goto('file://' + path.join(OUT, 'index.html'));
  await page.waitForSelector('.lane');
  await page.waitForTimeout(700);

  // 印刷の組み直しを実行してから print メディアに切り替える
  await page.evaluate(() => { startPrint = startPrint; });
  await page.evaluate(() => {
    // window.print() は止めておく（ダイアログで固まるため）
    window.print = function () {};
    startPrint();
  });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(400);

  // ---- 1. 網掛け（土日祝）と日付の目盛りが合っているか ----
  console.log('\n網掛けと目盛りの位置');
  const align = await page.evaluate(() => {
    const grid = document.getElementById('grid');
    const cells = [...grid.querySelectorAll('.bg-cell')];
    const dayRow = grid.querySelectorAll('.head-row')[1];
    const dayEls = [...dayRow.children].slice(1); // 先頭は head-label
    const gridRect = grid.getBoundingClientRect();

    // 休日の日付だけを、目盛り側の順番で拾う
    const offIdx = [];
    dayEls.forEach((d, i) => { if (d.classList.contains('we')) offIdx.push(i); });

    const worst = { diff: 0, at: -1 };
    const n = Math.min(cells.length, offIdx.length);
    for (let j = 0; j < n; j++) {
      const c = cells[j].getBoundingClientRect();
      const d = dayEls[offIdx[j]].getBoundingClientRect();
      const diff = Math.abs(c.left - d.left);
      if (diff > worst.diff) { worst.diff = diff; worst.at = j; }
    }
    return {
      cells: cells.length, offDays: offIdx.length, compared: n,
      worst: Math.round(worst.diff * 10) / 10, at: worst.at,
      gridW: Math.round(gridRect.width),
      trackW: Math.round(grid.querySelector('.track').getBoundingClientRect().width),
      labelW: Math.round(grid.querySelector('.lane-label').getBoundingClientRect().width),
      bgLeft: Math.round(grid.querySelector('.bg-layer').getBoundingClientRect().left - gridRect.left)
    };
  });
  console.log('    網掛け ' + align.cells + '枚 / 休日の目盛り ' + align.offDays + '個'
    + ' / grid幅 ' + align.gridW + ' / track幅 ' + align.trackW
    + ' / ラベル列 ' + align.labelW + ' / 網掛け層の左 ' + align.bgLeft);
  check('網掛けの枚数と休日の目盛りの数が一致', align.cells === align.offDays,
    align.cells + ' 対 ' + align.offDays);
  check('網掛け層の左端がラベル列の幅と一致', align.bgLeft === align.labelW,
    align.bgLeft + ' 対 ' + align.labelW);
  check('網掛けと目盛りのズレが 1px 未満', align.worst < 1,
    '最大 ' + align.worst + 'px（' + align.at + '枚目）');

  // ---- 2. 吹き出しの縦線が他の吹き出しを貫通していないか ----
  console.log('\n吹き出しと引き出し線');
  const leaders = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('#grid .plabel')];
    const lines = [...document.querySelectorAll('#grid .pleader')];
    // 重なったときにどちらが上に描かれるかは、z-index と DOM 順で決まる
    const z = el => {
      const v = getComputedStyle(el).zIndex;
      return v === 'auto' ? 0 : Number(v);
    };
    let through = 0;
    lines.forEach(ln => {
      const l = ln.getBoundingClientRect();
      labels.forEach(lb => {
        const b = lb.getBoundingClientRect();
        const hit = l.left < b.right && l.right > b.left && l.top < b.bottom && l.bottom > b.top;
        if (!hit) return;
        // 線が吹き出しより上に描かれていたら「貫通」
        if (z(ln) > z(lb)) through++;
        else if (z(ln) === z(lb)
          && (ln.compareDocumentPosition(lb) & Node.DOCUMENT_POSITION_PRECEDING)) through++;
      });
    });
    const opaque = labels.length
      ? getComputedStyle(labels[0]).backgroundColor
      : '';
    return { labels: labels.length, lines: lines.length, through: through, bg: opaque };
  });
  console.log('    吹き出し ' + leaders.labels + ' / 引き出し線 ' + leaders.lines
    + ' / 吹き出しの背景 ' + leaders.bg);
  check('吹き出しが出ている', leaders.labels > 0);
  check('引き出し線が吹き出しを貫通していない', leaders.through === 0,
    leaders.through + ' 箇所で線が上に描かれている');
  check('吹き出しの背景が不透明', /^rgb\(/.test(leaders.bg), leaders.bg);

  // ---- 3. 吹き出しどうしが重なっていないか（既存の確認） ----
  const overlap = await page.evaluate(() => {
    const byLane = new Map();
    document.querySelectorAll('#grid .lane').forEach((lane, i) => {
      byLane.set(i, [...lane.querySelectorAll('.plabel')].map(e => e.getBoundingClientRect()));
    });
    let n = 0;
    byLane.forEach(rects => {
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) n++;
        }
      }
    });
    return n;
  });
  check('吹き出しどうしが重なっていない', overlap === 0, overlap + ' 件');

  // ---- 4. 用紙の幅に収まっているか ----
  const width = await page.evaluate(() => {
    const grid = document.getElementById('grid');
    return {
      grid: Math.round(grid.getBoundingClientRect().width),
      body: Math.round(document.body.scrollWidth)
    };
  });
  // A4横 297mm - 余白8mm×2 = 281mm ≒ 1062px (96dpi)
  console.log('    grid幅 ' + width.grid + 'px / body ' + width.body + 'px（A4横の刷り幅 ≒1062px）');
  check('用紙の幅に収まっている', width.grid <= 1062, width.grid + 'px');

  // ---- 5. 期間をデータに合わせて切っているか ----
  console.log('\n刷る期間');
  const range = await page.evaluate(() => {
    let min = null, max = null;
    visibleLanes().forEach(l => laneItems(l).forEach(i => {
      const end = i.endKey || i.dueKey;
      if (min === null || i.dueKey < min) min = i.dueKey;
      if (max === null || end > max) max = end;
    }));
    return {
      screenFrom: DATA.from, screenTo: DATA.to,
      from: days[0], to: days[days.length - 1],
      dataFrom: min, dataTo: max, dayW: dayW, count: days.length,
      head: document.querySelector('.print-head .m').textContent
    };
  });
  console.log('    画面 ' + range.screenFrom + '〜' + range.screenTo
    + ' / 紙 ' + range.from + '〜' + range.to + '（' + range.count + '日 × ' + range.dayW + 'px）');
  check('工程のある範囲を覆っている',
    range.from <= range.dataFrom && range.to >= range.dataTo,
    range.from + '〜' + range.to + ' に対して データ ' + range.dataFrom + '〜' + range.dataTo);
  // 画面は［設定］の前月数・後月数ぶん出すが、紙は工程のある範囲だけにする。
  // 週の頭・週末で切るぶんだけ、データより少しはみ出す
  const span = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
  check('工程の無い期間まで広げない',
    span(range.from, range.to) < span(range.screenFrom, range.screenTo),
    '紙 ' + span(range.from, range.to) + '日 / 画面 ' + span(range.screenFrom, range.screenTo) + '日');
  check('前後の余りは1週間以内',
    span(range.from, range.dataFrom) <= 8 && span(range.dataTo, range.to) <= 8,
    '前 ' + span(range.from, range.dataFrom) + '日 / 後 ' + span(range.dataTo, range.to) + '日');
  check('週の頭（月）から週末（日）で切る',
    new Date(range.from + 'T00:00:00Z').getUTCDay() === 1
    && new Date(range.to + 'T00:00:00Z').getUTCDay() === 0,
    range.from + '〜' + range.to);
  check('見出しの期間が刷る範囲と一致',
    range.head.indexOf(String(+range.from.slice(5, 7)) + '月' + String(+range.from.slice(8, 10)) + '日') >= 0,
    range.head);

  // ---- 6. 区切りが読めるか ----
  console.log('\n目盛りと罫線');
  const grid2 = await page.evaluate(() => {
    const g = document.getElementById('grid');
    const months = new Set();
    days.forEach(k => months.add(k.slice(0, 7)));
    return {
      ticks: g.querySelectorAll('.tick').length,
      vlines: g.querySelectorAll('.vline').length,
      monthLines: g.querySelectorAll('.vline.month').length,
      weekLines: g.querySelectorAll('.vline.week').length,
      months: months.size, days: days.length, dayW: dayW
    };
  });
  console.log('    目盛り ' + grid2.ticks + '/' + grid2.days + '日 / 罫線 ' + grid2.vlines
    + '（月 ' + grid2.monthLines + ' / 週 ' + grid2.weekLines + '）');
  check('幅があるときは毎日に目盛りを出す',
    grid2.dayW < 13 || grid2.ticks === grid2.days, grid2.ticks + ' / ' + grid2.days);
  check('月の変わり目に罫線を引く', grid2.monthLines === grid2.months - 1,
    grid2.monthLines + ' 本 / ' + grid2.months + ' ヶ月');
  check('週の頭にも罫線を引く', grid2.weekLines > 0, String(grid2.weekLines));

  await page.screenshot({ path: path.join(OUT, 'print-check.png'), fullPage: true });

  // ---- 7. 印刷が終わったら画面の期間に戻るか ----
  console.log('\n印刷のあと');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => endPrint());
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    from: days[0], to: days[days.length - 1], dayW: dayW,
    labelW: getComputedStyle(document.documentElement).getPropertyValue('--label-w').trim(),
    head: document.querySelectorAll('.print-head').length
  }));
  check('画面の期間に戻る', after.from === range.screenFrom && after.to === range.screenTo,
    after.from + '〜' + after.to);
  check('1日の幅も戻る', after.dayW > range.dayW, String(after.dayW));
  check('ラベル列の幅も戻る', after.labelW === '260px' || after.labelW === '', after.labelW);
  check('紙用の見出しが消える', after.head === 0, String(after.head));
  check('紙用の幅指定も外れる',
    await page.evaluate(() => document.body.style.width === ''),
    await page.evaluate(() => document.body.style.width));

  // ---- 8. ページを跨いでも日付軸が付くか ----
  console.log('\n複数ページ');
  const page2 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page2.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page2.goto('file://' + path.join(OUT, 'index.html'));
  await page2.waitForSelector('.lane');
  await page2.waitForTimeout(700);
  // 1ページに収まらない状況を作る（レーンを3倍にする）
  await page2.evaluate(() => {
    const base = DATA.lanes.slice();
    for (let n = 1; n <= 2; n++) {
      base.forEach(l => {
        const c = JSON.parse(JSON.stringify(l));
        c.laneKey = l.laneKey + '#' + n;
        c.period = (l.period || '日付指定') + '複製' + n;
        DATA.lanes.push(c);
      });
    }
    renderAll();
  });
  await page2.waitForTimeout(400);
  await page2.evaluate(() => { window.print = function () {}; startPrint(); });
  await page2.emulateMedia({ media: 'print' });
  await page2.waitForTimeout(400);

  const paged = await page2.evaluate(() => {
    const pages = [...document.querySelectorAll('#grid .gpage')];
    return {
      pages: pages.length,
      lanes: document.querySelectorAll('#grid .lane').length,
      each: pages.map(g => ({
        heads: g.querySelectorAll('.head').length,
        ticks: g.querySelectorAll('.tick').length,
        months: g.querySelectorAll('.month-cell').length,
        bgs: g.querySelectorAll('.bg-layer').length,
        lanes: g.querySelectorAll('.lane').length,
        h: Math.round(g.getBoundingClientRect().height)
      })),
      printH: PRINT_H
    };
  });
  console.log('    ' + paged.pages + 'ページ / 全 ' + paged.lanes + ' レーン　'
    + paged.each.map(e => e.lanes + '行=' + e.h + 'px').join(' / '));
  check('2ページ以上に分かれる', paged.pages >= 2, paged.pages + 'ページ');
  check('どのページにも日付軸が付く', paged.each.every(e => e.heads === 1),
    JSON.stringify(paged.each.map(e => e.heads)));
  check('どのページにも目盛りが出る', paged.each.every(e => e.ticks > 0),
    JSON.stringify(paged.each.map(e => e.ticks)));
  check('どのページにも月名が出る', paged.each.every(e => e.months > 0),
    JSON.stringify(paged.each.map(e => e.months)));
  check('どのページにも休みの網掛けが出る', paged.each.every(e => e.bgs === 1),
    JSON.stringify(paged.each.map(e => e.bgs)));
  check('工程が1行も欠けない',
    paged.each.reduce((n, e) => n + e.lanes, 0) === paged.lanes,
    paged.each.reduce((n, e) => n + e.lanes, 0) + ' / ' + paged.lanes);
  check('1ページの高さが用紙に収まる',
    paged.each.every(e => e.h <= paged.printH),
    JSON.stringify(paged.each.map(e => e.h)) + ' / ' + paged.printH);
  await page2.screenshot({ path: path.join(OUT, 'print-pages.png'), fullPage: true });
  await page2.close();

  // ---- 9. カレンダーが1ページに収まるか ----
  console.log('\nカレンダー');
  const page3 = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page3.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page3.goto('file://' + path.join(OUT, 'index.html'));
  await page3.waitForSelector('.lane');
  await page3.waitForTimeout(700);
  await page3.evaluate(() => document.querySelector('#tabs button[data-view="month"]').click());
  await page3.waitForTimeout(500);
  await page3.evaluate(() => { window.print = function () {}; startPrint(); });
  await page3.emulateMedia({ media: 'print' });
  await page3.waitForTimeout(400);
  const cal = await page3.evaluate(() => ({
    total: Math.round(document.querySelector('.view').getBoundingClientRect().height),
    printH: PRINT_H,
    wrap: document.querySelector('.cal-wrap').style.height,
    cells: document.querySelectorAll('.cal-grid .cell').length,
    bar: getComputedStyle(document.querySelector('.cal-bar')).display,
    scrollable: [...document.querySelectorAll('.cal-grid .cell')]
      .filter(c => c.scrollHeight > c.clientHeight + 1).length
  }));
  console.log('    高さ ' + cal.total + 'px / 刷り高 ' + cal.printH + 'px　枠 ' + cal.wrap);
  check('1ページに収まる', cal.total <= cal.printH, cal.total + ' / ' + cal.printH);
  check('1か月ぶんのマスが出る', cal.cells >= 35, cal.cells + ' マス');
  check('月の切り替えボタンは刷らない', cal.bar === 'none', cal.bar);
  await page3.screenshot({ path: path.join(OUT, 'print-calendar.png'), fullPage: true });
  await page3.close();

  await browser.close();

  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
