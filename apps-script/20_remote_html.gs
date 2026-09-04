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
 * HTML を1枚返す。
 * GitHub から読む設定なら取りに行き、だめならプロジェクト内のファイルを使う。
 * @param {string} name 'gantt' または 'editor'
 */
function loadHtml_(name, settings) {
  settings = settings || getSettings_();
  if (!settingBool_(settings, '画面をGitHubから読み込む', false)) {
    return HtmlService.createTemplateFromFile(name);
  }

  var text = fetchRemoteHtml_(name, settings);
  if (!text) return HtmlService.createTemplateFromFile(name);
  return HtmlService.createTemplate(text);
}

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
