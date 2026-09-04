/**
 * 画面（HTML）を GitHub から読み込む（任意機能・既定 OFF）
 *
 * コードを直したびに3ファイルを貼り直すのは手間なので、
 * スケジュール画面と編集画面だけは GitHub から取ってこられるようにする。
 * 追加の権限は要らない（script.external_request は祝日CSVで承認済み）。
 *
 * 取れなかったときは必ずプロジェクト内のファイルに戻すので、
 * ネットワークが遮断されていても画面は開く。
 */

/** 取得を許すホスト。ここ以外は拒否する */
var REMOTE_HOST = 'https://raw.githubusercontent.com/';

/**
 * GitHub から取ってくる HTML。
 * json（テンプレートの受け渡し）を外していたため、コード.gs だけ貼り替えた人の手元で
 * 画面と中身の版が食い違い、読み込みボタンが効かない不具合になっていた。
 */
var REMOTE_FILES = ['gantt', 'editor', 'json'];

/** キャッシュの保持時間（秒）。毎回取りに行くと画面が開くまで待たされる */
var REMOTE_CACHE_SEC = 3600;

/**
 * この部品を入れたときだけ増える設定と、シート。
 * 配布用ビルドではこのファイルごと外すので、設定にもシートにも現れない。
 */
var EXTRA_SETTINGS = [
  ['画面をGitHubから読み込む', 'OFF', 'ON にすると、画面のHTML（gantt・editor・json）を下のURLから読み込む。コードを貼り直す手間が減る。取得できないときはプロジェクト内のファイルを使う'],
  ['画面の取得元URL', 'https://raw.githubusercontent.com/ImagicalRepo/test/claude/rare-disease-subsidy-schedule-21xoll/dist/', 'HTMLの取得元。raw.githubusercontent.com のみ。末尾は / で終わらせる']
];

var EXTRA_SHEET_DEFS = [{
  name: SHEET.UPDATE,
  headers: ['日時', '対象', '版', '取得元', '結果', '内容'],
  widths: [160, 120, 90, 420, 80, 380]
}];

/** 取得元のURL。末尾に / が無くても付ける */
function remoteBase_(settings) {
  var base = settingText_(settings, '画面の取得元URL', '') || '';
  base = String(base).trim();
  if (!base) return '';
  if (base.slice(-1) !== '/') base += '/';
  // 他所のコードを読み込ませないよう、ホストを固定する
  return base.indexOf(REMOTE_HOST) === 0 ? base : '';
}

/**
 * HTML を取得する。取れなければ空文字を返す（呼び出し側で退避する）。
 * 内容が前回と変わったときだけ更新履歴に残す。
 */
function fetchRemoteHtml_(name, settings) {
  var base = remoteBase_(settings);
  if (!base) {
    recordUpdate_(name + '.html', '', '失敗', '取得元URLが正しくありません（raw.githubusercontent.com のみ）');
    return '';
  }

  var url = base + name + '.html';
  var cache = CacheService.getScriptCache();
  var cacheKey = 'html_' + name;
  var cached = null;
  try {
    cached = cache.get(cacheKey);
  } catch (e) {
    cached = null;   // 大きすぎるとキャッシュに入らないことがある
  }
  if (cached) return cached;

  var text = '';
  try {
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) {
      recordUpdate_(name + '.html', '', '失敗', 'HTTP ' + res.getResponseCode() + '　' + url);
      return '';
    }
    text = res.getContentText();
  } catch (e) {
    recordUpdate_(name + '.html', '', '失敗', e.message + '　' + url);
    return '';
  }

  if (text.length < 200) {
    recordUpdate_(name + '.html', '', '失敗', '中身が短すぎます（' + text.length + '文字）　' + url);
    return '';
  }

  try {
    cache.put(cacheKey, text, REMOTE_CACHE_SEC);
  } catch (e) { /* 入らなくても動作に影響はない */ }

  // 取り直すたびに記録すると履歴が埋まるので、中身が変わったときだけ残す
  var props = PropertiesService.getDocumentProperties();
  var sigKey = 'htmlsig_' + name;
  var sig = htmlSignature_(text);
  if (props.getProperty(sigKey) !== sig) {
    props.setProperty(sigKey, sig);
    recordUpdate_(name + '.html', htmlVersion_(text), '更新', text.length + '文字を取り込みました　' + url);
  }
  return text;
}

/** 中身が変わったかどうかの判定に使う短い指紋 */
function htmlSignature_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2);
  }).join('');
}

/** HTML の先頭に埋め込んだ版表記を拾う（無ければ空） */
function htmlVersion_(text) {
  var m = /<!--\s*version:\s*([0-9A-Za-z.\-_]+)\s*-->/.exec(String(text).slice(0, 500));
  return m ? m[1] : '';
}

/** キャッシュを捨てて次回に取り直させる */
function clearRemoteHtmlCache_() {
  var cache = CacheService.getScriptCache();
  REMOTE_FILES.forEach(function (n) {
    try { cache.remove('html_' + n); } catch (e) { /* 無視 */ }
  });
}

