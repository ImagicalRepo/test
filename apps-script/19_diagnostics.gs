/**
 * 動作診断
 *
 * 画面が開かない・通知が来ないといったときに、どこで止まっているかを切り分ける。
 * メニュー［動作診断］から実行するか、エディタで runDiagnostics を直接実行する。
 */

function runDiagnostics() {
  var lines = [];
  var total = 0;

  function step(name, fn) {
    var start = new Date().getTime();
    var result, ok = true;
    try {
      result = fn();
    } catch (e) {
      ok = false;
      result = e.message;
    }
    var ms = new Date().getTime() - start;
    total += ms;
    lines.push((ok ? 'OK ' : 'NG ') + pad_(name, 22) + pad_(ms + 'ms', 8) + result);
    return ok;
  }

  step('スプレッドシート', function () {
    var s = ss_();
    return s.getName() + '（' + s.getSpreadsheetTimeZone() + '）';
  });

  [SHEET.SETTINGS, SHEET.WORK, SHEET.TEMPLATE, SHEET.ANCHOR, SHEET.SCHEDULE, SHEET.HOLIDAY].forEach(function (name) {
    step('シート: ' + name, function () {
      return readTable_(name).rows.length + ' 行';
    });
  });

  step('営業日カレンダー', function () {
    var cal = loadBusinessCalendar_();
    var today = todayKey_();
    return '本日 ' + today + ' は' + (isBusinessDay(cal, today) ? '営業日' : '休日');
  });

  var payload = null;
  step('画面データの取得', function () {
    payload = getGanttData();
    return '業務 ' + payload.works.length
      + ' / レーン ' + payload.lanes.length
      + ' / 通知 ' + payload.digest.total + ' 件';
  });

  if (payload) {
    step('データ量', function () {
      var size = JSON.stringify(payload).length;
      var stepCount = payload.lanes.reduce(function (n, l) { return n + l.items.length; }, 0);
      return Math.round(size / 1024) + ' KB / 工程 ' + stepCount + ' 件'
        + (size > 3000000 ? '　※大きすぎます。設定シートの先読み月数を減らしてください' : '');
    });
    step('表示範囲', function () {
      return payload.from + ' 〜 ' + payload.to + '（本日 ' + payload.today + '）';
    });
  }

  step('別ウィンドウのURL', function () {
    var saved = normalizeWebAppUrl_(settingText_(getSettings_(), 'WebアプリURL', ''));
    if (saved) return '登録済み ' + saved;
    var deployed = '';
    try {
      deployed = ScriptApp.getService().getUrl() || '';
    } catch (e) {
      deployed = '';
    }
    if (!deployed) return '未デプロイ（メニューの［別ウィンドウで開く］の手順を参照）';
    return 'デプロイのURL ' + deployed
      + '　※開けない場合は再デプロイするか［WebアプリのURLを登録］で /dev のURLを登録';
  });

  step('Chat通知の設定', function () {
    var url = settingText_(getSettings_(), 'ChatWebhookURL', '');
    if (!url) return '未設定（通知は送られません）';
    return /^https:\/\/chat\.googleapis\.com\//.test(url) ? '設定済み' : '形式が正しくありません';
  });

  step('トリガー', function () {
    var names = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
    return names.length ? names.join(', ') : 'なし（［通知トリガーを再設定］を実行してください）';
  });

  var text = lines.join('\n') + '\n\n合計 ' + total + 'ms';
  console.log(text);
  log_('動作診断', lines.filter(function (l) { return l.indexOf('NG') === 0; }).length === 0, text.replace(/\n/g, ' / '));
  return text;
}

function pad_(s, n) {
  s = String(s);
  while (s.length < n) s += ' ';
  return s;
}

/** メニューから実行し、結果をダイアログで表示する */
function menuDiagnostics() {
  var ui = SpreadsheetApp.getUi();
  var text;
  try {
    text = runDiagnostics();
  } catch (e) {
    text = '診断そのものが失敗しました:\n' + e.message + '\n\n' + (e.stack || '');
  }
  var html = HtmlService.createHtmlOutput(
    '<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;'
    + 'line-height:1.6;white-space:pre-wrap;margin:0">'
    + text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    + '</pre>').setWidth(640).setHeight(520);
  ui.showModalDialog(html, '動作診断');
}
