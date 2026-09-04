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
    title: scheduleTitle_(settings),
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
 * loadHtml_ を通すので、画面を外から取り込む設定が ON なら json.html も
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
