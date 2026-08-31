/**
 * メニュー・画面表示・シート上の操作
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📅 業務スケジュール')
    .addItem('ガント画面を開く', 'showGantt')
    .addSeparator()
    .addItem('工程テンプレートを編集', 'showTemplateEditor')
    .addItem('工程表を再生成', 'menuGenerate')
    .addItem('休日を取り込む', 'menuSyncHolidays')
    .addSeparator()
    .addItem('Chatにテスト通知', 'menuTestNotify')
    .addItem('通知トリガーを再設定', 'menuInstallTriggers')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('テンプレートの受け渡し')
      .addItem('書き出す（JSON）', 'showTemplateExport')
      .addItem('読み込む（JSON）', 'showTemplateImport'))
    .addSeparator()
    .addItem('初期セットアップ', 'menuSetup')
    .addToUi();
}

function showGantt() {
  var html = HtmlService.createTemplateFromFile('gantt')
    .evaluate()
    .setWidth(1400)
    .setHeight(880);
  SpreadsheetApp.getUi().showModalDialog(html, '業務スケジュール');
}

function showTemplateEditor() {
  var html = HtmlService.createTemplateFromFile('editor')
    .evaluate()
    .setWidth(1100)
    .setHeight(800);
  SpreadsheetApp.getUi().showModalDialog(html, '工程テンプレートの編集');
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
