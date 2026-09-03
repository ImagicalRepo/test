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
  return HtmlService.createTemplateFromFile(file)
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
