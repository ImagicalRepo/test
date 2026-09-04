/**
 * 業務スケジュール管理ツール
 *
 * このファイルは apps-script/*.gs をまとめたものです。
 * 編集はリポジトリ側の各ファイルで行い、node tools/bundle.js で作り直してください。
 *
 * 収録: 00_config.gs, 01_core_date.gs, 02_core_recurrence.gs, 03_core_schedule.gs, 04_core_digest.gs, 10_sheet_io.gs, 11_setup.gs, 12_holidays.gs, 13_generate.gs, 14_calendar.gs, 15_notify.gs, 16_menu.gs, 17_webapp.gs, 18_template_editor.gs, 19_diagnostics.gs, 20_remote_html.gs
 */

// ===========================================================================
// 00_config.gs
// ===========================================================================

/**
 * 設定・シート定義
 *
 * 指定難病の医療費助成のように「審査会日を基準に前後へ多段で伸びるスケジュール」を、
 * スプレッドシート＋ガント画面＋Google Chat 通知で管理するためのツール。
 *
 * 設計方針
 *  - 個人情報は保持しない（工程名と日付のみ）
 *  - シートをコピーして［初期セットアップ］を押すだけで動く
 *  - 要求する権限は最小（カレンダー・Gmail送信の権限は既定では不要）
 */

var SHEET = {
  SETTINGS: '設定',
  WORK: '業務マスタ',
  TEMPLATE: '工程テンプレート',
  ANCHOR: '基準日',
  SCHEDULE: '工程表',
  HOLIDAY: '休日マスタ',
  LOG: '実行ログ',
  UPDATE: '更新履歴'
};

/**
 * このコードの版。GitHub 側の版と比べて更新の有無を知らせる。
 * dist を作り直すときに手で上げる。
 */
var VERSION = '1.9.0';

/** 各シートのヘッダー定義（列は名前で参照するため、並び替えても壊れない） */
var SHEET_DEFS = [
  {
    name: SHEET.SETTINGS,
    headers: ['設定キー', '値', '説明'],
    widths: [200, 330, 470]
  },
  {
    name: SHEET.WORK,
    headers: ['業務ID', '業務名', '有効', '基準日名称', '基準日ルール', '基準日休日補正', '色', '備考'],
    widths: [100, 240, 60, 120, 200, 120, 80, 300]
  },
  {
    name: SHEET.TEMPLATE,
    headers: ['業務ID', '工程No', '工程名', '日付種別', '基準', '方向', '日数', '終了方向', '終了日数', '単位', '休日補正',
              '開始日', '終了日', '担当', 'リマインド営業日前', '備考'],
    widths: [100, 70, 260, 90, 180, 60, 60, 80, 80, 70, 90, 100, 100, 100, 130, 260]
  },
  {
    name: SHEET.ANCHOR,
    headers: ['業務ID', '回次', '基準日', '生成元', '状態', '備考'],
    widths: [100, 100, 110, 80, 90, 300]
  },
  {
    name: SHEET.SCHEDULE,
    headers: ['キー', '完', '業務ID', '業務名', '回次', '基準日', '工程No', '工程名', '予定日', '終了日', '曜日', '残営業日', '担当', '状態', '完了日', 'リマインド営業日前', '日程固定', '備考', 'イベントID'],
    widths: [200, 35, 90, 200, 90, 100, 60, 260, 100, 100, 45, 80, 90, 85, 100, 130, 75, 240, 200]
  },
  {
    name: SHEET.HOLIDAY,
    headers: ['日付', '名称', '種別'],
    widths: [110, 260, 110]
  },
  {
    name: SHEET.LOG,
    headers: ['日時', '処理', '結果', '内容'],
    widths: [160, 160, 80, 700]
  },
  {
    name: SHEET.UPDATE,
    headers: ['日時', '対象', '版', '取得元', '結果', '内容'],
    widths: [160, 120, 90, 420, 80, 380]
  }
];

/** 設定シートの既定値 */
var DEFAULT_SETTINGS = [
  ['ChatWebhookURL', '', 'Google Chat のスペースで作成した Webhook URL。ここに日次リマインドを投稿する'],
  ['通知時刻', '8', '日次リマインドを送る時刻（0〜23）。変更したら［トリガーを再設定］を実行'],
  ['休日は通知しない', 'ON', 'ON にすると土日祝・閉庁日は通知しない'],
  ['リマインド対象日数', '14', '「先の予定」として通知に含める営業日数の上限'],
  ['既定リマインド営業日前', '3', '工程テンプレートでリマインド日数が未指定のときの既定値'],
  ['先読み月数', '6', '基準日と工程表を何ヶ月先まで自動生成するか'],
  ['過去保持月数', '3', '何ヶ月前より古い工程表を通知・ガント表示の対象外にするか'],
  ['週休日', '土,日', '週休日の曜日。カンマ区切り'],
  ['年末年始休', '12/29-1/3', '毎年閉庁とする期間。M/D-M/D 形式。空なら設定しない'],
  ['祝日CSV_URL', 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv', '内閣府が公開している国民の祝日CSV。ここから祝日を取り込む'],
  ['カレンダー同期', 'OFF', 'ON にすると工程をGoogleカレンダーへ登録する。別途カレンダー権限の追加が必要（docs/README.md 参照）'],
  ['カレンダーID', '', 'カレンダー同期先のID。空ならスクリプト実行者のメインカレンダー'],
  ['ガント表示_前月数', '1', 'ガント画面で今日より何ヶ月前から表示するか'],
  ['ガント表示_後月数', '3', 'ガント画面で今日より何ヶ月先まで表示するか'],
  ['画面をGitHubから読み込む', 'OFF', 'ON にすると、画面のHTML（gantt・editor・json）を下のURLから読み込む。コードを貼り直す手間が減る。取得できないときはプロジェクト内のファイルを使う'],
  ['画面の取得元URL', 'https://raw.githubusercontent.com/ImagicalRepo/test/claude/rare-disease-subsidy-schedule-21xoll/dist/', 'HTMLの取得元。raw.githubusercontent.com のみ。末尾は / で終わらせる'],
  ['WebアプリURL', '', 'ブラウザで実際に開けたウェブアプリのURL（末尾が /exec でも /dev でも可）。メニューの［WebアプリのURLを登録］から設定する。空ならデプロイのURLを自動で使う'],
  ['画面の幅', '1400', 'スケジュール画面の幅（px）。ブラウザの幅より大きくはなりません'],
  ['画面の高さ', '800', 'スケジュール画面の高さ（px）。画面が小さいPCでは 640 程度に下げてください']
];

var STATUS = {
  NOT_STARTED: '未着手',
  IN_PROGRESS: '着手中',
  DONE: '完了',
  SKIP: '対象外'
};

var STATUS_LIST = [STATUS.NOT_STARTED, STATUS.IN_PROGRESS, STATUS.DONE, STATUS.SKIP];

var WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

/**
 * 業務マスタの「色」に使える名前。
 * 実際の色は画面側がカラーテーマに合わせて決めるため、ここでは名前だけを持つ。
 */
var COLOR_ORDER = ['青', '緑', '橙', '紫', '赤', '水色', '桃', '灰'];


// ===========================================================================
// 01_core_date.gs
// ===========================================================================

/**
 * 日付ユーティリティ / 営業日計算（純粋関数）
 *
 * 日付は原則 'YYYY-MM-DD' 形式の文字列（dateKey）で扱う。
 * タイムゾーンによる 1 日ずれを避けるため、内部の Date は必ず UTC で生成・参照する。
 */

/** 'YYYY-MM-DD' -> Date(UTC 00:00) */
function keyToDate(key) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key).trim());
  if (!m) throw new Error('日付の形式が不正です: ' + key + '（YYYY-MM-DD で指定してください）');
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new Error('存在しない日付です: ' + key);
  }
  return d;
}

/** Date -> 'YYYY-MM-DD' */
function dateToKey(d) {
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1;
  var day = d.getUTCDate();
  return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
}

/** シートのセル値（Date / 文字列 / 空）を dateKey に正規化。空なら '' を返す */
function toDateKey(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    // シートから来る Date はローカルタイムの 00:00。ローカル側の年月日をそのまま採用する。
    var y = value.getFullYear();
    var m = value.getMonth() + 1;
    var day = value.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }
  var s = String(value).trim();
  if (!s) return '';
  var m2 = /^(\d{4})[-\/年](\d{1,2})[-\/月](\d{1,2})日?$/.exec(s);
  if (!m2) throw new Error('日付として解釈できません: ' + s);
  var mm = Number(m2[2]);
  var dd = Number(m2[3]);
  return m2[1] + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
}

/** dateKey に暦日 n 日を加算した dateKey */
function addCalendarDays(key, n) {
  var d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + Number(n));
  return dateToKey(d);
}

/** 曜日番号 0=日 ... 6=土 */
function dayOfWeek(key) {
  return keyToDate(key).getUTCDay();
}

/** 2 つの dateKey の暦日差（to - from） */
function diffCalendarDays(fromKey, toKey) {
  return Math.round((keyToDate(toKey).getTime() - keyToDate(fromKey).getTime()) / 86400000);
}

/**
 * 営業日カレンダーを作る。
 * @param {Object} opts
 *   holidays      {Array<string>} 休日（祝日・閉庁日）の dateKey
 *   extraWorkdays {Array<string>} 休日だが出勤する日（振替出勤）の dateKey
 *   weekendDays   {Array<number>} 週休日の曜日番号（既定 [0,6] = 日・土）
 */
function createBusinessCalendar(opts) {
  opts = opts || {};
  var holidays = {};
  (opts.holidays || []).forEach(function (k) { if (k) holidays[k] = true; });
  var workdays = {};
  (opts.extraWorkdays || []).forEach(function (k) { if (k) workdays[k] = true; });
  var weekend = {};
  (opts.weekendDays || [0, 6]).forEach(function (w) { weekend[Number(w)] = true; });
  return { holidays: holidays, extraWorkdays: workdays, weekend: weekend };
}

/** 営業日かどうか */
function isBusinessDay(cal, key) {
  if (cal.extraWorkdays[key]) return true;   // 振替出勤は最優先
  if (cal.holidays[key]) return false;
  return !cal.weekend[dayOfWeek(key)];
}

/**
 * 営業日で n 日ずらす。
 * n > 0 : 起点の翌日以降で n 営業日後
 * n < 0 : 起点の前日以前で n 営業日前
 * n = 0 : 起点そのまま（補正は adjustToBusinessDay で行う）
 */
function addBusinessDays(cal, key, n) {
  var remaining = Math.abs(Number(n));
  if (!remaining) return key;
  var step = Number(n) > 0 ? 1 : -1;
  var cur = key;
  var guard = 0;
  while (remaining > 0) {
    cur = addCalendarDays(cur, step);
    if (isBusinessDay(cal, cur)) remaining--;
    if (++guard > 4000) throw new Error('営業日計算が収束しません（休日設定を確認してください）: ' + key);
  }
  return cur;
}

/**
 * 休日補正。
 * mode: 'none'（補正なし） / 'prev'（前営業日へ） / 'next'（翌営業日へ）
 */
function adjustToBusinessDay(cal, key, mode) {
  if (!mode || mode === 'none') return key;
  if (isBusinessDay(cal, key)) return key;
  var step = mode === 'next' ? 1 : -1;
  var cur = key;
  for (var i = 0; i < 400; i++) {
    cur = addCalendarDays(cur, step);
    if (isBusinessDay(cal, cur)) return cur;
  }
  throw new Error('補正先の営業日が見つかりません: ' + key);
}

/** from（含まない）から to（含む）までの営業日数。to が過去なら負の値 */
function countBusinessDays(cal, fromKey, toKey) {
  var diff = diffCalendarDays(fromKey, toKey);
  if (diff === 0) return 0;
  var step = diff > 0 ? 1 : -1;
  var cur = fromKey;
  var count = 0;
  for (var i = 0; i < Math.abs(diff); i++) {
    cur = addCalendarDays(cur, step);
    if (isBusinessDay(cal, cur)) count += step;
  }
  return count;
}

/**
 * 起点日から各日までの営業日数をまとめて求める表を作る。
 *
 * countBusinessDays は1回の呼び出しで日をひとつずつ辿るため、
 * 何百件もの工程それぞれについて呼ぶと表示範囲の広さに比例して遅くなる。
 * 範囲を一度だけ走査して表を作っておき、以後は参照するだけにする。
 *
 * @return {function(string): number} dateKey を渡すと営業日数を返す関数
 *         （表の範囲外の日付は countBusinessDays にそのまま委譲する）
 */
function createBusinessDayCounter(cal, originKey, minKey, maxKey) {
  var table = {};
  table[originKey] = 0;

  var cur = originKey;
  var count = 0;
  var guard = 0;
  while (cur < maxKey && guard++ < 4000) {
    cur = addCalendarDays(cur, 1);
    if (isBusinessDay(cal, cur)) count++;
    table[cur] = count;
  }

  cur = originKey;
  count = 0;
  guard = 0;
  while (cur > minKey && guard++ < 4000) {
    cur = addCalendarDays(cur, -1);
    if (isBusinessDay(cal, cur)) count--;
    table[cur] = count;
  }

  return function (key) {
    var v = table[key];
    return v === undefined ? countBusinessDays(cal, originKey, key) : v;
  };
}

/** 休日補正モードの表記ゆれを吸収（'前営業日' -> 'prev' 等） */
function normalizeAdjustMode(value) {
  var s = normalizeText(value);
  if (!s) return 'none';
  if (/^(prev|前営業日|前倒し|前)$/.test(s)) return 'prev';
  if (/^(next|翌営業日|後ろ倒し|翌|後)$/.test(s)) return 'next';
  if (/^(none|なし|補正なし|-)$/.test(s)) return 'none';
  throw new Error('休日補正の指定が不正です: ' + value + '（なし / 前営業日 / 翌営業日）');
}

/** 全角英数記号を半角へ、空白を除去した文字列を返す */
function normalizeText(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[Ａ-Ｚａ-ｚ０-９：／－．，]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
    })
    .replace(/[　\s]/g, '')
    .trim();
}


// ===========================================================================
// 02_core_recurrence.gs
// ===========================================================================

/**
 * 基準日ルールの解釈と展開（純粋関数）
 *
 * 「審査会は毎月第2水曜日」のようなルールから、実際の基準日を自動生成する。
 *
 * 対応する書き方（全角/半角・空白は無視）:
 *   毎月第2水            毎月第2水曜日 / 毎月第2水曜
 *   毎月最終金           （その月の最後の金曜日）
 *   毎月15日             毎月15
 *   毎月末日             毎月末
 *   2ヶ月毎第2水起点2026-04   （隔月。起点の月を基準に interval ヶ月ごと）
 *   毎年10月1日
 *   手動                 （基準日シートに手入力する。自動生成しない）
 */

