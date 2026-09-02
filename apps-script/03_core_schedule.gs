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
