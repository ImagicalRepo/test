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
