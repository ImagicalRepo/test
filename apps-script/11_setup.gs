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

  ['予定日', '完了日', '基準日'].forEach(function (name) {
    if (idx[name]) sh.getRange(2, idx[name], rowCount).setNumberFormat('yyyy/mm/dd');
  });
  var anchor = readTable_(SHEET.ANCHOR);
  var aidx = headerIndex_(anchor.headers);
  if (aidx['基準日']) anchor.sheet.getRange(2, aidx['基準日'], Math.max(anchor.sheet.getMaxRows() - 1, 1)).setNumberFormat('yyyy/mm/dd');
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
