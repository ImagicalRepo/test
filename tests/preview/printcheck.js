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

  await page.screenshot({ path: path.join(OUT, 'print-check.png'), fullPage: true });
  await browser.close();

  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
