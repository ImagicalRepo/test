/**
 * Googleカレンダー同期（任意機能・既定OFF）
 *
 * 既定ではカレンダー権限を要求しない構成にしてある。
 * 使う場合は appsscript.json の oauthScopes に
 *   "https://www.googleapis.com/auth/calendar"
 * を追加し、設定シートの「カレンダー同期」を ON にする。
 */

function syncCalendarIfEnabled() {
  var settings = getSettings_();
  if (!settingBool_(settings, 'カレンダー同期', false)) return { skipped: true };
  return syncCalendar();
}

function syncCalendar() {
  var settings = getSettings_();
  if (typeof CalendarApp === 'undefined') {
    var msg = 'カレンダー権限が付与されていません。appsscript.json の oauthScopes に calendar を追加してください。';
    log_('カレンダー同期', false, msg);
    throw new Error(msg);
  }

  var calId = settingText_(settings, 'カレンダーID', '');
  var cal = calId ? CalendarApp.getCalendarById(calId) : CalendarApp.getDefaultCalendar();
  if (!cal) throw new Error('カレンダーを取得できません: ' + calId);

  var t = readTable_(SHEET.SCHEDULE);
  var idx = headerIndex_(t.headers);
  if (!idx['イベントID']) throw new Error('工程表に「イベントID」列がありません');

  var today = todayKey_();
  var fromKey = shiftMonthKey_(today, -1);
  var created = 0, updated = 0, removed = 0;
  var eventIdValues = [];

  t.rows.forEach(function (r) {
    var eventId = String(r['イベントID'] || '').trim();
    var dueKey = toDateKey(r['予定日']);
    var endKey = toDateKey(r['終了日']);
    var status = String(r['状態'] || '').trim();
    var period = periodText_(r['回次']);
    var title = '【' + r['業務名'] + (period ? ' ' + period : '') + '】' + r['工程名'];
    var wanted = dueKey && dueKey >= fromKey && status !== STATUS.SKIP;

    if (!wanted) {
      if (eventId) {
        try { var ev = cal.getEventById(eventId); if (ev) { ev.deleteEvent(); removed++; } } catch (e) { /* 既に無い */ }
        eventId = '';
      }
      eventIdValues.push([eventId]);
      return;
    }

    var date = keyToSheetDate_(dueKey);
    // 終日イベントの終了日は「翌日」を渡す必要がある
    var endDate = endKey ? keyToSheetDate_(addCalendarDays(endKey, 1)) : null;
    var desc = [
      '担当: ' + (r['担当'] || '—'),
      '状態: ' + status,
      r['備考'] ? '備考: ' + r['備考'] : ''
    ].filter(String).join('\n');

    var event = null;
    if (eventId) {
      try { event = cal.getEventById(eventId); } catch (e) { event = null; }
    }
    if (event) {
      if (event.getTitle() !== title) event.setTitle(title);
      var start = event.getAllDayStartDate();
      if (!start || Utilities.formatDate(start, 'Asia/Tokyo', 'yyyy-MM-dd') !== dueKey) {
        if (endDate) event.setAllDayDates(date, endDate);
        else event.setAllDayDate(date);
      }
      event.setDescription(desc);
      updated++;
    } else {
      event = endDate
        ? cal.createAllDayEvent(title, date, endDate, { description: desc })
        : cal.createAllDayEvent(title, date, { description: desc });
      eventId = event.getId();
      created++;
    }
    eventIdValues.push([eventId]);
  });

  if (eventIdValues.length) {
    t.sheet.getRange(2, idx['イベントID'], eventIdValues.length, 1).setValues(eventIdValues);
  }
  log_('カレンダー同期', true, '作成 ' + created + ' / 更新 ' + updated + ' / 削除 ' + removed);
  return { created: created, updated: updated, removed: removed };
}
