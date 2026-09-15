/* 疑問ノート — iPadOS HIG に準拠した UI
 * 依存ライブラリなし。データは端末内(IndexedDB)。JSON の書き出し / 取り込みで共有。
 */
(() => {
'use strict';

// ============================================================
// 小道具
// ============================================================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (name, cls = '') => `<svg class="g ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const STATUS = { open: '未解決', wip: '確認中', done: '解決' };
const STATUS_ORDER = { open: 0, wip: 1, done: 2 };
const STATUS_VAR = { open: 'var(--red)', wip: 'var(--orange)', done: 'var(--green)' };

const fmt = (t) => {
  if (!t) return '';
  const d = new Date(t), n = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === n.toDateString()) return hm;
  if (d.toDateString() === new Date(n - 864e5).toDateString()) return '昨日';
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
const fmtFull = (t) => { if (!t) return ''; const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

let hudTimer;
function hud(msg) {
  const el = $('#hud'); el.textContent = msg; el.classList.add('on');
  clearTimeout(hudTimer); hudTimer = setTimeout(() => el.classList.remove('on'), 2000);
}

// ============================================================
// 保存
// ============================================================
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('gimon-note', 1);
      r.onupgradeneeded = () => { const d = r.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' }); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  all(store) { return new Promise((res, rej) => { const r = this.db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  put(store, v) { return new Promise((res, rej) => { const t = this.db.transaction(store, 'readwrite'); t.objectStore(store).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  del(store, k) { return new Promise((res, rej) => { const t = this.db.transaction(store, 'readwrite'); t.objectStore(store).delete(k); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
};

// ============================================================
// 状態
// ============================================================
const SYS = { blue: '#007AFF', red: '#FF3B30', orange: '#FF9500', green: '#34C759', indigo: '#5856D6', purple: '#AF52DE', teal: '#30B0C7', pink: '#FF2D55', brown: '#A2845E' };
const DEFAULT_CATS = [
  { id: 'inbox', name: '未分類', color: '#8E8E93' },
  { id: 'c1', name: '受電対応', color: SYS.blue },
  { id: 'c2', name: 'エスカレーション', color: SYS.red },
  { id: 'c3', name: 'システム操作', color: SYS.green },
  { id: 'c4', name: 'シフト・勤怠', color: SYS.indigo },
  { id: 'c5', name: '報告書', color: SYS.orange },
];
const OLD_TAGS = { important: '重要', todo: 'やること', later: 'あとで見る', share: 'みんなにも' };
const PRESET_TAGS = ['重要', 'やること', 'あとで見る', 'みんなにも', '手順', '用語'];
const normTags = (arr) => [...new Set((arr || []).map(t => OLD_TAGS[t] || String(t).replace(/^[⭐☑📌👥]\s*/, '').trim()).filter(Boolean))];

const state = {
  items: [], cats: [], me: '',
  view: { type: 'home', id: null },
  filter: { status: '', q: '' },
  editing: null, dirty: false,
  ink: { tool: 'pen', color: '#1C1C1E', width: 3.5 },
};
const catOf = (id) => state.cats.find(c => c.id === id) || state.cats[0];
const catByName = (name) => state.cats.find(c => c.name === name);
function allTags() {
  const n = {};
  for (const it of state.items) for (const t of it.tags) n[t] = (n[t] || 0) + 1;
  const used = Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b, 'ja'));
  return [...new Set([...used, ...PRESET_TAGS])].map(t => ({ t, n: n[t] || 0 }));
}

// v1 → v2 変換
function migrate(it) {
  if (it.v === 2) { it.tags = normTags(it.tags); return it; }
  const blocks = [];
  if (it.strokes?.length) blocks.push({ id: uid(), type: 'ink', strokes: it.strokes, w: it.padW || 800, h: it.padH || 320 });
  if (it.body?.trim()) blocks.push({ id: uid(), type: 'text', text: it.body });
  const named = typeof it.cat === 'string' && !state.cats.find(x => x.id === it.cat) ? catByName(it.cat) : null;
  return { v: 2, id: it.id, title: it.title || '',
    cat: named ? named.id : (state.cats.find(x => x.id === it.cat) ? it.cat : 'inbox'),
    status: it.status || 'open', tags: normTags(it.tags), pinned: !!it.pinned, blocks: it.blocks || blocks,
    answer: it.answer || '', answeredBy: it.answeredBy || '', answerAt: it.answerAt || (it.answer ? it.updatedAt : 0), answerReadAt: it.answerReadAt || 0,
    history: it.history || [{ at: it.createdAt || now(), by: it.createdBy || '', ev: 'created' }],
    createdAt: it.createdAt || now(), updatedAt: it.updatedAt || now(), createdBy: it.createdBy || '' };
}

async function load() {
  await DB.open();
  const meta = Object.fromEntries((await DB.all('meta')).map(x => [x.key, x.value]));
  state.me = meta.me || '';
  if (Array.isArray(meta.cats) && meta.cats.length && typeof meta.cats[0] === 'object') state.cats = meta.cats;
  else if (Array.isArray(meta.cats)) {
    state.cats = [DEFAULT_CATS[0], ...meta.cats.map((n, i) => ({ id: 'c' + (i + 1), name: n, color: DEFAULT_CATS[(i % 5) + 1].color }))];
    await saveCats();
  } else { state.cats = DEFAULT_CATS.slice(); await saveCats(); }
  if (!state.cats.find(c => c.id === 'inbox')) { state.cats.unshift({ ...DEFAULT_CATS[0] }); await saveCats(); }

  const raw = await DB.all('items');
  state.items = [];
  for (const r of raw) {
    const sig = (r.v || 1) + JSON.stringify(r.tags || []);
    const m = migrate(r);
    state.items.push(m);
    if (m.v + JSON.stringify(m.tags) !== sig) await saveItem(m);
  }
  if (!meta.seeded) { await seed(); await DB.put('meta', { key: 'seeded', value: true }); }
  state.firstRun = !meta.me;
}
const saveCats = () => DB.put('meta', { key: 'cats', value: state.cats });
const saveMeta = (k, v) => DB.put('meta', { key: k, value: v });
const saveItem = (it) => DB.put('items', it);

async function seed() {
  if (state.items.length) return;
  const t = now();
  const it = { v: 2, id: uid(), title: 'このページは削除して大丈夫です', cat: 'inbox', status: 'done', tags: ['あとで見る'], pinned: true,
    blocks: [
      { id: uid(), type: 'text', text: '疑問は1ページに1つ。うまく書こうとせず、その場で残すのがコツです。タイトルも業務も、あとから直せます。' },
      { id: uid(), type: 'check', items: [{ text: '手書きのブロックを足して、指で図を描く', done: true }, { text: '写真で画面や紙の資料を貼る', done: true }, { text: '回答をもらったら「解決」にする', done: false }] },
    ],
    answer: '回答はこの欄に書きます。届いた回答はホームの「新しい回答」に並びます。解決したページは FAQ としてまとめて印刷できます。',
    answeredBy: 'リーダー', answerAt: t, answerReadAt: t,
    history: [{ at: t, by: 'アプリ', ev: 'created' }, { at: t, by: 'リーダー', ev: 'answer' }, { at: t, by: 'アプリ', ev: 'status', v: 'done' }],
    createdAt: t, updatedAt: t, createdBy: 'アプリ' };
  state.items.push(it); await saveItem(it);
}

// ============================================================
// 派生
// ============================================================
const isUnread = (it) => it.answer && it.answerAt > (it.answerReadAt || 0) && it.answeredBy !== state.me;
const blockText = (b) => b.type === 'text' ? b.text : b.type === 'check' ? b.items.map(x => x.text).join(' ') : b.type === 'image' ? (b.caption || '') : '';
const textOf = (it) => [it.title, it.answer, it.answeredBy, it.createdBy, catOf(it.cat)?.name, ...it.tags, ...it.blocks.map(blockText)].join('\n').toLowerCase();
function snippet(it) {
  for (const b of it.blocks) {
    if (b.type === 'text' && b.text.trim()) return b.text.trim().replace(/\s+/g, ' ');
    if (b.type === 'check' && b.items.some(x => x.text.trim())) return b.items.filter(x => x.text.trim()).map(x => x.text).join('、');
  }
  if (it.blocks.some(b => b.type === 'ink' && b.strokes.length)) return '手書きのメモ';
  if (it.blocks.some(b => b.type === 'image')) return '写真';
  return '内容なし';
}
const firstLine = (it) => snippet(it).split(/[。\n]/)[0];
function log(it, ev, v) { it.history = it.history || []; it.history.push({ at: now(), by: state.me, ev, v }); if (it.history.length > 60) it.history.shift(); }

// 関連ページ: タグ共有 > 同じ業務 > 文字の重なり
function grams(s) { const g = new Set(); const t = s.replace(/[\s、。・,.（）()「」【】[\]]/g, ''); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
function related(it, limit = 4) {
  const mine = grams((it.title + ' ' + it.blocks.map(blockText).join(' ')).slice(0, 400).toLowerCase());
  return state.items.filter(o => o.id !== it.id).map(o => {
    const shared = o.tags.filter(t => it.tags.includes(t));
    const og = grams((o.title + ' ' + o.blocks.map(blockText).join(' ')).slice(0, 400).toLowerCase());
    let hit = 0; for (const g of og) if (mine.has(g)) hit++;
    const sim = hit / Math.max(8, Math.min(mine.size, og.size));
    const score = shared.length * 4 + (o.cat === it.cat ? 1.5 : 0) + (o.answer ? .5 : 0) + sim * 10;
    const why = shared.length ? `タグ「${shared[0]}」` : sim > .15 ? '似た内容' : o.cat === it.cat ? '同じ業務' : '';
    return { item: o, score, why };
  }).filter(o => o.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}

function viewItems() {
  const { type, id } = state.view;
  let arr = state.items;
  if (type === 'cat') arr = arr.filter(i => i.cat === id);
  if (type === 'tag') arr = arr.filter(i => i.tags.includes(id));
  if (type === 'pinned') arr = arr.filter(i => i.pinned);
  if (type === 'unread') arr = arr.filter(isUnread);
  const { status, q } = state.filter; const qq = q.trim().toLowerCase();
  if (status) arr = arr.filter(i => i.status === status);
  if (qq) arr = arr.filter(i => textOf(i).includes(qq));
  return arr.slice().sort((a, b) => (b.pinned - a.pinned) || (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.updatedAt - a.updatedAt));
}

// ============================================================
// 提示: ポップオーバー / アラート / フォームシート
// ============================================================
const layers = [];
function dismissTop() { const top = layers.pop(); if (top) top.close(); }
const isCompact = () => window.innerWidth <= 700;

function popover(anchor, items, onPick) {
  const compact = isCompact();
  const scrim = document.createElement('div');
  scrim.className = 'scrim' + (compact ? ' dim' : '');
  const pop = document.createElement('div');
  pop.className = 'popover';
  pop.setAttribute('role', 'menu');
  pop.innerHTML = items.map((m, i) => `
    <button class="menu-item ${m.style === 'destructive' ? 'destructive' : ''}" role="menuitem" data-i="${i}"${m.checked !== undefined ? ` aria-checked="${!!m.checked}"` : ''}>
      ${m.dot ? `<span class="swatch" style="background:${m.dot}"></span>` : m.icon ? ic(m.icon) : ''}
      <span class="mi-body"><span>${esc(m.label)}</span>${m.sub ? `<span class="mi-sub">${esc(m.sub)}</span>` : ''}</span>
      ${m.checked !== undefined ? `<span class="mi-check">${ic('check', 'sm')}</span>` : ''}
    </button>`).join('');

  let host = null;
  document.body.appendChild(scrim);
  if (compact) {
    host = document.createElement('div'); host.className = 'sheet-wrap';
    host.appendChild(pop); document.body.appendChild(host);
    host.onclick = (e) => { if (e.target === host) close(); };
  } else {
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const pw = Math.min(340, Math.max(260, pop.offsetWidth));
    const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    Object.assign(pop.style, { left: left + 'px', top: top + 'px', width: pw + 'px' });
  }
  function close() {
    pop.remove(); scrim.remove(); host?.remove();
    const i = layers.findIndex(l => l.el === pop); if (i >= 0) layers.splice(i, 1);
  }
  layers.push({ el: pop, close });
  scrim.onclick = close;
  pop.onclick = (e) => { const b = e.target.closest('.menu-item'); if (!b) return; close(); onPick(items[+b.dataset.i]); };
  return close;
}

function alert_({ title, message, field, actions }) {
  return new Promise(res => {
    const wrap = document.createElement('div');
    wrap.className = 'alert-wrap';
    wrap.innerHTML = `<div class="alert" role="alertdialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="a-body"><div class="a-title">${esc(title)}</div>
        ${message ? `<div class="a-msg">${esc(message)}</div>` : ''}
        ${field !== undefined ? `<div class="a-field"><input type="text" id="alertField" placeholder="${esc(field)}" autocomplete="off" enterkeyhint="done"></div>` : ''}
      </div>
      <div class="a-acts">${actions.map((a, i) => `<button data-i="${i}" class="${a.style || ''}">${esc(a.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(wrap);
    const close = (v) => { wrap.remove(); const i = layers.findIndex(l => l.el === wrap); if (i >= 0) layers.splice(i, 1); res(v); };
    layers.push({ el: wrap, close: () => close(null) });
    const inp = $('#alertField', wrap);
    if (inp) {
      setTimeout(() => inp.focus(), 60);
      inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); close(inp.value.trim() || null); } };
    }
    wrap.onclick = e => {
      const b = e.target.closest('.a-acts button'); if (!b) return;
      const a = actions[+b.dataset.i];
      close(a.style === 'cancel' ? null : (inp ? (inp.value.trim() || null) : true));
    };
  });
}
const confirm_ = (title, message, confirmLabel = '削除') =>
  alert_({ title, message, actions: [{ label: 'キャンセル', style: 'cancel' }, { label: confirmLabel, style: 'destructive' }] }).then(v => !!v);
const prompt_ = (title, message, placeholder, okLabel = '追加') =>
  alert_({ title, message, field: placeholder, actions: [{ label: 'キャンセル', style: 'cancel' }, { label: okLabel }] });
const notice = (title, message) => alert_({ title, message, actions: [{ label: 'OK' }] });

function formSheet({ title, body, left = 'キャンセル', right, onRight, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'formsheet-wrap';
  wrap.innerHTML = `<div class="formsheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header class="navbar"><div class="lead"><button class="navbtn text" data-act="left">${esc(left)}</button></div>
      <h2 class="title">${esc(title)}</h2>
      <div class="trail">${right ? `<button class="navbtn text" data-act="right" style="font-weight:600">${esc(right)}</button>` : '<span style="min-width:44px"></span>'}</div></header>
    <div class="fs-body"><div class="grouped">${body}</div></div></div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); const i = layers.findIndex(l => l.el === wrap); if (i >= 0) layers.splice(i, 1); onClose?.(); };
  layers.push({ el: wrap, close });
  wrap.addEventListener('click', e => {
    if (e.target === wrap) return close();
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'left') return close();
    if (onRight?.(wrap) === false) return;
    close();
  });
  return { wrap, close };
}

// ============================================================
// サイドバー
// ============================================================
function renderSidebar() {
  const counts = {}; let open = 0, unread = 0, pinned = 0;
  for (const it of state.items) {
    if (it.status !== 'done') { counts[it.cat] = (counts[it.cat] || 0) + 1; open++; }
    if (isUnread(it)) unread++;
    if (it.pinned) pinned++;
  }
  const v = state.view;
  const row = (type, id, inner, trail = '') => `<button class="sbrow" data-type="${type}" data-id="${esc(id ?? '')}"
      aria-current="${v.type === type && v.id === (id ?? null) ? 'true' : 'false'}">${inner}${trail}</button>`;
  const cnt = (n) => n ? `<span class="cnt">${n}</span>` : '';

  let h = row('home', null, `${ic('house')}<span class="nm">ホーム</span>`, unread ? `<span class="badge">${unread}</span>` : '');
  h += row('all', null, `${ic('tray')}<span class="nm">すべてのページ</span>`, cnt(open));
  h += row('pinned', null, `${ic('pin')}<span class="nm">ピン留め</span>`, cnt(pinned));

  h += '<div class="sbsec">業務</div>';
  for (const c of state.cats) h += row('cat', c.id, `<span class="swatch" style="background:${c.color}"></span><span class="nm">${esc(c.name)}</span>`, cnt(counts[c.id] || 0));
  h += row('editcats', null, `${ic('plus')}<span class="nm">業務を編集</span>`);

  const tags = allTags().filter(x => x.n);
  if (tags.length) {
    h += '<div class="sbsec">タグ</div>';
    for (const { t, n } of tags) h += row('tag', t, `${ic('tag')}<span class="nm">${esc(t)}</span>`, cnt(n));
  }
  h += '<div class="sbsec">ヘルプ</div>' + row('help', null, `${ic('book')}<span class="nm">使い方</span>`);
  $('#sbList').innerHTML = h;
}

// ============================================================
// 一覧 / ホーム
// ============================================================
function viewTitle() {
  const v = state.view;
  if (v.type === 'cat') { const c = catOf(v.id); return `<span class="swatch" style="background:${c.color}"></span>${esc(c.name)}`; }
  if (v.type === 'tag') return `${ic('tag', 'sm')}${esc(v.id)}`;
  return { home: 'ホーム', all: 'すべてのページ', pinned: 'ピン留め', unread: '新しい回答' }[v.type] || '';
}

function renderList() {
  const v = state.view;
  $('#listTitle').innerHTML = viewTitle();
  $('#listAccessory').hidden = v.type === 'home';
  $('#home').hidden = v.type !== 'home';
  $('#list').hidden = v.type === 'home';
  if (v.type === 'home') return renderHome();

  const items = viewItems();
  const el = $('#list');
  if (!items.length) {
    const { q, status } = state.filter;
    const [h, d] = q ? ['見つかりません', `「${q}」に一致するページはありません。`]
      : status ? [`${STATUS[status]}のページはありません`, 'セグメントを「すべて」に戻すと、ほかのページが表示されます。']
      : v.type === 'pinned' ? ['ピン留めはまだありません', 'ページを開いて右上のピンを押すと、ここに集まります。']
      : v.type === 'tag' ? ['このタグのページはありません', 'ページを開いて「タグ」から付けられます。']
      : v.type === 'unread' ? ['新しい回答はありません', '書き出したファイルをリーダーに渡し、返ってきたら取り込みます。']
      : v.type === 'cat' ? [`${catOf(v.id).name}のページはありません`, '右上の作成ボタンから、この業務のページを作れます。']
      : ['ページがありません', '右上の作成ボタンから、最初のページを作りましょう。'];
    el.innerHTML = `<div class="empty">${ic('note', 'lg')}<div class="h">${esc(h)}</div>${d ? `<div class="d">${esc(d)}</div>` : ''}</div>`;
    return;
  }
  const sec = (title, arr) => arr.length
    ? `<div class="gsec"><div class="ghead">${esc(title)}</div><div class="glist">${arr.map(noteCell).join('')}</div></div>` : '';
  const flat = state.filter.status || state.filter.q || v.type === 'tag' || v.type === 'unread';
  el.innerHTML = flat
    ? `<div class="gsec"><div class="ghead">${items.length} 件</div><div class="glist">${items.map(noteCell).join('')}</div></div>`
    : sec('ピン留め', items.filter(i => i.pinned)) + ['open', 'wip', 'done'].map(s => sec(STATUS[s], items.filter(i => !i.pinned && i.status === s))).join('');
}

function noteCell(it) {
  const th = thumb(it);
  const c = catOf(it.cat);
  const sn = snippet(it);
  const title = it.title || firstLine(it) || '新しいページ';
  // タイトルが本文の1行目そのものなら、続きだけを抜粋に出す（重複を避ける）
  const rest = sn.startsWith(title) ? sn.slice(title.length).replace(/^[。、\s]+/, '') : sn;
  const sub = it.answer ? '回答：' + it.answer : (rest || '追加のテキストなし');
  return `<button class="cell note" data-open="${it.id}">
    <span class="cbody">
      <span class="ntitle ${it.title ? '' : 'untitled'}">
        ${isUnread(it) ? '<span class="newdot"></span>' : ''}${it.pinned ? ic('pin', 'sm') : ''}
        <span style="overflow:hidden;text-overflow:ellipsis">${esc(title)}</span></span>
      <span class="nsnip">${esc(sub)}</span>
      <span class="nmeta">
        <span class="status st-${it.status}"><span class="dot"></span>${STATUS[it.status]}</span>
        <span>${fmt(it.updatedAt)}</span>
        <span style="display:inline-flex;align-items:center;gap:4px"><span class="swatch" style="width:8px;height:8px;background:${c.color}"></span>${esc(c.name)}</span>
        ${it.tags.slice(0, 2).map(t => `<span class="tagtoken">${ic('tag', 'sm')}${esc(t)}</span>`).join('')}
      </span>
    </span>
    ${th ? `<img class="nthumb" src="${th}" alt="">` : ''}
  </button>`;
}

function renderHome() {
  const open = state.items.filter(i => i.status === 'open').length;
  const wip = state.items.filter(i => i.status === 'wip').length;
  const done = state.items.filter(i => i.status === 'done').length;
  const unread = state.items.filter(isUnread);
  const todo = state.items.filter(i => i.tags.includes('やること') && i.status !== 'done');
  const recent = state.items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'おはようございます' : hour < 17 ? 'こんにちは' : 'お疲れさまです';

  const sec = (title, arr, more) => arr.length ? `<div class="gsec"><div class="ghead">${esc(title)}${more ? `<button class="more" data-go="${more}">すべて表示</button>` : ''}</div>
    <div class="glist">${arr.map(noteCell).join('')}</div></div>` : '';

  $('#home').innerHTML = `
    <div class="gsec" style="padding:2px var(--margin) 0">
      <div class="t-largetitle">${greet}${state.me ? '、' + esc(state.me) + 'さん' : ''}</div>
    </div>

    <div class="gsec">
      <div class="ghead">思いついたことを残す</div>
      <div class="capture">
        <textarea id="quickText" rows="2" placeholder="今、何に困っていますか。ひとまずここに書いて残せます" aria-label="クイックメモ"></textarea>
        <div class="row">
          <button class="tinted" id="quickInk">${ic('pen', 'sm')}手書きで書く</button>
          <span class="sp"></span>
          <button class="filled" id="quickSave">残す</button>
        </div>
      </div>
      <div class="gfoot">残したページは「未分類」に入ります。業務やタイトルは、落ち着いたときに整理できます。</div>
    </div>

    <div class="gsec">
      <div class="ghead">いまの状況</div>
      <div class="stats">
        <button class="stat" data-go="all:open"><div class="v" style="color:var(--red)">${open}</div><div class="k">未解決</div></button>
        <button class="stat" data-go="all:wip"><div class="v" style="color:var(--orange)">${wip}</div><div class="k">確認中</div></button>
        <button class="stat" data-go="unread:"><div class="v" style="color:var(--blue)">${unread.length}</div><div class="k">新しい回答</div></button>
        <button class="stat" data-go="all:done"><div class="v" style="color:var(--green)">${done}</div><div class="k">解決</div></button>
      </div>
    </div>

    ${rediscoverSection()}
    ${sec('新しい回答', unread.slice(0, 4), unread.length > 4 ? 'unread:' : '')}
    ${sec('やること', todo.slice(0, 4), todo.length > 4 ? 'tag:やること' : '')}
    ${recent.length ? sec('最近の変更', recent, 'all:')
      : `<div class="empty">${ic('note', 'lg')}<div class="h">ページがありません</div><div class="d">上の欄に書いて「残す」を押すか、右上の作成ボタンから始めましょう。</div></div>`}`;
}

function rediscoverSection() {
  const old = state.items.filter(i => now() - i.createdAt > 14 * 864e5 && i.createdBy !== 'アプリ');
  if (!old.length) return '';
  const it = old[Math.floor(now() / 864e5) % old.length];
  const days = Math.round((now() - it.createdAt) / 864e5);
  const hint = it.status === 'done' ? 'いま読み返すと、身についているか確かめられます。'
    : it.status === 'open' ? 'まだ未解決のままです。今なら聞けるかもしれません。'
    : '確認中のまま止まっています。';
  return `<div class="gsec"><div class="ghead">${days}日前のページ</div><div class="glist">
    <button class="cell" data-open="${it.id}">
      <span class="lead-icon" style="background:var(--indigo)">${ic('clock')}</span>
      <span class="cbody"><span class="ctitle">${esc(it.title || firstLine(it) || '新しいページ')}</span>
        <span class="t-footnote c2" style="display:block;margin-top:2px;white-space:normal;line-height:1.38">${esc(hint)}</span></span>
      ${ic('chev-r', 'sm')}
    </button></div></div>`;
}

// サムネイル
const thumbCache = new Map();
function thumb(it) {
  const b = it.blocks.find(x => (x.type === 'ink' && x.strokes.length) || (x.type === 'image' && x.src));
  if (!b) return '';
  const key = it.id + ':' + it.updatedAt;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let url = '';
  if (b.type === 'image') url = b.src;
  else {
    const S = 128;
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, S, S);
    const s = S / (b.w || 800); ctx.scale(s, s);
    drawStrokes(ctx, b.strokes, 1 / s);
    url = c.toDataURL('image/png');
  }
  thumbCache.set(key, url);
  return url;
}

const renderAll = () => { renderSidebar(); renderList(); };

// ============================================================
// 手書き
// ============================================================
const INKS = ['#1C1C1E', '#FF3B30', '#007AFF', '#34C759'];
function drawStrokes(ctx, strokes, lineScale) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    const pts = s.points; if (!pts || pts.length < 2) continue;
    if (s.tool === 'marker') {
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = s.color; ctx.globalAlpha = .3; ctx.lineWidth = s.w * lineScale;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke(); ctx.globalAlpha = 1; continue;
    }
    ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    const base = s.tool === 'eraser' ? s.w * 6 : s.w;
    ctx.lineWidth = base * lineScale;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

class Pad {
  constructor(wrap, canvas, block, onChange) {
    Object.assign(this, { wrap, canvas, block, onChange });
    this.ctx = canvas.getContext('2d');
    this.cur = null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(wrap);
    wrap.style.height = (block.h || 320) + 'px';
  }
  destroy() { this.ro.disconnect(); }
  resize() {
    const r = this.wrap.getBoundingClientRect(); if (!r.width) return;
    this.w = r.width; this.h = r.height;
    if (!this.block.w) this.block.w = Math.round(r.width);
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.redraw();
  }
  scale() { return this.w && this.block.w ? this.w / this.block.w : 1; }
  redraw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.dpr * this.scale();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawStrokes(ctx, this.block.strokes, 1);
    if (this.cur) drawStrokes(ctx, [this.cur], 1);
  }
  pt(e) {
    const r = this.canvas.getBoundingClientRect(), s = this.scale();
    return [Math.round((e.clientX - r.left) / s * 10) / 10, Math.round((e.clientY - r.top) / s * 10) / 10];
  }
  down(e) {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const { tool, color, width } = state.ink;
    this.cur = { tool, color: tool === 'marker' ? '#FFD60A' : color, w: tool === 'marker' ? 18 : width, points: [this.pt(e)] };
  }
  move(e) {
    if (!this.cur) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) this.cur.points.push(this.pt(ev));
    if (this.cur.tool === 'marker') return this.redraw();
    const k = this.dpr * this.scale();
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    const n = this.cur.points.length;
    drawStrokes(this.ctx, [{ ...this.cur, points: this.cur.points.slice(Math.max(0, n - evs.length - 2)) }], 1);
  }
  up() {
    if (!this.cur) return;
    if (this.cur.points.length === 1) this.cur.points.push(this.cur.points[0]);
    this.block.strokes.push(this.cur);
    this.cur = null; this.redraw(); this.onChange();
  }
  undo() { this.block.strokes.pop(); this.redraw(); this.onChange(); }
  clear() { this.block.strokes = []; this.redraw(); this.onChange(); }
  setHeight(h) { this.block.h = Math.max(180, Math.round(h)); this.wrap.style.height = this.block.h + 'px'; }
}

// ============================================================
// ページ（詳細）
// ============================================================
const PAGE = {
  pads: new Map(),

  open(it, { push = true } = {}) {
    if (state.editing && state.editing !== it) this.flush();
    state.editing = it;
    state.dirty = false;
    if (isUnread(it)) { it.answerReadAt = now(); saveItem(it); }
    this.renderDoc();
    if (push) pushPage();
    $('#pageScroll').scrollTop = 0;
    renderAll();
  },

  renderDoc() {
    this.killPads();
    const it = state.editing;
    const c = catOf(it.cat);
    $('#pageTitle').innerHTML = `<span class="swatch" style="background:${c.color}"></span><span class="t-footnote c2">${esc(c.name)}</span>`;
    $('#btnPin').style.color = it.pinned ? 'var(--tint)' : 'var(--label-3)';
    $('#btnPin').setAttribute('aria-pressed', String(it.pinned));

    $('#doc').innerHTML = `
      <textarea class="doc-title" id="edTitle" rows="1" placeholder="タイトル" aria-label="タイトル">${esc(it.title)}</textarea>

      <div class="gsec"><div class="glist">
        <button class="cell" data-prop="status"><span class="cbody"><span class="ctitle">ステータス</span></span>
          <span class="cvalue"><span class="status st-${it.status}"><span class="dot"></span>${STATUS[it.status]}</span></span>${ic('chev-r', 'sm')}</button>
        <button class="cell" data-prop="cat"><span class="cbody"><span class="ctitle">業務</span></span>
          <span class="cvalue"><span class="swatch" style="width:10px;height:10px;background:${c.color}"></span>${esc(c.name)}</span>${ic('chev-r', 'sm')}</button>
        <button class="cell" data-prop="tags"><span class="cbody"><span class="ctitle">タグ</span></span>
          ${it.tags.length ? `<span class="tokens">${it.tags.map(t => `<span class="token">${ic('tag', 'sm')}${esc(t)}</span>`).join('')}</span>` : '<span class="cvalue">なし</span>'}
          ${ic('chev-r', 'sm')}</button>
      </div></div>

      <div class="blocks" id="blocks"></div>

      <div class="gsec"><div class="glist">
        <button class="cell inset-sep" data-add="ink"><span class="lead-icon" style="background:var(--blue)">${ic('pen')}</span><span class="cbody"><span class="ctitle">手書きを追加</span></span></button>
        <button class="cell inset-sep" data-add="text"><span class="lead-icon" style="background:#8E8E93">${ic('text')}</span><span class="cbody"><span class="ctitle">テキストを追加</span></span></button>
        <button class="cell inset-sep" data-add="check"><span class="lead-icon" style="background:var(--green)">${ic('checklist')}</span><span class="cbody"><span class="ctitle">チェックリストを追加</span></span></button>
        <button class="cell inset-sep" data-add="image"><span class="lead-icon" style="background:var(--orange)">${ic('camera')}</span><span class="cbody"><span class="ctitle">写真を追加</span></span></button>
      </div></div>

      <div class="gsec answer">
        <div class="ghead">回答・対応</div>
        <div class="glist">
          <textarea id="edAnswer" placeholder="結論、その根拠、参照先の順に。次に読む人が同じ疑問を持たずに済みます" aria-label="回答">${esc(it.answer)}</textarea>
          <div class="who"><label for="edAnsweredBy">回答者</label>
            <input type="text" id="edAnsweredBy" value="${esc(it.answeredBy)}" placeholder="名前" autocomplete="off">
            <span class="t-footnote c3">${esc(fmtFull(it.answerAt))}</span></div>
          <div id="doneRow" ${it.answer.trim() && it.status !== 'done' ? '' : 'hidden'}>
            <button class="plainbtn" id="btnMarkDone">${ic('check')}解決にする</button></div>
        </div>
        <div class="gfoot">回答を書くと、ステータスは自動で「確認中」になります。</div>
      </div>

      <div class="gsec" id="relSec" hidden><div class="ghead">関連するページ</div><div class="glist" id="relList"></div></div>

      <div class="gsec"><div class="glist">
        <details class="hist"><summary>${ic('clock')}<span style="flex:1">履歴</span><span class="chev">${ic('chev-r', 'sm')}</span></summary><ul id="histList"></ul></details>
      </div></div>`;

    autogrow($('#edTitle'));
    autogrow($('#edAnswer'));
    this.renderBlocks();
    this.renderRelated();
    this.renderHistory();
  },

  killPads() { for (const p of this.pads.values()) p.destroy(); this.pads.clear(); },

  refresh() {
    const y = $('#pageScroll').scrollTop;
    this.renderDoc();
    $('#pageScroll').scrollTop = y;
  },

  renderBlocks() {
    this.killPads();
    const it = state.editing;
    const n = it.blocks.length;
    const ctl = (i) => `<button class="iconbtn plain" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="上へ移動">${ic('chev-u', 'sm')}</button>
      <button class="iconbtn plain" data-act="down" ${i === n - 1 ? 'disabled' : ''} aria-label="下へ移動">${ic('chev-d', 'sm')}</button>
      <button class="iconbtn plain" data-act="del" aria-label="このブロックを削除">${ic('xmark', 'sm')}</button>`;

    $('#blocks').innerHTML = it.blocks.map((b, i) => {
      if (b.type === 'ink') return `<div class="block" data-bid="${b.id}">
        <div class="block-bar"><span class="bk">手書き</span>${ctl(i)}</div>
        <div class="paper"><canvas class="pad"></canvas>
          <div class="palette" role="toolbar" aria-label="描画ツール">
            <button class="tool" data-tool="pen" aria-pressed="${state.ink.tool === 'pen'}" aria-label="ペン">${ic('pen')}</button>
            <button class="tool" data-tool="marker" aria-pressed="${state.ink.tool === 'marker'}" aria-label="マーカー">${ic('marker')}</button>
            <button class="tool" data-tool="eraser" aria-pressed="${state.ink.tool === 'eraser'}" aria-label="消しゴム">${ic('eraser')}</button>
            <span class="div"></span>
            ${INKS.map(col => `<button class="ink" data-color="${col}" aria-pressed="${state.ink.color === col}" aria-label="インクの色"><i style="background:${col}"></i></button>`).join('')}
            <span class="div"></span>
            <span class="widths">${[[2, 3], [3.5, 5], [6, 8]].map(([w, px]) => `<button class="wbtn" data-w="${w}" aria-pressed="${state.ink.width === w}" aria-label="線の太さ"><i style="width:${px}px;height:${px}px"></i></button>`).join('')}</span>
            <span class="div"></span>
            <button class="tool" data-act="undo" aria-label="取り消す">${ic('undo')}</button>
            <button class="tool" data-act="clearInk" aria-label="すべて消す">${ic('trash')}</button>
          </div>
          <div class="grip" title="ドラッグして高さを変える"><span></span></div>
        </div></div>`;
      if (b.type === 'text') return `<div class="block" data-bid="${b.id}">
        <div class="block-bar"><span class="bk">テキスト</span>${ctl(i)}</div>
        <textarea placeholder="${esc(b.placeholder || 'ここに書く')}">${esc(b.text)}</textarea></div>`;
      if (b.type === 'check') return `<div class="block" data-bid="${b.id}">
        <div class="block-bar"><span class="bk">チェックリスト ${b.items.filter(x => x.done).length}／${b.items.length}</span>${ctl(i)}</div>
        <div class="checks">${b.items.map((x, j) => `<div class="chk ${x.done ? 'on' : ''}" data-j="${j}">
            <button class="chkbox" data-act="toggle" role="checkbox" aria-checked="${x.done}" aria-label="完了">${ic('check', 'sm')}</button>
            <input type="text" value="${esc(x.text)}" placeholder="項目" aria-label="項目">
            <button class="rm" data-act="rmItem" aria-label="この項目を削除">${ic('xmark', 'sm')}</button></div>`).join('')}
          <button class="plainbtn" data-act="addItem" style="min-height:38px">${ic('plus', 'sm')}項目を追加</button></div></div>`;
      if (b.type === 'image') return `<div class="block" data-bid="${b.id}">
        <div class="block-bar"><span class="bk">写真</span>${ctl(i)}</div>
        <div class="photo"><img src="${b.src}" alt="${esc(b.caption || '貼り付けた写真')}">
          <input type="text" value="${esc(b.caption || '')}" placeholder="説明を書く" aria-label="写真の説明"></div></div>`;
      return '';
    }).join('');

    for (const el of $$('#blocks .block')) {
      const b = it.blocks.find(x => x.id === el.dataset.bid);
      if (b.type === 'ink') {
        const pad = new Pad($('.paper', el), $('canvas', el), b, () => this.touch());
        this.pads.set(b.id, pad);
        const grip = $('.grip', el);
        let y0, h0;
        grip.addEventListener('pointerdown', e => { y0 = e.clientY; h0 = pad.h; grip.setPointerCapture(e.pointerId); e.preventDefault(); });
        grip.addEventListener('pointermove', e => { if (y0 === undefined) return; pad.setHeight(h0 + e.clientY - y0); });
        grip.addEventListener('pointerup', () => { if (y0 === undefined) return; y0 = undefined; this.touch(); });
      }
      if (b.type === 'text') autogrow($('textarea', el));
    }
  },

  renderRelated() {
    const rel = related(state.editing);
    $('#relSec').hidden = !rel.length;
    if (!rel.length) return;
    $('#relList').innerHTML = rel.map(({ item: r, why }) => `<button class="cell" data-open="${r.id}">
      <span class="lead-icon" style="background:${catOf(r.cat).color}">${ic('link')}</span>
      <span class="cbody"><span class="ctitle">${esc(r.title || firstLine(r) || '新しいページ')}</span>
        <span class="t-footnote c2" style="display:block;margin-top:1px">${esc(why)}</span></span>
      <span class="cvalue"><span class="status st-${r.status}"><span class="dot"></span>${STATUS[r.status]}</span></span>${ic('chev-r', 'sm')}</button>`).join('');
  },

  renderHistory() {
    const label = (h) => h.ev === 'created' ? 'ページを作成'
      : h.ev === 'status' ? `ステータスを「${STATUS[h.v] || h.v}」に変更`
      : h.ev === 'answer' ? '回答を記入'
      : h.ev === 'import' ? '取り込みで更新' : h.ev;
    $('#histList').innerHTML = (state.editing.history || []).slice().reverse()
      .map(h => `<li><b>${esc(fmtFull(h.at))}</b><span>${esc(h.by || '—')}　${label(h)}</span></li>`).join('')
      || '<li><span>履歴はありません</span></li>';
  },

  setStatus(s, withLog) {
    const it = state.editing;
    if (it.status === s) return;
    it.status = s;
    if (withLog) log(it, 'status', s);
    this.refresh();
    this.touch(true);
  },

  addBlock(type) {
    if (type === 'image') return $('#imgFile').click();
    const b = type === 'ink' ? { id: uid(), type, strokes: [], w: 0, h: 340 }
      : type === 'check' ? { id: uid(), type, items: [{ text: '', done: false }] }
      : { id: uid(), type: 'text', text: '' };
    state.editing.blocks.push(b);
    this.renderBlocks();
    this.touch(true);
    requestAnimationFrame(() => {
      const el = $(`[data-bid="${b.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('textarea, input[type=text]', el)?.focus();
    });
  },

  touch(immediate) { state.dirty = true; immediate ? this.save() : this.saveSoon(); },
  saveSoon: debounce(() => PAGE.save(), 500),
  async save() {
    const it = state.editing; if (!it) return;
    it.updatedAt = now();
    if (!state.items.includes(it)) state.items.push(it);
    await saveItem(it);
    state.dirty = false;
    renderAll();
  },
  flush() { if (state.editing && state.dirty) return this.save(); },
  isEmpty(it) {
    return !it.title.trim() && !it.answer.trim() && !it.blocks.some(b =>
      (b.type === 'text' && b.text.trim()) || (b.type === 'ink' && b.strokes.length) ||
      (b.type === 'check' && b.items.some(x => x.text.trim())) || b.type === 'image');
  },
  async close() {
    const it = state.editing;
    if (!it) return popPage();
    if (this.isEmpty(it)) {
      state.items = state.items.filter(x => x !== it);
      await DB.del('items', it.id);
      hud('空のページは保存しませんでした');
    } else if (state.dirty || !state.items.includes(it)) {
      await this.save();
    }
    this.killPads();
    state.editing = null;
    popPage();
    renderAll();
  },
  async remove() {
    const it = state.editing;
    if (!(await confirm_('このページを削除しますか', '削除したページは元に戻せません。'))) return;
    state.items = state.items.filter(x => x !== it);
    await DB.del('items', it.id);
    this.killPads();
    state.editing = null;
    popPage();
    renderAll();
    hud('削除しました');
  },
};

function autogrow(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
function shrinkImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const M = 1400, s = Math.min(1, M / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', .82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image')); };
    img.src = url;
  });
}

