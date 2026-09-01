/**
 * 日次リマインドの内容を組み立てる（純粋関数）
 *
 * 「遅延」「本日」「まもなく」の3区分に振り分ける。
 * 区分の判定は工程ごとの「リマインド営業日前」に従う。
 */

/**
 * @param {Array<Object>} rows {workId, workName, color, period, seq, name, dueKey, owner, status, remindDays, note}
 * @param {Object} cal 営業日カレンダー
 * @param {string} todayKey 'YYYY-MM-DD'
 * @param {Object} opts {maxAheadBusinessDays:number, includeDone:boolean}
 * @return {{overdue:Array, today:Array, soon:Array, total:number}}
 */
function buildDigest(rows, cal, todayKey, opts) {
  opts = opts || {};
  var maxAhead = opts.maxAheadBusinessDays === undefined ? 14 : Number(opts.maxAheadBusinessDays);
  var includeDone = !!opts.includeDone;
  // 呼び出し側が営業日数の表を用意していればそれを使う（件数が多いときに効く）
  var countFrom = opts.counter || function (key) { return countBusinessDays(cal, todayKey, key); };

  var overdue = [], today = [], soon = [];

  rows.forEach(function (r) {
    if (!r.dueKey) return;
    var status = String(r.status || '').trim();
    if (!includeDone && (status === STATUS.DONE || status === STATUS.SKIP)) return;

    var remaining = countFrom(r.dueKey);
    var item = {
      workId: r.workId,
      workName: r.workName,
      color: r.color,
      period: r.period,
      seq: r.seq,
      name: r.name,
      dueKey: r.dueKey,
      owner: r.owner || '',
      status: status,
      note: r.note || '',
      remainingBusinessDays: remaining
    };

    if (r.dueKey < todayKey) {
      overdue.push(item);
      return;
    }
    if (r.dueKey === todayKey) {
      today.push(item);
      return;
    }
    var lead = Number(r.remindDays);
    if (isNaN(lead) || lead < 0) return;
    if (remaining <= Math.min(lead, maxAhead)) soon.push(item);
  });

  var byDue = function (a, b) {
    if (a.dueKey !== b.dueKey) return a.dueKey < b.dueKey ? -1 : 1;
    return (Number(a.seq) || 0) - (Number(b.seq) || 0);
  };
  overdue.sort(byDue);
  today.sort(byDue);
  soon.sort(byDue);

  return { overdue: overdue, today: today, soon: soon, total: overdue.length + today.length + soon.length };
}

/** 'YYYY-MM-DD' -> '9/12(金)' */
function formatShortDate(key) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  return Number(m[2]) + '/' + Number(m[3]) + '(' + WEEKDAY_LABELS[dayOfWeek(key)] + ')';
}

/** 1件分の表示行 */
function formatDigestLine(item, kind) {
  var head;
  if (kind === 'overdue') {
    head = '<b>' + formatShortDate(item.dueKey) + '</b> ' + Math.abs(item.remainingBusinessDays) + '営業日超過';
  } else if (kind === 'today') {
    head = '<b>本日</b>';
  } else {
    head = '<b>' + formatShortDate(item.dueKey) + '</b> あと' + item.remainingBusinessDays + '営業日';
  }
  var tail = item.owner ? '（' + item.owner + '）' : '';
  return head + '　' + item.workName + ' ' + item.period + '\n　' + item.name + tail;
}

/**
 * Google Chat へ投稿する本文（テキスト形式）を組み立てる。
 * カード形式より崩れにくく、スマホでも読みやすい。
 */
function buildChatText(digest, todayKey) {
  if (!digest.total) return '';
  var lines = [];
  lines.push('*' + formatShortDate(todayKey) + ' の業務スケジュール*');

  if (digest.overdue.length) {
    lines.push('');
    lines.push('🔴 *期限超過 ' + digest.overdue.length + '件*');
    digest.overdue.forEach(function (i) { lines.push(chatLine_(i, 'overdue')); });
  }
  if (digest.today.length) {
    lines.push('');
    lines.push('🟡 *本日 ' + digest.today.length + '件*');
    digest.today.forEach(function (i) { lines.push(chatLine_(i, 'today')); });
  }
  if (digest.soon.length) {
    lines.push('');
    lines.push('🔵 *まもなく ' + digest.soon.length + '件*');
    digest.soon.forEach(function (i) { lines.push(chatLine_(i, 'soon')); });
  }
  return lines.join('\n');
}

function chatLine_(item, kind) {
  var when;
  if (kind === 'overdue') {
    when = formatShortDate(item.dueKey) + ' 期限・' + Math.abs(item.remainingBusinessDays) + '営業日超過';
  } else if (kind === 'today') {
    when = '本日';
  } else {
    when = formatShortDate(item.dueKey) + '・あと' + item.remainingBusinessDays + '営業日';
  }
  var owner = item.owner ? ' 〈' + item.owner + '〉' : '';
  return '• *' + item.name + '*' + owner + '\n　' + item.workName + ' ' + item.period + '｜' + when;
}
