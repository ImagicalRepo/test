/**
 * テンプレートの受け渡し画面（json.html）の操作テスト
 *
 * この画面はスプレッドシートのモーダルダイアログとしてしか開かない。
 * ダイアログはサンドボックス化された iframe なので window.confirm が
 * 「Ignored call to 'confirm()'」として無視され、押しても何も起きなくなる。
 * ネイティブのダイアログに頼っていないことを確かめる。
 *
 *   node tests/preview/json.js
 */
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, 'out');
const PAGE = 'file://' + path.join(OUT, 'json-import.html');
const EXPORT_PAGE = 'file://' + path.join(OUT, 'json-export.html');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}

const SAMPLE = JSON.stringify({
  format: 'gyomu-schedule-template', version: 2,
  works: [{ id: 'W1', name: 'テスト', rule: '手動' }],
  templates: [{ workId: 'W1', seq: 10, name: '決裁', mode: '日付指定', startDate: '2026-09-01' }]
});

async function main() {
  if (!fs.existsSync(path.join(OUT, 'json-import.html'))) {
    console.error('先に node tests/preview/preview.js を実行してください');
    process.exit(1);
  }
  const { chromium } = require('playwright');
  const pre = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(fs.existsSync(pre) ? { executablePath: pre } : {});
  const page = await browser.newPage({ viewport: { width: 720, height: 620 } });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const state = () => page.evaluate(() => ({
    calls: window.MOCK_CALLS,
    native: window.NATIVE_DIALOGS,
    msg: document.getElementById('msg').textContent,
    label: document.getElementById('btnImport').textContent,
    cancelShown: !document.getElementById('btnCancel').hidden
  }));

  // ---- 上書き（merge）は1回押すだけで読み込む ----
  console.log('\n上書きで読み込む');
  await page.goto(PAGE);
  await page.waitForSelector('#btnImport');
  await page.fill('#box', SAMPLE);
  await page.click('#btnImport');
  await page.waitForTimeout(300);
  const merged = await state();
  check('1回押せばサーバーに渡る', merged.calls.length === 1, JSON.stringify(merged.calls));
  check('モードは上書き', merged.calls[0] && merged.calls[0].mode === 'merge',
    merged.calls[0] && merged.calls[0].mode);
  check('本文がそのまま渡る', merged.calls[0] && merged.calls[0].length === SAMPLE.length,
    merged.calls[0] && merged.calls[0].length + ' / ' + SAMPLE.length);
  check('結果が表示される', merged.msg.indexOf('読み込みました') >= 0, merged.msg);

  // ---- 入れ替え（replace）は2段階。confirm には頼らない ----
  console.log('\n入れ替えで読み込む');
  await page.goto(PAGE);
  await page.waitForSelector('#btnImport');
  await page.fill('#box', SAMPLE);
  await page.check('input[name=mode][value=replace]');
  await page.click('#btnImport');
  await page.waitForTimeout(250);
  const armed = await state();
  check('1回目は実行せず確認を出す', armed.calls.length === 0, JSON.stringify(armed.calls));
  check('ボタンが「本当に入れ替える」に変わる', armed.label.indexOf('本当に') >= 0, armed.label);
  check('［やめる］が出る', armed.cancelShown);
  check('消える旨を伝える', armed.msg.indexOf('すべて削除') >= 0, armed.msg);

  await page.click('#btnCancel');
  await page.waitForTimeout(150);
  const canceled = await state();
  check('やめれば実行されない', canceled.calls.length === 0 && canceled.label === '読み込む',
    canceled.label);

  await page.click('#btnImport');
  await page.waitForTimeout(200);
  await page.click('#btnImport');
  await page.waitForTimeout(300);
  const replaced = await state();
  check('2回目で実行される', replaced.calls.length === 1, JSON.stringify(replaced.calls));
  check('モードは入れ替え', replaced.calls[0] && replaced.calls[0].mode === 'replace',
    replaced.calls[0] && replaced.calls[0].mode);

  // ---- ネイティブのダイアログを使っていないこと ----
  console.log('\nサンドボックス対策');
  const nat = (await state()).native;
  check('confirm / alert / prompt を呼んでいない', nat.length === 0, JSON.stringify(nat));

  // ---- 版が出ていること（画面だけ古いまま気づかない事故を防ぐ） ----
  console.log('\n版の表示');
  const ver = await page.evaluate(() => {
    const e = document.querySelector('.ver');
    return e ? e.textContent : null;
  });
  check('コード.gs の版が画面に出る', !!ver && ver.indexOf('版') >= 0, String(ver));

  // ---- 書き出しに進捗を含める ----
  console.log('\n進捗を含めて書き出す');
  await page.goto(EXPORT_PAGE);
  await page.waitForSelector('#btnCopy');
  const exp0 = await page.evaluate(() => ({
    box: document.getElementById('box').value,
    checked: document.getElementById('withProgress').checked
  }));
  check('既定では進捗を含めない', exp0.checked === false);
  check('定義だけが入っている', exp0.box.indexOf('progress') < 0, exp0.box.slice(0, 60));

  await page.check('#withProgress');
  await page.waitForTimeout(300);
  const expOn = await page.evaluate(() => ({
    calls: window.MOCK_CALLS,
    box: document.getElementById('box').value,
    msg: document.getElementById('msg').textContent
  }));
  check('入れると書き出し直す',
    expOn.calls.some(c => c.fn === 'exportTemplatesJson' && c.withProgress === true),
    JSON.stringify(expOn.calls));
  check('進捗が入る', expOn.box.indexOf('"progress"') >= 0 && expOn.box.indexOf('完了') >= 0,
    expOn.box.slice(0, 80));
  check('入れたことが分かる', expOn.msg.indexOf('進捗を含めました') >= 0, expOn.msg);

  await page.uncheck('#withProgress');
  await page.waitForTimeout(300);
  const expOff = await page.evaluate(() => ({
    box: document.getElementById('box').value,
    msg: document.getElementById('msg').textContent
  }));
  check('外すと定義だけに戻る', expOff.box.indexOf('"progress"') < 0, expOff.box.slice(0, 60));
  check('外したことが分かる', expOff.msg.indexOf('進捗を外しました') >= 0, expOff.msg);

  // ---- 読み込み側が復元件数を伝えること ----
  console.log('\n進捗の復元');
  await page.goto(PAGE);
  await page.waitForSelector('#btnImport');
  await page.evaluate(() => {
    window.MOCK_IMPORT_RESULT = { rows: 42, errors: [], progress: { applied: 30, missing: 2 } };
  });
  await page.fill('#box', SAMPLE);
  await page.click('#btnImport');
  await page.waitForTimeout(300);
  const restored = (await state()).msg;
  check('復元した件数を出す', restored.indexOf('進捗 30 件を復元') >= 0, restored);
  check('該当しなかった件数も出す', restored.indexOf('2 件') >= 0, restored);

  // ---- <script> の中にテンプレートの出力を混ぜていないこと ----
  // 書き出され方によっては JS ごと壊れ、「押しても何も起きない」になる。
  console.log('\nスクリプトの安全性');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', 'json.html'), 'utf8');
  const inScript = src.slice(src.indexOf('<script>'), src.lastIndexOf('</' + 'script>'));
  const scriptlets = inScript.match(/<\?[\s\S]*?\?>/g);
  check('<script> の中にスクリプトレットがない', !scriptlets, JSON.stringify(scriptlets));

  // gantt / editor もテンプレートとして評価されるので、`<?` が混ざると画面ごと壊れる
  ['gantt.html', 'editor.html'].forEach(f => {
    const t = fs.readFileSync(path.join(__dirname, '..', '..', 'apps-script', f), 'utf8');
    const found = t.match(/<\?[\s\S]{0,60}?\?>/g);
    check(f + ' にスクリプトレットが混ざっていない', !found, JSON.stringify(found));
  });

  // ---- 画面で落ちたら、黙らずに知らせること ----
  console.log('\nエラーの見える化');
  await page.goto(PAGE);
  await page.waitForSelector('#btnImport');
  await page.evaluate(() => {
    // 読み込みの途中で落ちる状況を作る
    document.getElementById('box').remove();
  });
  await page.click('#btnImport');
  await page.waitForTimeout(300);
  const broke = await state();
  check('画面にエラーが出る', broke.msg.indexOf('読み込みの開始') >= 0, broke.msg);
  check('実行ログにも送る',
    broke.calls.some(c => c.fn === 'logClientError'), JSON.stringify(broke.calls));
  check('ボタンは押せるままにする',
    await page.evaluate(() => !document.getElementById('btnImport').disabled));

  // ---- 貼り忘れ ----
  console.log('\n貼り忘れ');
  await page.goto(PAGE);
  await page.waitForSelector('#btnImport');
  await page.click('#btnImport');
  await page.waitForTimeout(250);
  const empty = await state();
  check('空のまま押すと案内が出る', empty.msg.indexOf('貼り付け') >= 0, empty.msg);
  check('サーバーは呼ばれない', empty.calls.length === 0, JSON.stringify(empty.calls));

  // ---- 失敗したとき ----
  console.log('\n読み込みに失敗したとき');
  await page.evaluate(() => { window.MOCK_FAIL = '形式が一致しません'; });
  await page.fill('#box', SAMPLE);
  await page.click('#btnImport');
  await page.waitForTimeout(300);
  const failed = await state();
  check('理由が表示される', failed.msg.indexOf('形式が一致しません') >= 0, failed.msg);
  check('もう一度押せる', await page.evaluate(() => !document.getElementById('btnImport').disabled));

  await browser.close();
  console.log('\n' + '─'.repeat(48));
  if (errors.length) { console.log('JSエラー:\n' + errors.join('\n')); fail += errors.length; }
  console.log(fail === 0 ? 'すべて成功しました（' + pass + ' 件）' : fail + ' 件 失敗（成功 ' + pass + ' 件）');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