// ============================================================
// ナビゲーション
// ============================================================
function pushPage() {
  $('#pageStack').classList.add('on');
  $('#pageStack').setAttribute('aria-hidden', 'false');
  $('#listStack').classList.add('back');
  $('#listStack').setAttribute('aria-hidden', 'true');
}
function popPage() {
  $('#pageStack').classList.remove('on');
  $('#pageStack').setAttribute('aria-hidden', 'true');
  $('#listStack').classList.remove('back');
  $('#listStack').setAttribute('aria-hidden', 'false');
}
function go(type, id, status) {
  if (state.editing) PAGE.close();
  state.view = { type, id: id ?? null };
  if (status !== undefined) {
    state.filter.status = status;
    $$('#segStatus button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.s === status)));
  }
  $('#split').classList.remove('show-sidebar');
  $('#sidebarScrim').hidden = true;
  $('#listScroll').scrollTop = 0;
  $('#backLabel').textContent = state.view.type === 'home' ? 'ホーム' : '一覧';
  renderAll();
}

// ============================================================
// 新規作成
// ============================================================
const TEMPLATES = [
  { id: 'ink', icon: 'pen', label: '手書きではじめる', sub: '白い紙が開きます。整理はあとで' },
  { id: 'question', icon: 'text', label: '疑問を整理して書く', sub: '状況 / 調べたこと / 聞きたいこと' },
  { id: 'steps', icon: 'checklist', label: '教わった手順を残す', sub: '順番にチェックリストで' },
  { id: 'call', icon: 'bubble', label: '電話・引き継ぎのメモ', sub: '相手 / 用件 / 対応 / 次にやること' },
];
function newItem(tpl) {
  const cat = state.view.type === 'cat' ? state.view.id : 'inbox';
  const blocks = {
    ink: [{ id: uid(), type: 'ink', strokes: [], w: 0, h: 380 }],
    text: [{ id: uid(), type: 'text', text: '' }],
    question: [
      { id: uid(), type: 'text', text: '', placeholder: 'いつ、どの業務で、何が起きましたか' },
      { id: uid(), type: 'text', text: '', placeholder: '自分で調べたこと、試したこと' },
      { id: uid(), type: 'text', text: '', placeholder: '聞きたいことを一言で' }],
    steps: [
      { id: uid(), type: 'check', items: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }] },
      { id: uid(), type: 'text', text: '', placeholder: '注意点、つまずきやすいところ' }],
    call: [
      { id: uid(), type: 'text', text: '', placeholder: '相手（会社名・名前・連絡先）' },
      { id: uid(), type: 'text', text: '', placeholder: '用件' },
      { id: uid(), type: 'text', text: '', placeholder: '対応したこと' },
      { id: uid(), type: 'check', items: [{ text: '', done: false }] }],
  }[tpl] || [{ id: uid(), type: 'ink', strokes: [], w: 0, h: 380 }];
  return { v: 2, id: uid(), title: '', cat,
    status: tpl === 'steps' ? 'done' : 'open',
    tags: tpl === 'call' ? ['やること'] : [],
    pinned: false, blocks, answer: '', answeredBy: '', answerAt: 0, answerReadAt: 0,
    history: [{ at: now(), by: state.me, ev: 'created' }], createdAt: now(), updatedAt: now(), createdBy: state.me };
}
async function quickCapture(text) {
  const it = newItem('text');
  it.blocks = [{ id: uid(), type: 'text', text }];
  state.items.push(it);
  await saveItem(it);
  renderAll();
  hud('未分類に残しました');
}

