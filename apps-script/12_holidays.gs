/**
 * 休日マスタの同期
 *
 * ・国民の祝日：内閣府が公開している syukujitsu.csv から取り込む（種別=祝日）
 *   一次情報なので確実で、Googleカレンダーの権限も不要。
 * ・年末年始 ：設定シートの「年末年始休」から自動生成（種別=年末年始）
 * ・上記以外 ：手入力した閉庁日・振替出勤日は消さずに残す（種別=閉庁 / 振替出勤）
 */

function syncHolidays() {
  var settings = getSettings_();
  var t = readTable_(SHEET.HOLIDAY);

  // 手入力分（閉庁・振替出勤など）は保持する
  var manual = t.rows.filter(function (r) {
    var kind = String(r['種別'] || '').trim();
    return kind !== '祝日' && kind !== '年末年始';
  }).map(function (r) {
    return { key: toDateKey(r['日付']), name: r['名称'], kind: String(r['種別'] || '閉庁').trim() };
  }).filter(function (r) { return r.key; });

  var thisYear = Number(todayKey_().slice(0, 4));
  var fromKey = (thisYear - 1) + '-01-01';
  var toKey = (thisYear + 3) + '-12-31';

  var fetched = [];
  var fetchError = '';
  try {
    fetched = fetchNationalHolidays_(settings, fromKey, toKey);
  } catch (e) {
    fetchError = e.message;
    // 取得できなかった場合は既存の祝日行をそのまま残す（消してしまうと営業日計算が狂うため）
    fetched = t.rows.filter(function (r) { return String(r['種別'] || '').trim() === '祝日'; })
      .map(function (r) { return { key: toDateKey(r['日付']), name: r['名称'], kind: '祝日' }; })
      .filter(function (r) { return r.key; });
  }

  var yearEnd = buildYearEndClosures_(settings, thisYear - 1, thisYear + 3);

  var merged = {};
  // 手入力を最優先（振替出勤の指定が祝日に勝てるようにする）
  manual.concat(fetched).concat(yearEnd).forEach(function (r) {
    if (!r.key) return;
    if (!merged[r.key]) merged[r.key] = r;
  });

  var rows = Object.keys(merged).sort().map(function (k) {
    return { '日付': keyToSheetDate_(k), '名称': merged[k].name, '種別': merged[k].kind };
  });
  replaceTable_(SHEET.HOLIDAY, rows);

  if (fetchError) {
    log_('休日同期', false, '祝日CSVを取得できませんでした（既存の祝日行を維持）: ' + fetchError);
  } else {
    log_('休日同期', true, rows.length + '件');
  }
  return { count: rows.length, error: fetchError };
}

/** 内閣府の祝日CSVを取得して [{key,name,kind}] を返す */
function fetchNationalHolidays_(settings, fromKey, toKey) {
  var url = settingText_(settings, '祝日CSV_URL', 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv');
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    throw new Error('HTTP ' + res.getResponseCode());
  }
  // 内閣府CSVは Shift_JIS
  var text;
  try {
    text = res.getBlob().getDataAsString('Shift_JIS');
  } catch (e) {
    text = res.getContentText();
  }
  return parseHolidayCsv_(text, fromKey, toKey);
}

/**
 * 祝日CSVを解析する（純粋関数）。
 * 形式: 「国民の祝日・休日月日,国民の祝日・休日名称」のヘッダー＋ "2026/1/1,元日" の行
 */
function parseHolidayCsv_(text, fromKey, toKey) {
  var out = [];
  String(text).split(/\r\n|\r|\n/).forEach(function (line) {
    if (!line) return;
    var cols = line.split(',');
    if (cols.length < 2) return;
    var m = /^\s*(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\s*$/.exec(cols[0]);
    if (!m) return; // ヘッダー行など
    var key = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
    if (fromKey && key < fromKey) return;
    if (toKey && key > toKey) return;
    out.push({ key: key, name: String(cols[1]).trim(), kind: '祝日' });
  });
  return out;
}

/** 「12/29-1/3」形式の年末年始閉庁日を年ごとに展開する（純粋関数） */
function buildYearEndClosures_(settings, fromYear, toYear) {
  // 設定を空にしたら「年末年始の閉庁を設定しない」の意味なので、既定値へ戻さない
  var spec = settingText_(settings, '年末年始休', '');
  if (!spec) return [];
  var m = /^(\d{1,2})\/(\d{1,2})-(\d{1,2})\/(\d{1,2})$/.exec(normalizeText(spec));
  if (!m) {
    log_('休日同期', false, '年末年始休の書式が不正です（例: 12/29-1/3）: ' + spec);
    return [];
  }
  var out = [];
  for (var y = fromYear; y <= toYear; y++) {
    var startKey = y + '-' + pad2_(m[1]) + '-' + pad2_(m[2]);
    var endYear = Number(m[3]) < Number(m[1]) ? y + 1 : y;
    var endKey = endYear + '-' + pad2_(m[3]) + '-' + pad2_(m[4]);
    var cur = startKey;
    var guard = 0;
    while (cur <= endKey && guard++ < 40) {
      out.push({ key: cur, name: '年末年始（閉庁）', kind: '年末年始' });
      cur = addCalendarDays(cur, 1);
    }
  }
  return out;
}

function pad2_(v) { var n = Number(v); return n < 10 ? '0' + n : String(n); }
