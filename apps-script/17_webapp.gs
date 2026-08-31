/**
 * ガント画面（HTMLサービス）へのデータ供給と更新処理
 *
 * スプレッドシートのメニューからダイアログとして開くほか、
 * Webアプリとしてデプロイして単独のURLで開くこともできる。
 */

function doGet() {
  return HtmlService.createTemplateFromFile('gantt')
    .evaluate()
    .setTitle('業務スケジュール')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
      name: w['業務名'],
      enabled: !/^(off|false|いいえ|無効|0)$/i.test(String(w['有効']).trim()),
      anchorName: w['基準日名称'] || '基準日',
      rule: w['基準日ルール'],
      // 実際の色は画面側でテーマに合わせて解決する。ここでは色の名前だけ渡す
      color: String(w['色'] || '').trim() || COLOR_ORDER[i % COLOR_ORDER.length]
    };
    works.push(item);
    workById[id] = item;
  });

  var anchorByKey = {};
  readTable_(SHEET.ANCHOR).rows.forEach(function (a) {
    var id = String(a['業務ID']).trim();
    var period = String(a['回次']).trim();
    if (!id || !period) return;
    anchorByKey[id + '|' + period] = toDateKey(a['基準日']);
  });

  var laneMap = {};
  var lanes = [];
  readTable_(SHEET.SCHEDULE).rows.forEach(function (r) {
    var workId = String(r['業務ID']).trim();
    var period = String(r['回次']).trim();
    var dueKey = toDateKey(r['予定日']);
    if (!workId || !dueKey) return;
    if (dueKey < fromKey || dueKey > toKey) return;
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
    if (dueKey > lane.to) lane.to = dueKey;

    var status = String(r['状態'] || STATUS.NOT_STARTED).trim();
    lane.items.push({
      key: String(r['キー']).trim(),
      seq: Number(r['工程No']) || 0,
      name: r['工程名'],
      dueKey: dueKey,
      weekday: WEEKDAY_LABELS[dayOfWeek(dueKey)],
      status: status,
      owner: r['担当'] || '',
      note: r['備考'] || '',
      isAnchor: dueKey === (anchorByKey[laneKey] || ''),
      overdue: dueKey < today && status !== STATUS.DONE && status !== STATUS.SKIP,
      remaining: countBusinessDays(cal, today, dueKey)
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

  return {
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
    statusList: STATUS_LIST
  };
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

/** 工程の状態を更新する（ガント画面から呼ばれる） */
function updateItemStatus(key, status) {
  if (STATUS_LIST.indexOf(status) < 0) throw new Error('不正な状態です: ' + status);
  var t = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(t.headers);
  var target = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['キー']).trim() === key) { target = t.rows[i]; break; }
  }
  if (!target) throw new Error('工程が見つかりません: ' + key);

  t.sheet.getRange(target._row, idx['状態']).setValue(status);
  if (idx['完']) t.sheet.getRange(target._row, idx['完']).setValue(status === STATUS.DONE);
  if (idx['完了日']) {
    t.sheet.getRange(target._row, idx['完了日'])
      .setValue(status === STATUS.DONE ? keyToSheetDate_(todayKey_()) : '');
  }
  return { key: key, status: status };
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