// ============================================================
// 設定・業務・使い方
// ============================================================
function settingsSheet() {
  const body = `
    <div class="gsec"><div class="glist">
      <div class="cell"><span class="cbody"><span class="ctitle">名前</span></span>
        <input class="tf" id="setName" type="text" value="${esc(state.me)}" placeholder="入力" autocomplete="off"></div>
      <button class="cell" data-act="cats"><span class="cbody"><span class="ctitle">業務カテゴリ</span></span>
        <span class="cvalue">${state.cats.length} 件</span>${ic('chev-r', 'sm')}</button>
    </div><div class="gfoot">名前は、作成者と回答者として各ページに記録されます。</div></div>

    <div class="gsec"><div class="glist">
      <button class="cell inset-sep" data-act="export"><span class="lead-icon" style="background:var(--blue)">${ic('export')}</span>
        <span class="cbody"><span class="ctitle">すべてを書き出す</span></span>${ic('chev-r', 'sm')}</button>
      <button class="cell inset-sep" data-act="import"><span class="lead-icon" style="background:var(--green)">${ic('import')}</span>
        <span class="cbody"><span class="ctitle">ファイルを取り込む</span></span>${ic('chev-r', 'sm')}</button>
    </div><div class="gfoot">書き出したファイルを AirDrop で渡し、相手が取り込むと内容が合流します。同じページは新しいほうが残り、回答は消えません。</div></div>

    <div class="gsec"><div class="glist">
      <button class="cell inset-sep" data-act="help"><span class="lead-icon" style="background:var(--indigo)">${ic('book')}</span>
        <span class="cbody"><span class="ctitle">使い方</span></span>${ic('chev-r', 'sm')}</button>
    </div></div>`;

  const sheet = formSheet({
    title: '設定', left: '完了', body,
    onClose: async () => {
      const nm = $('#setName', sheet.wrap)?.value.trim();
      if (nm !== undefined && nm !== state.me) { state.me = nm; await saveMeta('me', nm); }
      renderAll();
    },
  });

  sheet.wrap.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'cats') { sheet.close(); catSheet(); }
    if (act === 'export') { sheet.close(); exportData(); }
    if (act === 'import') { sheet.close(); $('#fileImport').click(); }
    if (act === 'help') { sheet.close(); helpSheet(); }
  });
}