/** 更新履歴シートに1行足す */
function recordUpdate_(target, version, result, detail) {
  try {
    appendRows_(SHEET.UPDATE, [{
      '日時': new Date(),
      '対象': target,
      '版': version || '',
      '取得元': settingText_(getSettings_(), '画面の取得元URL', '') || '',
      '結果': result,
      '内容': detail || ''
    }]);
  } catch (e) {
    console.warn('更新履歴に書けませんでした: ' + e.message);
  }
}

/**
 * GitHub 側の版を調べて、いまの版と比べる。
 * dist/version.json（{"version":"1.1.0"}）を置いておく前提。
 */
function checkForUpdate() {
  var settings = getSettings_();
  var base = remoteBase_(settings);
  if (!base) {
    return { ok: false, message: '［設定］シートの「画面の取得元URL」が正しくありません。' };
  }
  try {
    var res = UrlFetchApp.fetch(base + 'version.json', { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      return { ok: false, message: '版の情報を取得できませんでした（HTTP ' + res.getResponseCode() + '）。' };
    }
    var latest = String(JSON.parse(res.getContentText()).version || '').trim();
    return {
      ok: true,
      current: VERSION,
      latest: latest,
      newer: !!latest && latest !== VERSION
    };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * GitHub から画面を取り直す。
 * キャッシュを捨てるだけで、次に画面を開いたときに新しいものが読まれる。
 */
function menuRefreshHtml() {
  var ui = SpreadsheetApp.getUi();
  var settings = getSettings_();
  if (!settingBool_(settings, '画面をGitHubから読み込む', false)) {
    ui.alert('GitHubからの読み込みはOFFです',
      '［設定］シートの「画面をGitHubから読み込む」を ON にすると、\n'
      + 'スケジュール画面と編集画面のHTMLを貼り直さなくてよくなります。\n\n'
      + '取得できないときは、これまでどおりプロジェクト内のファイルを使います。',
      ui.ButtonSet.OK);
    return;
  }
  clearRemoteHtmlCache_();

  // その場で取りに行き、結果をここで見せる（次に開くまで分からないと不安なので）
  var got = [];
  var failed = [];
  REMOTE_FILES.forEach(function (n) {
    var text = fetchRemoteHtml_(n, settings);
    if (text) got.push(n + '.html（' + text.length + '文字）');
    else failed.push(n + '.html');
  });

  ui.alert(failed.length ? '一部を取得できませんでした' : '取り込みました',
    (got.length ? '取得できたもの:\n　' + got.join('\n　') + '\n\n' : '')
    + (failed.length
      ? '取得できなかったもの:\n　' + failed.join('\n　')
      + '\n\nこれらはプロジェクト内のファイルを使います。\n'
      + '詳しい理由は［更新履歴］シートを見てください。'
      : '次に画面を開くと反映されます。\n記録は［更新履歴］シートに残ります。'),
    ui.ButtonSet.OK);
}

/** GitHub 側の版と比べて、更新があるか知らせる */
function menuCheckUpdate() {
  var ui = SpreadsheetApp.getUi();
  var r = checkForUpdate();
  if (!r.ok) {
    ui.alert('確認できませんでした', r.message, ui.ButtonSet.OK);
    return;
  }
  if (r.newer) {
    ui.alert('新しい版があります',
      'いまの版：' + r.current + '\n最新の版：' + r.latest + '\n\n'
      + 'GitHub の dist から コード.gs を貼り直してください。\n'
      + '（画面のHTMLは「画面をGitHubから読み込む」が ON なら自動で更新されます）',
      ui.ButtonSet.OK);
  } else {
    ui.alert('最新です', 'いまの版：' + r.current, ui.ButtonSet.OK);
  }
}

// ---- 呼び出し側から見た入口 ----
// 本体（16_menu.gs / 17_webapp.gs / 19_diagnostics.gs）は typeof で見て分岐する。
// このファイルごと外した配布用ビルドでは、どれも呼ばれない。

/** 画面のHTMLを外から取り込む。使わない設定・取れなかったときは null */
function extraHtmlTemplate_(name, settings) {
  settings = settings || getSettings_();
  if (!settingBool_(settings, '画面をGitHubから読み込む', false)) return null;
  var text = fetchRemoteHtml_(name, settings);
  return text ? HtmlService.createTemplate(text) : null;
}

/** メニューに、取り込み関係の項目を足す */
function addExtraMenu_(menu) {
  menu.addSeparator()
    .addItem('画面を最新にする', 'menuRefreshHtml')
    .addItem('更新を確認', 'menuCheckUpdate');
}

/** 動作診断の「画面の取得元」の行 */
function extraDiagnostics_() {
  var settings = getSettings_();
  if (!settingBool_(settings, '画面をGitHubから読み込む', false)) {
    return 'プロジェクト内のファイル（版 ' + VERSION + '）';
  }
  var base = remoteBase_(settings);
  if (!base) return 'ON だが取得元URLが不正（' + REMOTE_HOST + ' のみ）';
  var got = REMOTE_FILES.filter(function (n) {
    return !!fetchRemoteHtml_(n, settings);
  });
  return got.length + '/' + REMOTE_FILES.length + ' 取得可（版 ' + VERSION + '）　' + base;
}
