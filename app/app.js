/* 疑問ノート v2 — OneNote風「セクション / ページ / ブロック」構成の疑問管理ノート
 * 依存ライブラリなし。データは端末内(IndexedDB)。JSONの書き出し/取り込みで共有。
 */
(() => {
'use strict';

// ============ 小道具 ============
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { open: '未解決', wip: '確認中', done: '解決' };
const STATUS_ICON = { open: '🔴', wip: '🟡', done: '🟢' };
const OLD_TAGS = { important: '⭐重要', todo: '☑やること', later: '📌あとで見る', share: '👥みんなにも' };
const PRESET_TAGS = ['⭐重要', '☑やること', '📌あとで見る', '👥みんなにも', '手順', '用語', 'よくある'];
const normTags = (arr) => [...new Set((arr || []).map(t => OLD_TAGS[t] || String(t).trim()).filter(Boolean))];
// 使用頻度順のタグ一覧(プリセット込み)
function allTags() { const n = {}; for (const it of state.items) for (const t of it.tags) n[t] = (n[t] || 0) + 1;
  return [...new Set([...Object.keys(n).sort((a, b) => n[b] - n[a]), ...PRESET_TAGS])].map(t => ({ t, n: n[t] || 0 })); }
const fmt = (t) => { if (!t) return ''; const d = new Date(t); const td = new Date(); const same = d.toDateString() === td.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; return same ? `今日 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`; };
let toastTimer;
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ============ 保存(IndexedDB) ============
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

// ============ 状態 ============
const DEFAULT_CATS = [
  { id: 'inbox', name: '未分類', color: '#868e96' },
  { id: 'c1', name: '受電対応', color: '#2f6fed' },
  { id: 'c2', name: 'エスカレーション', color: '#d9480f' },
  { id: 'c3', name: 'システム操作', color: '#0ca678' },
  { id: 'c4', name: 'シフト・勤怠', color: '#7c3aed' },
  { id: 'c5', name: '報告書', color: '#e8590c' },
];
const state = {
  items: [], cats: [], me: '',
  view: { type: 'home', id: null },      // home | all | pinned | tags | cat
  filter: { status: '', q: '', tag: '' },
  editing: null, dirty: false,
  ink: { tool: 'pen', color: '#1f2328', width: 3.5, penOnly: false },
};
const catOf = (id) => state.cats.find(c => c.id === id) || state.cats[0];
const catByName = (name) => state.cats.find(c => c.name === name);

// v1(単一手書き+本文) → v2(ブロック) へ変換
function migrate(it) {
  if (it.v === 2) return it;
  const blocks = [];
  if (it.strokes && it.strokes.length) blocks.push({ id: uid(), type: 'ink', strokes: it.strokes, w: it.padW || 800, h: it.padH || 320 });
  if (it.body && it.body.trim()) blocks.push({ id: uid(), type: 'text', text: it.body });
  const c = typeof it.cat === 'string' && !state.cats.find(x => x.id === it.cat) ? (catByName(it.cat) || null) : null;
  const out = { v: 2, id: it.id, title: it.title || '', cat: c ? c.id : (state.cats.find(x => x.id === it.cat) ? it.cat : 'inbox'),
    status: it.status || 'open', tags: normTags(it.tags), pinned: !!it.pinned, blocks: it.blocks || blocks,
    answer: it.answer || '', answeredBy: it.answeredBy || '', answerAt: it.answerAt || (it.answer ? it.updatedAt : 0), answerReadAt: it.answerReadAt || 0,
    history: it.history || [{ at: it.createdAt || now(), by: it.createdBy || '', ev: 'created' }],
    createdAt: it.createdAt || now(), updatedAt: it.updatedAt || now(), createdBy: it.createdBy || '' };
  return out;
}

async function load() {
  await DB.open();
  const meta = Object.fromEntries((await DB.all('meta')).map(x => [x.key, x.value]));
  state.me = meta.me || '';
  state.ink.penOnly = !!meta.penOnly;
  if (Array.isArray(meta.cats) && meta.cats.length && typeof meta.cats[0] === 'object') state.cats = meta.cats;
  else if (Array.isArray(meta.cats)) { // v1: 文字列配列
    state.cats = [DEFAULT_CATS[0], ...meta.cats.map((n, i) => ({ id: 'c' + (i + 1), name: n, color: DEFAULT_CATS[(i % 5) + 1].color }))];
    await saveCats();
  } else { state.cats = DEFAULT_CATS.slice(); await saveCats(); }
  if (!state.cats.find(c => c.id === 'inbox')) { state.cats.unshift(DEFAULT_CATS[0]); await saveCats(); }
  const raw = await DB.all('items');
  state.items = [];
  for (const r of raw) { const m = migrate(r); const nt = normTags(m.tags); const changed = m !== r || JSON.stringify(nt) !== JSON.stringify(m.tags); m.tags = nt; state.items.push(m); if (changed) await saveItem(m); }
  if (!meta.seeded) { await seed(); await DB.put('meta', { key: 'seeded', value: true }); }
  state.firstRun = !meta.me;
}
const saveCats = () => DB.put('meta', { key: 'cats', value: state.cats });
const saveMeta = (k, v) => DB.put('meta', { key: k, value: v });
const saveItem = (it) => DB.put('items', it);

async function seed() {
  if (state.items.length) return;
  const t = now();
  const it = { v: 2, id: uid(), title: '（例）このページは削除してOK：使い方の見本', cat: 'inbox', status: 'done', tags: ['📌あとで見る', 'よくある'], pinned: true,
    blocks: [
      { id: uid(), type: 'text', text: '疑問は1ページに1つ。殴り書きでもいいので、その場で残すのがコツです。\nタイトル・業務・タグはあとで直せます。' },
      { id: uid(), type: 'check', items: [{ text: '手書きは「✎ 手書き」で紙を追加', done: true }, { text: '写真は「📷 写真」で画面や資料を撮って貼る', done: true }, { text: '解決したら 🟢解決 にする', done: false }] },
    ],
    answer: '回答はこの緑の欄に書きます。LDが書いたら、ホームの「新しい回答」に出ます。\n解決済みのページは「🖨 FAQ」でまとめて印刷できます。', answeredBy: 'リーダー', answerAt: t, answerReadAt: t,
    history: [{ at: t, by: 'アプリ', ev: 'created' }, { at: t, by: 'リーダー', ev: 'answer' }, { at: t, by: 'アプリ', ev: 'status', v: 'done' }],
    createdAt: t, updatedAt: t, createdBy: 'アプリ' };
  state.items.push(it); await saveItem(it);
}

// ============ 派生データ ============
const isUnread = (it) => it.answer && it.answerAt > (it.answerReadAt || 0) && it.answeredBy !== state.me;
const textOf = (it) => [it.title, it.answer, it.answeredBy, it.createdBy, catOf(it.cat)?.name,
  ...it.blocks.map(b => b.type === 'text' ? b.text : b.type === 'check' ? b.items.map(x => x.text).join(' ') : b.type === 'image' ? b.caption : '')].join('\n').toLowerCase();
const firstLine = (it) => { for (const b of it.blocks) { if (b.type === 'text' && b.text.trim()) return b.text.trim().split('\n')[0]; if (b.type === 'check' && b.items.length) return '☑ ' + b.items[0].text; } return ''; };
// 関連ページ: タグ共有 > 同じ業務 > 文字の重なり(2文字ずつ)
function grams(s) { const g = new Set(); const t = s.replace(/[\s、。・,.（）()「」【】\[\]]/g, ''); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
function related(it, limit = 5) {
  const mine = grams((it.title + ' ' + it.blocks.filter(b => b.type === 'text').map(b => b.text).join(' ')).slice(0, 400).toLowerCase());
  return state.items.filter(o => o.id !== it.id).map(o => {
    const shared = o.tags.filter(t => it.tags.includes(t));
    let score = shared.length * 4 + (o.cat === it.cat ? 1.5 : 0) + (o.answer ? 0.5 : 0);
    const og = grams((o.title + ' ' + o.blocks.filter(b => b.type === 'text').map(b => b.text).join(' ')).slice(0, 400).toLowerCase());
    let hit = 0; for (const g of og) if (mine.has(g)) hit++;
    const sim = hit / Math.max(8, Math.min(mine.size, og.size));
    score += sim * 10;
    const why = shared.length ? `タグ「${shared[0]}」` : sim > 0.15 ? '似た内容' : o.cat === it.cat ? '同じ業務' : '';
    return { ...o, score, why };
  }).filter(o => o.score >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}
function log(it, ev, v) { it.history = it.history || []; it.history.push({ at: now(), by: state.me, ev, v }); if (it.history.length > 60) it.history.shift(); }

function viewItems() {
  const { type, id } = state.view;
  let arr = state.items;
  if (type === 'cat') arr = arr.filter(i => i.cat === id);
  if (type === 'pinned') arr = arr.filter(i => i.pinned);
  if (type === 'tags') arr = arr.filter(i => i.tags && i.tags.length);
  if (type === 'unread') arr = arr.filter(isUnread);
  const { status, q, tag } = state.filter; const qq = q.trim().toLowerCase();
  if (status) arr = arr.filter(i => i.status === status);
  if (tag) arr = arr.filter(i => i.tags.includes(tag));
  if (qq) arr = arr.filter(i => textOf(i).includes(qq));
  const o = { open: 0, wip: 1, done: 2 };
  return arr.slice().sort((a, b) => (b.pinned - a.pinned) || (o[a.status] - o[b.status]) || (b.updatedAt - a.updatedAt));
}

// ============ 描画: サイドバー ============
function renderNav() {
  const counts = {}; let open = 0, unread = 0, pinned = 0, tagged = 0;
  for (const it of state.items) {
    if (it.status !== 'done') { counts[it.cat] = (counts[it.cat] || 0) + 1; open++; }
    if (isUnread(it)) unread++; if (it.pinned) pinned++; if (it.tags?.length) tagged++;
  }
  const v = state.view;
  const row = (type, id, ico, name, n, cls = '') => `<button class="navi ${v.type === type && v.id === id ? 'active' : ''}" data-type="${type}" data-id="${id ?? ''}">
      ${ico}<span class="nm">${esc(name)}</span>${n !== undefined ? `<span class="n ${cls} ${n ? '' : 'zero'}">${n}</span>` : ''}</button>`;
  let h = row('home', null, '<span class="ico">🏠</span>', 'ホーム', unread, 'new');
  h += row('all', null, '<span class="ico">📚</span>', 'すべて', open);
  h += row('pinned', null, '<span class="ico">📌</span>', 'ピン留め', pinned, 'zero');
  h += row('tags', null, '<span class="ico">🏷</span>', 'タグ', tagged, 'zero');
  h += `<div class="lbl">業務（セクション）</div>`;
  for (const c of state.cats) h += row('cat', c.id, `<span class="dot" style="background:${c.color}"></span>`, c.name, counts[c.id] || 0);
  h += `<button class="navi" id="navAddCat" style="color:var(--muted);font-size:14px"><span class="ico">＋</span><span class="nm">業務を追加・編集</span></button>`;
  $('#nav').innerHTML = h;
  $('#meLabel').textContent = state.me ? `${state.me} ／ 設定` : '設定';
}

// ============ 描画: 一覧 / ホーム ============
function renderList() {
  const v = state.view;
  const title = { home: 'ホーム', all: 'すべて', pinned: '📌 ピン留め', tags: '🏷 タグの概要', unread: '💬 新しい回答' }[v.type] ||
    (v.type === 'cat' ? `<span class="dot" style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${catOf(v.id).color}"></span>${esc(catOf(v.id).name)}` : '');
  $('#viewTitle').innerHTML = title;
  $('#filters').hidden = v.type === 'home';
  renderTagFilter();
  $('#home').hidden = v.type !== 'home';
  $('#list').hidden = v.type === 'home';
  if (v.type === 'home') return renderHome();

  const items = viewItems();
  const list = $('#list');
  if (!items.length) {
    const msg = state.filter.q ? `「${esc(state.filter.q)}」に一致するページはありません。` :
      v.type === 'pinned' ? 'ページの右上「📌」でピン留めすると、ここに集まります。' :
      v.type === 'tags' ? 'ページに「⭐重要」「☑やること」などのタグを付けると、ここに集まります。' :
      v.type === 'cat' ? `<b>${esc(catOf(v.id).name)}</b> の疑問はまだありません。<br>「＋ 疑問を書く」を押すと、この業務に入ります。` :
      'まだページがありません。<br>右下の「＋ 疑問を書く」から始めましょう。';
    list.innerHTML = `<div class="empty"><div class="big">📝</div>${msg}</div>`;
    return;
  }
  let h = (state.filter.q || state.filter.tag) ? `<div class="group-h">検索結果 ${items.length} 件</div>` : '';
  if (v.type === 'tags') {
    for (const { t } of allTags()) {
      const grp = items.filter(i => i.tags.includes(t)); if (!grp.length) continue;
      h += `<div class="group-h">🏷 ${esc(t)}（${grp.length}）</div>` + grp.map(card).join('');
    }
  } else if (!state.filter.status && !state.filter.q && !state.filter.tag) {
    const pin = items.filter(i => i.pinned);
    if (pin.length) h += `<div class="group-h">📌 ピン留め</div>` + pin.map(card).join('');
    for (const s of ['open', 'wip', 'done']) {
      const grp = items.filter(i => !i.pinned && i.status === s); if (!grp.length) continue;
      h += `<div class="group-h">${STATUS_ICON[s]} ${STATUS[s]}（${grp.length}）</div>` + grp.map(card).join('');
    }
  } else h = items.map(card).join('');
  list.innerHTML = h;
}

function renderTagFilter() {
  const tags = allTags().filter(x => x.n > 0);
  const el = $('#tagChips'); el.hidden = !tags.length;
  el.innerHTML = `<button class="chip sm ${state.filter.tag ? '' : 'on'}" data-tag="">🏷 すべて</button>` +
    tags.map(x => `<button class="chip sm ${state.filter.tag === x.t ? 'on' : ''}" data-tag="${esc(x.t)}">${esc(x.t)} <span class="muted">${x.n}</span></button>`).join('');
}
function card(it) {
  const c = catOf(it.cat);
  const th = thumb(it);
  const line = firstLine(it);
  return `<button class="card ${state.editing?.id === it.id ? 'sel' : ''}" data-id="${it.id}">
    <span class="bar" style="background:${c.color}"></span>
    ${th ? `<img class="thumb" alt="" src="${th}">` : `<span class="thumb ph">${it.blocks.some(b => b.type === 'check') ? '☑' : 'Ａ'}</span>`}
    <div class="body">
      <div class="t ${it.title ? '' : 'untitled'}">${it.pinned ? '📌 ' : ''}${esc(it.title || line || '（無題）')}${isUnread(it) ? ' <span class="pill new">新しい回答</span>' : ''}</div>
      <div class="m"><span class="pill ${it.status}">${STATUS[it.status]}</span><span class="pill cat">${esc(c.name)}</span><span>${fmt(it.updatedAt)}</span>${it.createdBy ? `<span>${esc(it.createdBy)}</span>` : ''}
        ${it.tags?.length ? it.tags.slice(0, 3).map(t => `<span class="pill tag">${esc(t)}</span>`).join('') : ''}</div>
      ${it.answer ? `<div class="a">💬 ${esc(it.answer)}</div>` : ''}
    </div></button>`;
}

function renderHome() {
  const open = state.items.filter(i => i.status === 'open').length;
  const wip = state.items.filter(i => i.status === 'wip').length;
  const done = state.items.filter(i => i.status === 'done').length;
  const unread = state.items.filter(isUnread);
  const recent = state.items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  const todo = state.items.filter(i => i.tags?.includes('todo') && i.status !== 'done');
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'おはようございます' : hour < 17 ? 'こんにちは' : 'お疲れさまです';
  const tipHidden = localStorage.getItem('tipHidden') === '1';
  $('#home').innerHTML = `
    <h2>${greet}${state.me ? '、' + esc(state.me) + 'さん' : ''}</h2>
    <div class="sub">分からないことは、そのまま書いて残せばOK。答えはあとから集まります。</div>
    <div class="capture">
      <textarea id="qc" rows="2" placeholder="今、何に困っている？ ここに書いて「残す」だけでOK"></textarea>
      <div class="qc-acts"><button class="btn sm ghost" id="qcInk">✎ 手書きで</button><span style="flex:1"></span><button class="btn sm primary" id="qcSave">残す</button></div>
    </div>
    ${tipHidden ? '' : `<div class="tip">💡<div>タイトルや業務はあとでOK。残したメモは「未分類」に入るので、落ち着いたときに整理しましょう。</div><button class="x" id="tipX">✕</button></div>`}
    ${rediscoverCard()}
    <div class="tiles">
      <button class="tile open" data-go="all:open"><div class="k">未解決</div><div class="v">${open}</div></button>
      <button class="tile wip" data-go="all:wip"><div class="k">確認中</div><div class="v">${wip}</div></button>
      <button class="tile new" data-go="unread:"><div class="k">新しい回答</div><div class="v">${unread.length}</div></button>
      <button class="tile done" data-go="all:done"><div class="k">解決（FAQ）</div><div class="v">${done}</div></button>
    </div>
    ${unread.length ? `<h3>💬 新しい回答が届いています</h3>` + unread.slice(0, 5).map(card).join('') : ''}
    ${todo.length ? `<h3>☑ やること</h3>` + todo.slice(0, 5).map(card).join('') : ''}
    <h3>🕒 最近さわったページ</h3>
    ${recent.length ? recent.map(card).join('') : `<div class="empty">まだページがありません。<br>右下の「＋ 疑問を書く」から始めましょう。</div>`}`;
}

// 今日の再発見: 14日以上前のページから、日替わりで1つ
function rediscoverCard() {
  const old = state.items.filter(i => now() - i.createdAt > 14 * 864e5 && i.createdBy !== 'アプリ');
  if (!old.length) return '';
  const day = Math.floor(now() / 864e5); const it = old[day % old.length];
  const days = Math.round((now() - it.createdAt) / 864e5);
  const hint = it.status === 'done' ? 'もう覚えていますか？' : it.status === 'open' ? 'まだ未解決です。誰かに聞けそう？' : '回答待ちのままです';
  return `<button class="redis" data-id="${it.id}"><span class="ri">🔭</span><span><b>${days}日前の「${esc(it.title || firstLine(it) || '（無題）')}」を見返してみませんか？</b><br><span class="muted small">${esc(catOf(it.cat).name)} ・ ${hint}</span></span><span class="muted">›</span></button>`;
}
async function quickCapture(text) {
  const it = newItem('text'); it.blocks = [{ id: uid(), type: 'text', text }]; it.title = '';
  state.items.push(it); await saveItem(it); renderAll(); toast('未分類に残しました。あとで整理すればOK');
}
// サムネイル(手書き or 写真)
const thumbCache = new Map();
function thumb(it) {
  const b = it.blocks.find(x => (x.type === 'ink' && x.strokes.length) || (x.type === 'image' && x.src));
  if (!b) return '';
  const key = it.id + ':' + it.updatedAt;
  if (thumbCache.has(key)) return thumbCache.get(key);
  let url = '';
  if (b.type === 'image') url = b.src;
  else {
    const W = 128, H = 96; const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const s = W / (b.w || 800); ctx.scale(s, s); drawStrokes(ctx, b.strokes, 1 / s);
    url = c.toDataURL('image/png');
  }
  thumbCache.set(key, url); return url;
}

function renderAll() { renderNav(); renderList(); }

// ============ 手書き ============
function drawStrokes(ctx, strokes, lineScale) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    const pts = s.points; if (!pts || pts.length < 2) continue;
    if (s.tool === 'hl') {
      ctx.globalCompositeOperation = 'multiply'; ctx.strokeStyle = s.color; ctx.globalAlpha = .35; ctx.lineWidth = s.w * lineScale;
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      ctx.globalAlpha = 1; continue;
    }
    ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    const base = s.tool === 'eraser' ? s.w * 6 : s.w;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1, p] = pts[i];
      ctx.lineWidth = base * (0.6 + 0.8 * (p ?? 0.5)) * lineScale;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

class Pad {
  constructor(wrap, canvas, block, onChange) {
    this.wrap = wrap; this.canvas = canvas; this.block = block; this.onChange = onChange;
    this.ctx = canvas.getContext('2d'); this.cur = null; this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const c = canvas;
    c.addEventListener('pointerdown', e => this.down(e)); c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e)); c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('touchstart', e => e.preventDefault(), { passive: false }); c.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(wrap);
    wrap.style.height = (block.h || 320) + 'px';
  }
  destroy() { this.ro.disconnect(); }
  resize() {
    const r = this.wrap.getBoundingClientRect(); if (!r.width) return;
    this.w = r.width; this.h = r.height;
    if (!this.block.w) this.block.w = Math.round(r.width);
    this.canvas.width = Math.round(r.width * this.dpr); this.canvas.height = Math.round(r.height * this.dpr);
    this.redraw();
  }
  scale() { return this.w && this.block.w ? this.w / this.block.w : 1; }
  redraw() {
    const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.dpr * this.scale(); ctx.setTransform(k, 0, 0, k, 0, 0);
    drawStrokes(ctx, this.block.strokes, 1); if (this.cur) drawStrokes(ctx, [this.cur], 1);
  }
  pt(e) { const r = this.canvas.getBoundingClientRect(); const s = this.scale(); const p = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [Math.round((e.clientX - r.left) / s * 10) / 10, Math.round((e.clientY - r.top) / s * 10) / 10, Math.round(p * 100) / 100]; }
  accept(e) { return !(state.ink.penOnly && e.pointerType === 'touch'); }
  down(e) {
    if (!this.accept(e)) return; e.preventDefault(); this.canvas.setPointerCapture(e.pointerId);
    const { tool, color, width } = state.ink;
    this.cur = { tool, color: tool === 'hl' ? '#ffe066' : color, w: tool === 'hl' ? 18 : width, points: [this.pt(e)] };
  }
  move(e) {
    if (!this.cur || !this.accept(e)) return; e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) this.cur.points.push(this.pt(ev));
    if (this.cur.tool === 'hl') return this.redraw();
    const k = this.dpr * this.scale(); this.ctx.setTransform(k, 0, 0, k, 0, 0);
    const n = this.cur.points.length;
    drawStrokes(this.ctx, [{ ...this.cur, points: this.cur.points.slice(Math.max(0, n - evs.length - 2)) }], 1);
  }
  up() {
    if (!this.cur) return;
    if (this.cur.points.length === 1) this.cur.points.push(this.cur.points[0]);
    this.block.strokes.push(this.cur); this.cur = null; this.redraw(); this.onChange();
  }
  undo() { this.block.strokes.pop(); this.redraw(); this.onChange(); }
  clear() { this.block.strokes = []; this.redraw(); this.onChange(); }
  setHeight(h) { this.block.h = Math.max(160, Math.round(h)); this.wrap.style.height = this.block.h + 'px'; }
}

