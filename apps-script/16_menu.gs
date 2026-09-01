/**
 * メニュー・画面表示・シート上の操作
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📅 業務スケジュール')
    .addItem('スケジュール画面を開く', 'showGantt')
    .addItem('別ウィンドウで開く（URLを表示）', 'showAppUrl')
    .addSeparator()
    .addItem('工程テンプレートを編集', 'showTemplateEditor')
    .addItem('工程表を再生成', 'menuGenerate')
    .addItem('休日を取り込む', 'menuSyncHolidays')
    .addSeparator()
    .addItem('Chatにテスト通知', 'menuTestNotify')
    .addItem('動作診断', 'menuDiagnostics')
    .addItem('通知トリガーを再設定', 'menuInstallTriggers')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('テンプレートの受け渡し')
      .addItem('書き出す（JSON）', 'showTemplateExport')
      .addItem('読み込む（JSON）', 'showTemplateImport'))
    .addSeparator()
    .addItem('初期セットアップ', 'menuSetup')
    .addItem('サンプルを削除して最初から作る', 'menuReset')
    .addToUi();
}

/**
 * ダイアログの大きさは Apps Script の仕様上あとから変えられないため、
 * 設定シートの「画面の幅 / 画面の高さ」で指定できるようにしている。
 * 本当に自由な大きさで使いたい場合はウェブアプリとして開く（showAppUrl 参照）。
 */
function showGantt() {
  var settings = getSettings_();
  var html = HtmlService.createTemplateFromFile('gantt')
    .evaluate()
    .setWidth(clampSize_(settingNumber_(settings, '画面の幅', 1400), 800, 2000))
    .setHeight(clampSize_(settingNumber_(settings, '画面の高さ', 800), 480, 1400));
  SpreadsheetApp.getUi().showModalDialog(html, '業務スケジュール');
}

function showTemplateEditor() {
  var settings = getSettings_();
  var html = HtmlService.createTemplateFromFile('editor')
    .evaluate()
    .setWidth(clampSize_(settingNumber_(settings, '画面の幅', 1400) - 250, 800, 1700))
    .setHeight(clampSize_(settingNumber_(settings, '画面の高さ', 800), 480, 1400));
  SpreadsheetApp.getUi().showModalDialog(html, '工程テンプレートの編集');
}

