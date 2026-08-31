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