var WEEKDAY_NAMES = { '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };

/** 基準日ルール文字列を解析する。手動/空なら null を返す */
function parseRecurrence(rule) {
  // 「末日」と「最終日曜」を取り違えないよう、ここでは「曜」を落とさずに解析する
  var s = normalizeText(rule);
  if (!s || /^(手動|なし|-)$/.test(s)) return null;

  var interval = 1;
  var anchorMonth = null; // {year, month} 隔月などの位相
  var m;

  // 起点指定（例: 起点2026-04 / 開始2026/04）
  m = /(?:起点|開始)(\d{4})[-\/](\d{1,2})/.exec(s);
  if (m) {
    anchorMonth = { year: Number(m[1]), month: Number(m[2]) };
    s = s.replace(m[0], '');
  }

  // 毎年 M月D日
  m = /^毎年(\d{1,2})月(\d{1,2})日?$/.exec(s);
  if (m) {
    return { type: 'YEARLY_DATE', month: Number(m[1]), day: Number(m[2]) };
  }

  // Nヶ月毎 / 毎月
  m = /^(\d+)[ヶケか]?月毎/.exec(s);
  if (m) {
    interval = Number(m[1]);
    s = s.replace(m[0], '');
  } else if (/^毎月/.test(s)) {
    s = s.replace(/^毎月/, '');
  } else {
    throw new Error('基準日ルールを解釈できません: ' + rule);
  }
  if (interval < 1) throw new Error('周期は 1 以上で指定してください: ' + rule);

  // 末日（「毎月最終日曜」と紛れるため、曜日パターンより先に判定する）
  if (/^(末|末日|最終日)$/.test(s)) {
    return { type: 'MONTHLY_DAY', interval: interval, day: 'last', anchorMonth: anchorMonth };
  }

  // 第N曜日（「曜」あり）: 第2水曜日 / 最終金曜 / 第2日曜
  m = /^第?(最終|末|\d)([日月火水木金土])曜日?$/.exec(s);
  // 第N曜日（「曜」を省略）: 第2水 / 最終金
  //   「日」だけは「末日」「15日」と紛れるため、省略形では受け付けない
  if (!m) m = /^第?(最終|末|\d)([月火水木金土])$/.exec(s);
  if (m) {
    var nth = /^(最終|末)$/.test(m[1]) ? 'last' : Number(m[1]);
    if (nth !== 'last' && (nth < 1 || nth > 5)) throw new Error('第N曜日の N は 1〜5 です: ' + rule);
    return { type: 'MONTHLY_NTH', interval: interval, nth: nth, weekday: WEEKDAY_NAMES[m[2]], anchorMonth: anchorMonth };
  }

  // D日
  m = /^(\d{1,2})日?$/.exec(s);
  if (m) {
    var day = Number(m[1]);
    if (day < 1 || day > 31) throw new Error('日付は 1〜31 で指定してください: ' + rule);
    return { type: 'MONTHLY_DAY', interval: interval, day: day, anchorMonth: anchorMonth };
  }

  throw new Error('基準日ルールを解釈できません: ' + rule);
}

/** 指定年月の第N曜日（nth='last' で最終）の dateKey。存在しなければ null */
function nthWeekdayOfMonth(year, month, nth, weekday) {
  if (nth === 'last') {
    var last = new Date(Date.UTC(year, month, 0));
    var back = (last.getUTCDay() - weekday + 7) % 7;
    last.setUTCDate(last.getUTCDate() - back);
    return dateToKey(last);
  }
  var first = new Date(Date.UTC(year, month - 1, 1));
  var offset = (weekday - first.getUTCDay() + 7) % 7;
  var day = 1 + offset + (nth - 1) * 7;
  var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null; // 第5週が無い月
  return dateToKey(new Date(Date.UTC(year, month - 1, day)));
}

/** 指定年月の D 日（day='last' で末日）の dateKey。存在しない日（2/31 等）は末日に丸める */
function dayOfMonth(year, month, day) {
  var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  var d = day === 'last' ? daysInMonth : Math.min(Number(day), daysInMonth);
  return dateToKey(new Date(Date.UTC(year, month - 1, d)));
}

/**
 * ルールを期間内で展開する。
 * @param {Object|null} spec parseRecurrence の戻り値
 * @param {string} fromKey 展開開始日（含む）
 * @param {string} toKey   展開終了日（含む）
 * @param {Object} cal     営業日カレンダー（休日補正に使用）
 * @param {string} adjustMode 'none' | 'prev' | 'next'
 * @return {Array<{dateKey:string, period:string}>} period は回次ラベル（YYYY-MM / YYYY）
 */
function expandRecurrence(spec, fromKey, toKey, cal, adjustMode) {
  if (!spec) return [];
  var mode = normalizeAdjustMode(adjustMode);
  var out = [];
  var from = keyToDate(fromKey);
  var to = keyToDate(toKey);
  if (from.getTime() > to.getTime()) return [];

  if (spec.type === 'YEARLY_DATE') {
    for (var y = from.getUTCFullYear(); y <= to.getUTCFullYear(); y++) {
      var key = dayOfMonth(y, spec.month, spec.day);
      pushIfInRange_(out, key, String(y), fromKey, toKey, cal, mode);
    }
    return out;
  }

  var cursorY = from.getUTCFullYear();
  var cursorM = from.getUTCMonth() + 1;
  // 隔月などは起点月から位相を合わせるため、1 周期分手前から走査する
  for (var i = 0; i < spec.interval; i++) {
    var prev = shiftMonth_(cursorY, cursorM, -1);
    cursorY = prev.year; cursorM = prev.month;
  }
  var guard = 0;
  while (guard++ < 2000) {
    var cur = { year: cursorY, month: cursorM };
    if (matchesInterval_(spec, cur)) {
      var k = spec.type === 'MONTHLY_NTH'
        ? nthWeekdayOfMonth(cur.year, cur.month, spec.nth, spec.weekday)
        : dayOfMonth(cur.year, cur.month, spec.day);
      if (k) {
        var period = cur.year + '-' + (cur.month < 10 ? '0' + cur.month : cur.month);
        pushIfInRange_(out, k, period, fromKey, toKey, cal, mode);
      }
    }
    var next = shiftMonth_(cursorY, cursorM, 1);
    cursorY = next.year; cursorM = next.month;
    if (new Date(Date.UTC(cursorY, cursorM - 1, 1)).getTime() > to.getTime()) break;
  }
  return out;
}

function matchesInterval_(spec, cur) {
  if (!spec.interval || spec.interval === 1) return true;
  var anchor = spec.anchorMonth || { year: cur.year, month: 1 };
  var months = (cur.year - anchor.year) * 12 + (cur.month - anchor.month);
  return ((months % spec.interval) + spec.interval) % spec.interval === 0;
}

function shiftMonth_(year, month, delta) {
  var total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function pushIfInRange_(out, key, period, fromKey, toKey, cal, mode) {
  var adjusted = cal ? adjustToBusinessDay(cal, key, mode) : key;
  if (adjusted < fromKey || adjusted > toKey) return;
  for (var i = 0; i < out.length; i++) if (out[i].dateKey === adjusted) return;
  out.push({ dateKey: adjusted, period: period });
}


// ===========================================================================
// 03_core_schedule.gs
// ===========================================================================

/**
 * 工程テンプレートから実際の日程を算出する（純粋関数）
 *
 * 各工程は「基準（基準日 or 別の工程）」からの相対日数で定義する。
 * これにより、審査会の日が動いても全工程が自動で追随する。
 */

var ANCHOR_ALIASES = ['起点', '起点の日', '基準日', '基準', 'アンカー', 'ANCHOR'];

/** 方向と日数から符号付き日数を得る */
function signedOffset(direction, days) {
  var n = Number(days);
  if (isNaN(n)) throw new Error('日数が数値ではありません: ' + days);
  var d = normalizeText(direction);
  if (!d || /^(-|同日)$/.test(d)) return n;
  if (/^(前|前倒し|BEFORE|-)$/i.test(d)) return -Math.abs(n);
  if (/^(後|後ろ|以降|AFTER|\+)$/i.test(d)) return Math.abs(n);
  throw new Error('方向の指定が不正です: ' + direction + '（前 / 後 / 空欄）');
}

/** 単位表記を正規化 */
function normalizeUnit(value) {
  var s = normalizeText(value);
  if (!s || /^(営業日|BIZ|B)$/i.test(s)) return 'business';
  if (/^(暦日|カレンダー日|暦|CAL|C)$/i.test(s)) return 'calendar';
  throw new Error('日数単位の指定が不正です: ' + value + '（営業日 / 暦日）');
}

function isAnchorRef(value) {
  var s = normalizeText(value);
  if (!s) return true;
  for (var i = 0; i < ANCHOR_ALIASES.length; i++) {
    if (s === normalizeText(ANCHOR_ALIASES[i])) return true;
  }
  return false;
}

/**
 * テンプレートを 1 案件分の日程に展開する。
 *
 * 工程の日付の決め方は2通りある。
 *   起点から … 基準（起点の日、または別の工程）からの相対日数で決める
 *   日付指定 … 起点と無関係に、日付そのものを指定する
 * どちらも「終了」を入れると期間になる（例：受付期間、点検作業の3日間）。
 *
 * @param {Array<Object>} rows 工程テンプレート行
 *        {seq, name, mode, base, direction, days, endDirection, endDays,
 *         startDate, endDate, unit, adjust, owner, remindDays, note}
 * @param {string} anchorKey 基準日（審査会日など）の dateKey。空なら起点なし
 * @param {Object} cal 営業日カレンダー
 * @param {string} anchorName 基準日の別名（業務マスタの「基準日名称」）。base 欄でこの名前も基準日として扱う
 * @param {Object} [opts] {skipUnresolved: true} で、起点が無くて決められない工程を
 *        エラーにせず unresolved=true を付けて返す（起点の日が未登録の業務の判定に使う）
 * @return {Array<Object>} rows に dateKey（開始）と endKey（終了・任意）を加えたもの（入力順）
 */
function computeSchedule(rows, anchorKey, cal, anchorName, opts) {
  if (!rows || !rows.length) return [];
  var skipUnresolved = !!(opts && opts.skipUnresolved);
  anchorKey = String(anchorKey || '').trim();
  if (anchorKey) keyToDate(anchorKey); // 形式チェック

  var byName = {};
  rows.forEach(function (r) {
    var name = normalizeText(r.name);
    if (!name) throw new Error('工程名が空の行があります（工程No: ' + r.seq + '）');
    if (byName[name]) throw new Error('工程名が重複しています: ' + r.name);
    byName[name] = r;
  });

  var anchorAlias = anchorName ? normalizeText(anchorName) : '';
  var resolved = {}; // 工程名 -> dateKey
  var pending = rows.slice();
  var guard = 0;

  while (pending.length) {
    var progressed = false;
    var next = [];
    for (var i = 0; i < pending.length; i++) {
      var row = pending[i];

      // 日付そのものを指定する工程は、基準を解決する必要がない
      if (rowMode(row) === 'fixed') {
        applyFixedDates(cal, row);
        // 後続の工程は、期間の終わりを基準にできる
        resolved[normalizeText(row.name)] = row.endKey || row.dateKey;
        progressed = true;
        continue;
      }

      var baseText = normalizeText(row.base);
      var baseKey = null;

      if (isAnchorRef(baseText) || (anchorAlias && baseText === anchorAlias)) {
        if (!anchorKey) {
          // 起点の日が無いと決められない工程。呼び出し側の指定で扱いを変える
          if (!skipUnresolved) {
            throw new Error('「' + row.name + '」は起点からの日数で指定されていますが、'
              + '起点の日が登録されていません');
          }
          row.unresolved = true;
          row.dateKey = '';
          row.endKey = '';
          progressed = true;
          continue;
        }
        baseKey = anchorKey;
      } else if (resolved.hasOwnProperty(baseText)) {
        baseKey = resolved[baseText];
      } else if (!byName[baseText]) {
        throw new Error('「' + row.name + '」の基準「' + row.base + '」に対応する工程がありません');
      }

      if (baseKey === null) {
        next.push(row);
        continue;
      }
      row.dateKey = offsetFrom(cal, baseKey, row);
      row.endKey = computeEndKey(cal, baseKey, row);
      resolved[normalizeText(row.name)] = row.endKey || row.dateKey;
      progressed = true;
    }
    if (!progressed) {
      if (skipUnresolved) {
        // 起点待ちの工程を基準にしている工程も、まとめて「決められない」とする
        next.forEach(function (r) { r.unresolved = true; r.dateKey = ''; r.endKey = ''; });
        break;
      }
      throw new Error('工程の基準が循環しています: ' + next.map(function (r) { return r.name; }).join(' → '));
    }
    pending = next;
    if (++guard > 500) throw new Error('工程の解決が収束しませんでした');
  }

  return rows;
}

/** 日付の決め方の表記ゆれを吸収 */
function normalizeMode(value) {
  var s = normalizeText(value);
  if (!s || /^(起点から|相対|基準から|RELATIVE)$/i.test(s)) return 'relative';
  if (/^(日付指定|指定日|直接指定|固定|FIXED)$/i.test(s)) return 'fixed';
  throw new Error('日付種別の指定が不正です: ' + value + '（起点から / 日付指定）');
}

/**
 * 1 行の日付の決め方。
 * シートに直接書き足したときは日付種別が空になりがちなので、
 * 開始日だけ埋まっている行は「日付指定」とみなす。
 */
function rowMode(row) {
  if (!normalizeText(row.mode) && String(row.startDate || '').trim()) return 'fixed';
  return normalizeMode(row.mode);
}

/** 日付を直接指定した工程の開始・終了を決める */
function applyFixedDates(cal, row) {
  var start = String(row.startDate || '').trim();
  if (!start) {
    throw new Error('「' + row.name + '」は日付指定ですが、開始日が入っていません');
  }
  keyToDate(start);
  row.dateKey = start;

  var end = String(row.endDate || '').trim();
  if (!end) {
    row.endKey = '';
    return;
  }
  keyToDate(end);
  if (end < start) {
    throw new Error('「' + row.name + '」の終了日が開始日より前です（' + start + ' 〜 ' + end + '）');
  }
  row.endKey = end;
}

/** 期間の終わり（起点からの相対指定）。終了日数が空なら単日として '' を返す */
function computeEndKey(cal, baseKey, row) {
  var raw = row.endDays;
  if (raw === '' || raw === null || raw === undefined) return '';
  var endRow = {
    name: row.name,
    direction: row.endDirection === '' || row.endDirection === undefined || row.endDirection === null
      ? row.direction : row.endDirection,
    days: raw,
    unit: row.unit,
    adjust: row.adjust
  };
  var endKey = offsetFrom(cal, baseKey, endRow);
  if (endKey < row.dateKey) {
    throw new Error('「' + row.name + '」の終了が開始より前になります（'
      + row.dateKey + ' 〜 ' + endKey + '）');
  }
  return endKey === row.dateKey ? '' : endKey;
}

/** 基準日から 1 工程分ずらす */
function offsetFrom(cal, baseKey, row) {
  var offset = signedOffset(row.direction, row.days);
  var unit = normalizeUnit(row.unit);
  var adjust = normalizeAdjustMode(row.adjust);
  var key = unit === 'business'
    ? addBusinessDays(cal, baseKey, offset)
    : addCalendarDays(baseKey, offset);
  // 営業日計算の結果は必ず営業日になるが、offset=0 や暦日指定では休日に着地しうる
  return adjustToBusinessDay(cal, key, unit === 'business' && offset !== 0 ? 'none' : adjust);
}

/**
 * 予定日とリマインド設定から、通知すべきかを判定する。
 * @return {string} 'overdue' | 'today' | 'soon' | 'none'
 */
function reminderStatus(cal, todayKey, dueKey, remindBusinessDays) {
  if (dueKey === todayKey) return 'today';
  if (dueKey < todayKey) return 'overdue';
  var lead = Number(remindBusinessDays);
  if (!lead || lead < 0) return 'none';
  var remaining = countBusinessDays(cal, todayKey, dueKey);
  return remaining <= lead ? 'soon' : 'none';
}


// ===========================================================================
// 04_core_digest.gs
// ===========================================================================

/**
 * 日次リマインドの内容を組み立てる（純粋関数）
 *
 * 「遅延」「本日」「まもなく」の3区分に振り分ける。
 * 区分の判定は工程ごとの「リマインド営業日前」に従う。
 */

/**
 * @param {Array<Object>} rows {workId, workName, color, period, seq, name, dueKey, owner, status, remindDays, note}
 * @param {Object} cal 営業日カレンダー
 * @param {string} todayKey 'YYYY-MM-DD'
 * @param {Object} opts {maxAheadBusinessDays:number, includeDone:boolean}
 * @return {{overdue:Array, today:Array, soon:Array, total:number}}
 */
function buildDigest(rows, cal, todayKey, opts) {
  opts = opts || {};
  var maxAhead = opts.maxAheadBusinessDays === undefined ? 14 : Number(opts.maxAheadBusinessDays);
  var includeDone = !!opts.includeDone;
  // 呼び出し側が営業日数の表を用意していればそれを使う（件数が多いときに効く）
  var countFrom = opts.counter || function (key) { return countBusinessDays(cal, todayKey, key); };

  var overdue = [], today = [], soon = [];

  rows.forEach(function (r) {
    if (!r.dueKey) return;
    var status = String(r.status || '').trim();
    if (!includeDone && (status === STATUS.DONE || status === STATUS.SKIP)) return;

    var remaining = countFrom(r.dueKey);
    var item = {
      key: r.key || '',
      workId: r.workId,
      workName: r.workName,
      color: r.color,
      period: r.period,
      seq: r.seq,
      name: r.name,
      dueKey: r.dueKey,
      owner: r.owner || '',
      status: status,
      note: r.note || '',
      remainingBusinessDays: remaining
    };

    if (r.dueKey < todayKey) {
      overdue.push(item);
      return;
    }
    if (r.dueKey === todayKey) {
      today.push(item);
      return;
    }
    var lead = Number(r.remindDays);
    if (isNaN(lead) || lead < 0) return;
    if (remaining <= Math.min(lead, maxAhead)) soon.push(item);
  });

  var byDue = function (a, b) {
    if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
    return (Number(a.seq) || 0) - (Number(b.seq) || 0);
  };
  overdue.sort(byDue);
  today.sort(byDue);
  soon.sort(byDue);

  return { overdue: overdue, today: today, soon: soon, total: overdue.length + today.length + soon.length };
}

/** 'YYYY-MM-DD' -> '9/12(金)' */
function formatShortDate(key) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return Number(m[2]) + '/' + Number(m[3]) + '(' + WEEKDAY_LABELS[dayOfWeek(key)] + ')';
}

/**
 * 「業務名 回次」の表示。
 * 日付指定だけで組んだ工程は回次を持たないため、空なら区切りを入れない
 * （入れると「指定難病 医療費助成 ｜本日」のように余分な空白が残る）。
 */
function formatWorkLabel(item) {
  var period = String(item.period === undefined || item.period === null ? '' : item.period).trim();
  return period ? item.workName + ' ' + period : String(item.workName || '');
}

/** 1件分の表示行 */
function formatDigestLine(item, kind) {
  var head;
  if (kind === 'overdue') {
    head = '<b>' + formatShortDate(item.dueKey) + '</b> ' + Math.abs(item.remainingBusinessDays) + '営業日超過';
  } else if (kind === 'today') {
    head = '<b>本日</b>';
  } else {
    head = '<b>' + formatShortDate(item.dueKey) + '</b> あと' + item.remainingBusinessDays + '営業日';
  }
  var tail = item.owner ? '（' + item.owner + '）' : '';
  return head + '　' + formatWorkLabel(item) + '\n　' + item.name + tail;
}

/**
 * Google Chat へ投稿する本文（テキスト形式）を組み立てる。
 * カード形式より崩れにくく、スマホでも読みやすい。
 */
function buildChatText(digest, todayKey, appUrl) {
  if (!digest.total) return '';
  var lines = [];
  lines.push('*' + formatShortDate(todayKey) + ' の業務スケジュール*');

  if (digest.overdue.length) {
    lines.push('');
    lines.push('🔴 *期限超過 ' + digest.overdue.length + '件*');
    digest.overdue.forEach(function (i) { lines.push(chatLine_(i, 'overdue')); });
  }
  if (digest.today.length) {
    lines.push('');
    lines.push('🟡 *本日 ' + digest.today.length + '件*');
    digest.today.forEach(function (i) { lines.push(chatLine_(i, 'today')); });
  }
  if (digest.soon.length) {
    lines.push('');
    lines.push('🔵 *まもなく ' + digest.soon.length + '件*');
    digest.soon.forEach(function (i) { lines.push(chatLine_(i, 'soon')); });
  }

  // 通知から画面へ飛べるように、末尾に1本だけリンクを置く。
  // 各行に付けると読みにくくなるため、まとめてここに出す。
  if (appUrl) {
    lines.push('');
    lines.push('<' + appUrl + '|スケジュール画面を開く>');
  }
  return lines.join('\n');
}

function chatLine_(item, kind) {
  var when;
  if (kind === 'overdue') {
    when = formatShortDate(item.dueKey) + ' 期限・' + Math.abs(item.remainingBusinessDays) + '営業日超過';
  } else if (kind === 'today') {
    when = '本日';
  } else {
    when = formatShortDate(item.dueKey) + '・あと' + item.remainingBusinessDays + '営業日';
  }
  var owner = item.owner ? ' 〈' + item.owner + '〉' : '';
  return '• *' + item.name + '*' + owner + '\n　' + formatWorkLabel(item) + '｜' + when;
}


// ===========================================================================
// 10_sheet_io.gs
// ===========================================================================

/**
 * スプレッドシート入出力
 */

var SS_ID_PROP = 'SPREADSHEET_ID';
var SS_CACHE_ = null;

/**
 * 対象スプレッドシートを返す。
 * Webアプリ（doGet）からは getActive() が使えない場合があるため、
 * 初期セットアップ時に控えておいたIDでフォールバックする。
 *
 * 1回の実行中に何十回も呼ばれるので、取得結果を保持しておく。
 */
function ss_() {
  if (SS_CACHE_) return SS_CACHE_;

  var active = null;
  try {
    active = SpreadsheetApp.getActive();
  } catch (e) {
    active = null;
  }
  if (active) {
    SS_CACHE_ = active;
    try {
      var props = PropertiesService.getScriptProperties();
      if (props.getProperty(SS_ID_PROP) !== active.getId()) {
        props.setProperty(SS_ID_PROP, active.getId());
      }
    } catch (e) { /* 権限がなければ黙って諦める */ }
    return active;
  }
  var id = PropertiesService.getScriptProperties().getProperty(SS_ID_PROP);
  if (!id) throw new Error('対象のスプレッドシートを特定できません。スプレッドシートから［初期セットアップ］を1回実行してください。');
  SS_CACHE_ = SpreadsheetApp.openById(id);
  return SS_CACHE_;
}

/** 実行ログを1行追記する（失敗しても本処理は止めない） */
function log_(process, ok, message) {
  try {
    var sh = getSheet_(SHEET.LOG, true);
    if (!sh) return;
    sh.appendRow([new Date(), process, ok ? 'OK' : 'NG', String(message).slice(0, 4000)]);
    // 直近300行だけ残す
    var extra = sh.getLastRow() - 301;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) {
    console.warn('ログ書き込みに失敗: ' + e.message);
  }
}

function getSheet_(name, optional) {
  var sh = ss_().getSheetByName(name);
  if (!sh && !optional) {
    throw new Error('シート「' + name + '」がありません。メニュー［難病スケジュール］→［初期セットアップ］を実行してください。');
  }
  return sh;
}

/**
 * シートを {headers, rows} で読み出す。
 * rows の各要素は列名をキーにしたオブジェクトで、_row に実際の行番号を持つ。
 */
function readTable_(name) {
  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { sheet: sh, headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

/** ヘッダー名 -> 列番号(1始まり) のマップ */
function headerIndex_(headers) {
  var idx = {};
  headers.forEach(function (h, i) { if (h) idx[h] = i + 1; });
  return idx;
}

/** オブジェクト配列をシートの 2 行目以降へ全面上書きする */
function replaceTable_(name, rows) {
  var t = readTable_(name);
  var sh = t.sheet;
  var headers = t.headers;
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

/** オブジェクト配列を末尾に追記する */
function appendRows_(name, rows) {
  if (!rows.length) return;
  var t = readTable_(name);
  var sh = t.sheet;
  var headers = t.headers;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

/** 設定シートを key -> value のオブジェクトで読み出す */
function getSettings_() {
  var t = readTable_(SHEET.SETTINGS);
  var map = {};
  t.rows.forEach(function (r) {
    var k = String(r['設定キー']).trim();
    if (k) map[k] = r['値'];
  });
  return map;
}

/** 設定シートの値を書き換える（キーが無ければ末尾に追加する） */
function setSetting_(key, value, description) {
  var t = readTable_(SHEET.SETTINGS);
  var idx = headerIndex_(t.headers);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['設定キー']).trim() === key) {
      t.sheet.getRange(t.rows[i]._row, idx['値']).setValue(value);
      return;
    }
  }
  appendRows_(SHEET.SETTINGS, [{ '設定キー': key, '値': value, '説明': description || '' }]);
}

function settingText_(settings, key, fallback) {
  var v = settings[key];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return String(v).trim();
}

function settingNumber_(settings, key, fallback) {
  var v = settingText_(settings, key, null);
  if (v === null) return fallback;
  var n = Number(v);
  return isNaN(n) ? fallback : n;
}

function settingBool_(settings, key, fallback) {
  var v = settingText_(settings, key, null);
  if (v === null) return fallback;
  return /^(on|true|はい|有効|1)$/i.test(v);
}

/** 休日マスタと設定から営業日カレンダーを組み立てる */
function loadBusinessCalendar_(settings) {
  settings = settings || getSettings_();
  var holidays = [];
  var extraWorkdays = [];
  var sh = getSheet_(SHEET.HOLIDAY, true);
  if (sh) {
    var t = readTable_(SHEET.HOLIDAY);
    t.rows.forEach(function (r) {
      var key = toDateKey(r['日付']);
      if (!key) return;
      if (String(r['種別']).indexOf('出勤') >= 0) extraWorkdays.push(key);
      else holidays.push(key);
    });
  }
  var weekendText = settingText_(settings, '週休日', '土,日');
  var weekendDays = weekendText.split(/[,、]/).map(function (s) {
    var name = normalizeText(s).replace(/曜日?$/, '');
    var i = WEEKDAY_LABELS.indexOf(name);
    return i >= 0 ? i : null;
  }).filter(function (v) { return v !== null; });
  if (!weekendDays.length) weekendDays = [0, 6];

  return createBusinessCalendar({ holidays: holidays, extraWorkdays: extraWorkdays, weekendDays: weekendDays });
}

/**
 * 回次（2026-09 / 2026）を文字列として読む。
 *
 * 「2026-09」はスプレッドシートが日付として解釈してしまうことがあり、
 * そのまま String() すると "Sat Aug 01 2026 00:00:00 GMT+0900" のような
 * 表示になってしまう。Date で入っていた場合は年月に戻す。
 */
function periodText_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Tokyo';
    return Utilities.formatDate(value, tz, 'yyyy-MM');
  }
  return String(value).trim();
}

