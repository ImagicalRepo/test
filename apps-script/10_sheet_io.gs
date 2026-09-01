/**
 * スプレッドシート入出力
 */

var SS_ID_PROP = 'SPREADSHEET_ID';
var SS_CACHE_ = null;

/**
 * 対象スプレッドシートを返す。
 * Webアプリ（doGet）からは getActive() が使えない場合があるため、
 * 初期セットアップ時に控えておいたIDでフォールバックする。
 *
 * 1回の実行中に何十回も呼ばれるので、取得結果を保持しておく。
 */
function ss_() {
  if (SS_CACHE_) return SS_CACHE_;

  var active = null;
  try {
    active = SpreadsheetApp.getActive();
  } catch (e) {
    active = null;
  }
  if (active) {
    SS_CACHE_ = active;
    try {
      var props = PropertiesService.getScriptProperties();
      if (props.getProperty(SS_ID_PROP) !== active.getId()) {
        props.setProperty(SS_ID_PROP, active.getId());
      }
    } catch (e) { /* 権限がなければ黙って諦める */ }
    return active;
  }
  var id = PropertiesService.getScriptProperties().getProperty(SS_ID_PROP);
  if (!id) throw new Error('対象のスプレッドシートを特定できません。スプレッドシートから［初期セットアップ］を1回実行してください。');
  SS_CACHE_ = SpreadsheetApp.openById(id);
  return SS_CACHE_;
}

/** 実行ログを1行追記する（失敗しても本処理は止めない） */
function log_(process, ok, message) {
  try {
    var sh = getSheet_(SHEET.LOG, true);
    if (!sh) return;
    sh.appendRow([new Date(), process, ok ? 'OK' : 'NG', String(message).slice(0, 4000)]);
    // 直近300行だけ残す
    var extra = sh.getLastRow() - 301;
    if (extra > 0) sh.deleteRows(2, extra);
  } catch (e) {
    console.warn('ログ書き込みに失敗: ' + e.message);
  }
}

function getSheet_(name, optional) {
  var sh = ss_().getSheetByName(name);
  if (!sh && !optional) {
    throw new Error('シート「' + name + '」がありません。メニュー［難病スケジュール］→［初期セットアップ］を実行してください。');
  }
  return sh;
}

/**
 * シートを {headers, rows} で読み出す。
 * rows の各要素は列名をキーにしたオブジェクトで、_row に実際の行番号を持つ。
 */
function readTable_(name) {
  var sh = getSheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { sheet: sh, headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var obj = { _row: r + 1 };
    var empty = true;
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = values[r][c];
      if (values[r][c] !== '' && values[r][c] !== null) empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

/** ヘッダー名 -> 列番号(1始まり) のマップ */
function headerIndex_(headers) {
  var idx = {};
  headers.forEach(function (h, i) { if (h) idx[h] = i + 1; });
  return idx;
}

/** オブジェクト配列をシートの 2 行目以降へ全面上書きする */
function replaceTable_(name, rows) {
  var t = readTable_(name);
  var sh = t.sheet;
  var headers = t.headers;
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, Math.max(sh.getLastColumn(), 1)).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

/** オブジェクト配列を末尾に追記する */
function appendRows_(name, rows) {
  if (!rows.length) return;
  var t = readTable_(name);
  var sh = t.sheet;
  var headers = t.headers;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      return (v === undefined || v === null) ? '' : v;
    });
  });
  sh.getRange(sh.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

/** 設定シートを key -> value のオブジェクトで読み出す */
function getSettings_() {
  var t = readTable_(SHEET.SETTINGS);
  var map = {};
  t.rows.forEach(function (r) {
    var k = String(r['設定キー']).trim();
    if (k) map[k] = r['値'];
  });
  return map;
}

function settingText_(settings, key, fallback) {
  var v = settings[key];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return String(v).trim();
}

function settingNumber_(settings, key, fallback) {
  var v = settingText_(settings, key, null);
  if (v === null) return fallback;
  var n = Number(v);
  return isNaN(n) ? fallback : n;
}

function settingBool_(settings, key, fallback) {
  var v = settingText_(settings, key, null);
  if (v === null) return fallback;
  return /^(on|true|はい|有効|1)$/i.test(v);
}

/** 休日マスタと設定から営業日カレンダーを組み立てる */
function loadBusinessCalendar_(settings) {
  settings = settings || getSettings_();
  var holidays = [];
  var extraWorkdays = [];
  var sh = getSheet_(SHEET.HOLIDAY, true);
  if (sh) {
    var t = readTable_(SHEET.HOLIDAY);
    t.rows.forEach(function (r) {
      var key = toDateKey(r['日付']);
      if (!key) return;
      if (String(r['種別']).indexOf('出勤') >= 0) extraWorkdays.push(key);
      else holidays.push(key);
    });
  }
  var weekendText = settingText_(settings, '週休日', '土,日');
  var weekendDays = weekendText.split(/[,、]/).map(function (s) {
    var name = normalizeText(s).replace(/曜日?$/, '');
    var i = WEEKDAY_LABELS.indexOf(name);
    return i >= 0 ? i : null;
  }).filter(function (v) { return v !== null; });
  if (!weekendDays.length) weekendDays = [0, 6];

  return createBusinessCalendar({ holidays: holidays, extraWorkdays: extraWorkdays, weekendDays: weekendDays });
}

/** dateKey をシート表示用の Date（ローカル 00:00）に変換 */
function keyToSheetDate_(key) {
  if (!key) return '';
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function todayKey_() {
  var tz = ss_().getSpreadsheetTimeZone() || 'Asia/Tokyo';
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}