function catSheet() {
  let cats = state.cats.map(c => ({ ...c }));
  const palette = Object.values(SYS);
  const rows = () => `<div class="gsec"><div class="glist" id="catList">
      ${cats.map((c, i) => `<div class="catrow" data-i="${i}">
        <input type="color" value="${c.color}" aria-label="色">
        <input type="text" value="${esc(c.name)}" placeholder="業務の名前" aria-label="業務の名前" ${c.id === 'inbox' ? 'readonly' : ''}>
        <button class="iconbtn plain" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">${ic('chev-u', 'sm')}</button>
        <button class="iconbtn plain" data-down="${i}" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="下へ">${ic('chev-d', 'sm')}</button>
        ${c.id === 'inbox' ? '<span style="min-width:34px"></span>'
          : `<button class="iconbtn" data-del="${i}" style="color:var(--red)" aria-label="削除">${ic('trash', 'sm')}</button>`}
      </div>`).join('')}
      <button class="plainbtn" id="catAdd">${ic('plus', 'sm')}業務を追加</button>
    </div><div class="gfoot">「未分類」は残ります。業務を削除すると、そのページは未分類に移ります。</div></div>`;

  const read = (wrap) => $$('.catrow', wrap).forEach(r => {
    const i = +r.dataset.i;
    cats[i].color = $('input[type=color]', r).value;
    cats[i].name = $('input[type=text]', r).value;
  });

  const sheet = formSheet({
    title: '業務カテゴリ', left: 'キャンセル', right: '完了', body: rows(),
    onRight: (wrap) => { read(wrap); saveCatEdits(cats); },
  });

  sheet.wrap.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    const redraw = () => { $('.grouped', sheet.wrap).innerHTML = rows(); };
    if (b.id === 'catAdd') {
      read(sheet.wrap);
      cats.push({ id: uid(), name: '', color: palette[cats.length % palette.length] });
      redraw();
      $$('#catList input[type=text]', sheet.wrap).pop()?.focus();
      return;
    }
    if (b.dataset.del !== undefined) {
      read(sheet.wrap);
      const i = +b.dataset.del;
      const used = state.items.filter(x => x.cat === cats[i].id).length;
      if (used && !(await confirm_(`「${cats[i].name}」を削除しますか`, `${used} 件のページが「未分類」に移ります。`))) return;
      cats.splice(i, 1); redraw(); return;
    }
    if (b.dataset.up !== undefined) { read(sheet.wrap); const i = +b.dataset.up; [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; redraw(); return; }
    if (b.dataset.down !== undefined) { read(sheet.wrap); const i = +b.dataset.down; [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; redraw(); }
  });
}

