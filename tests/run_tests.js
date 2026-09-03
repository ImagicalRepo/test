/**
 * Apps Script のコアロジック（純粋関数）を Node で検証する。
 *
 *   node tests/run_tests.js
 *
 * .gs ファイルをサンドボックスに読み込み、GAS 固有の API に依存しない部分だけを直接呼ぶ。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC_DIR = path.join(__dirname, '..', 'apps-script');
const FILES = [
  '00_config.gs',
  '01_core_date.gs',
  '02_core_recurrence.gs',
  '03_core_schedule.gs',
  '04_core_digest.gs',
  '12_holidays.gs'
];

// GAS 側の I/O 関数はスタブに差し替える
const sandbox = {
  console,
  settingText_: (settings, key, fallback) => {
    const v = settings && settings[key];
    return v === undefined || v === null || String(v).trim() === '' ? fallback : String(v).trim();
  },
  log_: () => {}
};
vm.createContext(sandbox);

for (const file of FILES) {
  const code = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: file });
  } catch (e) {
    console.error(`✗ ${file} の読み込みに失敗: ${e.message}`);
    process.exit(1);
  }
}

const G = sandbox;
const HOLIDAYS_2026 = require('./holidays2026');

// ---- 簡易テストフレームワーク ----
let passed = 0;
const failures = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n${name}`);
}

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures.push({ group: currentGroup, name, message: e.message });
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${label || ''} 期待値 ${b} / 実際 ${a}`);
  }
}

function throws(fn, pattern, label) {
  let thrown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error(`${label || ''} 例外が投げられませんでした`);
  if (pattern && !pattern.test(thrown.message)) {
    throw new Error(`${label || ''} 想定外のメッセージ: ${thrown.message}`);
  }
}

const cal = G.createBusinessCalendar({ holidays: Object.keys(HOLIDAYS_2026) });

// ---------------------------------------------------------------
group('日付ユーティリティ');

check('dateKey と Date を相互変換できる', () => {
  eq(G.dateToKey(G.keyToDate('2026-09-09')), '2026-09-09');
});

check('月またぎ・年またぎの加算ができる', () => {
  eq(G.addCalendarDays('2026-01-31', 1), '2026-02-01');
  eq(G.addCalendarDays('2026-12-31', 1), '2027-01-01');
  eq(G.addCalendarDays('2027-01-01', -1), '2026-12-31');
  eq(G.addCalendarDays('2024-02-28', 1), '2024-02-29', 'うるう年');
});

check('存在しない日付を弾く', () => {
  throws(() => G.keyToDate('2026-02-30'), /存在しない日付/);
  throws(() => G.keyToDate('2026/09/09'), /形式が不正/);
});

check('表記ゆれのある日付文字列を正規化できる', () => {
  eq(G.toDateKey('2026/9/9'), '2026-09-09');
  eq(G.toDateKey('2026年9月9日'), '2026-09-09');
  eq(G.toDateKey(''), '');
});

check('曜日を返す', () => {
  eq(G.dayOfWeek('2026-09-09'), 3, '2026-09-09は水曜');
  eq(G.dayOfWeek('2026-05-03'), 0, '2026-05-03は日曜');
});

// ---------------------------------------------------------------
group('営業日の判定');

check('土日は営業日でない', () => {
  eq(G.isBusinessDay(cal, '2026-09-05'), false, '土曜');
  eq(G.isBusinessDay(cal, '2026-09-06'), false, '日曜');
  eq(G.isBusinessDay(cal, '2026-09-07'), true, '月曜');
});

check('祝日・閉庁日は営業日でない', () => {
  eq(G.isBusinessDay(cal, '2026-08-11'), false, '山の日');
  eq(G.isBusinessDay(cal, '2026-12-30'), false, '年末閉庁');
  eq(G.isBusinessDay(cal, '2026-05-06'), false, '振替休日');
});

check('振替出勤日は休日設定より優先される', () => {
  const c = G.createBusinessCalendar({
    holidays: ['2026-09-05', '2026-08-11'],
    extraWorkdays: ['2026-09-05']
  });
  eq(G.isBusinessDay(c, '2026-09-05'), true, '土曜だが振替出勤');
  eq(G.isBusinessDay(c, '2026-08-11'), false);
});

check('週休日を変更できる', () => {
  const c = G.createBusinessCalendar({ holidays: [], weekendDays: [0] });
  eq(G.isBusinessDay(c, '2026-09-05'), true, '土曜も稼働');
  eq(G.isBusinessDay(c, '2026-09-06'), false, '日曜は休み');
});

// ---------------------------------------------------------------
group('営業日の加減算');

check('ゴールデンウィークを飛び越える', () => {
  // 5/1(金) の翌営業日は 5/2〜5/6 が休みのため 5/7(木)
  eq(G.addBusinessDays(cal, '2026-05-01', 1), '2026-05-07');
  eq(G.addBusinessDays(cal, '2026-05-11', -2), '2026-05-07');
});

check('年末年始をまたぐ', () => {
  // 12/28(月) の翌営業日は 12/29〜1/3 が閉庁のため 1/4(月)
  eq(G.addBusinessDays(cal, '2026-12-28', 1), '2027-01-04');
  eq(G.addBusinessDays(cal, '2027-01-04', -1), '2026-12-28');
});

check('0 日指定は基準日をそのまま返す', () => {
  eq(G.addBusinessDays(cal, '2026-05-03', 0), '2026-05-03');
});

check('審査会の20営業日前を正しく求める', () => {
  // 2026-09-09(水)の20営業日前。8/11(山の日)を飛ばして 8/12(水)
  eq(G.addBusinessDays(cal, '2026-09-09', -20), '2026-08-12');
});

check('休日補正で前後の営業日へ寄せる', () => {
  eq(G.adjustToBusinessDay(cal, '2026-05-03', 'prev'), '2026-05-01');
  eq(G.adjustToBusinessDay(cal, '2026-05-03', 'next'), '2026-05-07');
  eq(G.adjustToBusinessDay(cal, '2026-05-03', 'none'), '2026-05-03');
  eq(G.adjustToBusinessDay(cal, '2026-09-09', 'prev'), '2026-09-09', '営業日はそのまま');
});

check('補正モードの表記ゆれを吸収する', () => {
  eq(G.normalizeAdjustMode('前営業日'), 'prev');
  eq(G.normalizeAdjustMode('翌営業日'), 'next');
  eq(G.normalizeAdjustMode(''), 'none');
  eq(G.normalizeAdjustMode('なし'), 'none');
  throws(() => G.normalizeAdjustMode('てきとう'), /休日補正の指定が不正/);
});

check('営業日数の表は1件ずつの計算と完全に一致する', () => {
  const origin = '2026-09-09';
  const counter = G.createBusinessDayCounter(cal, origin, '2026-06-01', '2026-12-31');
  let cur = '2026-06-01';
  let checked = 0;
  while (cur <= '2026-12-31') {
    eq(counter(cur), G.countBusinessDays(cal, origin, cur), cur);
    cur = G.addCalendarDays(cur, 1);
    checked++;
  }
  eq(checked > 200, true, '検査した日数');
  eq(counter('2027-06-01'), G.countBusinessDays(cal, origin, '2027-06-01'), '範囲外は元の計算に委譲する');
});

check('営業日数を数える（符号つき）', () => {
  eq(G.countBusinessDays(cal, '2026-09-09', '2026-09-11'), 2);
  eq(G.countBusinessDays(cal, '2026-09-11', '2026-09-09'), -2);
  eq(G.countBusinessDays(cal, '2026-09-09', '2026-09-09'), 0);
  eq(G.countBusinessDays(cal, '2026-05-01', '2026-05-07'), 1, 'GW中は1営業日');
});

// ---------------------------------------------------------------
group('基準日ルールの解釈');

check('毎月第N曜日を解釈する', () => {
  eq(G.parseRecurrence('毎月第2水'), { type: 'MONTHLY_NTH', interval: 1, nth: 2, weekday: 3, anchorMonth: null });
  eq(G.parseRecurrence('毎月第2水曜日'), { type: 'MONTHLY_NTH', interval: 1, nth: 2, weekday: 3, anchorMonth: null });
  eq(G.parseRecurrence('毎月第４火'), { type: 'MONTHLY_NTH', interval: 1, nth: 4, weekday: 2, anchorMonth: null }, '全角');
});

check('最終曜日・末日・D日を解釈する', () => {
  eq(G.parseRecurrence('毎月最終金').nth, 'last');
  eq(G.parseRecurrence('毎月末日'), { type: 'MONTHLY_DAY', interval: 1, day: 'last', anchorMonth: null });
  eq(G.parseRecurrence('毎月15日'), { type: 'MONTHLY_DAY', interval: 1, day: 15, anchorMonth: null });
});

check('「末日」と「最終日曜」を取り違えない', () => {
  eq(G.parseRecurrence('毎月末日'), { type: 'MONTHLY_DAY', interval: 1, day: 'last', anchorMonth: null });
  eq(G.parseRecurrence('毎月最終日曜'), { type: 'MONTHLY_NTH', interval: 1, nth: 'last', weekday: 0, anchorMonth: null });
  eq(G.parseRecurrence('毎月最終日曜日'), { type: 'MONTHLY_NTH', interval: 1, nth: 'last', weekday: 0, anchorMonth: null });
  eq(G.parseRecurrence('毎月第2日曜日'), { type: 'MONTHLY_NTH', interval: 1, nth: 2, weekday: 0, anchorMonth: null });
  eq(G.parseRecurrence('毎月1日'), { type: 'MONTHLY_DAY', interval: 1, day: 1, anchorMonth: null });
});

check('隔月と起点を解釈する', () => {
  const spec = G.parseRecurrence('2ヶ月毎第2水 起点2026-04');
  eq(spec.interval, 2);
  eq(spec.anchorMonth, { year: 2026, month: 4 });
});

check('毎年の指定を解釈する', () => {
  eq(G.parseRecurrence('毎年9月1日'), { type: 'YEARLY_DATE', month: 9, day: 1 });
});

check('手動・空欄は null を返す', () => {
  eq(G.parseRecurrence('手動'), null);
  eq(G.parseRecurrence(''), null);
  eq(G.parseRecurrence(null), null);
});

check('解釈できないルールはエラーにする', () => {
  throws(() => G.parseRecurrence('第2水曜あたり'), /解釈できません/);
  throws(() => G.parseRecurrence('毎月第9水'), /1〜5/);
});

// ---------------------------------------------------------------
group('基準日の展開');

check('第N曜日を月ごとに算出する', () => {
  eq(G.nthWeekdayOfMonth(2026, 9, 2, 3), '2026-09-09', '9月第2水');
  eq(G.nthWeekdayOfMonth(2026, 10, 2, 3), '2026-10-14', '10月第2水');
  eq(G.nthWeekdayOfMonth(2026, 9, 'last', 5), '2026-09-25', '9月最終金');
  eq(G.nthWeekdayOfMonth(2026, 2, 5, 1), null, '第5月曜が無い月');
});

check('末日と存在しない日を丸める', () => {
  eq(G.dayOfMonth(2026, 5, 'last'), '2026-05-31');
  eq(G.dayOfMonth(2026, 2, 31), '2026-02-28', '2/31は末日へ');
});

check('毎月第2水を期間展開する', () => {
  const list = G.expandRecurrence(G.parseRecurrence('毎月第2水'), '2026-09-01', '2026-12-31', cal, 'prev');
  eq(list.map(x => x.dateKey), ['2026-09-09', '2026-10-14', '2026-11-11', '2026-12-09']);
  eq(list[0].period, '2026-09');
});

check('休日に当たった基準日を前営業日へ補正する', () => {
  // 5月末日(日)は 5/29(金) へ寄る
  const list = G.expandRecurrence(G.parseRecurrence('毎月末日'), '2026-05-01', '2026-05-31', cal, 'prev');
  eq(list.map(x => x.dateKey), ['2026-05-29']);
});

check('隔月は起点月から位相が合う', () => {
  const list = G.expandRecurrence(G.parseRecurrence('2ヶ月毎第2水 起点2026-04'), '2026-05-01', '2026-12-31', cal, 'prev');
  eq(list.map(x => x.dateKey.slice(0, 7)), ['2026-06', '2026-08', '2026-10', '2026-12']);
});

check('毎年の基準日を展開する', () => {
  const list = G.expandRecurrence(G.parseRecurrence('毎年9月1日'), '2026-01-01', '2027-12-31', cal, 'next');
  eq(list.map(x => x.dateKey), ['2026-09-01', '2027-09-01']);
  eq(list[0].period, '2026');
});

// ---------------------------------------------------------------
group('工程スケジュールの算出');

const NANBYO_TEMPLATE = () => ([
  { seq: 10, name: '受付締切', base: '', direction: '前', days: 20, unit: '営業日', adjust: '前営業日' },
  { seq: 20, name: '資料送付', base: '', direction: '前', days: 7, unit: '営業日', adjust: '前営業日' },
  { seq: 30, name: '審査会', base: '', direction: '後', days: 0, unit: '営業日', adjust: '前営業日' },
  { seq: 40, name: '決裁起案', base: '審査会', direction: '後', days: 2, unit: '営業日', adjust: '前営業日' },
  { seq: 50, name: '決裁完了', base: '決裁起案', direction: '後', days: 3, unit: '営業日', adjust: '前営業日' },
  { seq: 60, name: '封入封緘', base: '決裁完了', direction: '後', days: 1, unit: '営業日', adjust: '前営業日' },
  { seq: 70, name: '発送', base: '封入封緘', direction: '後', days: 1, unit: '営業日', adjust: '前営業日' }
]);

check('基準日から前後の工程を算出する', () => {
  const rows = G.computeSchedule(NANBYO_TEMPLATE(), '2026-09-09', cal, '審査会');
  const byName = {};
  rows.forEach(r => { byName[r.name] = r.dateKey; });
  eq(byName['受付締切'], '2026-08-12');
  eq(byName['資料送付'], '2026-08-31');
  eq(byName['審査会'], '2026-09-09');
});

check('工程が連鎖して積み上がる（決裁→封緘→発送）', () => {
  const rows = G.computeSchedule(NANBYO_TEMPLATE(), '2026-09-09', cal, '審査会');
  const byName = {};
  rows.forEach(r => { byName[r.name] = r.dateKey; });
  eq(byName['決裁起案'], '2026-09-11');
  eq(byName['決裁完了'], '2026-09-16');
  eq(byName['封入封緘'], '2026-09-17');
  eq(byName['発送'], '2026-09-18');
});

check('基準日を動かすと全工程が追随する', () => {
  const rows = G.computeSchedule(NANBYO_TEMPLATE(), '2026-09-16', cal, '審査会');
  const byName = {};
  rows.forEach(r => { byName[r.name] = r.dateKey; });
  // 9/21〜9/23（敬老の日・国民の休日・秋分の日）で3営業日ぶん押し出される
  eq(byName['決裁起案'], '2026-09-18');
  eq(byName['決裁完了'], '2026-09-28');
  eq(byName['封入封緘'], '2026-09-29');
  eq(byName['発送'], '2026-09-30');
});

check('暦日指定は休日補正で営業日へ寄せる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '受付開始', base: '', direction: '後', days: 0, unit: '営業日', adjust: 'なし' },
    { seq: 20, name: '受付締切', base: '受付開始', direction: '後', days: 60, unit: '暦日', adjust: '翌営業日' }
  ], '2026-09-01', cal, '受付開始');
  eq(rows[1].dateKey, '2026-11-02', '60暦日後の10/31(土)→11/2(月)');
});

check('基準日名称でも基準日として参照できる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '結果整理', base: '審査会', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].dateKey, '2026-09-10');
});

// ---------------------------------------------------------------
group('日付を直接指定する工程');

check('開始日をそのまま使う', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '棚卸し', mode: '日付指定', startDate: '2026-09-14' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].dateKey, '2026-09-14');
  eq(rows[0].endKey, '', '終了日が無ければ単日');
});

check('開始日と終了日で期間になる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '窓口受付', mode: '日付指定', startDate: '2026-09-01', endDate: '2026-09-30' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].dateKey, '2026-09-01');
  eq(rows[0].endKey, '2026-09-30');
});

check('休日でも指定した日をそのまま使う', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '休日窓口', mode: '日付指定', startDate: '2026-09-05' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].dateKey, '2026-09-05', '土曜でも動かさない');
});

check('開始日が空ならエラーにする', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: '未入力', mode: '日付指定', startDate: '' }
  ], '2026-09-09', cal, '審査会'), /開始日が入っていません/);
});

check('終了日が開始日より前ならエラーにする', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: '逆転', mode: '日付指定', startDate: '2026-09-10', endDate: '2026-09-01' }
  ], '2026-09-09', cal, '審査会'), /終了日が開始日より前/);
});

check('日付指定の工程を基準にできる（期間の終わりが基準になる）', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '受付期間', mode: '日付指定', startDate: '2026-09-01', endDate: '2026-09-30' },
    { seq: 20, name: '集計', base: '受付期間', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[1].dateKey, '2026-10-01', '9/30の翌営業日');
});

check('日付種別が空でも開始日があれば日付指定として扱う', () => {
  // シートに直接書き足すと日付種別が空になりがち
  const rows = G.computeSchedule([
    { seq: 10, name: '直接記入', mode: '', startDate: '2026-09-14' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].dateKey, '2026-09-14');
  eq(G.rowMode({ mode: '', startDate: '2026-09-14' }), 'fixed');
  eq(G.rowMode({ mode: '', startDate: '' }), 'relative', '開始日も空なら従来どおり相対');
  eq(G.rowMode({ mode: '起点から', startDate: '2026-09-14' }), 'relative', '明示指定を優先する');
});

// ---------------------------------------------------------------
group('起点の日が無い業務');

check('日付指定の工程は起点が無くても決まる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '棚卸し', mode: '日付指定', startDate: '2026-09-14' }
  ], '', cal, '審査会', { skipUnresolved: true });
  eq(rows[0].dateKey, '2026-09-14');
  eq(!!rows[0].unresolved, false);
});

check('日付指定から伸びる工程も起点なしで決まる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '受付期間', mode: '日付指定', startDate: '2026-09-01', endDate: '2026-09-30' },
    { seq: 20, name: '集計', base: '受付期間', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '', cal, '審査会', { skipUnresolved: true });
  eq(rows[1].dateKey, '2026-10-01');
  eq(!!rows[1].unresolved, false);
});

check('起点からの工程は unresolved になる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '締切', base: '', direction: '前', days: 20, unit: '営業日', adjust: 'なし' },
    { seq: 20, name: '棚卸し', mode: '日付指定', startDate: '2026-09-14' }
  ], '', cal, '審査会', { skipUnresolved: true });
  eq(rows[0].unresolved, true);
  eq(rows[0].dateKey, '');
  eq(!!rows[1].unresolved, false, '日付指定は影響を受けない');
});

check('起点待ちの工程を基準にした工程も unresolved になる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '締切', base: '', direction: '前', days: 20, unit: '営業日', adjust: 'なし' },
    { seq: 20, name: '点検', base: '締切', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '', cal, '審査会', { skipUnresolved: true });
  eq(rows[0].unresolved, true);
  eq(rows[1].unresolved, true);
});

check('skipUnresolved が無ければ起点なしはエラーにする', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: '締切', base: '', direction: '前', days: 20, unit: '営業日', adjust: 'なし' }
  ], '', cal, '審査会'), /起点の日が登録されていません/);
});

// ---------------------------------------------------------------
group('日付を直接指定する工程（つづき）');

check('日付種別の表記ゆれを吸収する', () => {
  eq(G.normalizeMode(''), 'relative');
  eq(G.normalizeMode('起点から'), 'relative');
  eq(G.normalizeMode('日付指定'), 'fixed');
  eq(G.normalizeMode('指定日'), 'fixed');
  throws(() => G.normalizeMode('てきとう'), /日付種別の指定が不正/);
});

// ---------------------------------------------------------------
group('期間を持つ工程（起点からの相対）');

check('開始と終了をそれぞれ算出する', () => {
  // 審査会の20営業日前から10営業日前までが受付期間
  const rows = G.computeSchedule([
    { seq: 10, name: '受付期間', base: '', direction: '前', days: 20,
      endDirection: '前', endDays: 10, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].dateKey, '2026-08-12');
  eq(rows[0].endKey, '2026-08-26');
});

check('終了日数が空なら単日のまま', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '締切', base: '', direction: '前', days: 20, endDays: '', unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].endKey, '');
});

check('終了が開始と同じ日なら単日として扱う', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '同日', base: '', direction: '前', days: 5,
      endDirection: '前', endDays: 5, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会');
  eq(rows[0].endKey, '');
});

check('終了が開始より前ならエラーにする', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: '逆転', base: '', direction: '前', days: 5,
      endDirection: '前', endDays: 10, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会'), /終了が開始より前/);
});

check('暦日指定の期間も算出できる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '受付', base: '', direction: '後', days: 0,
      endDirection: '後', endDays: 60, unit: '暦日', adjust: 'なし' }
  ], '2026-09-01', cal, '受付開始');
  eq(rows[0].dateKey, '2026-09-01');
  eq(rows[0].endKey, '2026-10-31');
});

check('期間を持つ工程の終わりを次の工程の基準にできる', () => {
  const rows = G.computeSchedule([
    { seq: 10, name: '受付期間', base: '', direction: '後', days: 0,
      endDirection: '後', endDays: 60, unit: '暦日', adjust: 'なし' },
    { seq: 20, name: '締切後の点検', base: '受付期間', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '2026-09-01', cal, '受付開始');
  eq(rows[1].dateKey, '2026-11-02', '10/31(土)の翌営業日');
});

// ---------------------------------------------------------------
group('工程スケジュールの算出（続き）');

check('循環参照を検出する', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: 'A', base: 'B', direction: '後', days: 1, unit: '営業日', adjust: 'なし' },
    { seq: 20, name: 'B', base: 'A', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会'), /循環/);
});

check('存在しない基準を指すとエラーにする', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: 'A', base: '無い工程', direction: '後', days: 1, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会'), /対応する工程がありません/);
});

check('工程名の重複を弾く', () => {
  throws(() => G.computeSchedule([
    { seq: 10, name: '審査', base: '', direction: '前', days: 1, unit: '営業日', adjust: 'なし' },
    { seq: 20, name: '審査', base: '', direction: '前', days: 2, unit: '営業日', adjust: 'なし' }
  ], '2026-09-09', cal, '審査会'), /重複/);
});

check('方向と単位の指定ミスを弾く', () => {
  throws(() => G.signedOffset('斜め', 3), /方向の指定が不正/);
  throws(() => G.normalizeUnit('週'), /日数単位の指定が不正/);
  eq(G.signedOffset('前', 5), -5);
  eq(G.signedOffset('後', 5), 5);
  eq(G.signedOffset('', -5), -5, '方向が空なら符号をそのまま使う');
});

// ---------------------------------------------------------------
group('リマインドの振り分け');

const DIGEST_ROWS = [
  { workId: 'NAN', workName: '指定難病', period: '2026-09', seq: 10, name: '受付締切', dueKey: '2026-09-07', status: '未着手', remindDays: 3 },
  { workId: 'NAN', workName: '指定難病', period: '2026-09', seq: 20, name: '資料送付', dueKey: '2026-09-09', status: '未着手', remindDays: 3 },
  { workId: 'NAN', workName: '指定難病', period: '2026-09', seq: 30, name: '意見返送期限', dueKey: '2026-09-11', status: '未着手', remindDays: 3 },
  { workId: 'NAN', workName: '指定難病', period: '2026-09', seq: 40, name: '発送', dueKey: '2026-09-30', status: '未着手', remindDays: 3 },
  { workId: 'NAN', workName: '指定難病', period: '2026-09', seq: 50, name: '済んだ作業', dueKey: '2026-09-07', status: '完了', remindDays: 3 }
];

check('遅延・本日・まもなくに振り分ける', () => {
  const d = G.buildDigest(DIGEST_ROWS, cal, '2026-09-09', {});
  eq(d.overdue.map(x => x.name), ['受付締切']);
  eq(d.today.map(x => x.name), ['資料送付']);
  eq(d.soon.map(x => x.name), ['意見返送期限']);
  eq(d.total, 3, '先の予定(9/30)と完了分は含めない');
});

check('超過日数と残営業日を計算する', () => {
  const d = G.buildDigest(DIGEST_ROWS, cal, '2026-09-09', {});
  eq(d.overdue[0].remainingBusinessDays, -2, '9/7は2営業日超過');
  eq(d.soon[0].remainingBusinessDays, 2, '9/11まで2営業日');
});

check('完了・対象外は既定で通知しない', () => {
  const d = G.buildDigest(DIGEST_ROWS, cal, '2026-09-09', {});
  eq(d.overdue.length, 1);
  const withDone = G.buildDigest(DIGEST_ROWS, cal, '2026-09-09', { includeDone: true });
  eq(withDone.overdue.length, 2);
});

check('リマインド日数が長くても上限日数で打ち切る', () => {
  const rows = [{ workId: 'X', workName: 'X', period: '2026-09', seq: 10, name: '遠い予定', dueKey: '2026-10-30', status: '未着手', remindDays: 60 }];
  eq(G.buildDigest(rows, cal, '2026-09-09', { maxAheadBusinessDays: 14 }).total, 0);
  eq(G.buildDigest(rows, cal, '2026-09-09', { maxAheadBusinessDays: 60 }).total, 1);
});

check('リマインド日数が未設定なら通知しない', () => {
  const rows = [{ workId: 'X', workName: 'X', period: '2026-09', seq: 10, name: '通知なし', dueKey: '2026-09-10', status: '未着手', remindDays: '' }];
  eq(G.buildDigest(rows, cal, '2026-09-09', {}).soon.length, 0);
});

check('Chat投稿本文に3区分が並ぶ', () => {
  const d = G.buildDigest(DIGEST_ROWS, cal, '2026-09-09', {});
  const text = G.buildChatText(d, '2026-09-09');
  eq(text.includes('期限超過 1件'), true);
  eq(text.includes('本日 1件'), true);
  eq(text.includes('まもなく 1件'), true);
  eq(text.includes('受付締切'), true);
  eq(G.buildChatText({ overdue: [], today: [], soon: [], total: 0 }, '2026-09-09'), '', '対象ゼロなら空文字');
});

check('回次が無い工程で余分な空白を入れない', () => {
  // 日付指定だけで組んだ工程は回次を持たない
  eq(G.formatWorkLabel({ workName: '定例の事務', period: '' }), '定例の事務');
  eq(G.formatWorkLabel({ workName: '定例の事務' }), '定例の事務', '未定義でも同じ');
  eq(G.formatWorkLabel({ workName: '指定難病', period: '2026-09' }), '指定難病 2026-09');
  const d = G.buildDigest(
    [{ workId: 'X', workName: '定例の事務', color: '青', period: '', seq: 10,
       name: '窓口点検', dueKey: '2026-09-09', owner: '', status: '未着手', remindDays: 3, note: '' }],
    cal, '2026-09-09', {});
  const text = G.buildChatText(d, '2026-09-09');
  eq(text.includes('定例の事務｜本日'), true, '「定例の事務 ｜本日」にならないこと');
});

check('通知の末尾に画面へのリンクを付ける', () => {
  const d = G.buildDigest(DIGEST_ROWS, cal, '2026-09-09', {});
  const url = 'https://script.google.com/macros/s/ABC/exec';
  const withUrl = G.buildChatText(d, '2026-09-09', url);
  eq(withUrl.includes('<' + url + '|スケジュール画面を開く>'), true);
  eq(withUrl.trim().split('\n').pop().indexOf('<' + url) === 0, true, '末尾に1本だけ');
  const without = G.buildChatText(d, '2026-09-09', '');
  eq(without.includes('スケジュール画面を開く'), false, '未登録なら付けない');
  eq(G.buildChatText({ overdue: [], today: [], soon: [], total: 0 }, '2026-09-09', url), '',
    '対象ゼロならリンクも出さない');
});

check('日付の表示形式', () => {
  eq(G.formatShortDate('2026-09-09'), '9/9(水)');
});

// ---------------------------------------------------------------
group('休日データの取り込み');

check('内閣府の祝日CSVを解析する', () => {
  const csv = '国民の祝日・休日月日,国民の祝日・休日名称\r\n2026/1/1,元日\r\n2026/5/3,憲法記念日\r\n2027/1/1,元日\r\n';
  const rows = G.parseHolidayCsv_(csv, '2026-01-01', '2026-12-31');
  eq(rows.map(r => r.key), ['2026-01-01', '2026-05-03']);
  eq(rows[0].name, '元日');
  eq(rows[0].kind, '祝日');
});

check('CSVのゴミ行を無視する', () => {
  const csv = 'ヘッダー行\n\n,\n2026/8/11,山の日\nおかしな行,テスト\n';
  eq(G.parseHolidayCsv_(csv, '2026-01-01', '2026-12-31').map(r => r.key), ['2026-08-11']);
});

check('年末年始の閉庁日を年またぎで展開する', () => {
  const rows = G.buildYearEndClosures_({ '年末年始休': '12/29-1/3' }, 2026, 2026);
  eq(rows.map(r => r.key), [
    '2026-12-29', '2026-12-30', '2026-12-31',
    '2027-01-01', '2027-01-02', '2027-01-03'
  ]);
});

check('年末年始の書式が不正なら空を返す', () => {
  eq(G.buildYearEndClosures_({ '年末年始休': 'てきとう' }, 2026, 2026), []);
  eq(G.buildYearEndClosures_({ '年末年始休': '' }, 2026, 2026), []);
});

// ---------------------------------------------------------------
console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`失敗 ${failures.length} 件 / 成功 ${passed} 件\n`);
  failures.forEach(f => console.log(`  ✗ [${f.group}] ${f.name}\n      ${f.message}`));
  process.exit(1);
}
console.log(`すべて成功しました（${passed} 件）`);