/** dateKey をシート表示用の Date（ローカル 00:00）に変換 */
function keyToSheetDate_(key) {
  if (!key) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function todayKey_() {
  var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}


// ===========================================================================
// 11_setup.gs
// ===========================================================================

/**
 * 初期セットアップ：シート作成・書式・サンプルデータ・トリガー登録
 *
 * スプレッドシートをコピーしたあと、これを1回実行すれば使い始められる。
 */

function setupWorkbook() {
  var created = [];
  SHEET_DEFS.forEach(function (def) {
    var sh = ss_().getSheetByName(def.name);
    if (!sh) {
      sh = ss_().insertSheet(def.name);
      created.push(def.name);
    }
    // ヘッダーを整える（既存の列は残し、不足分だけ足す）
    var existing = (sh.getLastColumn() > 0 && sh.getLastRow() > 0)
      ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); })
      : [];
    var headers = existing.filter(function (h) { return h; });
    def.headers.forEach(function (h) { if (headers.indexOf(h) < 0) headers.push(h); });
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#e8eef7')
      .setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    def.widths.forEach(function (w, i) {
      if (i < headers.length) sh.setColumnWidth(i + 1, w);
    });
  });

  seedSettings_();
  var seeded = false;
  if (readTable_(SHEET.WORK).rows.length === 0) {
    seedSamples_();
    seeded = true;
  }
  applyFormats_();
  applyValidations_();
  syncHolidays();
  var result = generateSchedules();
  applyScheduleCheckboxes_();
  installTriggers();

  log_('初期セットアップ', true, 'シート作成 ' + created.length + '件 / サンプル投入 ' + (seeded ? 'あり' : 'なし'));
  return { created: created, seeded: seeded, generate: result };
}

function seedSettings_() {
  var t = readTable_(SHEET.SETTINGS);
  var existing = {};
  t.rows.forEach(function (r) { existing[String(r['設定キー']).trim()] = true; });
  var add = DEFAULT_SETTINGS.filter(function (row) { return !existing[row[0]]; })
    .map(function (row) { return { '設定キー': row[0], '値': row[1], '説明': row[2] }; });
  appendRows_(SHEET.SETTINGS, add);
}

function applyFormats_() {
  var sched = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(sched.headers);
  var sh = sched.sheet;
  var rowCount = Math.max(sh.getMaxRows() - 1, 1);

  ['予定日', '終了日', '完了日', '基準日'].forEach(function (name) {
    if (idx[name]) sh.getRange(2, idx[name], rowCount).setNumberFormat('yyyy/mm/dd');
  });
  var tplFmt = readTable_(SHEET.TEMPLATE);
  var tfIdx = headerIndex_(tplFmt.headers);
  ['開始日', '終了日'].forEach(function (name) {
    if (tfIdx[name]) {
      tplFmt.sheet.getRange(2, tfIdx[name], Math.max(tplFmt.sheet.getMaxRows() - 1, 1))
        .setNumberFormat('yyyy/mm/dd');
    }
  });
  var anchor = readTable_(SHEET.ANCHOR);
  var aidx = headerIndex_(anchor.headers);
  if (aidx['基準日']) anchor.sheet.getRange(2, aidx['基準日'], Math.max(anchor.sheet.getMaxRows() - 1, 1)).setNumberFormat('yyyy/mm/dd');
  // 「2026-09」のような回次は、放っておくとスプレッドシートが日付に変換してしまう
  if (aidx['回次']) anchor.sheet.getRange(2, aidx['回次'], Math.max(anchor.sheet.getMaxRows() - 1, 1)).setNumberFormat('@');
  if (idx['回次']) sh.getRange(2, idx['回次'], rowCount).setNumberFormat('@');
  var hol = readTable_(SHEET.HOLIDAY);
  var hidx = headerIndex_(hol.headers);
  if (hidx['日付']) hol.sheet.getRange(2, hidx['日付'], Math.max(hol.sheet.getMaxRows() - 1, 1)).setNumberFormat('yyyy/mm/dd');

  // 内部用の列は隠す
  if (idx['キー']) sh.hideColumns(idx['キー']);
  if (idx['イベントID']) sh.hideColumns(idx['イベントID']);

  // 条件付き書式：完了=グレー / 期限超過=赤 / 本日=黄
  if (idx['状態'] && idx['予定日']) {
    var range = sh.getRange(2, 1, rowCount, sched.headers.length);
    var cs = columnLetter_(idx['状態']);
    var cd = columnLetter_(idx['予定日']);
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=$' + cs + '2="' + STATUS.DONE + '"')
        .setBackground('#f1f3f4').setFontColor('#9aa0a6').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + cd + '2<>"",$' + cd + '2<TODAY(),$' + cs + '2<>"' + STATUS.DONE + '",$' + cs + '2<>"' + STATUS.SKIP + '")')
        .setBackground('#fce8e6').setFontColor('#c5221f').setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied('=AND($' + cd + '2=TODAY(),$' + cs + '2<>"' + STATUS.DONE + '")')
        .setBackground('#fef7e0').setRanges([range]).build()
    ]);
  }
}

function applyValidations_() {
  var sched = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(sched.headers);
  var rows = Math.max(sched.sheet.getMaxRows() - 1, 1);
  if (idx['状態']) {
    sched.sheet.getRange(2, idx['状態'], rows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build());
  }
  if (idx['日程固定']) {
    sched.sheet.getRange(2, idx['日程固定'], rows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['', 'ON'], true).build());
  }

  var tpl = readTable_(SHEET.TEMPLATE);
  var tidx = headerIndex_(tpl.headers);
  var trows = Math.max(tpl.sheet.getMaxRows() - 1, 1);
  if (tidx['日付種別']) {
    tpl.sheet.getRange(2, tidx['日付種別'], trows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['日付指定', '起点から'], true).build());
  }
  if (tidx['単位']) {
    tpl.sheet.getRange(2, tidx['単位'], trows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['営業日', '暦日'], true).build());
  }
  if (tidx['方向']) {
    tpl.sheet.getRange(2, tidx['方向'], trows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['前', '後'], true).build());
  }
  if (tidx['休日補正']) {
    tpl.sheet.getRange(2, tidx['休日補正'], trows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['なし', '前営業日', '翌営業日'], true).build());
  }

  var work = readTable_(SHEET.WORK);
  var widx = headerIndex_(work.headers);
  var wrows = Math.max(work.sheet.getMaxRows() - 1, 1);
  if (widx['有効']) {
    work.sheet.getRange(2, widx['有効'], wrows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['ON', 'OFF'], true).build());
  }
  if (widx['色']) {
    work.sheet.getRange(2, widx['色'], wrows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(COLOR_ORDER, true).build());
  }
  if (widx['基準日休日補正']) {
    work.sheet.getRange(2, widx['基準日休日補正'], wrows).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['なし', '前営業日', '翌営業日'], true).build());
  }
}

/** 工程表の「完」列をチェックボックスにする */
function applyScheduleCheckboxes_() {
  var sched = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(sched.headers);
  if (!idx['完']) return;
  var last = Math.max(sched.sheet.getLastRow() - 1, 1);
  sched.sheet.getRange(2, idx['完'], last).insertCheckboxes();
}

function columnLetter_(col) {
  var s = '';
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - m) / 26);
  }
  return s;
}

/**
 * サンプルデータ投入。
 * ※ 工程名・日数は「よくある流れ」の例です。実際の要領・決裁ルールに合わせて必ず書き換えてください。
 */
function seedSamples_() {
  appendRows_(SHEET.WORK, [
    {
      '業務ID': 'NAN', '業務名': '指定難病 医療費助成（月次審査会）', '有効': 'ON',
      '基準日名称': '審査会', '基準日ルール': '毎月第2水', '基準日休日補正': '前営業日',
      '色': '青', '備考': '審査会日を基準に、前後の工程を自動算出'
    },
    {
      '業務ID': 'KOSIN', '業務名': '指定難病 更新申請（一斉更新）', '有効': 'ON',
      '基準日名称': '受付開始', '基準日ルール': '毎年9月1日', '基準日休日補正': '翌営業日',
      '色': '緑', '備考': '年次の一斉更新。受付開始日を基準に前後を算出'
    },
    {
      '業務ID': 'SHOMAN', '業務名': '小児慢性特定疾病 医療費助成', '有効': 'ON',
      '基準日名称': '審査会', '基準日ルール': '毎月第4火', '基準日休日補正': '前営業日',
      '色': '橙', '備考': '別サイクルで回る審査会'
    }
  ]);

  var nan = [
    [10, '申請受付分の締切（当月審査会分）', '', '前', 20, '営業日', 3, '窓口・郵送分をここで締める'],
    [20, '形式審査・不備照会の完了', '', '前', 15, '営業日', 3, '不備は返戻または追加提出を依頼'],
    [30, '審査会資料の作成・システム入力', '', '前', 10, '営業日', 3, '入力はここまでに終わらせる'],
    [40, '資料の最終確認（係内）', '', '前', 8, '営業日', 2, ''],
    [50, '審査委員へ資料送付', '', '前', 7, '営業日', 2, '発送日'],
    [60, '審査委員からの意見返送期限', '', '前', 3, '営業日', 2, '未着はここで督促'],
    [70, '審査会', '', '後', 0, '営業日', 1, '基準日そのもの'],
    [80, '審査結果の整理・記録作成', '審査会', '後', 1, '営業日', 1, ''],
    [90, '認定/不認定 決裁の起案・システム入力', '審査結果の整理・記録作成', '後', 1, '営業日', 1, '起案日'],
    [100, '決裁完了（見込）', '認定/不認定 決裁の起案・システム入力', '後', 3, '営業日', 2, '起案からN営業日。実績に合わせて調整する'],
    [110, '受給者証・通知書の印刷', '決裁完了（見込）', '後', 1, '営業日', 1, ''],
    [120, '封入封緘・点検', '受給者証・通知書の印刷', '後', 1, '営業日', 1, '二人体制で突合'],
    [130, '受給者証の発送', '封入封緘・点検', '後', 1, '営業日', 1, '到達日を意識して逆算する'],
    [140, '台帳更新・報告用データ反映', '受給者証の発送', '後', 2, '営業日', 2, '']
  ];
  appendRows_(SHEET.TEMPLATE, nan.map(function (r) {
    return {
      '業務ID': 'NAN', '工程No': r[0], '工程名': r[1], '基準': r[2], '方向': r[3], '日数': r[4],
      '単位': r[5], '休日補正': '前営業日', '担当': '', 'リマインド営業日前': r[6], '備考': r[7]
    };
  }));

  var kosin = [
    [10, '更新案内の印刷・封入準備', '', '前', 20, '営業日', 5, ''],
    [20, '更新案内の一斉発送', '', '前', 10, '営業日', 3, '受付開始前に届くように'],
    [30, '更新申請 受付開始', '', '後', 0, '営業日', 1, '基準日そのもの'],
    [40, '受付期間 中間点検（未提出者の把握）', '更新申請 受付開始', '後', 30, '暦日', 3, ''],
    [50, '更新申請 受付締切', '更新申請 受付開始', '後', 60, '暦日', 5, '休日なら翌営業日に補正'],
    [60, '未提出者への勧奨通知', '更新申請 受付締切', '後', 5, '営業日', 3, ''],
    [70, '審査・決裁（一斉分）完了', '更新申請 受付締切', '後', 30, '営業日', 5, ''],
    [80, '新受給者証の封入封緘', '審査・決裁（一斉分）完了', '後', 3, '営業日', 2, ''],
    [90, '新受給者証の一斉発送', '新受給者証の封入封緘', '後', 2, '営業日', 2, '有効期間の開始前に到達させる']
  ];
  appendRows_(SHEET.TEMPLATE, kosin.map(function (r) {
    return {
      '業務ID': 'KOSIN', '工程No': r[0], '工程名': r[1], '基準': r[2], '方向': r[3], '日数': r[4],
      '単位': r[5], '休日補正': '翌営業日', '担当': '', 'リマインド営業日前': r[6], '備考': r[7]
    };
  }));

  var shoman = [
    [10, '申請受付分の締切', '', '前', 15, '営業日', 3, ''],
    [20, '医療意見書の確認・審査会資料作成', '', '前', 8, '営業日', 3, ''],
    [30, '審査会', '', '後', 0, '営業日', 1, ''],
    [40, '決裁起案', '審査会', '後', 2, '営業日', 1, ''],
    [50, '受給者証の発送', '決裁起案', '後', 5, '営業日', 2, '']
  ];
  appendRows_(SHEET.TEMPLATE, shoman.map(function (r) {
    return {
      '業務ID': 'SHOMAN', '工程No': r[0], '工程名': r[1], '基準': r[2], '方向': r[3], '日数': r[4],
      '単位': r[5], '休日補正': '前営業日', '担当': '', 'リマインド営業日前': r[6], '備考': r[7]
    };
  }));
}

/**
 * 業務の定義と、そこから生成したものをすべて消す。
 *
 * 設定・休日マスタ・実行ログは残す。作り直す必要がなく、
 * 特に休日マスタは手入力した閉庁日を失うと痛いため。
 */
function resetBusinessData() {
  [SHEET.WORK, SHEET.TEMPLATE, SHEET.ANCHOR, SHEET.SCHEDULE].forEach(function (name) {
    replaceTable_(name, []);
  });
  applyFormats_();
  applyValidations_();
  log_('データ初期化', true, '業務マスタ・工程テンプレート・基準日・工程表 を空にしました');
}