async function saveCatEdits(cats) {
  cats = cats.map(c => ({ ...c, name: c.name.trim() })).filter(c => c.name || c.id === 'inbox');
  if (!cats.find(c => c.id === 'inbox')) cats.unshift({ ...DEFAULT_CATS[0] });
  const ids = new Set(cats.map(c => c.id));
  for (const it of state.items) if (!ids.has(it.cat)) { it.cat = 'inbox'; await saveItem(it); }
  state.cats = cats;
  await saveCats();
  if (state.view.type === 'cat' && !ids.has(state.view.id)) state.view = { type: 'all', id: null };
  renderAll();
  if (state.editing) PAGE.refresh();
  hud('業務カテゴリを保存しました');
}

function helpSheet() {
  const step = (icon, color, title, body) => `<div class="cell inset-sep" style="align-items:flex-start">
    <span class="lead-icon" style="background:${color}">${ic(icon)}</span>
    <span class="cbody"><span class="t-headline">${esc(title)}</span>
      <span class="t-subhead c2" style="display:block;margin-top:2px;white-space:normal;line-height:1.4">${esc(body)}</span></span></div>`;
  formSheet({ title: '使い方', left: '閉じる', body: `
    <div class="gsec"><div class="glist">
      ${step('compose', 'var(--blue)', '迷ったらすぐ書く', '右上の作成ボタン、またはホームの入力欄から。うまく書こうとしなくて大丈夫です。')}
      ${step('folder', 'var(--indigo)', 'あとから業務ごとに整理', '最初は「未分類」に入ります。サイドバーの業務を選ぶと、その業務のページだけが表示されます。')}
      ${step('bubble', 'var(--green)', 'リーダーが回答を書く', '書き出したファイルを渡し、回答をもらったら取り込みます。届いた回答はホームに並びます。')}
      ${step('printer', 'var(--orange)', '解決したページは FAQ になる', '一覧の「その他」から FAQ を印刷できます。次に入る人への引き継ぎ資料になります。')}
    </div></div>
    <div class="gsec"><div class="ghead">手書き</div><div class="glist">
      ${step('pen', 'var(--teal)', '指でそのまま書ける', '図や矢印など、文字にしにくいものは手書きが速いです。紙の下のグリップで高さを変えられます。')}
      ${step('text', '#8E8E93', '文字はテキストで残す', '手書きは検索に引っかかりません。あとで探したいことはテキストのブロックに書きます。')}
    </div></div>` });
}

