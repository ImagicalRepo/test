/**
 * 工程テンプレートから実際の日程を算出する（純粋関数）
 *
 * 各工程は「基準（基準日 or 別の工程）」からの相対日数で定義する。
 * これにより、審査会の日が動いても全工程が自動で追随する。
 */

var ANCHOR_ALIASES = ['基準日', '基準', 'アンカー', 'ANCHOR'];

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
 * @param {Array<Object>} rows 工程テンプレート行
 *        {seq, name, base, direction, days, unit, adjust, owner, remindDays, note}
 * @param {string} anchorKey 基準日（審査会日など）の dateKey
 * @param {Object} cal 営業日カレンダー
 * @param {string} anchorName 基準日の別名（業務マスタの「基準日名称」）。base 欄でこの名前も基準日として扱う
 * @return {Array<Object>} rows に dateKey を加えたもの（入力順）
 */
function computeSchedule(rows, anchorKey, cal, anchorName) {
  if (!rows || !rows.length) return [];
  keyToDate(anchorKey); // 形式チェック

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
      var baseText = normalizeText(row.base);
      var baseKey = null;

      if (isAnchorRef(baseText) || (anchorAlias && baseText === anchorAlias)) {
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
      resolved[normalizeText(row.name)] = row.dateKey;
      progressed = true;
    }
    if (!progressed) {
      throw new Error('工程の基準が循環しています: ' + next.map(function (r) { return r.name; }).join(' → '));
    }
    pending = next;
    if (++guard > 500) throw new Error('工程の解決が収束しませんでした');
  }

  return rows;
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