/** 日次トリガーを（重複させずに）登録する */
function installTriggers() {
  var settings = getSettings_();
  var hour = settingNumber_(settings, '通知時刻', 8);
  if (hour < 0 || hour > 23) hour = 8;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'dailyReminder' || fn === 'nightlyRefresh') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('nightlyRefresh').timeBased().atHour(1).everyDays(1).create();
  ScriptApp.newTrigger('dailyReminder').timeBased().atHour(hour).everyDays(1).create();
  log_('トリガー設定', true, '日次リマインド ' + hour + '時 / 自動更新 1時');
  return hour;
}

/** 毎晩の自動更新：休日取込 → 基準日展開 → 工程表生成 →（有効なら）カレンダー同期 */
function nightlyRefresh() {
  syncHolidays();
  generateSchedules();
  syncCalendarIfEnabled();
}


// ===========================================================================
// 12_holidays.gs
// ===========================================================================

/**
 * 休日マスタの同期
 *
 * ・国民の祝日：内閣府が公開している syukujitsu.csv から取り込む（種別=祝日）
 *   一次情報なので確実で、Googleカレンダーの権限も不要。
 * ・年末年始 ：設定シートの「年末年始休」から自動生成（種別=年末年始）
 * ・上記以外 ：手入力した閉庁日・振替出勤日は消さずに残す（種別=閉庁 / 振替出勤）
 */

function syncHolidays() {
  var settings = getSettings_();
  var t = readTable_(SHEET.HOLIDAY);

  // 手入力分（閉庁・振替出勤など）は保持する
  var manual = t.rows.filter(function (r) {
    var kind = String(r['種別'] || '').trim();
    return kind !== '祝日' && kind !== '年末年始';
  }).map(function (r) {
    return { key: toDateKey(r['日付']), name: r['名称'], kind: String(r['種別'] || '閉庁').trim() };
  }).filter(function (r) { return r.key; });

  var thisYear = Number(todayKey_().slice(0, 4));
  var fromKey = (thisYear - 1) + '-01-01';
  var toKey = (thisYear + 3) + '-12-31';

  var fetched = [];
  var fetchError = '';
  try {
    fetched = fetchNationalHolidays_(settings, fromKey, toKey);
  } catch (e) {
    fetchError = e.message;
    // 取得できなかった場合は既存の祝日行をそのまま残す（消してしまうと営業日計算が狂うため）
    fetched = t.rows.filter(function (r) { return String(r['種別'] || '').trim() === '祝日'; })
      .map(function (r) { return { key: toDateKey(r['日付']), name: r['名称'], kind: '祝日' }; })
      .filter(function (r) { return r.key; });
  }

  var yearEnd = buildYearEndClosures_(settings, thisYear - 1, thisYear + 3);

  var merged = {};
  // 手入力を最優先（振替出勤の指定が祝日に勝てるようにする）
  manual.concat(fetched).concat(yearEnd).forEach(function (r) {
    if (!r.key) return;
    if (!merged[r.key]) merged[r.key] = r;
  });

  var rows = Object.keys(merged).sort().map(function (k) {
    return { '日付': keyToSheetDate_(k), '名称': merged[k].name, '種別': merged[k].kind };
  });
  replaceTable_(SHEET.HOLIDAY, rows);

  if (fetchError) {
    log_('休日同期', false, '祝日CSVを取得できませんでした（既存の祝日行を維持）: ' + fetchError);
  } else {
    log_('休日同期', true, rows.length + '件');
  }
  return { count: rows.length, error: fetchError };
}

/** 内閣府の祝日CSVを取得して [{key,name,kind}] を返す */
function fetchNationalHolidays_(settings, fromKey, toKey) {
  var url = settingText_(settings, '祝日CSV_URL', 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('HTTP ' + res.getResponseCode());
  }
  // 内閣府CSVは Shift_JIS
  var text;
  try {
    text = res.getBlob().getDataAsString('Shift_JIS');
  } catch (e) {
    text = res.getContentText();
  }
  return parseHolidayCsv_(text, fromKey, toKey);
}

/**
 * 祝日CSVを解析する（純粋関数）。
 * 形式: 「国民の祝日・休日月日,国民の祝日・休日名称」のヘッダー＋ "2026/1/1,元日" の行
 */
function parseHolidayCsv_(text, fromKey, toKey) {
  var out = [];
  String(text).split(/\r\n|\r|\n/).forEach(function (line) {
    if (!line) return;
    var cols = line.split(',');
    if (cols.length < 2) return;
    var m = /^\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*$/.exec(cols[0]);
    if (!m) return; // ヘッダー行など
    var key = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
    if (fromKey && key < fromKey) return;
    if (toKey && key > toKey) return;
    out.push({ key: key, name: String(cols[1]).trim(), kind: '祝日' });
  });
  return out;
}

/** 「12/29-1/3」形式の年末年始閉庁日を年ごとに展開する（純粋関数） */
function buildYearEndClosures_(settings, fromYear, toYear) {
  // 設定を空にしたら「年末年始の閉庁を設定しない」の意味なので、既定値へ戻さない
  var spec = settingText_(settings, '年末年始休', '');
  if (!spec) return [];
  var m = /^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/.exec(normalizeText(spec));
  if (!m) {
    log_('休日同期', false, '年末年始休の書式が不正です（例: 12/29-1/3）: ' + spec);
    return [];
  }
  var out = [];
  for (var y = fromYear; y <= toYear; y++) {
    var startKey = y + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
    var endYear = Number(m[3]) < Number(m[1]) ? y + 1 : y;
    var endKey = endYear + '-' + pad2_(m[3]) + '-' + pad2_(m[4]);
    var cur = startKey;
    var guard = 0;
    while (cur <= endKey && guard++ < 40) {
      out.push({ key: cur, name: '年末年始（閉庁）', kind: '年末年始' });
      cur = addCalendarDays(cur, 1);
    }
  }
  return out;
}

function pad2_(v) { var n = Number(v); return n < 10 ? '0' + n : String(n); }


// ===========================================================================
// 13_generate.gs
// ===========================================================================

/**
 * 基準日の展開と工程表の生成
 *
 * ・業務マスタの「基準日ルール」から基準日シートへ回次を自動追加（既存行は上書きしない）
 * ・基準日 × 工程テンプレート から工程表を再生成
 * ・状態／完了日／備考／担当／イベントID など手入力した内容は保持する
 * ・「日程固定」に ON を入れた行は、再生成しても予定日を動かさない
 */

function generateSchedules() {
  var settings = getSettings_();
  var cal = loadBusinessCalendar_(settings);
  var today = todayKey_();
  var aheadMonths = settingNumber_(settings, '先読み月数', 6);
  var backMonths = settingNumber_(settings, '過去保持月数', 3);
  var defaultRemind = settingNumber_(settings, '既定リマインド営業日前', 3);

  var fromKey = shiftMonthKey_(today, -backMonths);
  var toKey = shiftMonthKey_(today, aheadMonths);

  var works = readTable_(SHEET.WORK).rows.filter(function (w) {
    return String(w['業務ID']).trim() && !/^(off|false|いいえ|無効|0)$/i.test(String(w['有効']).trim());
  });
  var errors = [];
  // 工程が未登録の業務。エラーではなく「まだ作っていないだけ」なので分けて扱う
  var notices = {};

  // ---- 1. 基準日の自動展開 ----
  var anchorTable = readTable_(SHEET.ANCHOR);
  var anchorSeen = {};
  anchorTable.rows.forEach(function (r) {
    anchorSeen[String(r['業務ID']).trim() + '|' + periodText_(r['回次'])] = true;
  });
  var newAnchors = [];
  works.forEach(function (w) {
    try {
      var spec = parseRecurrence(w['基準日ルール']);
      if (!spec) return;
      var list = expandRecurrence(spec, fromKey, toKey, cal, normalizeAdjustMode(w['基準日休日補正']));
      list.forEach(function (item) {
        var key = String(w['業務ID']).trim() + '|' + item.period;
        if (anchorSeen[key]) return;
        anchorSeen[key] = true;
        newAnchors.push({
          '業務ID': w['業務ID'], '回次': item.period, '基準日': keyToSheetDate_(item.dateKey),
          '生成元': '自動', '状態': '予定', '備考': ''
        });
      });
    } catch (e) {
      errors.push('[' + w['業務ID'] + '] 基準日ルール: ' + e.message);
    }
  });
  if (newAnchors.length) appendRows_(SHEET.ANCHOR, newAnchors);

  // ---- 2. 工程表の再生成 ----
  var repaired = repairAnchorPeriods_();
  if (repaired) log_('回次の修復', true, repaired + ' 行を文字列に直しました');

  var anchors = readTable_(SHEET.ANCHOR).rows.filter(function (r) {
    return String(r['業務ID']).trim() && periodText_(r['回次']) && toDateKey(r['基準日']);
  });
  var templates = groupTemplates_(readTable_(SHEET.TEMPLATE).rows);
  var workById = {};
  works.forEach(function (w) { workById[String(w['業務ID']).trim()] = w; });

  // 生成する行数だけ営業日数を数えることになるので、ここでも表を使う
  var countFrom = createBusinessDayCounter(cal, today, shiftMonthKey_(fromKey, -1), shiftMonthKey_(toKey, 1));

  var oldRows = readTable_(SHEET.SCHEDULE).rows;
  var oldByKey = {};
  var oldByAlt = {};
  oldRows.forEach(function (r) {
    var k = String(r['キー']).trim();
    if (k) oldByKey[k] = r;
    // 回次の表記が変わるとキーも変わるため、業務・基準日・工程No でも引けるようにする。
    // これがないと、回次を直したときに入力済みの進捗が失われる。
    var alt = String(r['業務ID']).trim() + '|' + toDateKey(r['基準日']) + '|' + r['工程No'];
    if (alt) oldByAlt[alt] = r;
  });

  var newRows = [];
  var usedKeys = {};

  // 業務ごとに、有効な起点の日をまとめる
  var anchorsByWork = {};
  anchors.forEach(function (a) {
    if (String(a['状態']).trim() === '中止') return;
    var workId = String(a['業務ID']).trim();
    if (!workById[workId]) return; // 無効化された業務はスキップ
    if (!anchorsByWork[workId]) anchorsByWork[workId] = [];
    anchorsByWork[workId].push(a);
  });

  /** 1工程を工程表の行に変換して積む */
  function pushRow(work, period, anchorKey, row) {
    var workId = String(work['業務ID']).trim();
    var key = workId + '|' + period + '|' + row.seq;
    if (usedKeys[key]) return;
    usedKeys[key] = true;
    var old = oldByKey[key]
      || oldByAlt[workId + '|' + anchorKey + '|' + row.seq]
      || {};
    var pinned = /^(on|true|はい|固定|1)$/i.test(String(old['日程固定'] || '').trim());
    var dueKey = pinned && toDateKey(old['予定日']) ? toDateKey(old['予定日']) : row.dateKey;
    var endKey = pinned && toDateKey(old['予定日'])
      ? toDateKey(old['終了日'])
      : (row.endKey || '');
    var remind = row.remindDays === '' || row.remindDays === null || row.remindDays === undefined
      ? defaultRemind : Number(row.remindDays);
    var status = old['状態'] || STATUS.NOT_STARTED;
    newRows.push({
      'キー': key,
      '完': status === STATUS.DONE,
      '業務ID': workId,
      '業務名': work['業務名'],
      '回次': period,
      '基準日': anchorKey ? keyToSheetDate_(anchorKey) : '',
      '工程No': row.seq,
      '工程名': row.name,
      '予定日': keyToSheetDate_(dueKey),
      '終了日': endKey ? keyToSheetDate_(endKey) : '',
      '曜日': WEEKDAY_LABELS[dayOfWeek(dueKey)],
      '残営業日': countFrom(dueKey),
      '担当': old['担当'] || row.owner || '',
      '状態': status,
      '完了日': old['完了日'] || '',
      'リマインド営業日前': old['リマインド営業日前'] !== '' && old['リマインド営業日前'] !== undefined && old['リマインド営業日前'] !== null
        ? old['リマインド営業日前'] : remind,
      '日程固定': old['日程固定'] || '',
      '備考': old['備考'] || row.note || '',
      'イベントID': old['イベントID'] || '',
      _sortDue: dueKey,
      _sortSeq: Number(row.seq) || 0
    });
  }

  works.forEach(function (work) {
    var workId = String(work['業務ID']).trim();
    var tpl = templates[workId];
    if (!tpl || !tpl.length) {
      // 業務を作った直後は工程が空なのが普通なので、失敗としては扱わない
      notices[workId] = true;
      return;
    }

    // 起点が無くても決まる工程（日付指定と、そこから伸びる工程）を先に出す。
    // これらは回次に属さないので、業務ごとに1回だけ生成する。
    var free;
    try {
      free = computeSchedule(cloneTemplateRows_(tpl), '', cal, work['基準日名称'],
        { skipUnresolved: true });
    } catch (e) {
      errors.push('[' + workId + '] ' + e.message);
      return;
    }
    var needsAnchor = {};
    free.forEach(function (row) {
      if (row.unresolved) needsAnchor[row.seq] = true;
      else pushRow(work, '', '', row);
    });

    var list = anchorsByWork[workId] || [];
    var waiting = Object.keys(needsAnchor);
    if (!waiting.length) return;            // 起点を使う工程が無ければここまで
    if (!list.length) {
      var names = free.filter(function (r) { return r.unresolved; })
        .map(function (r) { return r.name; });
      errors.push('[' + workId + '] 起点の日が登録されていないため、'
        + names.slice(0, 3).join('・')
        + (names.length > 3 ? ' ほか' + (names.length - 3) + '件' : '')
        + ' の日付を出せません');
      return;
    }

    // 起点からの工程は回次ごとに生成する
    list.forEach(function (a) {
      var anchorKey = toDateKey(a['基準日']);
      var rows;
      try {
        rows = computeSchedule(cloneTemplateRows_(tpl), anchorKey, cal, work['基準日名称']);
      } catch (e) {
        errors.push('[' + workId + ' ' + periodText_(a['回次']) + '] ' + e.message);
        return;
      }
      rows.forEach(function (row) {
        if (!needsAnchor[row.seq]) return;  // 日付指定の工程は上で出している
        pushRow(work, periodText_(a['回次']), anchorKey, row);
      });
    });
  });

  // テンプレートから消えたが、進捗が入っている行は履歴として残す
  oldRows.forEach(function (r) {
    var k = String(r['キー']).trim();
    if (!k || usedKeys[k]) return;
    var status = String(r['状態'] || '').trim();
    if (status === STATUS.NOT_STARTED || status === '') return;
    var due = toDateKey(r['予定日']);
    r._sortDue = due || '9999-12-31';
    r._sortSeq = Number(r['工程No']) || 0;
    newRows.push(r);
  });

  newRows.sort(function (a, b) {
    if (a._sortDue !== b._sortDue) return a._sortDue < b._sortDue ? -1 : 1;
    if (a['業務ID'] !== b['業務ID']) return a['業務ID'] < b['業務ID'] ? -1 : 1;
    return a._sortSeq - b._sortSeq;
  });
  newRows.forEach(function (r) { delete r._sortDue; delete r._sortSeq; });

  replaceTable_(SHEET.SCHEDULE, newRows);
  applyScheduleCheckboxes_();

  var pending = Object.keys(notices);
  log_('工程表生成', errors.length === 0,
    '基準日追加 ' + newAnchors.length + '件 / 工程 ' + newRows.length + '行'
    + (pending.length ? ' / 工程が未登録: ' + pending.join(', ') : '')
    + (errors.length ? ' / エラー: ' + errors.join(' | ') : ''));

  return {
    anchorsAdded: newAnchors.length,
    rows: newRows.length,
    errors: errors,
    pendingWorks: pending
  };
}

/**
 * 基準日シートの回次を文字列に直す。
 *
 * 「2026-09」は日付として、「2026」はシリアル値として解釈され、
 * セルが Date になってしまうことがある（2026 は 1905-07-18 になる）。
 * 基準日と業務のルールから正しい回次を組み立て直し、書式も文字列にする。
 */
function repairAnchorPeriods_() {
  var t = readTable_(SHEET.ANCHOR);
  var idx = headerIndex_(t.headers);
  if (!idx['回次'] || !t.rows.length) return 0;

  var works = {};
  readTable_(SHEET.WORK).rows.forEach(function (w) {
    works[String(w['業務ID']).trim()] = w;
  });

  var values = [];
  var fixed = 0;
  t.rows.forEach(function (r) {
    var raw = r['回次'];
    var isDate = Object.prototype.toString.call(raw) === '[object Date]';
    var want = isDate ? '' : String(raw).trim();

    if (isDate || !want) {
      var dateKey = toDateKey(r['基準日']);
      var work = works[String(r['業務ID']).trim()];
      var yearly = false;
      try {
        var spec = work ? parseRecurrence(work['基準日ルール']) : null;
        yearly = !!spec && spec.type === 'YEARLY_DATE';
      } catch (e) {
        yearly = false;
      }
      want = dateKey ? (yearly ? dateKey.slice(0, 4) : dateKey.slice(0, 7)) : '';
    }
    if (want !== String(raw)) fixed++;
    values.push([want]);
  });

  var range = t.sheet.getRange(2, idx['回次'], values.length, 1);
  range.setNumberFormat('@');
  range.setValues(values);
  return fixed;
}

/** 工程テンプレート行を業務IDごとにまとめ、工程Noで並べる */
function groupTemplates_(rows) {
  var map = {};
  rows.forEach(function (r) {
    var id = String(r['業務ID']).trim();
    if (!id || !String(r['工程名']).trim()) return;
    if (!map[id]) map[id] = [];
    map[id].push({
      seq: r['工程No'],
      name: String(r['工程名']).trim(),
      mode: r['日付種別'],
      base: r['基準'],
      direction: r['方向'],
      days: r['日数'] === '' || r['日数'] === null ? 0 : r['日数'],
      endDirection: r['終了方向'],
      endDays: r['終了日数'],
      startDate: toDateKey(r['開始日']),
      endDate: toDateKey(r['終了日']),
      unit: r['単位'],
      adjust: r['休日補正'],
      owner: r['担当'],
      remindDays: r['リマインド営業日前'],
      note: r['備考']
    });
  });
  Object.keys(map).forEach(function (id) {
    map[id].sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
  });
  return map;
}