// ============================================================
// 書き出し / 取り込み / FAQ
// ============================================================
async function exportData(items) {
  const all = !items;
  items = items || state.items;
  const payload = { app: 'gimon-note', version: 2, exportedAt: new Date().toISOString(), by: state.me, cats: state.cats, items };
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const name = all ? `疑問ノート_${state.me || 'noname'}_${ymd}.json`
    : `疑問ノート_${(items[0].title || firstLine(items[0]) || 'ページ').slice(0, 20)}_${ymd}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  hud('ファイルを書き出しました');
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); }
  catch { return notice('取り込めませんでした', 'ファイルを読み取れません。疑問ノートから書き出した JSON ファイルを選んでください。'); }
  if (data?.app !== 'gimon-note' || !Array.isArray(data.items)) {
    return notice('取り込めませんでした', 'これは疑問ノートのファイルではないようです。');
  }
  const idMap = {};
  for (const c of (data.cats || [])) {
    if (typeof c === 'string') {
      const m = catByName(c);
      if (m) idMap[c] = m.id;
      else { const n = { id: uid(), name: c, color: '#8E8E93' }; state.cats.push(n); idMap[c] = n.id; }
      continue;
    }
    if (state.cats.find(x => x.id === c.id)) { idMap[c.id] = c.id; continue; }
    const m = catByName(c.name);
    if (m) idMap[c.id] = m.id;
    else { state.cats.push({ ...c }); idMap[c.id] = c.id; }
  }
  await saveCats();

  const mine = new Map(state.items.map(i => [i.id, i]));
  let added = 0, updated = 0, same = 0;
  for (const raw of data.items) {
    const it = migrate({ ...raw, cat: idMap[raw.cat] || raw.cat });
    if (!state.cats.find(c => c.id === it.cat)) it.cat = 'inbox';
    const cur = mine.get(it.id);
    if (!cur) {
      it.history = [...(it.history || []), { at: now(), by: state.me, ev: 'import' }];
      state.items.push(it); await saveItem(it); added++;
    } else if ((it.updatedAt || 0) > (cur.updatedAt || 0)) {
      if (!it.answer && cur.answer) {
        it.answer = cur.answer; it.answeredBy = cur.answeredBy; it.answerAt = cur.answerAt;
        if (it.status === 'open') it.status = cur.status;
      }
      if (cur.answerReadAt > (it.answerReadAt || 0)) it.answerReadAt = cur.answerReadAt;
      it.history = [...(it.history || []), { at: now(), by: state.me, ev: 'import' }];
      Object.assign(cur, it); await saveItem(cur); updated++;
    } else same++;
  }
  renderAll();
  if (state.editing) PAGE.refresh();
  notice('取り込みました', `追加 ${added} 件、更新 ${updated} 件、変更なし ${same} 件。`);
}

function inkPng(b) {
  const W = 900, H = Math.round(W * (b.h || 320) / (b.w || 800));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const s = W / (b.w || 800);
  ctx.scale(s, s);
  drawStrokes(ctx, b.strokes, 1 / s);
  return c.toDataURL('image/png');
}
function printFAQ() {
  const src = viewItems().filter(i => i.status === 'done');
  if (!src.length) return hud('この一覧に解決済みのページがありません');
  const v = state.view;
  const title = v.type === 'cat' ? catOf(v.id).name : v.type === 'tag' ? v.id : 'すべての業務';
  $('#printView').innerHTML = `<h2>よくある疑問：${esc(title)}</h2>
    <div class="pm">疑問ノートから ${new Date().toLocaleDateString('ja-JP')} 出力・${src.length} 件</div>` +
    src.map(it => {
      const txt = it.blocks.filter(b => b.type === 'text' && b.text.trim()).map(b => esc(b.text)).join('\n');
      const ck = it.blocks.filter(b => b.type === 'check').map(b => b.items.map(x => (x.done ? '☑ ' : '☐ ') + esc(x.text)).join('\n')).join('\n');
      const im = it.blocks.filter(b => (b.type === 'ink' && b.strokes.length) || b.type === 'image')
        .map(b => `<img src="${b.type === 'image' ? b.src : inkPng(b)}">`).join('');
      return `<div class="pq"><h4>${esc(it.title || firstLine(it) || '（無題）')}</h4>
        <div class="pm">${esc(catOf(it.cat).name)}　${it.createdBy ? esc(it.createdBy) + '　' : ''}${esc(fmtFull(it.createdAt))}</div>
        ${txt || ck ? `<div class="pa">${txt}${txt && ck ? '\n' : ''}${ck}</div>` : ''}${im}
        <div class="pa"><b>回答：</b>${esc(it.answer || '（未記入）')}${it.answeredBy ? `　— ${esc(it.answeredBy)}` : ''}</div></div>`;
    }).join('');
  setTimeout(() => window.print(), 60);
}

// ============================================================
// ポップオーバーの中身
// ============================================================
function openById(id) { const it = state.items.find(x => x.id === id); if (it) PAGE.open(it); }

function statusPopover(anchor) {
  const it = state.editing;
  popover(anchor, ['open', 'wip', 'done'].map(s => ({
    label: STATUS[s], value: s, checked: it.status === s, dot: STATUS_VAR[s],
  })), m => PAGE.setStatus(m.value, true));
}
function catPopover(anchor) {
  const it = state.editing;
  popover(anchor, [
    ...state.cats.map(c => ({ label: c.name, value: c.id, checked: it.cat === c.id, dot: c.color })),
    { label: '業務を編集', value: '__edit', icon: 'gear' },
  ], m => {
    if (m.value === '__edit') return catSheet();
    it.cat = m.value;
    PAGE.refresh();
    PAGE.touch(true);
  });
}
function tagPopover(anchor) {
  const it = state.editing;
  popover(anchor, [
    ...allTags().map(({ t, n }) => ({ label: t, value: t, checked: it.tags.includes(t), icon: 'tag', sub: n ? `${n} ページ` : '' })),
    { label: '新しいタグ', value: '__new', icon: 'plus' },
  ], async m => {
    if (m.value === '__new') {
      const t = await prompt_('新しいタグ', '同じ観点のページを、あとでまとめて探せます。', '例：転送、深夜帯、用語');
      if (!t) return;
      const name = t.replace(/^#/, '').trim();
      if (name && !it.tags.includes(name)) it.tags.push(name);
    } else {
      it.tags = it.tags.includes(m.value) ? it.tags.filter(x => x !== m.value) : [...it.tags, m.value];
    }
    PAGE.refresh();
    PAGE.touch(true);
  });
}

function syncInk() {
  $$('#blocks [data-tool]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tool === state.ink.tool)));
  $$('#blocks [data-color]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.color === state.ink.color)));
  $$('#blocks [data-w]').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.w === state.ink.width)));
}

// ============================================================
// 起動と配線
// ============================================================
async function main() {
  await load();
  renderAll();
  $('#backLabel').textContent = 'ホーム';

  // --- サイドバー ---
  $('#sbList').addEventListener('click', e => {
    const b = e.target.closest('.sbrow'); if (!b) return;
    if (b.dataset.type === 'editcats') return catSheet();
    if (b.dataset.type === 'help') return helpSheet();
    go(b.dataset.type, b.dataset.id || null, '');
  });
  $('#btnSidebar').onclick = () => {
    if (window.innerWidth <= 768) {
      const on = $('#split').classList.toggle('show-sidebar');
      $('#sidebarScrim').hidden = !on;
    } else $('#split').classList.toggle('collapsed');
  };
  $('#sidebarScrim').onclick = () => { $('#split').classList.remove('show-sidebar'); $('#sidebarScrim').hidden = true; };
  $('#btnSettings').onclick = settingsSheet;

  // --- 一覧 ---
  $('#listScroll').addEventListener('click', e => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) {
      const raw = goBtn.dataset.go;
      if (raw.startsWith('tag:')) return go('tag', raw.slice(4), '');
      const [t, s] = raw.split(':');
      return go(t, null, s ?? '');
    }
    if (e.target.closest('#quickSave')) {
      const ta = $('#quickText');
      const t = ta.value.trim();
      if (!t) return ta.focus();
      return quickCapture(t);
    }
    if (e.target.closest('#quickInk')) {
      const it = newItem('ink');
      const t = $('#quickText').value.trim();
      if (t) it.blocks.unshift({ id: uid(), type: 'text', text: t });
      return PAGE.open(it);
    }
    const open = e.target.closest('[data-open]');
    if (open) openById(open.dataset.open);
  });
  $('#listScroll').addEventListener('input', e => { if (e.target.id === 'quickText') autogrow(e.target); });

  $('#searchField').addEventListener('input', e => {
    state.filter.q = e.target.value;
    $('#searchClear').hidden = !e.target.value;
    renderList();
  });
  $('#searchClear').onclick = () => {
    $('#searchField').value = '';
    state.filter.q = '';
    $('#searchClear').hidden = true;
    renderList();
    $('#searchField').focus();
  };
  $('#segStatus').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.filter.status = b.dataset.s;
    $$('#segStatus button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    renderList();
  });

  $('#btnCompose').onclick = (e) => popover(e.currentTarget,
    TEMPLATES.map(t => ({ label: t.label, sub: t.sub, icon: t.icon, value: t.id })),
    m => {
      PAGE.open(newItem(m.value));
      if (m.value !== 'ink') setTimeout(() => $('#edTitle')?.focus(), 320);
    });

  $('#btnListMenu').onclick = (e) => popover(e.currentTarget, [
    { label: 'FAQ を印刷', sub: 'この一覧の解決済みページ', icon: 'printer', value: 'print' },
    { label: 'すべてを書き出す', icon: 'export', value: 'export' },
    { label: 'ファイルを取り込む', icon: 'import', value: 'import' },
  ], m => {
    if (m.value === 'print') printFAQ();
    if (m.value === 'export') exportData();
    if (m.value === 'import') $('#fileImport').click();
  });

  // --- ページ ---
  $('#btnBack').onclick = () => PAGE.close();
  $('#btnPin').onclick = () => {
    const it = state.editing; if (!it) return;
    it.pinned = !it.pinned;
    PAGE.refresh();
    PAGE.touch(true);
    hud(it.pinned ? 'ピン留めしました' : 'ピン留めを外しました');
  };
  $('#btnShare').onclick = () => state.editing && exportData([state.editing]);
  $('#btnPageMenu').onclick = (e) => popover(e.currentTarget, [
    { label: 'このページを書き出す', icon: 'export', value: 'share' },
    { label: 'ページを削除', icon: 'trash', value: 'delete', style: 'destructive' },
  ], m => {
    if (m.value === 'share') exportData([state.editing]);
    if (m.value === 'delete') PAGE.remove();
  });

  $('#doc').addEventListener('click', async e => {
    const it = state.editing; if (!it) return;
    const open = e.target.closest('[data-open]');
    if (open) return openById(open.dataset.open);
    const prop = e.target.closest('[data-prop]');
    if (prop) return ({ status: statusPopover, cat: catPopover, tags: tagPopover })[prop.dataset.prop](prop);
    const add = e.target.closest('[data-add]');
    if (add) return PAGE.addBlock(add.dataset.add);
    if (e.target.closest('#btnMarkDone')) {
      PAGE.setStatus('done', true);
      return hud('解決にしました。FAQ に載ります');
    }

    const blk = e.target.closest('.block'); if (!blk) return;
    const btn = e.target.closest('button'); if (!btn) return;
    const b = it.blocks.find(x => x.id === blk.dataset.bid);
    const i = it.blocks.indexOf(b);

    if (btn.dataset.tool) { state.ink.tool = btn.dataset.tool; return syncInk(); }
    if (btn.dataset.color) {
      state.ink.color = btn.dataset.color;
      if (state.ink.tool === 'eraser') state.ink.tool = 'pen';
      return syncInk();
    }
    if (btn.dataset.w) { state.ink.width = +btn.dataset.w; return syncInk(); }

    const pad = PAGE.pads.get(b.id);
    switch (btn.dataset.act) {
      case 'undo': return pad.undo();
      case 'clearInk':
        if (await confirm_('手書きをすべて消しますか', 'この紙に書いた線がすべて消えます。', '消す')) pad.clear();
        return;
      case 'up':
        if (i > 0) { it.blocks.splice(i, 1); it.blocks.splice(i - 1, 0, b); PAGE.renderBlocks(); PAGE.touch(true); }
        return;
      case 'down':
        if (i < it.blocks.length - 1) { it.blocks.splice(i, 1); it.blocks.splice(i + 1, 0, b); PAGE.renderBlocks(); PAGE.touch(true); }
        return;
      case 'del': {
        const empty = (b.type === 'text' && !b.text.trim()) || (b.type === 'ink' && !b.strokes.length)
          || (b.type === 'check' && !b.items.some(x => x.text.trim()));
        if (!empty && !(await confirm_('このブロックを削除しますか', '書いた内容は元に戻せません。'))) return;
        it.blocks.splice(i, 1);
        PAGE.renderBlocks(); PAGE.touch(true);
        return;
      }
      case 'addItem':
        b.items.push({ text: '', done: false });
        PAGE.renderBlocks(); PAGE.touch();
        $$('.chk input[type=text]', $(`[data-bid="${b.id}"]`)).pop()?.focus();
        return;
      case 'rmItem':
        b.items.splice(+e.target.closest('.chk').dataset.j, 1);
        PAGE.renderBlocks(); PAGE.touch();
        return;
      case 'toggle': {
        const row = e.target.closest('.chk');
        const j = +row.dataset.j;
        b.items[j].done = !b.items[j].done;
        row.classList.toggle('on', b.items[j].done);
        $('.chkbox', row).setAttribute('aria-checked', String(b.items[j].done));
        $('.bk', blk).textContent = `チェックリスト ${b.items.filter(x => x.done).length}／${b.items.length}`;
        PAGE.touch();
        return;
      }
    }
  });

  $('#doc').addEventListener('input', e => {
    const it = state.editing; if (!it) return;
    const t = e.target;
    if (t.id === 'edTitle') { it.title = t.value.replace(/\n/g, ''); autogrow(t); return PAGE.touch(); }
    if (t.id === 'edAnswer') {
      const v = t.value;
      if (v.trim() && !it.answer.trim()) {
        if (!$('#edAnsweredBy').value && state.me) { $('#edAnsweredBy').value = state.me; it.answeredBy = state.me; }
        log(it, 'answer');
      }
      it.answer = v;
      it.answerAt = now();
      it.answerReadAt = now();
      autogrow(t);
      if (v.trim() && it.status === 'open') {
        it.status = 'wip';
        $('.cell[data-prop="status"] .cvalue').innerHTML = '<span class="status st-wip"><span class="dot"></span>確認中</span>';
      }
      $('#doneRow').hidden = !(v.trim() && it.status !== 'done');
      return PAGE.touch();
    }
    if (t.id === 'edAnsweredBy') { it.answeredBy = t.value.trim(); return PAGE.touch(); }
    const blk = t.closest('.block'); if (!blk) return;
    const b = it.blocks.find(x => x.id === blk.dataset.bid);
    if (b.type === 'text') { b.text = t.value; autogrow(t); }
    else if (b.type === 'check') { const row = t.closest('.chk'); if (row) b.items[+row.dataset.j].text = t.value; }
    else if (b.type === 'image') b.caption = t.value;
    PAGE.touch();
  });

  $('#imgFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f || !state.editing) return;
    try {
      const src = await shrinkImage(f);
      const b = { id: uid(), type: 'image', src, caption: '' };
      state.editing.blocks.push(b);
      PAGE.renderBlocks();
      PAGE.touch(true);
      requestAnimationFrame(() => $(`[data-bid="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    } catch { notice('写真を読み込めませんでした', '別の写真を選んでみてください。'); }
  });
  $('#fileImport').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importData(f);
  });

  // --- 外付けキーボード ---
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (layers.length) { e.preventDefault(); return dismissTop(); }
      if (state.editing) { e.preventDefault(); return PAGE.close(); }
    }
    const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (typing || layers.length) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#btnCompose').click(); }
    if (e.key === 'f' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#searchField').focus(); }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden) PAGE.flush(); });
  window.addEventListener('pagehide', () => PAGE.flush());

  if (state.firstRun) setTimeout(helpSheet, 400);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}

main().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend',
    `<div class="alert-wrap"><div class="alert"><div class="a-body"><div class="a-title">起動できませんでした</div><div class="a-msg">${esc(e.message)}</div></div></div></div>`);
});
})();
