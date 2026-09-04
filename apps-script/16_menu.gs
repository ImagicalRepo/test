/**
 * メニュー・画面表示・シート上の操作
 */

function onOpen() {
  var menu = SpreadsheetApp.getUi()
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
    .addItem('配布用に整える', 'menuPrepareTemplate');

  // 画面を外から取り込む部品を入れているときだけ足す。配布用ビルドには無い
  if (typeof addExtraMenu_ === 'function') addExtraMenu_(menu);
  menu.addToUi();
}

/**
 * ダイアログの大きさは Apps Script の仕様上あとから変えられないため、
 * 設定シートの「画面の幅 / 画面の高さ」で指定できるようにしている。
 * 本当に自由な大きさで使いたい場合はウェブアプリとして開く（showAppUrl 参照）。
 */
function showGantt() {
  var settings = getSettings_();
  var html = loadHtml_('gantt', settings)
    .evaluate()
    .setWidth(clampSize_(settingNumber_(settings, '画面の幅', 1400), 800, 2000))
    .setHeight(clampSize_(settingNumber_(settings, '画面の高さ', 800), 480, 1400));
  SpreadsheetApp.getUi().showModalDialog(html, '業務スケジュール');
}

function showTemplateEditor() {
  var settings = getSettings_();
  var html = loadHtml_('editor', settings)
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

/**
 * 配る用のシートに整える。
 *
 * このシートをコピーして使ってもらう配り方をするとき、配布者の環境に固有の値が
 * そのままコピー先へ引き継がれてしまう。特に次の2つは実害がある。
 *
 *   ChatWebhookURL … コピーした全員が配布者のChatスペースへ通知を投げる
 *   WebアプリURL   … /exec は配布者の権限で動くため、開くと配布者のシートが見える
 *
 * あわせて業務データと履歴を空にし、コピー先で［初期セットアップ］を実行しても
 * サンプルが入り直さないようにする。休日マスタとその他の設定は残す。
 */
function menuPrepareTemplate() {
  var ui = SpreadsheetApp.getUi();
  var counts = {
    work: readTable_(SHEET.WORK).rows.length,
    tpl: readTable_(SHEET.TEMPLATE).rows.length,
    anchor: readTable_(SHEET.ANCHOR).rows.length,
    sched: readTable_(SHEET.SCHEDULE).rows.length
  };
  var settings = getSettings_();
  var hasChat = !!settingText_(settings, 'ChatWebhookURL', '');
  var hasApp = !!settingText_(settings, 'WebアプリURL', '');

  var ok = ui.alert('配布用に整えます',
    'このシートを「コピーして使ってもらう元」にします。次を消します。\n\n'
    + '　・業務マスタ ' + counts.work + '件 / 工程テンプレート ' + counts.tpl + '件\n'
    + '　・基準日 ' + counts.anchor + '件 / 工程表 ' + counts.sched + '行\n'
    + '　・実行ログ と 更新履歴\n'
    + (hasChat ? '　・ChatWebhookURL（コピーした人が、あなたのスペースへ通知しないように）\n' : '')
    + (hasApp ? '　・WebアプリURL（コピーした人に、あなたのシートが見えないように）\n' : '')
    + '\n休日マスタとその他の設定は残します。\n'
    + 'この操作は元に戻せません。よろしいですか？',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  resetBusinessData();
  replaceTable_(SHEET.LOG, []);
  // 更新履歴シートは任意の部品を入れたときだけ存在する（第2引数は「無くてもよい」）
  if (getSheet_(SHEET.UPDATE, true)) replaceTable_(SHEET.UPDATE, []);
  setSetting_('ChatWebhookURL', '');
  setSetting_('WebアプリURL', '');
  setSetting_('サンプルを入れる', 'OFF');
  log_('配布用に整える', true,
    '業務 ' + counts.work + '件 / 工程 ' + counts.tpl + '件 / 工程表 ' + counts.sched + '行 を消去');

  ui.alert('配布用に整えました',
    'このあとの配り方です。\n\n'
    + '1. ［共有］→「リンクを知っている全員」→ 権限は「閲覧者」\n'
    + '2. URL の末尾 /edit を /copy に変えて配る\n'
    + '     https://docs.google.com/spreadsheets/d/<ID>/copy\n\n'
    + '受け取った人の手順\n'
    + '　［コピーを作成］→ 再読み込み →［初期セットアップ］→ 承認\n\n'
    + 'コピーには引き継がれないもの（各自で必要）\n'
    + '　・通知トリガー（初期セットアップで登録されます）\n'
    + '　・ウェブアプリのデプロイ\n'
    + '　・Chat の Webhook URL\n'
    + '　・Google アカウントの承認',
    ui.ButtonSet.OK);
}