function cloneTemplateRows_(rows) {
  return rows.map(function (r) {
    return {
      seq: r.seq, name: r.name, mode: r.mode, base: r.base,
      direction: r.direction, days: r.days,
      endDirection: r.endDirection, endDays: r.endDays,
      startDate: r.startDate, endDate: r.endDate,
      unit: r.unit, adjust: r.adjust, owner: r.owner, remindDays: r.remindDays, note: r.note
    };
  });
}

/** dateKey を n ヶ月ずらす（日は月末に丸める） */
function shiftMonthKey_(key, months) {
  var d = keyToDate(key);
  var y = d.getUTCFullYear();
  var m = d.getUTCMonth() + 1 + Number(months);
  var day = d.getUTCDate();
  var total = y * 12 + (m - 1);
  var ny = Math.floor(total / 12);
  var nm = (total % 12) + 1;
  var maxDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return dateToKey(new Date(Date.UTC(ny, nm - 1, Math.min(day, maxDay))));
}


// ===========================================================================
// 14_calendar.gs
// ===========================================================================

/**
 * Googleカレンダー同期（任意機能・既定OFF）
 *
 * 既定ではカレンダー権限を要求しない構成にしてある。
 * 使う場合は appsscript.json の oauthScopes に
 *   "https://www.googleapis.com/auth/calendar"
 * を追加し、設定シートの「カレンダー同期」を ON にする。
 */

function syncCalendarIfEnabled() {
  var settings = getSettings_();
  if (!settingBool_(settings, 'カレンダー同期', false)) return { skipped: true };
  return syncCalendar();
}

function syncCalendar() {
  var settings = getSettings_();
  if (typeof CalendarApp === 'undefined') {
    var msg = 'カレンダー権限が付与されていません。appsscript.json の oauthScopes に calendar を追加してください。';
    log_('カレンダー同期', false, msg);
    throw new Error(msg);
  }

  var calId = settingText_(settings, 'カレンダーID', '');
  var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('カレンダーを取得できません: ' + calId);

  var t = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(t.headers);
  if (!idx['イベントID']) throw new Error('工程表に「イベントID」列がありません');

  var today = todayKey_();
  var fromKey = shiftMonthKey_(today, -1);
  var created = 0, updated = 0, removed = 0;
  var eventIdValues = [];

  t.rows.forEach(function (r) {
    var eventId = String(r['イベントID'] || '').trim();
    var dueKey = toDateKey(r['予定日']);
    var endKey = toDateKey(r['終了日']);
    var status = String(r['状態'] || '').trim();
    var period = periodText_(r['回次']);
    var title = '【' + r['業務名'] + (period ? ' ' + period : '') + '】' + r['工程名'];
    var wanted = dueKey && dueKey >= fromKey && status !== STATUS.SKIP;

    if (!wanted) {
      if (eventId) {
        try { var ev = cal.getEventById(eventId); if (ev) { ev.deleteEvent(); removed++; } } catch (e) { /* 既に無い */ }
        eventId = '';
      }
      eventIdValues.push([eventId]);
      return;
    }

    var date = keyToSheetDate_(dueKey);
    // 終日イベントの終了日は「翌日」を渡す必要がある
    var endDate = endKey ? keyToSheetDate_(addCalendarDays(endKey, 1)) : null;
    var desc = [
      '担当: ' + (r['担当'] || '—'),
      '状態: ' + status,
      r['備考'] ? '備考: ' + r['備考'] : ''
    ].filter(String).join('\n');

    var event = null;
    if (eventId) {
      try { event = cal.getEventById(eventId); } catch (e) { event = null; }
    }
    if (event) {
      if (event.getTitle() !== title) event.setTitle(title);
      var start = event.getAllDayStartDate();
      if (!start || Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd') !== dueKey) {
        if (endDate) event.setAllDayDates(date, endDate);
        else event.setAllDayDate(date);
      }
      event.setDescription(desc);
      updated++;
    } else {
      event = endDate
        ? cal.createAllDayEvent(title, date, endDate, { description: desc })
        : cal.createAllDayEvent(title, date, { description: desc });
      eventId = event.getId();
      created++;
    }
    eventIdValues.push([eventId]);
  });

  if (eventIdValues.length) {
    t.sheet.getRange(2, idx['イベントID'], eventIdValues.length, 1).setValues(eventIdValues);
  }
  log_('カレンダー同期', true, '作成 ' + created + ' / 更新 ' + updated + ' / 削除 ' + removed);
  return { created: created, updated: updated, removed: removed };
}


// ===========================================================================
// 15_notify.gs
// ===========================================================================

/**
 * Google Chat への通知
 *
 * Chat のスペースで［アプリと連携］→［Webhook を作成］して得た URL を
 * 設定シートの ChatWebhookURL に貼るだけで動く。
 */

function dailyReminder() {
  var settings = getSettings_();
  var cal = loadBusinessCalendar_(settings);
  var today = todayKey_();

  if (settingBool_(settings, '休日は通知しない', true) && !isBusinessDay(cal, today)) {
    log_('日次リマインド', true, '休日のためスキップ: ' + today);
    return { skipped: true };
  }

  var digest = buildDigestFromSheet_(settings, cal, today);
  if (!digest.total) {
    log_('日次リマインド', true, '通知対象なし');
    return { total: 0 };
  }

  var text = buildChatText(digest, today, webAppUrl_('', settings));
  var res = postToChat_(settings, text);
  log_('日次リマインド', res.ok,
    '超過 ' + digest.overdue.length + ' / 本日 ' + digest.today.length + ' / まもなく ' + digest.soon.length
    + (res.ok ? '' : ' / ' + res.message));
  return { total: digest.total, posted: res.ok, message: res.message };
}

/** 工程表シートからダイジェストを組み立てる */
function buildDigestFromSheet_(settings, cal, today) {
  var colorByWork = {};
  readTable_(SHEET.WORK).rows.forEach(function (w, i) {
    colorByWork[String(w['業務ID']).trim()] = w['色'] || COLOR_ORDER[i % COLOR_ORDER.length];
  });

  var backMonths = settingNumber_(settings, '過去保持月数', 3);
  var minKey = shiftMonthKey_(today, -backMonths);
  var defaultRemind = settingNumber_(settings, '既定リマインド営業日前', 3);

  var rows = readTable_(SHEET.SCHEDULE).rows.map(function (r) {
    var dueKey = toDateKey(r['予定日']);
    if (!dueKey || dueKey < minKey) return null;
    var remind = r['リマインド営業日前'];
    return {
      key: String(r['キー']).trim(),
      workId: String(r['業務ID']).trim(),
      workName: String(r['業務名'] || ''),
      color: colorByWork[String(r['業務ID']).trim()],
      period: periodText_(r['回次']),
      seq: Number(r['工程No']) || 0,
      name: String(r['工程名'] || ''),
      dueKey: dueKey,
      owner: String(r['担当'] || ''),
      status: String(r['状態'] || ''),
      note: String(r['備考'] || ''),
      remindDays: (remind === '' || remind === null || remind === undefined) ? defaultRemind : Number(remind)
    };
  }).filter(Boolean);

  var minSeen = today, maxSeen = today;
  rows.forEach(function (r) {
    if (r.dueKey < minSeen) minSeen = r.dueKey;
    if (r.dueKey > maxSeen) maxSeen = r.dueKey;
  });

  return buildDigest(rows, cal, today, {
    maxAheadBusinessDays: settingNumber_(settings, 'リマインド対象日数', 14),
    includeDone: false,
    counter: createBusinessDayCounter(cal, today, minSeen, maxSeen)
  });
}

/** Chat Webhook へ投稿する */
function postToChat_(settings, text) {
  var url = settingText_(settings, 'ChatWebhookURL', '');
  if (!url) {
    return { ok: false, message: 'ChatWebhookURL が未設定です。設定シートに Webhook URL を貼ってください。' };
  }
  if (!/^https:\/\/chat\.googleapis\.com\//.test(url)) {
    return { ok: false, message: 'ChatWebhookURL が Google Chat の Webhook URL ではありません。' };
  }
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, message: '' };
    return { ok: false, message: 'Chat投稿に失敗 HTTP ' + code + ': ' + res.getContentText().slice(0, 300) };
  } catch (e) {
    return { ok: false, message: 'Chat投稿に失敗: ' + e.message };
  }
}

/** メニューから叩く：いまの内容でテスト投稿する */
function sendTestNotification() {
  var settings = getSettings_();
  var cal = loadBusinessCalendar_(settings);
  var today = todayKey_();
  var digest = buildDigestFromSheet_(settings, cal, today);
  var text = digest.total
    ? buildChatText(digest, today, webAppUrl_('', settings))
    : '*' + formatShortDate(today) + ' の業務スケジュール*\n\n通知対象の工程はありません。';
  var res = postToChat_(settings, text);
  log_('テスト通知', res.ok, res.message || '送信しました');
  return res;
}


// ===========================================================================
// 16_menu.gs
// ===========================================================================

/**
 * メニュー・画面表示・シート上の操作
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📅 業務スケジュール')
    .addItem('スケジュール画面を開く', 'showGantt')
    .addItem('別ウィンドウで開く（URLを表示）', 'showAppUrl')
    .addItem('WebアプリのURLを登録', 'menuSetAppUrl')
    .addSeparator()
    .addItem('工程テンプレートを編集', 'showTemplateEditor')
    .addItem('工程表を再生成', 'menuGenerate')
    .addItem('休日を取り込む', 'menuSyncHolidays')
    .addItem('カレンダーに同期', 'menuSyncCalendar')
    .addSeparator()
    .addItem('画面を最新にする', 'menuRefreshHtml')
    .addItem('更新を確認', 'menuCheckUpdate')
    .addSeparator()
    .addItem('Chatにテスト通知', 'menuTestNotify')
    .addItem('動作診断', 'menuDiagnostics')
    .addItem('通知トリガーを再設定', 'menuInstallTriggers')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('テンプレートの受け渡し')
      .addItem('書き出す（JSON）', 'showTemplateExport')
      .addItem('読み込む（JSON）', 'showTemplateImport'))
    .addSeparator()
    .addItem('初期セットアップ', 'menuSetup')
    .addItem('サンプルを削除して最初から作る', 'menuReset')
    .addToUi();
}

/**
 * ダイアログの大きさは Apps Script の仕様上あとから変えられないため、
 * 設定シートの「画面の幅 / 画面の高さ」で指定できるようにしている。
 * 本当に自由な大きさで使いたい場合はウェブアプリとして開く（showAppUrl 参照）。
 */
function showGantt() {
  var settings = getSettings_();
  var html = loadHtml_('gantt', settings)
    .evaluate()
    .setWidth(clampSize_(settingNumber_(settings, '画面の幅', 1400), 800, 2000))
    .setHeight(clampSize_(settingNumber_(settings, '画面の高さ', 800), 480, 1400));
  SpreadsheetApp.getUi().showModalDialog(html, '業務スケジュール');
}

function showTemplateEditor() {
  var settings = getSettings_();
  var html = loadHtml_('editor', settings)
    .evaluate()
    .setWidth(clampSize_(settingNumber_(settings, '画面の幅', 1400) - 250, 800, 1700))
    .setHeight(clampSize_(settingNumber_(settings, '画面の高さ', 800), 480, 1400));
  SpreadsheetApp.getUi().showModalDialog(html, '工程テンプレートの編集');
}

function clampSize_(value, min, max) {
  var n = Number(value);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * ウェブアプリとしてデプロイ済みなら、その URL を表示する。
 * ブラウザのタブで開けるので、大きさは自由に変えられ、スプレッドシートを開かずに使える。
 */
function showAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var settings = getSettings_();
  var saved = normalizeWebAppUrl_(settingText_(settings, 'WebアプリURL', ''));
  var deployed = '';
  try {
    deployed = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    deployed = '';
  }
  var url = saved || deployed;

  var body;
  if (url) {
    var editorUrl = url + '?page=editor';
    body =
      '<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;color:#202124">'
      + '<p>次のURLを開くと、それぞれの画面だけを別のタブで表示できます。<br>'
      + 'ウィンドウの大きさは自由に変えられます。ブックマークしておくと便利です。</p>'
      + '<p style="margin-bottom:4px"><b>スケジュール画面</b><br>'
      + '<a href="' + url + '" target="_blank" rel="noopener"'
      + ' style="word-break:break-all;color:#1a73e8">' + url + '</a></p>'
      + '<p style="margin-bottom:4px"><b>工程テンプレートの編集</b><br>'
      + '<a href="' + editorUrl + '" target="_blank" rel="noopener"'
      + ' style="word-break:break-all;color:#1a73e8">' + editorUrl + '</a></p>'
      + '<p style="color:#5f6368;font-size:12px">違いは末尾の <code>?page=editor</code> だけです。'
      + (saved ? '（設定シートに登録されたURLを表示しています）' : '') + '</p>'
      + '<hr style="border:none;border-top:1px solid #dadce0;margin:14px 0">'
      + '<p style="font-size:12px;line-height:1.7;color:#3c4043;margin:0">'
      + '<b>このURLが開けないときは</b><br>'
      + '末尾が <code>/exec</code> のURLは<b>デプロイした時点のコード</b>を動かします。'
      + 'コードを貼り替えても再デプロイしていないと、古いままで開けません。'
      + '次のどちらかで直ります。</p>'
      + '<p style="font-size:12px;line-height:1.7;color:#3c4043;margin:8px 0 0">'
      + '<b>A. 再デプロイする（URLは変わりません）</b><br>'
      + '［拡張機能］→［Apps Script］→［デプロイ］→［デプロイを管理］→ 鉛筆マーク →'
      + ' バージョンを「新しいバージョン」→［デプロイ］</p>'
      + '<p style="font-size:12px;line-height:1.7;color:#3c4043;margin:8px 0 0">'
      + '<b>B. 開けるURLを登録する</b><br>'
      + '［デプロイ］→［デプロイをテスト］に出る末尾 <code>/dev</code> のURLは、'
      + '常に最新のコードで動きます（自分だけが開けます）。'
      + 'そのURLをコピーして、メニューの［WebアプリのURLを登録］に貼り付けてください。</p>'
      + '</div>';
  } else {
    body =
      '<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;color:#202124">'
      + '<p>まだウェブアプリとして公開されていません。次の手順で公開できます。</p>'
      + '<ol style="padding-left:1.2em">'
      + '<li>［拡張機能］→［Apps Script］を開く</li>'
      + '<li>右上の［デプロイ］→［新しいデプロイ］</li>'
      + '<li>歯車マーク →［ウェブアプリ］を選ぶ</li>'
      + '<li>次のユーザーとして実行：<b>自分</b></li>'
      + '<li>アクセスできるユーザー：<b>自分のみ</b></li>'
      + '<li>［デプロイ］→ 承認 → 表示された URL をコピー</li>'
      + '</ol>'
      + '<p style="color:#5f6368;font-size:12px">'
      + '公開後にもう一度このメニューを開くと、URL がここに表示されます。</p></div>';
  }
  ui.showModalDialog(HtmlService.createHtmlOutput(body).setWidth(600).setHeight(520),
    '別ウィンドウで開く');
}

/**
 * 実際にブラウザで開けた URL を設定シートに登録する。
 *
 * デプロイのURL（/exec）が古いバージョンを指していて開けない場合でも、
 * テスト用URL（/dev）を登録すれば［別ウィンドウで開く］から使える。
 */
function menuSetAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var current = normalizeWebAppUrl_(settingText_(getSettings_(), 'WebアプリURL', ''));
  var res = ui.prompt('WebアプリのURLを登録',
    'ブラウザで実際に開けたURLを貼り付けてください。\n'
    + '末尾が /exec でも /dev でもかまいません。\n'
    + '（?page=editor は付いていても外して登録します）\n\n'
    + (current ? '現在の登録：\n' + current + '\n\n' : '')
    + '空欄のまま［OK］を押すと登録を解除します。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = String(res.getResponseText() || '').trim();
  if (!input) {
    setSetting_('WebアプリURL', '');
    ui.alert('登録を解除しました',
      '以降はデプロイのURLを自動で使います。', ui.ButtonSet.OK);
    return;
  }

  var url = normalizeWebAppUrl_(input);
  if (!url) {
    ui.alert('登録できませんでした',
      'Apps Script のウェブアプリのURLではないようです。\n\n'
      + 'https://script.google.com/macros/s/……/exec\n'
      + 'https://script.google.com/macros/s/……/dev\n\n'
      + 'このどちらかの形で貼り付けてください。', ui.ButtonSet.OK);
    return;
  }

  setSetting_('WebアプリURL', url);
  ui.alert('登録しました', url, ui.ButtonSet.OK);
  showAppUrl();
}

/**
 * GitHub から画面を取り直す。
 * キャッシュを捨てるだけで、次に画面を開いたときに新しいものが読まれる。
 */
function menuRefreshHtml() {
  var ui = SpreadsheetApp.getUi();
  var settings = getSettings_();
  if (!settingBool_(settings, '画面をGitHubから読み込む', false)) {
    ui.alert('GitHubからの読み込みはOFFです',
      '［設定］シートの「画面をGitHubから読み込む」を ON にすると、\n'
      + 'スケジュール画面と編集画面のHTMLを貼り直さなくてよくなります。\n\n'
      + '取得できないときは、これまでどおりプロジェクト内のファイルを使います。',
      ui.ButtonSet.OK);
    return;
  }
  clearRemoteHtmlCache_();

  // その場で取りに行き、結果をここで見せる（次に開くまで分からないと不安なので）
  var got = [];
  var failed = [];
  REMOTE_FILES.forEach(function (n) {
    var text = fetchRemoteHtml_(n, settings);
    if (text) got.push(n + '.html（' + text.length + '文字）');
    else failed.push(n + '.html');
  });

  ui.alert(failed.length ? '一部を取得できませんでした' : '取り込みました',
    (got.length ? '取得できたもの:\n　' + got.join('\n　') + '\n\n' : '')
    + (failed.length
      ? '取得できなかったもの:\n　' + failed.join('\n　')
      + '\n\nこれらはプロジェクト内のファイルを使います。\n'
      + '詳しい理由は［更新履歴］シートを見てください。'
      : '次に画面を開くと反映されます。\n記録は［更新履歴］シートに残ります。'),
    ui.ButtonSet.OK);
}

/** GitHub 側の版と比べて、更新があるか知らせる */
function menuCheckUpdate() {
  var ui = SpreadsheetApp.getUi();
  var r = checkForUpdate();
  if (!r.ok) {
    ui.alert('確認できませんでした', r.message, ui.ButtonSet.OK);
    return;
  }
  if (r.newer) {
    ui.alert('新しい版があります',
      'いまの版：' + r.current + '\n最新の版：' + r.latest + '\n\n'
      + 'GitHub の dist から コード.gs を貼り直してください。\n'
      + '（画面のHTMLは「画面をGitHubから読み込む」が ON なら自動で更新されます）',
      ui.ButtonSet.OK);
  } else {
    ui.alert('最新です', 'いまの版：' + r.current, ui.ButtonSet.OK);
  }
}

