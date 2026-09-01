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
      anchorName: w['基準日名称'] || '基準日',
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
      base: String(r['基準'] || ''),
      direction: String(r['方向'] || '前'),
      days: r['日数'] === '' || r['日数'] === null ? 0 : Number(r['日数']),
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
  readTable_(SHEET.ANCHOR).rows.forEach(function (a) {
    var id = String(a['業務ID']).trim();
    var key = toDateKey(a['基準日']);
    if (!id || !key || key < today) return;
    if (!nextAnchors[id] || key < nextAnchors[id].dateKey) {
      nextAnchors[id] = { dateKey: key, period: periodText_(a['回次']) };
    }
  });

  return {
    today: today,
    works: works,
    templates: templates,
    nextAnchors: nextAnchors,
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
      name: r.name, base: r.base, direction: r.direction, days: r.days,
      unit: r.unit, adjust: r.adjust, owner: r.owner, remindDays: r.remindDays, note: r.note
    };
  });
  try {
    var computed = computeSchedule(input, anchorKey, cal, anchorName);
    return {
      ok: true,
      items: computed.map(function (r) {
        return {
          seq: r.seq, name: r.name, dateKey: r.dateKey,
          weekday: WEEKDAY_LABELS[dayOfWeek(r.dateKey)],
          isBusinessDay: isBusinessDay(cal, r.dateKey)
        };
      })
    };
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
      '基準': String(r.base || ''),
      '方向': String(r.direction || '前'),
      '日数': Number(r.days) || 0,
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
      seq: r['工程No'], name: r['工程名'], base: r['基準'], direction: r['方向'],
      days: r['日数'], unit: r['単位'], adjust: r['休日補正']
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
  log_('テンプレート保存', result.errors.length === 0, workId + ' / ' + added.length + '工程');
  return result;
}

function findWork_(workId) {
  var rows = readTable_(SHEET.WORK).rows;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['業務ID']).trim() === String(workId).trim()) return rows[i];
  }
  return null;
}

/** 業務マスタ1件を保存（新規追加も可） */
function saveWork(work) {
  var id = String(work.id || '').trim();
  if (!id) throw new Error('業務IDを入力してください');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('業務IDは半角英数字・ハイフン・アンダースコアで入力してください');
  if (work.rule) parseRecurrence(work.rule); // 書式チェック

  var t = readTable_(SHEET.WORK);
  var idx = headerIndex_(t.headers);
  var target = null;
  for (var i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i]['業務ID']).trim() === id) { target = t.rows[i]; break; }
  }
  var values = {
    '業務ID': id,
    '業務名': String(work.name || id),
    '有効': work.enabled === false ? 'OFF' : 'ON',
    '基準日名称': String(work.anchorName || '基準日'),
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
  return generateSchedules();
}

// ---- テンプレートの受け渡し（JSON） ----

/** 業務マスタ＋工程テンプレートを JSON 文字列で書き出す（個人情報は含まない） */
function exportTemplatesJson() {
  var works = readTable_(SHEET.WORK).rows.filter(function (w) { return String(w['業務ID']).trim(); });
  var templates = readTable_(SHEET.TEMPLATE).rows.filter(function (r) { return String(r['業務ID']).trim(); });
  var payload = {
    format: 'gyomu-schedule-template',
    version: 1,
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
        workId: String(r['業務ID']).trim(), seq: r['工程No'], name: r['工程名'], base: r['基準'],
        direction: r['方向'], days: r['日数'], unit: r['単位'], adjust: r['休日補正'],
        owner: r['担当'], remindDays: r['リマインド営業日前'], note: r['備考']
      };
    })
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * JSON を読み込む。
 * @param {string} json
 * @param {string} mode 'merge'（同じ業務IDは上書き）/ 'replace'（既存を全部消してから読み込む）
 */
function importTemplatesJson(json, mode) {
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
    tplRows.push({
      '業務ID': String(r.workId).trim(), '工程No': r.seq, '工程名': r.name, '基準': r.base || '',
      '方向': r.direction || '前', '日数': r.days || 0, '単位': r.unit || '営業日',
      '休日補正': r.adjust || '前営業日', '担当': r.owner || '',
      'リマインド営業日前': r.remindDays === undefined ? '' : r.remindDays, '備考': r.note || ''
    });
  });

  replaceTable_(SHEET.WORK, workRows);
  replaceTable_(SHEET.TEMPLATE, tplRows);
  applyValidations_();
  var result = generateSchedules();
  log_('テンプレート読込', result.errors.length === 0,
    '業務 ' + payload.works.length + '件 / 工程 ' + payload.templates.length + '件（' + mode + '）');
  return result;
}

function pickHeaders_(row, sheetName) {
  var headers = readTable_(sheetName).headers;
  var o = {};
  headers.forEach(function (h) { if (h) o[h] = row[h]; });
  return o;
}

function showTemplateExport() {
  var tpl = HtmlService.createTemplateFromFile('json');
  tpl.mode = 'export';
  tpl.payload = exportTemplatesJson();
  SpreadsheetApp.getUi().showModalDialog(tpl.evaluate().setWidth(720).setHeight(620), 'テンプレートの書き出し');
}

function showTemplateImport() {
  var tpl = HtmlService.createTemplateFromFile('json');
  tpl.mode = 'import';
  tpl.payload = '';
  SpreadsheetApp.getUi().showModalDialog(tpl.evaluate().setWidth(720).setHeight(620), 'テンプレートの読み込み');
}
