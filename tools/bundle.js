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

const size = fs.statSync(path.join(OUT, 'コード.gs')).size;
console.log('dist/ を作成しました（関数名の重複なし）');
console.log('  コード.gs        ' + gsFiles.length + 'ファイル分 / ' + Math.round(size / 1024) + ' KB');
htmlFiles.forEach(f => console.log('  ' + f));
console.log('  appsscript.json');
console.log('  version.json     ' + VERSION);