function menuSetup() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('初期セットアップ',
    'シートの作成・書式設定・休日の取り込み・トリガー登録を行います。\n'
    + '既存のデータは消しません。実行しますか？',
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  try {
    var r = setupWorkbook();
    var msg = 'セットアップが完了しました。\n\n'
      + (r.seeded ? '・サンプルの業務と工程テンプレートを入れました\n' : '')
      + '・工程表 ' + r.generate.rows + ' 行を生成しました\n'
      + '・毎日の通知トリガーを登録しました\n\n'
      + '次は［設定］シートの ChatWebhookURL を埋めてください。';
    if (r.generate.errors.length) msg += '\n\n【要確認】\n' + r.generate.errors.join('\n');
    ui.alert('完了', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

function menuReset() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('サンプルを削除して最初から作る',
    '次の4つのシートの中身をすべて削除します。\n\n'
    + '　・業務マスタ\n'
    + '　・工程テンプレート\n'
    + '　・基準日\n'
    + '　・工程表\n\n'
    + '設定・休日マスタ・実行ログはそのまま残ります。\n'
    + '（手入力した閉庁日も残ります）\n\n'
    + 'この操作は元に戻せません。実行しますか？',
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;

  try {
    resetBusinessData();
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    return;
  }
  ui.alert('削除しました',
    '続けて［工程テンプレートを編集］を開きます。\n'
    + '［＋ 業務を追加］から、実際の業務を登録してください。',
    ui.ButtonSet.OK);
  showTemplateEditor();
}

function menuGenerate() {
  try {
    var r = generateSchedules();
    var msg = '基準日を ' + r.anchorsAdded + ' 件追加し、工程表を ' + r.rows + ' 行にしました。';
    // 工程表を作り直したらカレンダーもずれるので、ONならその場で合わせる
    try {
      var c = syncCalendarIfEnabled();
      if (!c.skipped) {
        msg += '\nカレンダーも同期しました（作成 ' + c.created
          + ' / 更新 ' + c.updated + ' / 削除 ' + c.removed + '）。';
      }
    } catch (ce) {
      msg += '\n\nカレンダーの同期は失敗しました:\n' + ce.message;
    }
    if (r.errors.length) msg += '\n\n【要確認】\n' + r.errors.join('\n');
    SpreadsheetApp.getUi().alert('工程表の再生成', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function menuSyncHolidays() {
  var r = syncHolidays();
  var msg = '休日マスタを ' + r.count + ' 件にしました。';
  if (r.error) msg += '\n\n祝日CSVの取得に失敗しました（既存の祝日は維持）:\n' + r.error;
  SpreadsheetApp.getUi().alert('休日の取り込み', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * カレンダーへ今すぐ同期する。
 * 自動では毎日1時（nightlyRefresh）にしか走らないため、
 * 日中に直した内容をすぐ反映したいときはここから実行する。
 */
function menuSyncCalendar() {
  var ui = SpreadsheetApp.getUi();
  var settings = getSettings_();

  if (!settingBool_(settings, 'カレンダー同期', false)) {
    ui.alert('カレンダー同期はOFFです',
      '［設定］シートの「カレンダー同期」を ON にしてから実行してください。\n\n'
      + 'あわせて appsscript.json の oauthScopes に\n'
      + 'https://www.googleapis.com/auth/calendar\n'
      + 'を追加し、承認をやり直す必要があります。',
      ui.ButtonSet.OK);
    return;
  }

  try {
    var r = syncCalendar();
    ui.alert('カレンダーに同期しました',
      '作成 ' + r.created + ' 件／更新 ' + r.updated + ' 件／削除 ' + r.removed + ' 件\n\n'
      + '（自動では毎日1時に同じ処理が走ります）',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('同期できませんでした', e.message, ui.ButtonSet.OK);
  }
}

function menuTestNotify() {
  var r = sendTestNotification();
  SpreadsheetApp.getUi().alert(
    r.ok ? '送信しました' : '送信できませんでした',
    r.ok ? 'Google Chat のスペースを確認してください。' : r.message,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuInstallTriggers() {
  var hour = installTriggers();
  SpreadsheetApp.getUi().alert('トリガー設定',
    '毎日 ' + hour + ' 時に Chat へ通知します。\n（毎日 1 時に工程表を自動更新します）',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 工程表の「完」チェックボックスを状態と連動させる（シンプルトリガー）。
 * 追加の権限承認なしで動く。
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET.SCHEDULE) return;
    if (e.range.getRow() < 2) return;

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    var idx = {};
    headers.forEach(function (h, i) { if (h) idx[h] = i + 1; });
    if (!idx['完'] || !idx['状態']) return;

    var row = e.range.getRow();
    var col = e.range.getColumn();

    if (col === idx['完']) {
      var checked = e.range.getValue() === true;
      sh.getRange(row, idx['状態']).setValue(checked ? STATUS.DONE : STATUS.NOT_STARTED);
      if (idx['完了日']) sh.getRange(row, idx['完了日']).setValue(checked ? new Date() : '');
    } else if (col === idx['状態']) {
      var status = String(e.range.getValue()).trim();
      sh.getRange(row, idx['完']).setValue(status === STATUS.DONE);
      if (idx['完了日']) {
        var cur = sh.getRange(row, idx['完了日']).getValue();
        if (status === STATUS.DONE && !cur) sh.getRange(row, idx['完了日']).setValue(new Date());
        if (status !== STATUS.DONE) sh.getRange(row, idx['完了日']).setValue('');
      }
    }
  } catch (err) {
    console.warn('onEdit: ' + err.message);
  }
}


// ===========================================================================
// 17_webapp.gs
// ===========================================================================

/**
 * ガント画面（HTMLサービス）へのデータ供給と更新処理
 *
 * スプレッドシートのメニューからダイアログとして開くほか、
 * Webアプリとしてデプロイして単独のURLで開くこともできる。
 */

/**
 * ウェブアプリの入口。
 *   ...（パラメータなし） スケジュール画面
 *   ...?page=editor      工程テンプレートの編集画面
 * どちらもブラウザのタブで開くので、大きさは自由に変えられる。
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'schedule';
  var file = page === 'editor' ? 'editor' : 'gantt';
  var title = page === 'editor' ? '工程テンプレートの編集' : '業務スケジュール';
  return loadHtml_(file)
    .evaluate()
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * 画面を開くための URL を返す（未公開なら空文字）。
 *
 * 設定シートの「WebアプリURL」が入っていればそれを優先する。
 * ScriptApp が返す /exec はデプロイしたバージョンのもので、コードを貼り替えても
 * 再デプロイするまで古いままなので、実際に開けた URL を登録できるようにしている。
 */
function webAppUrl_(page, settings) {
  var base = '';
  try {
    base = normalizeWebAppUrl_(settingText_(settings || getSettings_(), 'WebアプリURL', ''));
  } catch (e) {
    base = '';
  }
  if (!base) {
    try {
      base = ScriptApp.getService().getUrl() || '';
    } catch (e2) {
      base = '';
    }
  }
  if (!base) return '';
  return page ? base + '?page=' + encodeURIComponent(page) : base;
}

/** 貼り付けられた URL から ?query や #fragment を落とす。形が違えば空文字 */
function normalizeWebAppUrl_(url) {
  var s = String(url || '').trim();
  if (!s) return '';
  s = s.split('#')[0].split('?')[0];
  return /^https:\/\/script\.google\.com\/[^\s]*\/(exec|dev)$/.test(s) ? s : '';
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** ガント画面が必要とするデータを一括で返す */
function getGanttData() {
  var settings = getSettings_();
  var cal = loadBusinessCalendar_(settings);
  var today = todayKey_();
  var fromKey = shiftMonthKey_(today, -settingNumber_(settings, 'ガント表示_前月数', 1));
  var toKey = shiftMonthKey_(today, settingNumber_(settings, 'ガント表示_後月数', 3));

  var works = [];
  var workById = {};
  readTable_(SHEET.WORK).rows.forEach(function (w, i) {
    var id = String(w['業務ID']).trim();
    if (!id) return;
    var item = {
      id: id,
      name: String(w['業務名'] || id),
      enabled: !/^(off|false|いいえ|無効|0)$/i.test(String(w['有効']).trim()),
      anchorName: String(w['基準日名称'] || '基準日'),
      rule: String(w['基準日ルール'] || ''),
      // 実際の色は画面側でテーマに合わせて解決する。ここでは色の名前だけ渡す
      color: String(w['色'] || '').trim() || COLOR_ORDER[i % COLOR_ORDER.length]
    };
    works.push(item);
    workById[id] = item;
  });

  var anchorByKey = {};
  readTable_(SHEET.ANCHOR).rows.forEach(function (a) {
    var id = String(a['業務ID']).trim();
    var period = periodText_(a['回次']);
    if (!id || !period) return;
    anchorByKey[id + '|' + period] = toDateKey(a['基準日']);
  });

  // 工程ごとに営業日数を数え直すと件数に比例して遅くなるため、表を先に作る
  var countFrom = createBusinessDayCounter(cal, today, fromKey, toKey);

  var laneMap = {};
  var lanes = [];
  readTable_(SHEET.SCHEDULE).rows.forEach(function (r) {
    var workId = String(r['業務ID']).trim();
    var period = periodText_(r['回次']);
    var dueKey = toDateKey(r['予定日']);
    var endKey = toDateKey(r['終了日']);
    if (!workId || !dueKey) return;
    // 期間を持つ工程は、期間のどこかが表示範囲に掛かっていれば出す
    if ((endKey || dueKey) < fromKey || dueKey > toKey) return;
    var work = workById[workId];
    if (!work || !work.enabled) return;

    var laneKey = workId + '|' + period;
    var lane = laneMap[laneKey];
    if (!lane) {
      lane = {
        laneKey: laneKey,
        workId: workId,
        workName: work.name,
        period: period,
        anchorKey: anchorByKey[laneKey] || '',
        anchorName: work.anchorName,
        color: work.color,
        from: dueKey,
        to: dueKey,
        items: []
      };
      laneMap[laneKey] = lane;
      lanes.push(lane);
    }
    if (dueKey < lane.from) lane.from = dueKey;
    if ((endKey || dueKey) > lane.to) lane.to = endKey || dueKey;

    var status = String(r['状態'] || STATUS.NOT_STARTED).trim();
    // 期間を持つ工程は、期限（終了日）を過ぎて初めて遅延とみなす
    var deadline = endKey || dueKey;
    lane.items.push({
      key: String(r['キー']).trim(),
      seq: Number(r['工程No']) || 0,
      name: String(r['工程名'] || ''),
      dueKey: dueKey,
      endKey: endKey,
      weekday: WEEKDAY_LABELS[dayOfWeek(dueKey)],
      status: status,
      owner: String(r['担当'] || ''),
      note: String(r['備考'] || ''),
      isAnchor: dueKey === (anchorByKey[laneKey] || ''),
      overdue: deadline < today && status !== STATUS.DONE && status !== STATUS.SKIP,
      remaining: countFrom(dueKey)
    });
  });

  lanes.forEach(function (l) {
    l.items.sort(function (a, b) {
      if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
      return a.seq - b.seq;
    });
    l.doneCount = l.items.filter(function (i) { return i.status === STATUS.DONE; }).length;
  });
  lanes.sort(function (a, b) {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.workId < b.workId ? -1 : 1;
  });

  var digest = buildDigestFromSheet_(settings, cal, today);

  var payload = {
    today: today,
    from: fromKey,
    to: toKey,
    works: works,
    lanes: lanes,
    holidays: listHolidays_(fromKey, toKey),
    weekendDays: Object.keys(cal.weekend).map(Number),
    digest: {
      overdue: digest.overdue,
      today: digest.today,
      soon: digest.soon,
      total: digest.total
    },
    statusList: STATUS_LIST,
    // 公開済みなら、画面から編集画面へ直接移動できるようにする
    editorUrl: webAppUrl_('editor', settings)
  };

  // 画面へ渡せるのは素の値だけ。シートから来た Date などが混ざっていても
  // 転送時に失敗しないよう、ここで確実に素のオブジェクトへ落とす。
  return JSON.parse(JSON.stringify(payload));
}

/** 表示範囲の休日を [{key, name}] で返す（振替出勤日は休日ではないので除く） */
function listHolidays_(fromKey, toKey) {
  var out = [];
  readTable_(SHEET.HOLIDAY).rows.forEach(function (r) {
    var k = toDateKey(r['日付']);
    if (!k || k < fromKey || k > toKey) return;
    if (String(r['種別'] || '').indexOf('出勤') >= 0) return;
    out.push({ key: k, name: String(r['名称'] || '') });
  });
  return out;
}

/** 工程1件の状態を更新する（ガント画面から呼ばれる） */
function updateItemStatus(key, status) {
  var r = updateItemsStatus([key], status);
  return { key: key, status: status, updated: r.updated };
}

/**
 * 複数の工程の状態をまとめて更新する。
 *
 * 1件ずつ setValue すると件数ぶんだけシートへの往復が増えるため、
 * 列ごとに1回の書き込みにまとめている（回次まるごとの完了で効く）。
 */
function updateItemsStatus(keys, status) {
  if (STATUS_LIST.indexOf(status) < 0) throw new Error('不正な状態です: ' + status);
  var wanted = {};
  (keys || []).forEach(function (k) {
    k = String(k).trim();
    if (k) wanted[k] = true;
  });
  if (!Object.keys(wanted).length) return { updated: 0, keys: [] };

  var t = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(t.headers);
  if (!idx['状態']) throw new Error('工程表に「状態」列がありません');
  if (!t.rows.length) return { updated: 0, keys: [] };

  var done = status === STATUS.DONE;
  var doneDate = done ? keyToSheetDate_(todayKey_()) : '';

  // readTable_ は空行を飛ばすので、行番号（_row）で位置を決める。
  // 既存の値を読んでおき、該当行だけ差し替えて書き戻す。
  var lastRow = t.sheet.getLastRow();
  if (lastRow < 2) return { updated: 0, keys: [] };
  var n = lastRow - 1;

  var statusCol = t.sheet.getRange(2, idx['状態'], n, 1).getValues();
  var checkCol = idx['完'] ? t.sheet.getRange(2, idx['完'], n, 1).getValues() : null;
  var dateCol = idx['完了日'] ? t.sheet.getRange(2, idx['完了日'], n, 1).getValues() : null;

  var hit = [];
  t.rows.forEach(function (r) {
    var key = String(r['キー']).trim();
    if (!wanted[key]) return;
    var i = r._row - 2;
    if (i < 0 || i >= n) return;
    hit.push(key);
    statusCol[i][0] = status;
    if (checkCol) checkCol[i][0] = done;
    if (dateCol) dateCol[i][0] = doneDate;
  });

  if (!hit.length) throw new Error('工程が見つかりません: ' + Object.keys(wanted).join(', '));

  t.sheet.getRange(2, idx['状態'], n, 1).setValues(statusCol);
  if (checkCol) t.sheet.getRange(2, idx['完'], n, 1).setValues(checkCol);
  if (dateCol) t.sheet.getRange(2, idx['完了日'], n, 1).setValues(dateCol);

  if (hit.length > 1) log_('状態の一括更新', true, hit.length + '件 → ' + status);
  return { updated: hit.length, keys: hit };
}

/** 基準日（審査会日など）を変更して、その回次の工程を組み直す */
function updateAnchorDate(workId, period, dateKey) {
  keyToDate(dateKey); // 形式チェック
  var t = readTable_(SHEET.ANCHOR);
  var idx = headerIndex_(t.headers);
  var target = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['業務ID']).trim() === workId && String(t.rows[i]['回次']).trim() === period) {
      target = t.rows[i];
      break;
    }
  }
  if (!target) throw new Error('基準日の行が見つかりません: ' + workId + ' ' + period);
  t.sheet.getRange(target._row, idx['基準日']).setValue(keyToSheetDate_(dateKey));
  if (idx['生成元']) t.sheet.getRange(target._row, idx['生成元']).setValue('手動');
  var result = generateSchedules();
  log_('基準日変更', true, workId + ' ' + period + ' → ' + dateKey);
  return result;
}


// ===========================================================================
// 18_template_editor.gs
// ===========================================================================

/**
 * 工程テンプレート編集画面のバックエンドと、テンプレートの受け渡し（JSON）
 */

/** 編集画面の初期データ */
function getEditorData() {
  var settings = getSettings_();
  var today = todayKey_();
  var works = readTable_(SHEET.WORK).rows.filter(function (w) {
    return String(w['業務ID']).trim();
  }).map(function (w, i) {
    return {
      id: String(w['業務ID']).trim(),
      name: w['業務名'],
      anchorName: w['基準日名称'] || '起点',
      rule: w['基準日ルール'],
      adjust: w['基準日休日補正'],
      enabled: !/^(off|false|いいえ|無効|0)$/i.test(String(w['有効']).trim()),
      color: w['色'] || COLOR_ORDER[i % COLOR_ORDER.length]
    };
  });

  var templates = {};
  readTable_(SHEET.TEMPLATE).rows.forEach(function (r) {
    var id = String(r['業務ID']).trim();
    if (!id) return;
    if (!templates[id]) templates[id] = [];
    templates[id].push({
      seq: r['工程No'],
      name: String(r['工程名'] || ''),
      mode: normalizeMode(r['日付種別']) === 'fixed' ? '日付指定' : '起点から',
      base: String(r['基準'] || ''),
      direction: String(r['方向'] || '前'),
      days: r['日数'] === '' || r['日数'] === null ? 0 : Number(r['日数']),
      endDirection: String(r['終了方向'] || ''),
      endDays: (r['終了日数'] === '' || r['終了日数'] === null || r['終了日数'] === undefined)
        ? '' : Number(r['終了日数']),
      startDate: toDateKey(r['開始日']),
      endDate: toDateKey(r['終了日']),
      unit: String(r['単位'] || '営業日'),
      adjust: String(r['休日補正'] || '前営業日'),
      owner: String(r['担当'] || ''),
      remindDays: r['リマインド営業日前'],
      note: String(r['備考'] || '')
    });
  });
  Object.keys(templates).forEach(function (id) {
    templates[id].sort(function (a, b) { return (Number(a.seq) || 0) - (Number(b.seq) || 0); });
  });

  var nextAnchors = {};
  var anchorsByWork = {};
  readTable_(SHEET.ANCHOR).rows.forEach(function (a) {
    var id = String(a['業務ID']).trim();
    var key = toDateKey(a['基準日']);
    if (!id || !key) return;
    var cancelled = String(a['状態'] || '').trim() === '中止';
    if (!anchorsByWork[id]) anchorsByWork[id] = [];
    anchorsByWork[id].push({
      period: periodText_(a['回次']),
      dateKey: key,
      source: String(a['生成元'] || '').trim(),
      cancelled: cancelled,
      past: key < today
    });
    if (key < today || cancelled) return;
    if (!nextAnchors[id] || key < nextAnchors[id].dateKey) {
      nextAnchors[id] = { dateKey: key, period: periodText_(a['回次']) };
    }
  });
  Object.keys(anchorsByWork).forEach(function (id) {
    anchorsByWork[id].sort(function (a, b) { return a.dateKey < b.dateKey ? -1 : 1; });
  });

  return {
    today: today,
    works: works,
    templates: templates,
    nextAnchors: nextAnchors,
    anchors: anchorsByWork,
    defaultRemind: settingNumber_(settings, '既定リマインド営業日前', 3),
    colors: COLOR_ORDER,
    scheduleUrl: webAppUrl_('')
  };
}

/**
 * 保存せずに日付だけ計算して返す（編集画面のプレビュー用）
 * @param {Array} rows 編集中の工程行
 * @param {string} anchorKey 基準日
 * @param {string} anchorName 基準日名称
 */
function previewSchedule(rows, anchorKey, anchorName) {
  var cal = loadBusinessCalendar_();
  var input = (rows || []).map(function (r, i) {
    return {
      seq: r.seq === '' || r.seq === undefined ? (i + 1) * 10 : r.seq,
      name: r.name, mode: r.mode, base: r.base, direction: r.direction, days: r.days,
      endDirection: r.endDirection, endDays: r.endDays,
      startDate: r.startDate, endDate: r.endDate,
      unit: r.unit, adjust: r.adjust, owner: r.owner, remindDays: r.remindDays, note: r.note
    };
  });
  var key = /^\d{4}-\d{2}-\d{2}$/.test(String(anchorKey || '').trim())
    ? String(anchorKey).trim() : '';
  try {
    // 起点の日が無くても、日付指定の工程だけは計算して見せる
    var computed = computeSchedule(input, key, cal, anchorName, { skipUnresolved: !key });
    var needsAnchor = 0;
    var items = computed.map(function (r) {
      if (r.unresolved) {
        needsAnchor++;
        return { seq: r.seq, name: r.name, dateKey: '', endKey: '', unresolved: true };
      }
      return {
        seq: r.seq, name: r.name, dateKey: r.dateKey, endKey: r.endKey || '',
        weekday: WEEKDAY_LABELS[dayOfWeek(r.dateKey)],
        endWeekday: r.endKey ? WEEKDAY_LABELS[dayOfWeek(r.endKey)] : '',
        isBusinessDay: isBusinessDay(cal, r.dateKey),
        unresolved: false
      };
    });
    return { ok: true, items: items, needsAnchor: needsAnchor };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/** 1業務分の工程テンプレートを保存し、工程表を作り直す */
function saveTemplate(workId, rows) {
  workId = String(workId).trim();
  if (!workId) throw new Error('業務IDが指定されていません');

  var t = readTable_(SHEET.TEMPLATE);
  var kept = t.rows.filter(function (r) { return String(r['業務ID']).trim() !== workId; });

  var seen = {};
  var added = (rows || []).map(function (r, i) {
    var name = String(r.name || '').trim();
    if (!name) throw new Error((i + 1) + '行目の工程名が空です');
    if (seen[name]) throw new Error('工程名が重複しています: ' + name);
    seen[name] = true;
    return {
      '業務ID': workId,
      '工程No': r.seq === '' || r.seq === undefined || r.seq === null ? (i + 1) * 10 : Number(r.seq),
      '工程名': name,
      '日付種別': normalizeMode(r.mode) === 'fixed' ? '日付指定' : '起点から',
      '基準': String(r.base || ''),
      '方向': String(r.direction || '前'),
      '日数': Number(r.days) || 0,
      '終了方向': String(r.endDirection || ''),
      '終了日数': (r.endDays === '' || r.endDays === null || r.endDays === undefined) ? '' : Number(r.endDays),
      '開始日': r.startDate ? keyToSheetDate_(r.startDate) : '',
      '終了日': r.endDate ? keyToSheetDate_(r.endDate) : '',
      '単位': String(r.unit || '営業日'),
      '休日補正': String(r.adjust || '前営業日'),
      '担当': String(r.owner || ''),
      'リマインド営業日前': r.remindDays === '' || r.remindDays === null || r.remindDays === undefined ? '' : Number(r.remindDays),
      '備考': String(r.note || '')
    };
  });

  // 保存前に必ず計算が通ることを確かめる（循環参照などをここで弾く）
  var work = findWork_(workId);
  var cal = loadBusinessCalendar_();
  computeSchedule(added.map(function (r) {
    return {
      seq: r['工程No'], name: r['工程名'], mode: r['日付種別'],
      base: r['基準'], direction: r['方向'], days: r['日数'],
      endDirection: r['終了方向'], endDays: r['終了日数'],
      startDate: toDateKey(r['開始日']), endDate: toDateKey(r['終了日']),
      unit: r['単位'], adjust: r['休日補正']
    };
  }), todayKey_(), cal, work ? work['基準日名称'] : '');

  var merged = kept.map(function (r) {
    var o = {};
    t.headers.forEach(function (h) { if (h) o[h] = r[h]; });
    return o;
  }).concat(added);

  replaceTable_(SHEET.TEMPLATE, merged);
  applyValidations_();
  var result = generateSchedules();

  // 他の業務のエラーまで見せると「保存できたのに失敗した」ように見えるため、
  // いま保存した業務に関係するものだけを返す
  var mine = result.errors.filter(function (m) { return m.indexOf('[' + workId) === 0; });
  log_('テンプレート保存', mine.length === 0, workId + ' / ' + added.length + '工程');
  return { anchorsAdded: result.anchorsAdded, rows: result.rows, errors: mine };
}

function findWork_(workId) {
  var rows = readTable_(SHEET.WORK).rows;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['業務ID']).trim() === String(workId).trim()) return rows[i];
  }
  return null;
}

/**
 * 業務マスタ1件を保存（新規追加も可）
 *
 * 業務IDはシート内で行を結び付けるためだけの記号なので、
 * 指定が無ければこちらで採番する（画面から入力させない）。
 */
function saveWork(work) {
  var t = readTable_(SHEET.WORK);
  var id = String(work.id || '').trim();
  if (!id) id = nextWorkId_(t.rows);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('業務IDは半角英数字・ハイフン・アンダースコアで入力してください');
  if (work.rule) parseRecurrence(work.rule); // 書式チェック

  var idx = headerIndex_(t.headers);
  var target = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['業務ID']).trim() === id) { target = t.rows[i]; break; }
  }
  var values = {
    '業務ID': id,
    '業務名': String(work.name || id),
    '有効': work.enabled === false ? 'OFF' : 'ON',
    '基準日名称': String(work.anchorName || '起点'),
    '基準日ルール': String(work.rule || ''),
    '基準日休日補正': String(work.adjust || '前営業日'),
    '色': String(work.color || '青'),
    '備考': String(work.note || '')
  };
  if (target) {
    Object.keys(values).forEach(function (h) {
      if (idx[h]) t.sheet.getRange(target._row, idx[h]).setValue(values[h]);
    });
  } else {
    appendRows_(SHEET.WORK, [values]);
  }
  applyValidations_();
  return { id: id, generate: generateSchedules() };
}

/**
 * 業務を1件まるごと削除する。
 * 業務マスタ・工程テンプレート・起点の日・工程表の該当行をすべて消す。
 */
function deleteWork(workId) {
  workId = String(workId || '').trim();
  if (!workId) throw new Error('業務が選ばれていません');

  var counts = countWorkRows_(workId);
  if (!counts.work) throw new Error('業務が見つかりません: ' + workId);

  // 工程表の行を消すとイベントIDも失われ、カレンダーに予定が取り残される。
  // 先にカレンダーから消しておく。
  var removedEvents = deleteWorkEvents_(workId);

  [SHEET.WORK, SHEET.TEMPLATE, SHEET.ANCHOR, SHEET.SCHEDULE].forEach(function (name) {
    var t = readTable_(name);
    var kept = t.rows.filter(function (r) { return String(r['業務ID']).trim() !== workId; });
    if (kept.length === t.rows.length) return;
    replaceTable_(name, kept.map(function (r) {
      var o = {};
      t.headers.forEach(function (h) { if (h) o[h] = r[h]; });
      return o;
    }));
  });
  applyScheduleCheckboxes_();

  log_('業務の削除', true, workId + ' / 工程 ' + counts.template + ' 起点 ' + counts.anchor
    + ' 工程表 ' + counts.schedule + ' 予定 ' + removedEvents);
  return {
    workId: workId,
    template: counts.template,
    anchor: counts.anchor,
    schedule: counts.schedule,
    events: removedEvents
  };
}

/** 削除の確認に出すための件数を数える */
function countWorkRows_(workId) {
  function n(name) {
    return readTable_(name).rows.filter(function (r) {
      return String(r['業務ID']).trim() === workId;
    }).length;
  }
  return {
    work: n(SHEET.WORK),
    template: n(SHEET.TEMPLATE),
    anchor: n(SHEET.ANCHOR),
    schedule: n(SHEET.SCHEDULE)
  };
}

/** その業務のカレンダー予定を消す（同期が OFF なら何もしない） */
function deleteWorkEvents_(workId) {
  var settings = getSettings_();
  if (!settingBool_(settings, 'カレンダー同期', false)) return 0;
  if (typeof CalendarApp === 'undefined') return 0;

  var removed = 0;
  try {
    var calId = settingText_(settings, 'カレンダーID', '');
    var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
    if (!cal) return 0;
    readTable_(SHEET.SCHEDULE).rows.forEach(function (r) {
      if (String(r['業務ID']).trim() !== workId) return;
      var id = String(r['イベントID'] || '').trim();
      if (!id) return;
      try {
        var ev = cal.getEventById(id);
        if (ev) { ev.deleteEvent(); removed++; }
      } catch (e) { /* すでに消えている */ }
    });
  } catch (e) {
    log_('業務の削除', false, 'カレンダーの予定を消せませんでした: ' + e.message);
  }
  return removed;
}

/** 削除の確認ダイアログ用に、消える件数だけ返す */
function getWorkDeleteInfo(workId) {
  return countWorkRows_(String(workId || '').trim());
}

/**
 * 1業務ぶんの工程表の行を、回次ごとにまとめて返す（進捗のまとめ設定用）
 */
function getWorkProgress(workId) {
  workId = String(workId || '').trim();
  var today = todayKey_();
  var groups = {};
  var order = [];

  readTable_(SHEET.SCHEDULE).rows.forEach(function (r) {
    if (String(r['業務ID']).trim() !== workId) return;
    var dueKey = toDateKey(r['予定日']);
    if (!dueKey) return;
    var period = periodText_(r['回次']);
    if (!groups[period]) {
      groups[period] = { period: period, anchorKey: toDateKey(r['基準日']), items: [] };
      order.push(period);
    }
    groups[period].items.push({
      key: String(r['キー']).trim(),
      seq: Number(r['工程No']) || 0,
      name: String(r['工程名'] || ''),
      dueKey: dueKey,
      endKey: toDateKey(r['終了日']),
      status: String(r['状態'] || STATUS.NOT_STARTED).trim(),
      owner: String(r['担当'] || ''),
      past: (toDateKey(r['終了日']) || dueKey) < today
    });
  });

  var list = order.map(function (p) { return groups[p]; });
  list.forEach(function (g) {
    g.items.sort(function (a, b) {
      if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
      return a.seq - b.seq;
    });
  });
  list.sort(function (a, b) {
    var x = a.items[0] ? a.items[0].dueKey : '';
    var y = b.items[0] ? b.items[0].dueKey : '';
    return x < y ? -1 : x > y ? 1 : 0;
  });

  // 「過去なのに未着手」が何件あるか。0 件なら案内を出す必要がない
  var stale = 0;
  list.forEach(function (g) {
    g.items.forEach(function (i) {
      if (i.past && i.status === STATUS.NOT_STARTED) stale++;
    });
  });

  return { workId: workId, today: today, groups: list, stale: stale, statusList: STATUS_LIST };
}

/** 使われていない業務IDを採番する（W1, W2, …） */
function nextWorkId_(rows) {
  var used = {};
  rows.forEach(function (r) { used[String(r['業務ID']).trim()] = true; });
  for (var n = 1; n < 10000; n++) {
    if (!used['W' + n]) return 'W' + n;
  }
  throw new Error('業務IDを採番できませんでした');
}

/**
 * 起点の日を手で1件足す。
 *
 * 決まった周期がない業務（基準日ルールが「手動」）はこれで日付を登録する。
 * 回次は日付そのものにする。月に複数回あっても重ならず、一覧でも読みやすい。
 */
function addAnchor(workId, dateKey) {
  workId = String(workId).trim();
  if (!workId) throw new Error('業務が選ばれていません');
  keyToDate(dateKey); // 形式チェック

  var t = readTable_(SHEET.ANCHOR);
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['業務ID']).trim() === workId && toDateKey(t.rows[i]['基準日']) === dateKey) {
      throw new Error('その日付はすでに登録されています：' + dateKey);
    }
  }
  appendRows_(SHEET.ANCHOR, [{
    '業務ID': workId, '回次': dateKey, '基準日': keyToSheetDate_(dateKey),
    '生成元': '手動', '状態': '予定', '備考': ''
  }]);
  applyFormats_();
  return generateSchedules();
}

/** 起点の日を1件消す（その回次の工程も次の再生成で消える） */
function deleteAnchor(workId, period) {
  workId = String(workId).trim();
  period = String(period).trim();
  var t = readTable_(SHEET.ANCHOR);
  var target = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['業務ID']).trim() === workId && periodText_(t.rows[i]['回次']) === period) {
      target = t.rows[i];
      break;
    }
  }
  if (!target) throw new Error('該当する起点の日が見つかりません：' + period);

  // 自動で並べている業務は、行ごと消しても次の再生成でルールから作り直されてしまう。
  // 「中止」として残すことで、その回だけを確実に除外できる（あとで戻すこともできる）。
  var idx = headerIndex_(t.headers);
  if (String(target['生成元'] || '').trim() === '自動' && idx['状態']) {
    t.sheet.getRange(target._row, idx['状態']).setValue('中止');
  } else {
    t.sheet.deleteRow(target._row);
  }
  return generateSchedules();
}

