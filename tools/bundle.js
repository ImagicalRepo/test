/**
 * Apps Script へ手作業で貼り付けるための配布物を作る。
 *
 *   node tools/bundle.js
 *
 * .gs ファイルはすべて1つの「コード.gs」にまとめる（Apps Script は
 * ファイル分割に依存しないため、1ファイルにしても動作は変わらない）。
 * これでコピー＆ペーストする回数が 15 回から 5 回に減る。
 *
 * 同名の関数が複数ファイルにあると後勝ちで静かに壊れるため、その検査も行う。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'apps-script');
const OUT = path.join(ROOT, 'dist');

const gsFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
const htmlFiles = fs.readdirSync(SRC).filter(f => f.endsWith('.html')).sort();

// 関数名の重複を検査する
const seen = new Map();
const duplicates = [];
for (const file of gsFiles) {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8');
  const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
  let m;
  while ((m = re.exec(src))) {
    if (seen.has(m[1])) duplicates.push(`${m[1]}  (${seen.get(m[1])} と ${file})`);
    else seen.set(m[1], file);
  }
}
if (duplicates.length) {
  console.error('関数名が重複しています。1ファイルにまとめると後勝ちで壊れます:\n  ' + duplicates.join('\n  '));
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

const header = [
  '/**',
  ' * 業務スケジュール管理ツール',
  ' *',
  ' * このファイルは apps-script/*.gs をまとめたものです。',
  ' * 編集はリポジトリ側の各ファイルで行い、node tools/bundle.js で作り直してください。',
  ' *',
  ' * 収録: ' + gsFiles.join(', '),
  ' */',
  ''
].join('\n');

const body = gsFiles.map(file => {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8').trim();
  return [
    '',
    '// '.padEnd(78, '='),
    '// ' + file,
    '// '.padEnd(78, '='),
    '',
    src,
    ''
  ].join('\n');
}).join('\n');

// 00_config.gs の VERSION を dist にも持ち出す。
// スプレッドシート側の［更新を確認］がこれと比べる。
const versionSrc = fs.readFileSync(path.join(SRC, '00_config.gs'), 'utf8');
const vm = /var VERSION = '([^']+)'/.exec(versionSrc);
if (!vm) {
  console.error('00_config.gs に VERSION が見つかりません');
  process.exit(1);
}
const VERSION = vm[1];

fs.writeFileSync(path.join(OUT, 'コード.gs'), header + body);
for (const file of htmlFiles) {
  // HTML を GitHub から読み込んだとき、どの版かを更新履歴に残せるようにする
  const html = fs.readFileSync(path.join(SRC, file), 'utf8');
  fs.writeFileSync(path.join(OUT, file), '<!-- version: ' + VERSION + ' -->\n' + html);
}
fs.copyFileSync(path.join(SRC, 'appsscript.json'), path.join(OUT, 'appsscript.json'));
fs.writeFileSync(path.join(OUT, 'version.json'),
  JSON.stringify({ version: VERSION, builtAt: new Date().toISOString() }, null, 2) + '\n');

// ============================================================================
// 配布用ビルド（dist/standalone/）
//
// 他団体へ配るときは「外部からコードを取ってくる」構図を持ち込みたくないので、
// 20_remote_html.gs を丸ごと外したものを別に作る。
// 呼び出し側は typeof で見て分岐するため、外しても動く。
// ============================================================================
const REMOTE_FILE = '20_remote_html.gs';
const STANDALONE = path.join(OUT, 'standalone');

const soFiles = gsFiles.filter(f => f !== REMOTE_FILE);
if (soFiles.length === gsFiles.length) {
  console.error(REMOTE_FILE + ' が見つかりません。配布用ビルドの除外対象を見直してください');
  process.exit(1);
}

const soHeader = [
  '/**',
  ' * 業務スケジュール管理ツール（配布用）',
  ' *',
  ' * このファイルは apps-script/*.gs をまとめたものです。',
  ' * 外部から画面を取得する機能は含めていません。',
  ' *',
  ' * 収録: ' + soFiles.join(', '),
  ' */',
  ''
].join('\n');

const soBody = soFiles.map(file => {
  const src = fs.readFileSync(path.join(SRC, file), 'utf8').trim();
  return ['', '// '.padEnd(78, '='), '// ' + file, '// '.padEnd(78, '='), '', src, ''].join('\n');
}).join('\n');

const soCode = soHeader + soBody;