// ============ エディタ ============
const ED = {
  pads: new Map(),
  init() {
    $('#edBack').onclick = () => this.close();
    $('#edDone').onclick = () => this.close();
    $('#edDelete').onclick = () => this.remove();
    $('#edPin').onclick = () => { const it = state.editing; it.pinned = !it.pinned; $('#edPin').classList.toggle('on', it.pinned); toast(it.pinned ? 'ピン留めしました' : 'ピン留めを外しました'); this.touch(true); };
    $('#edShare').onclick = () => exportData([state.editing]);
    $('#edTitle').addEventListener('input', () => { state.editing.title = $('#edTitle').value; this.touch(); });
    $('#edStatus').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; this.setStatus(b.dataset.s, true); });
    $('#edCats').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.editing.cat = b.dataset.cat; this.renderProps(); this.touch(true); });
    $('#edTags').addEventListener('click', async e => { const b = e.target.closest('button'); if (!b) return; const it = state.editing;
      let t = b.dataset.tag;
      if (b.dataset.newtag) { t = (await prompt_('新しいタグ', '例：転送、用語、深夜帯')); if (!t) return; t = t.replace(/^#/, '').trim(); if (!t) return; if (!it.tags.includes(t)) it.tags.push(t); }
      else it.tags = it.tags.includes(t) ? it.tags.filter(x => x !== t) : [...it.tags, t];
      this.renderProps(); this.renderRelated(); this.touch(true); });
    $('#edAnswer').addEventListener('input', () => {
      const it = state.editing; const v = $('#edAnswer').value;
      if (v.trim() && !it.answer.trim()) { if (!$('#edAnsweredBy').value && state.me) $('#edAnsweredBy').value = state.me; log(it, 'answer'); }
      it.answer = v; it.answeredBy = $('#edAnsweredBy').value.trim(); it.answerAt = now(); it.answerReadAt = now();
      if (v.trim() && it.status === 'open') this.setStatus('wip', false);
      $('#doneCta').hidden = !(v.trim() && it.status !== 'done'); $('#edAnsweredAt').textContent = fmt(it.answerAt);
      this.touch();
    });
    $('#edAnsweredBy').addEventListener('input', () => { state.editing.answeredBy = $('#edAnsweredBy').value.trim(); this.touch(); });
    $('#btnMarkDone').onclick = () => { this.setStatus('done', true); toast('🎉 解決にしました。FAQに載ります'); };
    $$('.addblk [data-add]').forEach(b => b.onclick = () => this.addBlock(b.dataset.add));
    $('#imgFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const src = await shrinkImage(f); const blk = { id: uid(), type: 'image', src, caption: '' }; state.editing.blocks.push(blk); this.renderBlocks(); this.touch(true); this.scrollToBlock(blk.id); });
    $('#blocks').addEventListener('click', e => this.onBlockClick(e));
    $('#blocks').addEventListener('input', e => this.onBlockInput(e));
    $('#blocks').addEventListener('change', e => this.onBlockInput(e));
  },
  open(it) {
    if (state.editing && state.editing !== it) this.flush();
    state.editing = it; state.dirty = false;
    if (isUnread(it)) { it.answerReadAt = now(); saveItem(it); }
    $('#edEmpty').hidden = true; $('#edBody').hidden = false; $$('#edPin,#edShare,#edDone').forEach(b => b.hidden = false);
    $('#edTitle').value = it.title;
    $('#edAnswer').value = it.answer; $('#edAnsweredBy').value = it.answeredBy; $('#edAnsweredAt').textContent = fmt(it.answerAt);
    $('#doneCta').hidden = !(it.answer.trim() && it.status !== 'done');
    $('#edPin').classList.toggle('on', it.pinned);
    this.renderProps(); this.renderBlocks(); this.renderHistory(); this.renderRelated();
    $('#editPane').classList.add('open'); $('#editPane .scroll').scrollTop = 0;
    renderAll();
  },
  renderProps() {
    const it = state.editing;
    $$('#edStatus button').forEach(b => b.classList.toggle('on', b.dataset.s === it.status));
    $('#edCats').innerHTML = state.cats.map(c => `<button class="chip catchip ${c.id === it.cat ? 'on' : ''}" data-cat="${c.id}" style="${c.id === it.cat ? 'border-color:' + c.color : ''}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('');
    const cand = [...new Set([...it.tags, ...allTags().map(x => x.t)])].slice(0, 10);
    $('#edTags').innerHTML = cand.map(t => `<button class="chip tagchip ${it.tags.includes(t) ? 'on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('') +
      `<button class="chip" data-newtag="1">＋ タグ</button>`;
    const c = catOf(it.cat);
    $('#edCrumb').innerHTML = `<span class="dot" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${c.color}"></span><span class="muted small">${esc(c.name)}</span>`;
  },
  setStatus(s, withLog) {
    const it = state.editing; if (it.status === s) return;
    it.status = s; if (withLog) log(it, 'status', s);
    $$('#edStatus button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
    $('#doneCta').hidden = !(it.answer.trim() && s !== 'done');
    this.renderHistory(); this.touch(true);
  },
  renderRelated() {
    const it = state.editing; const rel = related(it);
    $('#relatedBox').hidden = !rel.length;
    $('#relatedList').innerHTML = rel.map(r => `<button class="rel" data-id="${r.id}"><span class="dot" style="background:${catOf(r.cat).color}"></span>
      <span class="rt">${esc(r.title || firstLine(r) || '（無題）')}</span><span class="pill ${r.status}">${STATUS[r.status]}</span><span class="muted small">${esc(r.why)}</span></button>`).join('');
  },
  renderHistory() {
    const it = state.editing;
    const ev = (h) => h.ev === 'created' ? '作成' : h.ev === 'status' ? `ステータス → ${STATUS[h.v] || h.v}` : h.ev === 'answer' ? '回答を記入' : h.ev === 'import' ? '取り込みで更新' : h.ev;
    $('#historyList').innerHTML = (it.history || []).slice().reverse().map(h => `<li>${fmt(h.at)}　${esc(h.by || '')}　${ev(h)}</li>`).join('') || '<li>なし</li>';
  },
  // ---- ブロック ----
  renderBlocks() {
    for (const p of this.pads.values()) p.destroy(); this.pads.clear();
    const it = state.editing;
    const inkTools = `<div class="ink-tools">
        <button class="tool ${state.ink.tool === 'pen' ? 'on' : ''}" data-tool="pen" title="ペン">✎</button>
        <button class="tool ${state.ink.tool === 'hl' ? 'on' : ''}" data-tool="hl" title="蛍光ペン">🖍</button>
        <button class="tool ${state.ink.tool === 'eraser' ? 'on' : ''}" data-tool="eraser" title="消しゴム">◻</button><span class="sep"></span>
        ${['#1f2328', '#d9480f', '#2f6fed', '#2b8a3e'].map(c => `<button class="swatch ${state.ink.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}<span class="sep"></span>
        ${[[2, '·'], [3.5, '•'], [6, '●']].map(([w, l]) => `<button class="tool ${state.ink.width === w ? 'on' : ''}" data-w="${w}">${l}</button>`).join('')}<span class="sep"></span>
        <button class="tool" data-act="undo" title="元に戻す">↶</button><button class="tool" data-act="clearInk" title="全消去">🗑</button>
        <button class="tool ${state.ink.penOnly ? 'on' : ''}" data-act="penOnly" title="ペンのみ受付（指を無視）">✋</button></div>`;
    const ctl = (i, n) => `<button class="tool" data-act="up" ${i === 0 ? 'disabled style="opacity:.25"' : ''} title="上へ">↑</button><button class="tool" data-act="down" ${i === n - 1 ? 'disabled style="opacity:.25"' : ''} title="下へ">↓</button><button class="tool" data-act="del" title="削除">✕</button>`;
    $('#blocks').innerHTML = it.blocks.map((b, i) => {
      const n = it.blocks.length;
      if (b.type === 'ink') return `<div class="blk" data-bid="${b.id}"><div class="bh">${inkTools}${ctl(i, n)}</div><div class="canvas-wrap"><canvas class="pad"></canvas><div class="grip" title="ドラッグで紙を伸ばす">═</div></div></div>`;
      if (b.type === 'text') return `<div class="blk" data-bid="${b.id}"><div class="bh"><span class="k">Ａ テキスト</span>${ctl(i, n)}</div><textarea placeholder="${esc(b.placeholder || 'ここに書く（Apple Pencilならそのまま手書き入力できます）')}">${esc(b.text)}</textarea></div>`;
      if (b.type === 'check') return `<div class="blk" data-bid="${b.id}"><div class="bh"><span class="k">☑ チェックリスト ${b.items.filter(x => x.done).length}/${b.items.length}</span>${ctl(i, n)}</div><div class="check">
          ${b.items.map((x, j) => `<div class="ci ${x.done ? 'done' : ''}" data-j="${j}"><input type="checkbox" ${x.done ? 'checked' : ''}><input type="text" value="${esc(x.text)}" placeholder="項目"><button class="tool rm" data-act="rmItem">✕</button></div>`).join('')}
          <button class="add" data-act="addItem">＋ 項目を追加</button></div></div>`;
      if (b.type === 'image') return `<div class="blk" data-bid="${b.id}"><div class="bh"><span class="k">📷 写真</span>${ctl(i, n)}</div><div class="img"><img src="${b.src}" alt=""><input type="text" value="${esc(b.caption || '')}" placeholder="説明（任意）"></div></div>`;
      return '';
    }).join('');
    for (const el of $$('#blocks .blk')) {
      const b = it.blocks.find(x => x.id === el.dataset.bid);
      if (b.type === 'ink') {
        const pad = new Pad($('.canvas-wrap', el), $('canvas', el), b, () => this.touch());
        this.pads.set(b.id, pad);
        const grip = $('.grip', el); let y0, h0;
        grip.addEventListener('pointerdown', e => { y0 = e.clientY; h0 = pad.h; grip.setPointerCapture(e.pointerId); e.preventDefault(); });
        grip.addEventListener('pointermove', e => { if (y0 === undefined) return; pad.setHeight(h0 + e.clientY - y0); });
        grip.addEventListener('pointerup', () => { y0 = undefined; this.touch(); });
      }
      if (b.type === 'text') { const ta = $('textarea', el); autogrow(ta); }
    }
  },
  onBlockClick(e) {
    const btn = e.target.closest('button'); if (!btn) return;
    const el = e.target.closest('.blk'); const it = state.editing; const b = it.blocks.find(x => x.id === el.dataset.bid); const i = it.blocks.indexOf(b);
    if (btn.dataset.tool) { state.ink.tool = btn.dataset.tool; this.syncInkTools(); return; }
    if (btn.dataset.color) { state.ink.color = btn.dataset.color; if (state.ink.tool !== 'pen') state.ink.tool = 'pen'; this.syncInkTools(); return; }
    if (btn.dataset.w) { state.ink.width = +btn.dataset.w; this.syncInkTools(); return; }
    const act = btn.dataset.act; const pad = this.pads.get(b.id);
    if (act === 'undo') pad.undo();
    else if (act === 'clearInk') confirm_('この手書きを全部消しますか？', '消去').then(ok => ok && pad.clear());
    else if (act === 'penOnly') { state.ink.penOnly = !state.ink.penOnly; saveMeta('penOnly', state.ink.penOnly); this.syncInkTools(); toast(state.ink.penOnly ? '✋ ペンのみ受け付け（指は無視）' : '指でも書けます'); }
    else if (act === 'up' && i > 0) { it.blocks.splice(i, 1); it.blocks.splice(i - 1, 0, b); this.renderBlocks(); this.touch(true); }
    else if (act === 'down' && i < it.blocks.length - 1) { it.blocks.splice(i, 1); it.blocks.splice(i + 1, 0, b); this.renderBlocks(); this.touch(true); }
    else if (act === 'del') {
      const empty = (b.type === 'text' && !b.text.trim()) || (b.type === 'ink' && !b.strokes.length) || (b.type === 'check' && !b.items.some(x => x.text.trim()));
      (empty ? Promise.resolve(true) : confirm_('このブロックを削除しますか？', '削除')).then(ok => { if (!ok) return; it.blocks.splice(i, 1); this.renderBlocks(); this.touch(true); });
    }
    else if (act === 'addItem') { b.items.push({ text: '', done: false }); this.renderBlocks(); $$('.ci input[type=text]', $(`[data-bid="${b.id}"]`)).pop()?.focus(); this.touch(); }
    else if (act === 'rmItem') { const j = +e.target.closest('.ci').dataset.j; b.items.splice(j, 1); this.renderBlocks(); this.touch(); }
  },
  onBlockInput(e) {
    const el = e.target.closest('.blk'); if (!el) return;
    const b = state.editing.blocks.find(x => x.id === el.dataset.bid);
    if (b.type === 'text') { b.text = e.target.value; autogrow(e.target); }
    else if (b.type === 'check') { const ci = e.target.closest('.ci'); if (!ci) return; const j = +ci.dataset.j;
      if (e.target.type === 'checkbox') { b.items[j].done = e.target.checked; ci.classList.toggle('done', e.target.checked); $('.k', el).textContent = `☑ チェックリスト ${b.items.filter(x => x.done).length}/${b.items.length}`; }
      else b.items[j].text = e.target.value; }
    else if (b.type === 'image') b.caption = e.target.value;
    this.touch();
  },
  syncInkTools() {
    $$('#blocks [data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === state.ink.tool));
    $$('#blocks [data-color]').forEach(x => x.classList.toggle('on', x.dataset.color === state.ink.color));
    $$('#blocks [data-w]').forEach(x => x.classList.toggle('on', +x.dataset.w === state.ink.width));
    $$('#blocks [data-act="penOnly"]').forEach(x => x.classList.toggle('on', state.ink.penOnly));
    $('#penOnly').checked = state.ink.penOnly;
  },
  addBlock(type) {
    if (type === 'image') return $('#imgFile').click();
    const b = type === 'ink' ? { id: uid(), type, strokes: [], w: 0, h: 320 } : type === 'check' ? { id: uid(), type, items: [{ text: '', done: false }] } : { id: uid(), type, text: '' };
    state.editing.blocks.push(b); this.renderBlocks(); this.touch(true); this.scrollToBlock(b.id);
    const el = $(`[data-bid="${b.id}"]`); const inp = el && $('textarea, input[type=text]', el); if (inp) inp.focus();
  },
  scrollToBlock(id) { requestAnimationFrame(() => $(`[data-bid="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); },
  // ---- 保存 ----
  touch(immediate) { state.dirty = true; if (immediate) this.save(); else this.saveDebounced(); },
  saveDebounced: debounce(() => ED.save(), 500),
  async save() {
    const it = state.editing; if (!it) return;
    it.updatedAt = now();
    if (!state.items.includes(it)) state.items.push(it);
    await saveItem(it); state.dirty = false;
    renderAll();
  },
  flush() { if (state.editing && state.dirty) return this.save(); },
  isEmpty(it) { return !it.title.trim() && !it.answer.trim() && !it.blocks.some(b => (b.type === 'text' && b.text.trim()) || (b.type === 'ink' && b.strokes.length) || (b.type === 'check' && b.items.some(x => x.text.trim())) || b.type === 'image'); },
  async close() {
    const it = state.editing; if (!it) return;
    if (this.isEmpty(it)) { state.items = state.items.filter(x => x !== it); await DB.del('items', it.id); toast('空のページは保存しませんでした'); }
    else if (state.dirty || !state.items.includes(it)) await this.save();
    for (const p of this.pads.values()) p.destroy(); this.pads.clear();
    state.editing = null; $('#edBody').hidden = true; $('#edEmpty').hidden = false; $$('#edPin,#edShare,#edDone').forEach(b => b.hidden = true); $('#editPane').classList.remove('open');
    renderAll();
  },
  async remove() {
    const it = state.editing; if (!(await confirm_('このページを削除しますか？（取り消せません）', '削除する'))) return;
    state.items = state.items.filter(x => x !== it); await DB.del('items', it.id);
    for (const p of this.pads.values()) p.destroy(); this.pads.clear();
    state.editing = null; $('#edBody').hidden = true; $('#edEmpty').hidden = false; $$('#edPin,#edShare,#edDone').forEach(b => b.hidden = true); $('#editPane').classList.remove('open');
    renderAll(); toast('削除しました');
  },
};
function autogrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.max(56, ta.scrollHeight + 2) + 'px'; }
function shrinkImage(file) {
  return new Promise((res) => { const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const M = 1400; const s = Math.min(1, M / Math.max(img.width, img.height)); const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82)); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('画像を読み込めませんでした'); res(''); }; img.src = url; }).then(src => src || Promise.reject());
}

// ============ 新規作成(テンプレート) ============
function newItem(tpl) {
  const cat = state.view.type === 'cat' ? state.view.id : 'inbox';
  const blocks = {
    ink: [{ id: uid(), type: 'ink', strokes: [], w: 0, h: 360 }],
    question: [{ id: uid(), type: 'text', text: '', placeholder: '【状況】いつ・どの業務で・何が起きた？' }, { id: uid(), type: 'text', text: '', placeholder: '【自分がやったこと / 調べたこと】' }, { id: uid(), type: 'text', text: '', placeholder: '【聞きたいこと】ズバリ何を知りたい？' }],
    steps: [{ id: uid(), type: 'check', items: [{ text: '', done: false }, { text: '', done: false }, { text: '', done: false }] }, { id: uid(), type: 'text', text: '', placeholder: '補足・注意点' }],
    call: [{ id: uid(), type: 'text', text: '', placeholder: '【相手】会社名・名前・連絡先' }, { id: uid(), type: 'text', text: '', placeholder: '【用件】' }, { id: uid(), type: 'text', text: '', placeholder: '【対応したこと】' }, { id: uid(), type: 'check', items: [{ text: '', done: false }] }],
    text: [{ id: uid(), type: 'text', text: '' }],
  }[tpl] || [{ id: uid(), type: 'ink', strokes: [], w: 0, h: 360 }];
  const it = { v: 2, id: uid(), title: '', cat, status: 'open', tags: tpl === 'call' ? ['☑やること'] : [], pinned: false, blocks,
    answer: '', answeredBy: '', answerAt: 0, answerReadAt: 0, history: [{ at: now(), by: state.me, ev: 'created' }], createdAt: now(), updatedAt: now(), createdBy: state.me };
  if (tpl === 'steps') it.status = 'done';
  return it;
}

// ============ ダイアログ類 ============
function confirm_(text, yes = '実行', title = '確認') {
  return new Promise(res => { const d = $('#dlgConfirm');
    $('#cfTitle').textContent = title; $('#cfText').textContent = text; $('#cfYes').textContent = yes;
    const done = (v) => { d.close(); $('#cfYes').onclick = $('#cfNo').onclick = null; res(v); };
    $('#cfYes').onclick = () => done(true); $('#cfNo').onclick = () => done(false); d.showModal(); });
}
function prompt_(title, placeholder) {
  return new Promise(res => { const d = $('#dlgPrompt'); $('#ptTitle').textContent = title; const inp = $('#ptInput'); inp.value = ''; inp.placeholder = placeholder || '';
    const done = (v) => { d.close(); $('#ptOk').onclick = $('#ptNo').onclick = null; inp.onkeydown = null; res(v); };
    $('#ptOk').onclick = () => done(inp.value.trim()); $('#ptNo').onclick = () => done(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(inp.value.trim()); } };
    d.showModal(); setTimeout(() => inp.focus(), 50); });
}
function catDialog() {
  const d = $('#dlgCats'); let cats = state.cats.map(c => ({ ...c }));
  const draw = () => { $('#catEdit').innerHTML = cats.map((c, i) => `<div class="c" data-i="${i}">
      <input type="color" value="${c.color}"><input type="text" value="${esc(c.name)}" ${c.id === 'inbox' ? 'title="未分類は固定です"' : ''}>
      <button data-up="${i}">↑</button><button data-down="${i}">↓</button>${c.id === 'inbox' ? '<span style="width:30px"></span>' : `<button data-del="${i}">✕</button>`}</div>`).join(''); };
  const read = () => { $$('#catEdit .c').forEach(row => { const i = +row.dataset.i; cats[i].color = $('input[type=color]', row).value; cats[i].name = $('input[type=text]', row).value; }); };
  draw();
  $('#catEdit').onclick = e => { const b = e.target.closest('button'); if (!b) return; read();
    const i = +(b.dataset.del ?? b.dataset.up ?? b.dataset.down);
    if (b.dataset.del !== undefined) { const used = state.items.filter(x => x.cat === cats[i].id).length;
      (used ? confirm_(`「${cats[i].name}」には ${used} ページあります。削除すると「未分類」に移動します。`, '削除する') : Promise.resolve(true)).then(ok => { if (ok) { cats.splice(i, 1); draw(); } }); return; }
    if (b.dataset.up !== undefined && i > 0) [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
    if (b.dataset.down !== undefined && i < cats.length - 1) [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
    draw(); };
  $('#catAdd').onclick = () => { read(); cats.push({ id: uid(), name: '', color: ['#2f6fed', '#d9480f', '#0ca678', '#7c3aed', '#e8590c', '#c2255c', '#1098ad'][cats.length % 7] }); draw(); $$('#catEdit input[type=text]').pop().focus(); };
  $('#catCancel').onclick = () => d.close();
  $('#catSave').onclick = async () => { read();
    cats = cats.map(c => ({ ...c, name: c.name.trim() })).filter(c => c.name || c.id === 'inbox'); if (!cats.find(c => c.id === 'inbox')) cats.unshift(DEFAULT_CATS[0]);
    const ids = new Set(cats.map(c => c.id));
    for (const it of state.items) if (!ids.has(it.cat)) { it.cat = 'inbox'; await saveItem(it); }
    state.cats = cats; await saveCats();
    if (state.view.type === 'cat' && !ids.has(state.view.id)) state.view = { type: 'all', id: null };
    d.close(); renderAll(); if (state.editing) ED.renderProps(); toast('業務カテゴリを保存しました'); };
  d.showModal();
}
function settingsDialog(focusName) {
  const d = $('#dlgSettings'); $('#nameInput').value = state.me; $('#penOnly').checked = state.ink.penOnly;
  d.showModal(); if (focusName) setTimeout(() => $('#nameInput').focus(), 50);
}

// ============ 共有(書き出し/取り込み) ============
async function exportData(items) {
  const all = !items; items = items || state.items;
  const payload = { app: 'gimon-note', version: 2, exportedAt: new Date().toISOString(), by: state.me, cats: state.cats, items };
  const d = new Date(); const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const name = all ? `疑問ノート_${state.me || 'noname'}_${ymd}.json` : `疑問ノート_${(items[0].title || 'ページ').slice(0, 20)}_${ymd}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('ダウンロードしました');
}
async function importData(file) {
  let data; try { data = JSON.parse(await file.text()); } catch { toast('読み込めませんでした'); return; }
  if (!data || data.app !== 'gimon-note' || !Array.isArray(data.items)) { toast('疑問ノートのファイルではありません'); return; }
  // カテゴリ: idが同じなら同一。無ければ名前で照合、無ければ追加
  const idMap = {};
  for (const c of (data.cats || [])) {
    if (typeof c === 'string') { const m = catByName(c); if (m) idMap[c] = m.id; else { const n = { id: uid(), name: c, color: '#868e96' }; state.cats.push(n); idMap[c] = n.id; } continue; }
    if (state.cats.find(x => x.id === c.id)) { idMap[c.id] = c.id; continue; }
    const m = catByName(c.name); if (m) idMap[c.id] = m.id; else { state.cats.push({ ...c }); idMap[c.id] = c.id; }
  }
  await saveCats();
  const mine = new Map(state.items.map(i => [i.id, i]));
  let added = 0, updated = 0, skipped = 0;
  for (const raw of data.items) {
    const it = migrate({ ...raw, cat: idMap[raw.cat] || raw.cat }); if (!state.cats.find(c => c.id === it.cat)) it.cat = 'inbox';
    const cur = mine.get(it.id);
    if (!cur) { it.history = [...(it.history || []), { at: now(), by: state.me, ev: 'import' }]; state.items.push(it); await saveItem(it); added++; }
    else if ((it.updatedAt || 0) > (cur.updatedAt || 0)) {
      if (!it.answer && cur.answer) { it.answer = cur.answer; it.answeredBy = cur.answeredBy; it.answerAt = cur.answerAt; if (it.status === 'open') it.status = cur.status; }
      if (cur.answerReadAt > (it.answerReadAt || 0)) it.answerReadAt = cur.answerReadAt;
      it.history = [...(it.history || []), { at: now(), by: state.me, ev: 'import' }];
      Object.assign(cur, it); await saveItem(cur); updated++;
    } else skipped++;
  }
  renderAll(); if (state.editing) ED.open(state.editing);
  toast(`取り込み完了：追加 ${added} ／ 更新 ${updated} ／ 変更なし ${skipped}`);
}

// ============ FAQ印刷 ============
function printFAQ() {
  const src = viewItems().filter(i => i.status === 'done');
  if (!src.length) { toast('この一覧に「解決」のページがありません'); return; }
  const v = state.view; const title = v.type === 'cat' ? catOf(v.id).name : 'すべての業務';
  $('#printView').innerHTML = `<h2>FAQ：${esc(title)}（${src.length}件）</h2><div class="pm" style="color:#666;font-size:12px;margin-bottom:12px">疑問ノートより ${new Date().toLocaleDateString('ja-JP')} 出力</div>` +
    src.map(it => { const q = it.blocks.filter(b => b.type === 'text' && b.text.trim()).map(b => esc(b.text)).join('\n');
      const ck = it.blocks.filter(b => b.type === 'check').map(b => b.items.map(x => (x.done ? '☑ ' : '☐ ') + esc(x.text)).join('\n')).join('\n');
      const im = it.blocks.filter(b => (b.type === 'ink' && b.strokes.length) || b.type === 'image').map(b => `<img src="${b.type === 'image' ? b.src : inkPng(b)}">`).join('');
      return `<div class="pq"><h4>Q. ${esc(it.title || firstLine(it) || '（無題）')}</h4><div class="pm">${esc(catOf(it.cat).name)}　${it.createdBy ? esc(it.createdBy) + '　' : ''}${fmt(it.createdAt)}</div>
        ${q || ck ? `<div class="pa" style="color:#444">${q}${q && ck ? '\n' : ''}${ck}</div>` : ''}${im}<div class="pa"><b>A.</b> ${esc(it.answer || '（回答未記入）')}${it.answeredBy ? `<span class="pm">　— ${esc(it.answeredBy)}</span>` : ''}</div></div>`; }).join('');
  setTimeout(() => window.print(), 50);
}
function inkPng(b) { const W = 800, H = Math.round(W * (b.h || 320) / (b.w || 800)); const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); const s = W / (b.w || 800); ctx.scale(s, s); drawStrokes(ctx, b.strokes, 1 / s); return c.toDataURL('image/png'); }

// ============ 配線 ============
function go(type, id, status) {
  state.view = { type, id: id || null }; state.filter.tag = ''; if (status !== undefined) { state.filter.status = status; $$('#statusChips button').forEach(b => b.classList.toggle('on', b.dataset.s === status)); }
  $('#side').classList.remove('open'); $('#sideBg').hidden = true; $('#listScroll').scrollTop = 0; renderAll();
}
async function main() {
  await load();
  ED.init();
  renderAll();

  $('#nav').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.id === 'navAddCat') return catDialog(); go(b.dataset.type, b.dataset.id || null); });
  $('#btnMenu').onclick = () => { $('#side').classList.toggle('open'); $('#sideBg').hidden = !$('#side').classList.contains('open'); };
  $('#sideBg').onclick = () => { $('#side').classList.remove('open'); $('#sideBg').hidden = true; };
  $('#listScroll').addEventListener('click', e => {
    const tile = e.target.closest('[data-go]'); if (tile) { const [t, s] = tile.dataset.go.split(':'); return go(t, null, s); }
    if (e.target.id === 'tipX') { localStorage.setItem('tipHidden', '1'); return renderHome(); }
    if (e.target.id === 'qcSave') { const t = $('#qc').value.trim(); if (!t) { $('#qc').focus(); return; } return quickCapture(t); }
    if (e.target.id === 'qcInk') { const it = newItem('ink'); const t = $('#qc').value.trim(); if (t) it.blocks.unshift({ id: uid(), type: 'text', text: t }); return ED.open(it); }
    const rd = e.target.closest('.redis'); if (rd) { const it = state.items.find(x => x.id === rd.dataset.id); if (it) ED.open(it); return; }
    const c = e.target.closest('.card'); if (!c) return; const it = state.items.find(x => x.id === c.dataset.id); if (it) ED.open(it);
  });
  $('#q').addEventListener('input', e => { state.filter.q = e.target.value; renderList(); });
  $('#tagChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.filter.tag = b.dataset.tag; renderList(); });
  $('#relatedList').addEventListener('click', e => { const b = e.target.closest('.rel'); if (!b) return; const it = state.items.find(x => x.id === b.dataset.id); if (it) ED.open(it); });
  $('#statusChips').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.filter.status = b.dataset.s; $$('#statusChips button').forEach(x => x.classList.toggle('on', x === b)); renderList(); });
  $('#btnPrint').onclick = printFAQ;

  // 新規作成
  $('#fab').onclick = () => { $('#newSheet').hidden = false; };
  $('#newCancel').onclick = () => { $('#newSheet').hidden = true; };
  $('#newSheet').addEventListener('click', e => { if (e.target === $('#newSheet')) $('#newSheet').hidden = true; const b = e.target.closest('.tpl'); if (!b) return; $('#newSheet').hidden = true; ED.open(newItem(b.dataset.tpl));
    if (b.dataset.tpl !== 'ink') setTimeout(() => $('#edTitle').focus(), 250); });

  // 設定・ヘルプ
  $('#btnHelp').onclick = () => $('#dlgHelp').showModal();
  $('#helpClose').onclick = () => { $('#dlgHelp').close(); if (!state.me) settingsDialog(true); };
  $('#btnSettings').onclick = () => settingsDialog(false);
  $('#settingsClose').onclick = async () => { state.me = $('#nameInput').value.trim(); await saveMeta('me', state.me); state.ink.penOnly = $('#penOnly').checked; await saveMeta('penOnly', state.ink.penOnly); $('#dlgSettings').close(); renderAll(); };
  $('#btnCats').onclick = () => { $('#dlgSettings').close(); catDialog(); };
  $('#btnExport').onclick = () => exportData();
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) { $('#dlgSettings').close(); await importData(f); } });

  // キーボード(PC)
  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === 'Escape' && state.editing) { e.preventDefault(); ED.close(); }
    if (typing) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); $('#newSheet').hidden = false; }
    if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) ED.flush(); });
  window.addEventListener('pagehide', () => ED.flush());

  if (state.firstRun) setTimeout(() => $('#dlgHelp').showModal(), 300);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
main().catch(e => { console.error(e); alert('起動に失敗しました: ' + e.message); });
})();