/** 「中止」にした起点の日を元に戻す */
function restoreAnchor(workId, period) {
  workId = String(workId).trim();
  period = String(period).trim();
  var t = readTable_(SHEET.ANCHOR);
  var idx = headerIndex_(t.headers);
  for (var i = 0; i < t.rows.length; i++) {
    var r = t.rows[i];
    if (String(r['業務ID']).trim() === workId && periodText_(r['回次']) === period) {
      if (idx['状態']) t.sheet.getRange(r._row, idx['状態']).setValue('予定');
      return generateSchedules();
    }
  }
  throw new Error('該当する起点の日が見つかりません：' + period);
}

// ---- テンプレートの受け渡し（JSON） ----

/**
 * 業務マスタ＋工程テンプレートを JSON 文字列で書き出す（個人情報は含まない）。
 *
 * @param {boolean} withProgress true なら各工程の状態・完了日も含める。
 *        別のシートへ引っ越すときや控えを取るときに使う。
 *        他の団体へ定義だけを渡すときは false（既定）のままにする。
 */
function exportTemplatesJson(withProgress) {
  var works = readTable_(SHEET.WORK).rows.filter(function (w) { return String(w['業務ID']).trim(); });
  var templates = readTable_(SHEET.TEMPLATE).rows.filter(function (r) { return String(r['業務ID']).trim(); });
  var payload = {
    format: 'gyomu-schedule-template',
    // 版2で日付指定の工程（日付種別・開始日・終了日）を含めるようにした。
    // 版1の JSON もそのまま読める
    version: 2,
    // 進捗を含むかどうかは、版ではなくこの旗で分かるようにしている
    includesProgress: !!withProgress,
    exportedAt: todayKey_(),
    works: works.map(function (w) {
      return {
        id: String(w['業務ID']).trim(), name: w['業務名'], enabled: w['有効'],
        anchorName: w['基準日名称'], rule: w['基準日ルール'], adjust: w['基準日休日補正'],
        color: w['色'], note: w['備考']
      };
    }),
    templates: templates.map(function (r) {
      return {
        workId: String(r['業務ID']).trim(), seq: r['工程No'], name: r['工程名'],
        // 日付指定の工程は mode と開始日／終了日が無いと再現できない。
        // 版1では書き出していなかったため、読み込み側は欠けていても動くようにしてある
        mode: normalizeMode(r['日付種別']) === 'fixed' ? '日付指定' : '起点から',
        base: r['基準'], direction: r['方向'], days: r['日数'],
        endDirection: r['終了方向'], endDays: r['終了日数'],
        startDate: toDateKey(r['開始日']), endDate: toDateKey(r['終了日']),
        unit: r['単位'], adjust: r['休日補正'],
        owner: r['担当'], remindDays: r['リマインド営業日前'], note: r['備考']
      };
    })
  };

  if (withProgress) payload.progress = readProgress_();
  return JSON.stringify(payload, null, 2);
}

/**
 * 工程表から進捗だけを抜き出す。
 *
 * キーは「業務ID|回次|工程No」で、工程表の生成時に付けているものと同じ。
 * 読み込み側は生成し直したあとに、このキーで突き合わせて戻す。
 * 未着手の行は書かない（既定値なので、書いても意味がなく量が増えるだけ）。
 */
function readProgress_() {
  var out = [];
  readTable_(SHEET.SCHEDULE).rows.forEach(function (r) {
    var key = String(r['キー']).trim();
    if (!key) return;
    var status = String(r['状態'] || '').trim();
    var doneDate = toDateKey(r['完了日']);
    if ((!status || status === STATUS.NOT_STARTED) && !doneDate) return;
    out.push({ key: key, status: status || STATUS.NOT_STARTED, doneDate: doneDate });
  });
  return out;
}

