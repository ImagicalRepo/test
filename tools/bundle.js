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

// 配布物に外部取得の痕跡が残っていないことを確かめる
const banned = [
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
const hit = banned.filter(([word]) => soCode.includes(word));
if (hit.length) {
  console.error('配布用ビルドに外部取得の痕跡が残っています:\n  '
    + hit.map(([w, why]) => w + '（' + why + '）').join('\n  '));
  process.exit(1);
}
try {
  new Function(soCode);
} catch (e) {
  console.error('配布用ビルドの構文が通りません: ' + e.message);
  process.exit(1);
}

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
console.log('dist/standalone/ を作成しました（外部取得なし）');
console.log('  コード.gs        ' + soFiles.length + 'ファイル分 / ' + Math.round(soSize / 1024) + ' KB');
htmlFiles.forEach(f => console.log('  ' + f));
console.log('  appsscript.json');