function clampSize_(value, min, max) {
  var n = Number(value);
  if (isNaN(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * ウェブアプリとしてデプロイ済みなら、その URL を表示する。
 * ブラウザのタブで開けるので、大きさは自由に変えられ、スプレッドシートを開かずに使える。
 */
function showAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var url = '';
  try {
    url = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    url = '';
  }

  var body;
  if (url) {
    body =
      '<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;color:#202124">'
      + '<p>このURLを開くと、スケジュール画面だけを別のタブで表示できます。<br>'
      + 'ウィンドウの大きさは自由に変えられます。ブックマークしておくと便利です。</p>'
      + '<p><a href="' + url + '" target="_blank" rel="noopener"'
      + ' style="word-break:break-all;color:#1a73e8">' + url + '</a></p>'
      + '<p style="color:#5f6368;font-size:12px">'
      + 'コードを更新したときは、エディタの［デプロイ］→［デプロイを管理］→ 鉛筆マーク →'
      + ' バージョンを「新しいバージョン」にして再デプロイしてください。</p></div>';
  } else {
    body =
      '<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;color:#202124">'
      + '<p>まだウェブアプリとして公開されていません。次の手順で公開できます。</p>'
      + '<ol style="padding-left:1.2em">'
      + '<li>［拡張機能］→［Apps Script］を開く</li>'
      + '<li>右上の［デプロイ］→［新しいデプロイ］</li>'
      + '<li>歯車マーク →［ウェブアプリ］を選ぶ</li>'
      + '<li>次のユーザーとして実行：<b>自分</b></li>'
      + '<li>アクセスできるユーザー：<b>自分のみ</b></li>'
      + '<li>［デプロイ］→ 承認 → 表示された URL をコピー</li>'
      + '</ol>'
      + '<p style="color:#5f6368;font-size:12px">'
      + '公開後にもう一度このメニューを開くと、URL がここに表示されます。</p></div>';
  }
  ui.showModalDialog(HtmlService.createHtmlOutput(body).setWidth(520).setHeight(340),
    'スケジュール画面を別ウィンドウで開く');
}

function menuSetup() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('初期セットアップ',
    'シートの作成・書式設定・休日の取り込み・トリガー登録を行います。\n'
    + '既存のデータは消しません。実行しますか？',
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;
  try {
    var r = setupWorkbook();
    var msg = 'セットアップが完了しました。\n\n'
      + (r.seeded ? '・サンプルの業務と工程テンプレートを入れました\n' : '')
      + '・工程表 ' + r.generate.rows + ' 行を生成しました\n'
      + '・毎日の通知トリガーを登録しました\n\n'
      + '次は［設定］シートの ChatWebhookURL を埋めてください。';
    if (r.generate.errors.length) msg += '\n\n【要確認】\n' + r.generate.errors.join('\n');
    ui.alert('完了', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
  }
}

function menuReset() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert('サンプルを削除して最初から作る',
    '次の4つのシートの中身をすべて削除します。\n\n'
    + '　・業務マスタ\n'
    + '　・工程テンプレート\n'
    + '　・基準日\n'
    + '　・工程表\n\n'
    + '設定・休日マスタ・実行ログはそのまま残ります。\n'
    + '（手入力した閉庁日も残ります）\n\n'
    + 'この操作は元に戻せません。実行しますか？',
    ui.ButtonSet.OK_CANCEL);
  if (res !== ui.Button.OK) return;

  try {
    resetBusinessData();
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    return;
  }
  ui.alert('削除しました',
    '続けて［工程テンプレートを編集］を開きます。\n'
    + '［＋ 業務を追加］から、実際の業務を登録してください。',
    ui.ButtonSet.OK);
  showTemplateEditor();
}

function menuGenerate() {
  try {
    var r = generateSchedules();
    var msg = '基準日を ' + r.anchorsAdded + ' 件追加し、工程表を ' + r.rows + ' 行にしました。';
    if (r.errors.length) msg += '\n\n【要確認】\n' + r.errors.join('\n');
    SpreadsheetApp.getUi().alert('工程表の再生成', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    SpreadsheetApp.getUi().alert('エラー', e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function menuSyncHolidays() {
  var r = syncHolidays();
  var msg = '休日マスタを ' + r.count + ' 件にしました。';
  if (r.error) msg += '\n\n祝日CSVの取得に失敗しました（既存の祝日は維持）:\n' + r.error;
  SpreadsheetApp.getUi().alert('休日の取り込み', msg, SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuTestNotify() {
  var r = sendTestNotification();
  SpreadsheetApp.getUi().alert(
    r.ok ? '送信しました' : '送信できませんでした',
    r.ok ? 'Google Chat のスペースを確認してください。' : r.message,
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuInstallTriggers() {
  var hour = installTriggers();
  SpreadsheetApp.getUi().alert('トリガー設定',
    '毎日 ' + hour + ' 時に Chat へ通知します。\n（毎日 1 時に工程表を自動更新します）',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 工程表の「完」チェックボックスを状態と連動させる（シンプルトリガー）。
 * 追加の権限承認なしで動く。
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET.SCHEDULE) return;
    if (e.range.getRow() < 2) return;

    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
    var idx = {};
    headers.forEach(function (h, i) { if (h) idx[h] = i + 1; });
    if (!idx['完'] || !idx['状態']) return;

    var row = e.range.getRow();
    var col = e.range.getColumn();

    if (col === idx['完']) {
      var checked = e.range.getValue() === true;
      sh.getRange(row, idx['状態']).setValue(checked ? STATUS.DONE : STATUS.NOT_STARTED);
      if (idx['完了日']) sh.getRange(row, idx['完了日']).setValue(checked ? new Date() : '');
    } else if (col === idx['状態']) {
      var status = String(e.range.getValue()).trim();
      sh.getRange(row, idx['完']).setValue(status === STATUS.DONE);
      if (idx['完了日']) {
        var cur = sh.getRange(row, idx['完了日']).getValue();
        if (status === STATUS.DONE && !cur) sh.getRange(row, idx['完了日']).setValue(new Date());
        if (status !== STATUS.DONE) sh.getRange(row, idx['完了日']).setValue('');
      }
    }
  } catch (err) {
    console.warn('onEdit: ' + err.message);
  }
}