/**
 * 書き出した進捗を工程表へ戻す。
 *
 * 工程表を作り直した直後に呼ぶ。該当する行が無いものは数だけ返し、
 * 読み込んだ人が「思ったより少ない」と気づけるようにする。
 */
function applyProgress_(list) {
  var wanted = {};
  var total = 0;
  (list || []).forEach(function (p) {
    var key = String(p && p.key || '').trim();
    if (!key) return;
    var status = String(p.status || '').trim();
    if (STATUS_LIST.indexOf(status) < 0) return;   // 知らない状態は無視する
    wanted[key] = { status: status, doneDate: toDateKey(p.doneDate) };
    total++;
  });
  if (!total) return { applied: 0, missing: 0 };

  var t = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(t.headers);
  var lastRow = t.sheet.getLastRow();
  if (!idx['状態'] || lastRow < 2) return { applied: 0, missing: total };
  var n = lastRow - 1;

  // 1行ずつ書くと件数ぶん往復が増えるので、列ごとに1回で書き戻す
  var statusCol = t.sheet.getRange(2, idx['状態'], n, 1).getValues();
  var checkCol = idx['完'] ? t.sheet.getRange(2, idx['完'], n, 1).getValues() : null;
  var dateCol = idx['完了日'] ? t.sheet.getRange(2, idx['完了日'], n, 1).getValues() : null;

  var applied = 0;
  t.rows.forEach(function (r) {
    var hit = wanted[String(r['キー']).trim()];
    if (!hit) return;
    var i = r._row - 2;                 // readTable_ は空行を飛ばすので行番号で位置を決める
    if (i < 0 || i >= n) return;
    applied++;
    statusCol[i][0] = hit.status;
    if (checkCol) checkCol[i][0] = hit.status === STATUS.DONE;
    if (dateCol) dateCol[i][0] = hit.doneDate ? keyToSheetDate_(hit.doneDate) : '';
  });

  t.sheet.getRange(2, idx['状態'], n, 1).setValues(statusCol);
  if (checkCol) t.sheet.getRange(2, idx['完'], n, 1).setValues(checkCol);
  if (dateCol) t.sheet.getRange(2, idx['完了日'], n, 1).setValues(dateCol);

  return { applied: applied, missing: total - applied };
}

/**
 * JSON を読み込む。
 * @param {string} json
 * @param {string} mode 'merge'（同じ業務IDは上書き）/ 'replace'（既存を全部消してから読み込む）
 */
function importTemplatesJson(json, mode) {
  try {
    return importTemplatesJson_(json, mode);
  } catch (e) {
    // 画面側にメッセージが出ないことがあるので、実行ログにも必ず残す
    log_('テンプレート読込', false, (mode || '') + '　' + e.message);
    throw e;
  }
}

function importTemplatesJson_(json, mode) {
  var payload;
  try {
    payload = JSON.parse(json);
  } catch (e) {
    throw new Error('JSONとして読めません: ' + e.message);
  }
  if (!payload || payload.format !== 'gyomu-schedule-template') {
    throw new Error('このツールが書き出した形式ではありません（format が一致しません）');
  }
  if (!payload.works || !payload.templates) throw new Error('works / templates が含まれていません');

  var incomingIds = {};
  payload.works.forEach(function (w) { incomingIds[String(w.id).trim()] = true; });

  var workRows, tplRows;
  if (mode === 'replace') {
    workRows = [];
    tplRows = [];
  } else {
    workRows = readTable_(SHEET.WORK).rows.filter(function (w) {
      return String(w['業務ID']).trim() && !incomingIds[String(w['業務ID']).trim()];
    }).map(function (w) { return pickHeaders_(w, SHEET.WORK); });
    tplRows = readTable_(SHEET.TEMPLATE).rows.filter(function (r) {
      return String(r['業務ID']).trim() && !incomingIds[String(r['業務ID']).trim()];
    }).map(function (r) { return pickHeaders_(r, SHEET.TEMPLATE); });
  }

  payload.works.forEach(function (w) {
    if (w.rule) parseRecurrence(w.rule);
    workRows.push({
      '業務ID': String(w.id).trim(), '業務名': w.name || w.id, '有効': w.enabled || 'ON',
      '基準日名称': w.anchorName || '基準日', '基準日ルール': w.rule || '',
      '基準日休日補正': w.adjust || '前営業日', '色': w.color || '青', '備考': w.note || ''
    });
  });
  payload.templates.forEach(function (r) {
    // 版1の JSON には mode / 開始日 / 終了日 が無い。
    // その場合は開始日の有無から推測し、無ければ従来どおり「起点から」とみなす
    var fixed = r.mode === undefined ? !!r.startDate : normalizeMode(r.mode) === 'fixed';
    tplRows.push({
      '業務ID': String(r.workId).trim(), '工程No': r.seq, '工程名': r.name,
      '日付種別': fixed ? '日付指定' : '起点から',
      '基準': r.base || '',
      '方向': r.direction || '前', '日数': r.days || 0,
      '終了方向': String(r.endDirection || ''),
      '終了日数': (r.endDays === '' || r.endDays === null || r.endDays === undefined) ? '' : Number(r.endDays),
      '開始日': r.startDate ? keyToSheetDate_(r.startDate) : '',
      '終了日': r.endDate ? keyToSheetDate_(r.endDate) : '',
      '単位': r.unit || '営業日',
      '休日補正': r.adjust || '前営業日', '担当': r.owner || '',
      'リマインド営業日前': r.remindDays === undefined ? '' : r.remindDays, '備考': r.note || ''
    });
  });

  replaceTable_(SHEET.WORK, workRows);
  replaceTable_(SHEET.TEMPLATE, tplRows);
  applyValidations_();
  var result = generateSchedules();

  // 進捗は工程表を作り直したあとに戻す。含まれていなければ何もしない
  // （同じシートで読み直す場合、状態は生成時にキーで引き継がれる）
  if (payload.progress && payload.progress.length) {
    result.progress = applyProgress_(payload.progress);
  }

  log_('テンプレート読込', result.errors.length === 0,
    '業務 ' + payload.works.length + '件 / 工程 ' + payload.templates.length + '件（' + mode + '）'
    + (result.progress ? '　進捗 ' + result.progress.applied + '件を復元'
        + (result.progress.missing ? '（' + result.progress.missing + '件は該当なし）' : '') : ''));
  return result;
}

function pickHeaders_(row, sheetName) {
  var headers = readTable_(sheetName).headers;
  var o = {};
  headers.forEach(function (h) { if (h) o[h] = row[h]; });
  return o;
}

/**
 * 受け渡しの画面を開く。
 *
 * loadHtml_ を通すので、［画面をGitHubから読み込む］が ON なら json.html も
 * 自動で最新になる。画面の隅に版を出しているので、コード.gs と食い違って
 * いないかをその場で確かめられる。
 */
function showTemplateDialog_(mode) {
  var tpl = loadHtml_('json');
  tpl.mode = mode;
  tpl.payload = mode === 'export' ? exportTemplatesJson() : '';
  tpl.version = VERSION;
  SpreadsheetApp.getUi().showModalDialog(
    tpl.evaluate().setWidth(720).setHeight(620),
    mode === 'export' ? 'テンプレートの書き出し' : 'テンプレートの読み込み');
}

function showTemplateExport() { showTemplateDialog_('export'); }
function showTemplateImport() { showTemplateDialog_('import'); }


// ===========================================================================
// 19_diagnostics.gs
// ===========================================================================

/**
 * 動作診断
 *
 * 画面が開かない・通知が来ないといったときに、どこで止まっているかを切り分ける。
 * メニュー［動作診断］から実行するか、エディタで runDiagnostics を直接実行する。
 */

function runDiagnostics() {
  var lines = [];
  var total = 0;

  function step(name, fn) {
    var start = new Date().getTime();
    var result, ok = true;
    try {
      result = fn();
    } catch (e) {
      ok = false;
      result = e.message;
    }
    var ms = new Date().getTime() - start;
    total += ms;
    lines.push((ok ? 'OK ' : 'NG ') + pad_(name, 22) + pad_(ms + 'ms', 8) + result);
    return ok;
  }

  step('スプレッドシート', function () {
    var s = ss_();
    return s.getName() + '（' + s.getSpreadsheetTimeZone() + '）';
  });

  [SHEET.SETTINGS, SHEET.WORK, SHEET.TEMPLATE, SHEET.ANCHOR, SHEET.SCHEDULE, SHEET.HOLIDAY].forEach(function (name) {
    step('シート: ' + name, function () {
      return readTable_(name).rows.length + ' 行';
    });
  });

  step('営業日カレンダー', function () {
    var cal = loadBusinessCalendar_();
    var today = todayKey_();
    return '本日 ' + today + ' は' + (isBusinessDay(cal, today) ? '営業日' : '休日');
  });

  var payload = null;
  step('画面データの取得', function () {
    payload = getGanttData();
    return '業務 ' + payload.works.length
      + ' / レーン ' + payload.lanes.length
      + ' / 通知 ' + payload.digest.total + ' 件';
  });

  if (payload) {
    step('データ量', function () {
      var size = JSON.stringify(payload).length;
      var stepCount = payload.lanes.reduce(function (n, l) { return n + l.items.length; }, 0);
      return Math.round(size / 1024) + ' KB / 工程 ' + stepCount + ' 件'
        + (size > 3000000 ? '　※大きすぎます。設定シートの先読み月数を減らしてください' : '');
    });
    step('表示範囲', function () {
      return payload.from + ' 〜 ' + payload.to + '（本日 ' + payload.today + '）';
    });
  }

  step('別ウィンドウのURL', function () {
    var saved = normalizeWebAppUrl_(settingText_(getSettings_(), 'WebアプリURL', ''));
    if (saved) return '登録済み ' + saved;
    var deployed = '';
    try {
      deployed = ScriptApp.getService().getUrl() || '';
    } catch (e) {
      deployed = '';
    }
    if (!deployed) return '未デプロイ（メニューの［別ウィンドウで開く］の手順を参照）';
    return 'デプロイのURL ' + deployed
      + '　※開けない場合は再デプロイするか［WebアプリのURLを登録］で /dev のURLを登録';
  });

  step('画面の取得元', function () {
    var settings = getSettings_();
    if (!settingBool_(settings, '画面をGitHubから読み込む', false)) {
      return 'プロジェクト内のファイル（版 ' + VERSION + '）';
    }
    var base = remoteBase_(settings);
    if (!base) return 'ON だが取得元URLが不正（raw.githubusercontent.com のみ）';
    var got = REMOTE_FILES.filter(function (n) {
      return !!fetchRemoteHtml_(n, settings);
    });
    return 'GitHub ' + got.length + '/' + REMOTE_FILES.length + ' 取得可（版 ' + VERSION + '）　' + base;
  });

  step('カレンダー同期', function () {
    var settings = getSettings_();
    if (!settingBool_(settings, 'カレンダー同期', false)) return 'OFF（カレンダーには書き込みません）';
    if (typeof CalendarApp === 'undefined') {
      return 'ON だが権限なし。appsscript.json に calendar スコープを足して承認し直してください';
    }
    var calId = settingText_(settings, 'カレンダーID', '');
    return 'ON / ' + (calId || 'メインカレンダー') + '　※毎日1時と［カレンダーに同期］で反映';
  });

  step('Chat通知の設定', function () {
    var url = settingText_(getSettings_(), 'ChatWebhookURL', '');
    if (!url) return '未設定（通知は送られません）';
    return /^https:\/\/chat\.googleapis\.com\//.test(url) ? '設定済み' : '形式が正しくありません';
  });

  step('トリガー', function () {
    var names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    return names.length ? names.join(', ') : 'なし（［通知トリガーを再設定］を実行してください）';
  });

  var text = lines.join('\n') + '\n\n合計 ' + total + 'ms';
  console.log(text);
  log_('動作診断', lines.filter(function (l) { return l.indexOf('NG') === 0; }).length === 0, text.replace(/\n/g, ' / '));
  return text;
}

/**
 * 画面側で起きた JS エラーを実行ログに残す。
 *
 * スプレッドシートのダイアログは開発者ツールを開きにくく、落ちても
 * 「押しても何も起きない」としか分からないため、画面から送ってもらう。
 */
function logClientError(where, message) {
  log_('画面のエラー', false, String(where || '') + '　' + String(message || '').slice(0, 500));
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/** メニューから実行し、結果をダイアログで表示する */
function menuDiagnostics() {
  var ui = SpreadsheetApp.getUi();
  var text;
  try {
    text = runDiagnostics();
  } catch (e) {
    text = '診断そのものが失敗しました:\n' + e.message + '\n\n' + (e.stack || '');
  }
  var html = HtmlService.createHtmlOutput(
    '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;'
    + 'line-height:1.6;white-space:pre-wrap;margin:0">'
    + text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    + '</pre>').setWidth(640).setHeight(520);
  ui.showModalDialog(html, '動作診断');
}


// ===========================================================================
// 20_remote_html.gs
// ===========================================================================

/**
 * 画面（HTML）を GitHub から読み込む（任意機能・既定 OFF）
 *
 * コードを直したびに3ファイルを貼り直すのは手間なので、
 * スケジュール画面と編集画面だけは GitHub から取ってこられるようにする。
 * 追加の権限は要らない（script.external_request は祝日CSVで承認済み）。
 *
 * 取れなかったときは必ずプロジェクト内のファイルに戻すので、
 * ネットワークが遮断されていても画面は開く。
 */

/** 取得を許すホスト。ここ以外は拒否する */
var REMOTE_HOST = 'https://raw.githubusercontent.com/';

/**
 * GitHub から取ってくる HTML。
 * json（テンプレートの受け渡し）を外していたため、コード.gs だけ貼り替えた人の手元で
 * 画面と中身の版が食い違い、読み込みボタンが効かない不具合になっていた。
 */
var REMOTE_FILES = ['gantt', 'editor', 'json'];

/** キャッシュの保持時間（秒）。毎回取りに行くと画面が開くまで待たされる */
var REMOTE_CACHE_SEC = 3600;

/**
 * HTML を1枚返す。
 * GitHub から読む設定なら取りに行き、だめならプロジェクト内のファイルを使う。
 * @param {string} name 'gantt' または 'editor'
 */
function loadHtml_(name, settings) {
  settings = settings || getSettings_();
  if (!settingBool_(settings, '画面をGitHubから読み込む', false)) {
    return HtmlService.createTemplateFromFile(name);
  }

  var text = fetchRemoteHtml_(name, settings);
  if (!text) return HtmlService.createTemplateFromFile(name);
  return HtmlService.createTemplate(text);
}

/** 取得元のURL。末尾に / が無くても付ける */
function remoteBase_(settings) {
  var base = settingText_(settings, '画面の取得元URL', '') || '';
  base = String(base).trim();
  if (!base) return '';
  if (base.slice(-1) !== '/') base += '/';
  // 他所のコードを読み込ませないよう、ホストを固定する
  return base.indexOf(REMOTE_HOST) === 0 ? base : '';
}

/**
 * HTML を取得する。取れなければ空文字を返す（呼び出し側で退避する）。
 * 内容が前回と変わったときだけ更新履歴に残す。
 */
function fetchRemoteHtml_(name, settings) {
  var base = remoteBase_(settings);
  if (!base) {
    recordUpdate_(name + '.html', '', '失敗', '取得元URLが正しくありません（raw.githubusercontent.com のみ）');
    return '';
  }

  var url = base + name + '.html';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'html_' + name;
  var cached = null;
  try {
    cached = cache.get(cacheKey);
  } catch (e) {
    cached = null;   // 大きすぎるとキャッシュに入らないことがある
  }
  if (cached) return cached;

  var text = '';
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) {
      recordUpdate_(name + '.html', '', '失敗', 'HTTP ' + res.getResponseCode() + '　' + url);
      return '';
    }
    text = res.getContentText();
  } catch (e) {
    recordUpdate_(name + '.html', '', '失敗', e.message + '　' + url);
    return '';
  }

  if (text.length < 200) {
    recordUpdate_(name + '.html', '', '失敗', '中身が短すぎます（' + text.length + '文字）　' + url);
    return '';
  }

  try {
    cache.put(cacheKey, text, REMOTE_CACHE_SEC);
  } catch (e) { /* 入らなくても動作に影響はない */ }

  // 取り直すたびに記録すると履歴が埋まるので、中身が変わったときだけ残す
  var props = PropertiesService.getDocumentProperties();
  var sigKey = 'htmlsig_' + name;
  var sig = htmlSignature_(text);
  if (props.getProperty(sigKey) !== sig) {
    props.setProperty(sigKey, sig);
    recordUpdate_(name + '.html', htmlVersion_(text), '更新', text.length + '文字を取り込みました　' + url);
  }
  return text;
}

/** 中身が変わったかどうかの判定に使う短い指紋 */
function htmlSignature_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/** HTML の先頭に埋め込んだ版表記を拾う（無ければ空） */
function htmlVersion_(text) {
  var m = /<!--\s*version:\s*([0-9A-Za-z.\-_]+)\s*-->/.exec(String(text).slice(0, 500));
  return m ? m[1] : '';
}

/** キャッシュを捨てて次回に取り直させる */
function clearRemoteHtmlCache_() {
  var cache = CacheService.getScriptCache();
  REMOTE_FILES.forEach(function (n) {
    try { cache.remove('html_' + n); } catch (e) { /* 無視 */ }
  });
}

/** 更新履歴シートに1行足す */
function recordUpdate_(target, version, result, detail) {
  try {
    appendRows_(SHEET.UPDATE, [{
      '日時': new Date(),
      '対象': target,
      '版': version || '',
      '取得元': settingText_(getSettings_(), '画面の取得元URL', '') || '',
      '結果': result,
      '内容': detail || ''
    }]);
  } catch (e) {
    console.warn('更新履歴に書けませんでした: ' + e.message);
  }
}

/**
 * GitHub 側の版を調べて、いまの版と比べる。
 * dist/version.json（{"version":"1.1.0"}）を置いておく前提。
 */
function checkForUpdate() {
  var settings = getSettings_();
  var base = remoteBase_(settings);
  if (!base) {
    return { ok: false, message: '［設定］シートの「画面の取得元URL」が正しくありません。' };
  }
  try {
    var res = UrlFetchApp.fetch(base + 'version.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { ok: false, message: '版の情報を取得できませんでした（HTTP ' + res.getResponseCode() + '）。' };
    }
    var latest = String(JSON.parse(res.getContentText()).version || '').trim();
    return {
      ok: true,
      current: VERSION,
      latest: latest,
      newer: !!latest && latest !== VERSION
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
