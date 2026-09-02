/**
 * メニュー・画面表示・シート上の操作
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📅 業務スケジュール')
    .addItem('スケジュール画面を開く', 'showGantt')
    .addItem('別ウィンドウで開く（URLを表示）', 'showAppUrl')
    .addItem('WebアプリのURLを登録', 'menuSetAppUrl')
    .addSeparator()
    .addItem('工程テンプレートを編集', 'showTemplateEditor')
    .addItem('工程表を再生成', 'menuGenerate')
    .addItem('休日を取り込む', 'menuSyncHolidays')
    .addItem('カレンダーに同期', 'menuSyncCalendar')
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
  var settings = getSettings_();
  var saved = normalizeWebAppUrl_(settingText_(settings, 'WebアプリURL', ''));
  var deployed = '';
  try {
    deployed = ScriptApp.getService().getUrl() || '';
  } catch (e) {
    deployed = '';
  }
  var url = saved || deployed;

  var body;
  if (url) {
    var editorUrl = url + '?page=editor';
    body =
      '<div style="font-family:system-ui,sans-serif;font-size:13px;line-height:1.8;color:#202124">'
      + '<p>次のURLを開くと、それぞれの画面だけを別のタブで表示できます。<br>'
      + 'ウィンドウの大きさは自由に変えられます。ブックマークしておくと便利です。</p>'
      + '<p style="margin-bottom:4px"><b>スケジュール画面</b><br>'
      + '<a href="' + url + '" target="_blank" rel="noopener"'
      + ' style="word-break:break-all;color:#1a73e8">' + url + '</a></p>'
      + '<p style="margin-bottom:4px"><b>工程テンプレートの編集</b><br>'
      + '<a href="' + editorUrl + '" target="_blank" rel="noopener"'
      + ' style="word-break:break-all;color:#1a73e8">' + editorUrl + '</a></p>'
      + '<p style="color:#5f6368;font-size:12px">違いは末尾の <code>?page=editor</code> だけです。'
      + (saved ? '（設定シートに登録されたURLを表示しています）' : '') + '</p>'
      + '<hr style="border:none;border-top:1px solid #dadce0;margin:14px 0">'
      + '<p style="font-size:12px;line-height:1.7;color:#3c4043;margin:0">'
      + '<b>このURLが開けないときは</b><br>'
      + '末尾が <code>/exec</code> のURLは<b>デプロイした時点のコード</b>を動かします。'
      + 'コードを貼り替えても再デプロイしていないと、古いままで開けません。'
      + '次のどちらかで直ります。</p>'
      + '<p style="font-size:12px;line-height:1.7;color:#3c4043;margin:8px 0 0">'
      + '<b>A. 再デプロイする（URLは変わりません）</b><br>'
      + '［拡張機能］→［Apps Script］→［デプロイ］→［デプロイを管理］→ 鉛筆マーク →'
      + ' バージョンを「新しいバージョン」→［デプロイ］</p>'
      + '<p style="font-size:12px;line-height:1.7;color:#3c4043;margin:8px 0 0">'
      + '<b>B. 開けるURLを登録する</b><br>'
      + '［デプロイ］→［デプロイをテスト］に出る末尾 <code>/dev</code> のURLは、'
      + '常に最新のコードで動きます（自分だけが開けます）。'
      + 'そのURLをコピーして、メニューの［WebアプリのURLを登録］に貼り付けてください。</p>'
      + '</div>';
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
  ui.showModalDialog(HtmlService.createHtmlOutput(body).setWidth(600).setHeight(520),
    '別ウィンドウで開く');
}

/**
 * 実際にブラウザで開けた URL を設定シートに登録する。
 *
 * デプロイのURL（/exec）が古いバージョンを指していて開けない場合でも、
 * テスト用URL（/dev）を登録すれば［別ウィンドウで開く］から使える。
 */
function menuSetAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var current = normalizeWebAppUrl_(settingText_(getSettings_(), 'WebアプリURL', ''));
  var res = ui.prompt('WebアプリのURLを登録',
    'ブラウザで実際に開けたURLを貼り付けてください。\n'
    + '末尾が /exec でも /dev でもかまいません。\n'
    + '（?page=editor は付いていても外して登録します）\n\n'
    + (current ? '現在の登録：\n' + current + '\n\n' : '')
    + '空欄のまま［OK］を押すと登録を解除します。',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var input = String(res.getResponseText() || '').trim();
  if (!input) {
    setSetting_('WebアプリURL', '');
    ui.alert('登録を解除しました',
      '以降はデプロイのURLを自動で使います。', ui.ButtonSet.OK);
    return;
  }

  var url = normalizeWebAppUrl_(input);
  if (!url) {
    ui.alert('登録できませんでした',
      'Apps Script のウェブアプリのURLではないようです。\n\n'
      + 'https://script.google.com/macros/s/……/exec\n'
      + 'https://script.google.com/macros/s/……/dev\n\n'
      + 'このどちらかの形で貼り付けてください。', ui.ButtonSet.OK);
    return;
  }

  setSetting_('WebアプリURL', url);
  ui.alert('登録しました', url, ui.ButtonSet.OK);
  showAppUrl();
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
    // 工程表を作り直したらカレンダーもずれるので、ONならその場で合わせる
    try {
      var c = syncCalendarIfEnabled();
      if (!c.skipped) {
        msg += '\nカレンダーも同期しました（作成 ' + c.created
          + ' / 更新 ' + c.updated + ' / 削除 ' + c.removed + '）。';
      }
    } catch (ce) {
      msg += '\n\nカレンダーの同期は失敗しました:\n' + ce.message;
    }
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

/**
 * カレンダーへ今すぐ同期する。
 * 自動では毎日1時（nightlyRefresh）にしか走らないため、
 * 日中に直した内容をすぐ反映したいときはここから実行する。
 */
function menuSyncCalendar() {
  var ui = SpreadsheetApp.getUi();
  var settings = getSettings_();

  if (!settingBool_(settings, 'カレンダー同期', false)) {
    ui.alert('カレンダー同期はOFFです',
      '［設定］シートの「カレンダー同期」を ON にしてから実行してください。\n\n'
      + 'あわせて appsscript.json の oauthScopes に\n'
      + 'https://www.googleapis.com/auth/calendar\n'
      + 'を追加し、承認をやり直す必要があります。',
      ui.ButtonSet.OK);
    return;
  }

  try {
    var r = syncCalendar();
    ui.alert('カレンダーに同期しました',
      '作成 ' + r.created + ' 件／更新 ' + r.updated + ' 件／削除 ' + r.removed + ' 件\n\n'
      + '（自動では毎日1時に同じ処理が走ります）',
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('同期できませんでした', e.message, ui.ButtonSet.OK);
  }
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
