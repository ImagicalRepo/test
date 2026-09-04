/**
 * Google Chat への通知
 *
 * Chat のスペースで［アプリと連携］→［Webhook を作成］して得た URL を
 * 設定シートの ChatWebhookURL に貼るだけで動く。
 */

function dailyReminder() {
  var settings = getSettings_();
  var cal = loadBusinessCalendar_(settings);
  var today = todayKey_();

  if (settingBool_(settings, '休日は通知しない', true) && !isBusinessDay(cal, today)) {
    log_('日次リマインド', true, '休日のためスキップ: ' + today);
    return { skipped: true };
  }

  var digest = buildDigestFromSheet_(settings, cal, today);
  if (!digest.total) {
    log_('日次リマインド', true, '通知対象なし');
    return { total: 0 };
  }

  var text = buildChatText(digest, today, webAppUrl_('', settings), scheduleTitle_(settings));
  var res = postToChat_(settings, text);
  log_('日次リマインド', res.ok,
    '超過 ' + digest.overdue.length + ' / 本日 ' + digest.today.length + ' / まもなく ' + digest.soon.length
    + (res.ok ? '' : ' / ' + res.message));
  return { total: digest.total, posted: res.ok, message: res.message };
}

/** 工程表シートからダイジェストを組み立てる */
function buildDigestFromSheet_(settings, cal, today) {
  var colorByWork = {};
  readTable_(SHEET.WORK).rows.forEach(function (w, i) {
    colorByWork[String(w['業務ID']).trim()] = w['色'] || COLOR_ORDER[i % COLOR_ORDER.length];
  });

  var backMonths = settingNumber_(settings, '過去保持月数', 3);
  var minKey = shiftMonthKey_(today, -backMonths);
  var defaultRemind = settingNumber_(settings, '既定リマインド営業日前', 3);

  var rows = readTable_(SHEET.SCHEDULE).rows.map(function (r) {
    var dueKey = toDateKey(r['予定日']);
    if (!dueKey || dueKey < minKey) return null;
    var remind = r['リマインド営業日前'];
    return {
      key: String(r['キー']).trim(),
      workId: String(r['業務ID']).trim(),
      workName: String(r['業務名'] || ''),
      color: colorByWork[String(r['業務ID']).trim()],
      period: periodText_(r['回次']),
      seq: Number(r['工程No']) || 0,
      name: String(r['工程名'] || ''),
      dueKey: dueKey,
      owner: String(r['担当'] || ''),
      status: String(r['状態'] || ''),
      note: String(r['備考'] || ''),
      remindDays: (remind === '' || remind === null || remind === undefined) ? defaultRemind : Number(remind)
    };
  }).filter(Boolean);

  var minSeen = today, maxSeen = today;
  rows.forEach(function (r) {
    if (r.dueKey < minSeen) minSeen = r.dueKey;
    if (r.dueKey > maxSeen) maxSeen = r.dueKey;
  });

  return buildDigest(rows, cal, today, {
    maxAheadBusinessDays: settingNumber_(settings, 'リマインド対象日数', 14),
    includeDone: false,
    counter: createBusinessDayCounter(cal, today, minSeen, maxSeen)
  });
}

/** Chat Webhook へ投稿する */
function postToChat_(settings, text) {
  var url = settingText_(settings, 'ChatWebhookURL', '');
  if (!url) {
    return { ok: false, message: 'ChatWebhookURL が未設定です。設定シートに Webhook URL を貼ってください。' };
  }
  if (!/^https:\/\/chat\.googleapis\.com\//.test(url)) {
    return { ok: false, message: 'ChatWebhookURL が Google Chat の Webhook URL ではありません。' };
  }
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, message: '' };
    return { ok: false, message: 'Chat投稿に失敗 HTTP ' + code + ': ' + res.getContentText().slice(0, 300) };
  } catch (e) {
    return { ok: false, message: 'Chat投稿に失敗: ' + e.message };
  }
}

/** メニューから叩く：いまの内容でテスト投稿する */
function sendTestNotification() {
  var settings = getSettings_();
  var cal = loadBusinessCalendar_(settings);
  var today = todayKey_();
  var digest = buildDigestFromSheet_(settings, cal, today);
  var title = scheduleTitle_(settings);
  var text = digest.total
    ? buildChatText(digest, today, webAppUrl_('', settings), title)
    : '*' + formatShortDate(today) + ' の' + title + '*\n\n通知対象の工程はありません。';
  var res = postToChat_(settings, text);
  log_('テスト通知', res.ok, res.message || '送信しました');
  return res;
}