// 配布物に、外部取得の痕跡と特定業務に寄った表現が残っていないことを確かめる。
// 配る相手の業務は分からないので、サンプルも説明文も一般的な言い方にしておく。
const banned = [
  ['指定難病', '特定の業務に寄った語'],
  ['難病', '特定の業務に寄った語'],
  ['小児慢性', '特定の業務に寄った語'],
  ['医療費助成', '特定の業務に寄った語'],
  ['審査会', '特定の業務に寄った語'],
  ['受給者証', '特定の業務に寄った語'],
  ['医療意見書', '特定の業務に寄った語'],
  ['疾病', '特定の業務に寄った語'],
  ['GitHub', '固有名'],
  ['remote', '取り込み部品を指す語'],
  ['Remote', '取り込み部品を指す語'],
  ['github', '固有名'],
  ['UrlFetchApp.fetch(base', '外から画面を取りに行く処理'],
  ['REMOTE_', '取り込み部品の定数'],
  ['fetchRemoteHtml_', '取り込みの関数'],
  ['clearRemoteHtmlCache_', 'キャッシュ破棄の関数'],
  ['checkForUpdate', '更新確認の関数'],
  ['menuRefreshHtml', '取り込みのメニュー'],
  ['menuCheckUpdate', '更新確認のメニュー']
];
const soHtml = htmlFiles.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
const hit = banned.filter(([word]) => soCode.includes(word) || soHtml.includes(word));
if (hit.length) {
  console.error('配布用ビルドに残してはいけない表現があります:\n  '
    + hit.map(([w, why]) => w + '（' + why + '）').join('\n  '));
  process.exit(1);
}
try {
  new Function(soCode);
} catch (e) {
  console.error('配布用ビルドの構文が通りません: ' + e.message);
  process.exit(1);
}

// ------------------------------------------------------------------
// メニューが呼ぶ関数が、両方のビルドに揃っているかを見る。
//
// ファイルをまたいで関数を動かしたとき、配布用ビルドから静かに抜け落ちて
// 「関数が見つかりません」になったことがある。Node 側で .gs のメニューを
// 実行していないためテストでは気づけないので、ここで見る。
// ------------------------------------------------------------------
function menuHandlers(src, fromLabel) {
  const body = src.slice(src.indexOf('function ' + fromLabel));
  const scope = body.slice(0, body.indexOf('\n}'));
  const names = new Set();
  const re = /addItem\(\s*'[^']*'\s*,\s*'([A-Za-z0-9_$]+)'\s*\)/g;
  let m;
  while ((m = re.exec(scope))) names.add(m[1]);
  return [...names];
}

function checkMenu(code, label) {
  // onOpen が直接並べる項目に加え、任意の部品が足す項目（あれば）も見る
  const wanted = menuHandlers(code, 'onOpen')
    .concat(code.includes('function addExtraMenu_') ? menuHandlers(code, 'addExtraMenu_') : []);
  const missing = wanted.filter(fn => !new RegExp('^function ' + fn + '\\s*\\(', 'm').test(code));
  if (missing.length) {
    console.error(label + ' のメニューが呼ぶ関数が見つかりません:\n  ' + missing.join('\n  '));
    process.exit(1);
  }
  return wanted.length;
}

const fullMenu = checkMenu(header + body, 'dist');
const soMenu = checkMenu(soCode, 'dist/standalone');

fs.mkdirSync(STANDALONE, { recursive: true });
fs.writeFileSync(path.join(STANDALONE, 'コード.gs'), soCode);
for (const file of htmlFiles) {
  // 配布物には版コメントを付けない（更新確認の機能が無いため使い道がない）
  fs.copyFileSync(path.join(SRC, file), path.join(STANDALONE, file));
}
fs.copyFileSync(path.join(SRC, 'appsscript.json'), path.join(STANDALONE, 'appsscript.json'));

const size = fs.statSync(path.join(OUT, 'コード.gs')).size;
const soSize = fs.statSync(path.join(STANDALONE, 'コード.gs')).size;
console.log('dist/ を作成しました（関数名の重複なし）');
console.log('  コード.gs        ' + gsFiles.length + 'ファイル分 / ' + Math.round(size / 1024) + ' KB');
htmlFiles.forEach(f => console.log('  ' + f));
console.log('  appsscript.json');
console.log('  version.json     ' + VERSION);
console.log('  メニュー ' + fullMenu + ' 項目すべてに実体あり');
console.log('dist/standalone/ を作成しました（外部取得なし）');
console.log('  コード.gs        ' + soFiles.length + 'ファイル分 / ' + Math.round(soSize / 1024) + ' KB');
htmlFiles.forEach(f => console.log('  ' + f));
console.log('  appsscript.json');
