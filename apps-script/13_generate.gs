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

  // ---- 1. 基準日の自動展開 ----
  var anchorTable = readTable_(SHEET.ANCHOR);
  var anchorSeen = {};
  anchorTable.rows.forEach(function (r) {
    anchorSeen[String(r['業務ID']).trim() + '|' + String(r['回次']).trim()] = true;
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
  var anchors = readTable_(SHEET.ANCHOR).rows.filter(function (r) {
    return String(r['業務ID']).trim() && String(r['回次']).trim() && toDateKey(r['基準日']);
  });
  var templates = groupTemplates_(readTable_(SHEET.TEMPLATE).rows);
  var workById = {};
  works.forEach(function (w) { workById[String(w['業務ID']).trim()] = w; });

  // 生成する行数だけ営業日数を数えることになるので、ここでも表を使う
  var countFrom = createBusinessDayCounter(cal, today, shiftMonthKey_(fromKey, -1), shiftMonthKey_(toKey, 1));

  var oldRows = readTable_(SHEET.SCHEDULE).rows;
  var oldByKey = {};
  oldRows.forEach(function (r) {
    var k = String(r['キー']).trim();
    if (k) oldByKey[k] = r;
  });

  var newRows = [];
  var usedKeys = {};

  anchors.forEach(function (a) {
    var workId = String(a['業務ID']).trim();
    var work = workById[workId];
    if (!work) return; // 無効化された業務はスキップ
    if (String(a['状態']).trim() === '中止') return;
    var tpl = templates[workId];
    if (!tpl || !tpl.length) {
      errors.push('[' + workId + '] 工程テンプレートが登録されていません');
      return;
    }
    var anchorKey = toDateKey(a['基準日']);
    var rows;
    try {
      rows = computeSchedule(cloneTemplateRows_(tpl), anchorKey, cal, work['基準日名称']);
    } catch (e) {
      errors.push('[' + workId + ' ' + a['回次'] + '] ' + e.message);
      return;
    }
    rows.forEach(function (row) {
      var key = workId + '|' + String(a['回次']).trim() + '|' + row.seq;
      usedKeys[key] = true;
      var old = oldByKey[key] || {};
      var fixed = /^(on|true|はい|固定|1)$/i.test(String(old['日程固定'] || '').trim());
      var dueKey = fixed && toDateKey(old['予定日']) ? toDateKey(old['予定日']) : row.dateKey;
      var remind = row.remindDays === '' || row.remindDays === null || row.remindDays === undefined
        ? defaultRemind : Number(row.remindDays);
      var status = old['状態'] || STATUS.NOT_STARTED;
      newRows.push({
        'キー': key,
        '完': status === STATUS.DONE,
        '業務ID': workId,
        '業務名': work['業務名'],
        '回次': a['回次'],
        '基準日': keyToSheetDate_(anchorKey),
        '工程No': row.seq,
        '工程名': row.name,
        '予定日': keyToSheetDate_(dueKey),
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

  log_('工程表生成', errors.length === 0,
    '基準日追加 ' + newAnchors.length + '件 / 工程 ' + newRows.length + '行'
    + (errors.length ? ' / エラー: ' + errors.join(' | ') : ''));

  return { anchorsAdded: newAnchors.length, rows: newRows.length, errors: errors };
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
      base: r['基準'],
      direction: r['方向'],
      days: r['日数'] === '' || r['日数'] === null ? 0 : r['日数'],
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
      seq: r.seq, name: r.name, base: r.base, direction: r.direction, days: r.days,
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
