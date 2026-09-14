/* 疑問ノート — iPad Safari 向け、インストール不要の疑問管理ノート
 * 依存ライブラリなし。データは端末内(IndexedDB)に保存し、JSONの書き出し/取り込みで共有する。
 */
(() => {
'use strict';

// ---------- 小道具 ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => Date.now();
const STATUS = { open: '未解決', wip: '確認中', done: '解決' };
const fmt = (t) => { const d = new Date(t); return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let toastTimer;
const toast = (msg) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 1800); };

// ---------- 保存(IndexedDB) ----------
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('gimon-note', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  },
  all(store) { return new Promise((res, rej) => { const r = this.db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  put(store, v) { return this.tx(store, 'readwrite', s => s.put(v)); },
  del(store, k) { return this.tx(store, 'readwrite', s => s.delete(k)); },
};

// ---------- 状態 ----------
const state = {
  items: [],
  cats: [],
  me: '',
  filter: { cat: null, status: '', q: '' },
  editing: null,      // 編集中のitem(参照)
  dirty: false,
};
const DEFAULT_CATS = ['受電対応', 'エスカレーション', 'システム操作', 'シフト・勤怠', '報告書', 'その他'];

async function load() {
  await DB.open();
  state.items = await DB.all('items');
  const meta = await DB.all('meta');
  const m = Object.fromEntries(meta.map(x => [x.key, x.value]));
  state.cats = m.cats || DEFAULT_CATS.slice();
  state.me = m.me || '';
  if (!m.cats) await DB.put('meta', { key: 'cats', value: state.cats });
}
const saveCats = () => DB.put('meta', { key: 'cats', value: state.cats });
const saveMe = () => DB.put('meta', { key: 'me', value: state.me });
const saveItem = (it) => DB.put('items', it);

// ---------- 一覧描画 ----------
const thumbCache = new Map(); // id+updatedAt -> dataURL
function renderCats() {
  const wrap = $('#cats');
  const counts = {};
  let totalOpen = 0;
  for (const it of state.items) {
    if (it.status !== 'done') { counts[it.cat] = (counts[it.cat] || 0) + 1; totalOpen++; }
  }
  const row = (label, key, n) =>
    `<button class="cat ${state.filter.cat === key ? 'active' : ''}" data-cat="${esc(key ?? '')}">
       <span>${esc(label)}</span><span class="n ${n ? '' : 'zero'}">${n}</span></button>`;
  let html = row('すべて', null, totalOpen);
  for (const c of state.cats) html += row(c, c, counts[c] || 0);
  const orphan = state.items.filter(i => !state.cats.includes(i.cat)).length;
  if (orphan) html += row('（カテゴリ未設定）', '__none__', orphan);
  wrap.innerHTML = html;
  $('#sub').textContent = `未解決 ${totalOpen} 件 / 全 ${state.items.length} 件`;
  $('#myName').textContent = state.me || '名前未設定';
}

function filtered() {
  const { cat, status, q } = state.filter;
  const qq = q.trim().toLowerCase();
  return state.items
    .filter(i => cat === null ? true : cat === '__none__' ? !state.cats.includes(i.cat) : i.cat === cat)
    .filter(i => !status || i.status === status)
    .filter(i => !qq || [i.title, i.body, i.answer, i.cat, i.createdBy, i.answeredBy].join('\n').toLowerCase().includes(qq))
    .sort((a, b) => {
      const o = { open: 0, wip: 1, done: 2 };
      if (o[a.status] !== o[b.status]) return o[a.status] - o[b.status];
      return b.updatedAt - a.updatedAt;
    });
}

function renderList() {
  const items = filtered();
  const list = $('#list');
  $('#viewTitle').textContent = state.filter.cat === null ? 'すべて' : state.filter.cat === '__none__' ? '（カテゴリ未設定）' : state.filter.cat;
  if (!items.length) {
    list.innerHTML = `<div class="empty">まだありません。<br>右下の「＋」で、疑問をそのまま手書きで残せます。</div>`;
    return;
  }
  list.innerHTML = items.map(i => `
    <button class="item" data-id="${i.id}">
      <img class="thumb" alt="" data-thumb="${i.id}" src="${thumb(i)}">
      <div class="body">
        <div class="t ${i.title ? '' : 'untitled'}">${esc(i.title || (i.body ? i.body.split('\n')[0] : '（手書きのみ）'))}</div>
        <div class="m">
          <span class="pill ${i.status}">${STATUS[i.status]}</span>
          <span>${esc(i.cat)}</span>
          <span>${fmt(i.updatedAt)}</span>
          ${i.createdBy ? `<span>by ${esc(i.createdBy)}</span>` : ''}
        </div>
        ${i.answer ? `<div class="a">✔ ${esc(i.answer)}</div>` : ''}
      </div>
    </button>`).join('');
}

function thumb(it) {
  const key = it.id + ':' + it.updatedAt;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const W = 144, H = 108;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  if (it.strokes && it.strokes.length) {
    const padW = it.padW || 800, padH = Math.min(it.padH || 320, padW * H / W);
    const s = W / padW;
    ctx.save(); ctx.scale(s, s);
    drawStrokes(ctx, it.strokes, 1 / s);
    ctx.restore();
  } else {
    ctx.fillStyle = '#c9c7c0'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('文字のみ', W / 2, H / 2 + 5);
  }
  const url = c.toDataURL('image/png');
  thumbCache.set(key, url);
  return url;
}

function renderAll() { renderCats(); renderList(); }

// ---------- 手書きパッド ----------
const Pad = {
  canvas: null, ctx: null, wrap: null,
  strokes: [], cur: null,
  tool: 'pen', color: '#1f2328', width: 3.5, penOnly: false,
  dpr: 1, w: 0, h: 0,
  onChange: null,
  init() {
    this.canvas = $('#pad'); this.wrap = $('#canvasWrap'); this.ctx = this.canvas.getContext('2d');
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this.down(e));
    c.addEventListener('pointermove', e => this.move(e));
    c.addEventListener('pointerup', e => this.up(e));
    c.addEventListener('pointercancel', e => this.up(e));
    c.addEventListener('pointerleave', e => this.up(e));
    // Safariのタッチスクロール/長押しメニューを抑止
    c.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    c.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    new ResizeObserver(() => this.resize()).observe(this.wrap);
    this.penOnly = localStorage.getItem('penOnly') === '1';
    $('#skPenOnly').classList.toggle('on', this.penOnly);
  },
  resize() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width) return;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.redraw();
  },
  setHeight(h) { this.wrap.style.height = h + 'px'; },
  load(strokes, padW, padH) {
    // 記録時の幅と今の幅が違えば拡大縮小して描く
    this.srcW = padW || this.w || 800;
    this.strokes = (strokes || []).map(s => ({ ...s, points: s.points.slice() }));
    this.setHeight(padH || 320);
    this.redraw();
  },
  scale() { return this.w && this.srcW ? this.w / this.srcW : 1; },
  redraw() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.dpr * this.scale();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    drawStrokes(ctx, this.strokes, 1);
    if (this.cur) drawStrokes(ctx, [this.cur], 1);
  },
  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    const s = this.scale();
    const p = e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5;
    return [(e.clientX - r.left) / s, (e.clientY - r.top) / s, Math.round(p * 100) / 100];
  },
  accept(e) { return !(this.penOnly && e.pointerType === 'touch'); },
  down(e) {
    if (!this.accept(e)) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.cur = { tool: this.tool, color: this.color, w: this.width, points: [this.pt(e)] };
  },
  move(e) {
    if (!this.cur || !this.accept(e)) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) this.cur.points.push(this.pt(ev));
    // 直近だけ描いて軽くする
    const ctx = this.ctx;
    const k = this.dpr * this.scale();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    const n = this.cur.points.length;
    drawStrokes(ctx, [{ ...this.cur, points: this.cur.points.slice(Math.max(0, n - evs.length - 2)) }], 1);
  },
  up(e) {
    if (!this.cur) return;
    if (this.cur.points.length === 1) this.cur.points.push(this.cur.points[0]);
    this.strokes.push(this.cur); this.cur = null;
    this.redraw();
    this.onChange && this.onChange();
  },
  undo() { this.strokes.pop(); this.redraw(); this.onChange && this.onChange(); },
  clear() { this.strokes = []; this.redraw(); this.onChange && this.onChange(); },
  export() { return { strokes: this.strokes, padW: Math.round(this.srcW || this.w), padH: Math.round(this.h) }; },
};

function drawStrokes(ctx, strokes, lineScale) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    const pts = s.points; if (!pts || pts.length < 2) continue;
    ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.color;
    const base = s.tool === 'eraser' ? s.w * 5 : s.w;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1, p] = pts[i];
      ctx.lineWidth = base * (0.6 + 0.8 * (p ?? 0.5)) * lineScale;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- エディタ ----------
const ED = {
  el: null, saveTimer: null,
  init() {
    this.el = $('#editor');
    Pad.init();
    Pad.onChange = () => this.touch();
    $('#edBack').onclick = () => this.close();
    $('#edDone').onclick = () => this.close();
    $('#edDelete').onclick = () => this.remove();
    for (const id of ['edTitle', 'edBody', 'edAnswer', 'edAnsweredBy', 'edCat']) $('#' + id).addEventListener('input', () => this.touch());
    $('#edStatus').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      this.setStatus(b.dataset.s); this.touch();
    });
    $('#edAnswer').addEventListener('input', () => {
      // 回答が書かれたら自動で「確認中」以上に
      if ($('#edAnswer').value.trim() && state.editing.status === 'open') this.setStatus('wip');
      if (!$('#edAnsweredBy').value && state.me) $('#edAnsweredBy').value = state.me;
    });
    // パッド操作
    $$('#sketch .tools [data-tool]').forEach(b => b.onclick = () => { Pad.tool = b.dataset.tool; $$('#sketch .tools [data-tool]').forEach(x => x.classList.toggle('on', x === b)); });
    $$('#swatches .swatch').forEach(b => b.onclick = () => { Pad.color = b.dataset.color; Pad.tool = 'pen'; $$('#swatches .swatch').forEach(x => x.classList.toggle('on', x === b)); $$('#sketch .tools [data-tool]').forEach(x => x.classList.toggle('on', x.dataset.tool === 'pen')); });
    $$('#sketch .tools [data-w]').forEach(b => b.onclick = () => { Pad.width = +b.dataset.w; $$('#sketch .tools [data-w]').forEach(x => x.classList.toggle('on', x === b)); });
    $('#skUndo').onclick = () => Pad.undo();
    $('#skClear').onclick = () => confirm_('手書きを全部消しますか？', '消去').then(ok => ok && Pad.clear());
    $('#skTaller').onclick = () => { Pad.setHeight(Pad.h + 240); this.touch(); };
    $('#skPenOnly').onclick = () => { Pad.penOnly = !Pad.penOnly; localStorage.setItem('penOnly', Pad.penOnly ? '1' : '0'); $('#skPenOnly').classList.toggle('on', Pad.penOnly); toast(Pad.penOnly ? 'ペンのみ受け付け（指は無視）' : '指でも書けます'); };
  },
  fillCats() {
    const sel = $('#edCat');
    const cur = state.editing.cat;
    const cats = state.cats.includes(cur) || !cur ? state.cats : [cur, ...state.cats];
    sel.innerHTML = cats.map(c => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  },
  setStatus(s) {
    state.editing.status = s;
    $$('#edStatus button').forEach(b => b.classList.toggle('on', b.dataset.s === s));
  },
  open(item) {
    state.editing = item; state.dirty = false;
    $('#edTitle').value = item.title || '';
    $('#edBody').value = item.body || '';
    $('#edAnswer').value = item.answer || '';
    $('#edAnsweredBy').value = item.answeredBy || '';
    this.fillCats(); this.setStatus(item.status);
    $('#edMeta').innerHTML = `作成 ${fmt(item.createdAt)}${item.createdBy ? ' / ' + esc(item.createdBy) : ''}　更新 ${fmt(item.updatedAt)}`;
    this.el.hidden = false;
    requestAnimationFrame(() => { Pad.resize(); Pad.load(item.strokes, item.padW, item.padH); });
  },
  collect() {
    const it = state.editing;
    it.title = $('#edTitle').value.trim();
    it.body = $('#edBody').value;
    it.answer = $('#edAnswer').value;
    it.answeredBy = $('#edAnsweredBy').value.trim();
    it.cat = $('#edCat').value;
    Object.assign(it, Pad.export());
  },
  touch() {
    state.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 600);
  },
  async save() {
    if (!state.editing) return;
    this.collect();
    const it = state.editing;
    it.updatedAt = now();
    if (!state.items.includes(it)) state.items.push(it);
    await saveItem(it);
    state.dirty = false;
  },
  async close() {
    clearTimeout(this.saveTimer);
    const it = state.editing;
    this.collect();
    const empty = !it.title && !it.body.trim() && !it.answer.trim() && !(it.strokes && it.strokes.length);
    if (empty) {
      if (state.items.includes(it)) { state.items = state.items.filter(x => x !== it); await DB.del('items', it.id); }
    } else if (state.dirty || !state.items.includes(it)) {
      await this.save();
    }
    state.editing = null;
    this.el.hidden = true;
    renderAll();
  },
  async remove() {
    const it = state.editing;
    if (!(await confirm_('この疑問を削除しますか？（取り消せません）', '削除'))) return;
    clearTimeout(this.saveTimer);
    state.items = state.items.filter(x => x !== it);
    await DB.del('items', it.id);
    state.editing = null; this.el.hidden = true; renderAll();
    toast('削除しました');
  },
};

function newItem() {
  const cat = (state.filter.cat && state.filter.cat !== '__none__') ? state.filter.cat : (state.cats[0] || 'その他');
  return { id: uid(), title: '', body: '', answer: '', answeredBy: '', cat, status: 'open', strokes: [], padW: 0, padH: 320, createdAt: now(), updatedAt: now(), createdBy: state.me };
}

// ---------- ダイアログ ----------
function confirm_(text, yes = '実行', title = '確認') {
  return new Promise(res => {
    const d = $('#dlgConfirm');
    $('#cfTitle').textContent = title; $('#cfText').textContent = text; $('#cfYes').textContent = yes;
    const done = (v) => { d.close(); $('#cfYes').onclick = $('#cfNo').onclick = null; res(v); };
    $('#cfYes').onclick = () => done(true); $('#cfNo').onclick = () => done(false);
    d.showModal();
  });
}

function catDialog() {
  const d = $('#dlgCats');
  let cats = state.cats.slice();
  const draw = () => {
    $('#catEdit').innerHTML = cats.map((c, i) => `
      <div class="c">
        <input type="text" value="${esc(c)}" data-i="${i}">
        <button data-up="${i}" title="上へ">↑</button><button data-down="${i}" title="下へ">↓</button><button data-del="${i}" title="削除">✕</button>
      </div>`).join('');
  };
  draw();
  const read = () => { $$('#catEdit input').forEach(inp => cats[+inp.dataset.i] = inp.value); };
  $('#catEdit').onclick = e => {
    const b = e.target.closest('button'); if (!b) return; read();
    if (b.dataset.del !== undefined) cats.splice(+b.dataset.del, 1);
    if (b.dataset.up !== undefined) { const i = +b.dataset.up; if (i > 0) [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; }
    if (b.dataset.down !== undefined) { const i = +b.dataset.down; if (i < cats.length - 1) [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]]; }
    draw();
  };
  $('#catAdd').onclick = () => { read(); cats.push(''); draw(); const inps = $$('#catEdit input'); inps[inps.length - 1].focus(); };
  $('#catCancel').onclick = () => d.close();
  $('#catSave').onclick = async () => {
    read();
    const old = state.cats;
    const cleaned = [...new Set(cats.map(c => c.trim()).filter(Boolean))];
    // 名前変更をそのまま既存データに反映（位置対応）
    const rename = {};
    old.forEach((o, i) => { if (cats[i] !== undefined && cats[i].trim() && cats[i].trim() !== o) rename[o] = cats[i].trim(); });
    if (Object.keys(rename).length) {
      for (const it of state.items) if (rename[it.cat]) { it.cat = rename[it.cat]; await saveItem(it); }
    }
    state.cats = cleaned.length ? cleaned : ['その他'];
    await saveCats();
    if (state.filter.cat && !state.cats.includes(state.filter.cat)) state.filter.cat = null;
    d.close(); renderAll(); toast('カテゴリを保存しました');
  };
  d.showModal();
}

function nameDialog() {
  const d = $('#dlgName');
  $('#nameInput').value = state.me;
  $('#nameCancel').onclick = () => d.close();
  $('#nameSave').onclick = async () => { state.me = $('#nameInput').value.trim(); await saveMe(); d.close(); renderCats(); };
  d.showModal();
}

// ---------- 共有(書き出し/取り込み) ----------
async function exportData() {
  const payload = { app: 'gimon-note', version: 1, exportedAt: new Date().toISOString(), by: state.me, cats: state.cats, items: state.items };
  const json = JSON.stringify(payload);
  const d = new Date();
  const name = `疑問ノート_${state.me || 'noname'}_${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function importData(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('読み込めませんでした'); return; }
  if (!data || data.app !== 'gimon-note' || !Array.isArray(data.items)) { toast('疑問ノートのファイルではありません'); return; }
  const mine = new Map(state.items.map(i => [i.id, i]));
  let added = 0, updated = 0, skipped = 0;
  for (const it of data.items) {
    const cur = mine.get(it.id);
    if (!cur) { state.items.push(it); await saveItem(it); added++; }
    else if ((it.updatedAt || 0) > (cur.updatedAt || 0)) {
      // 回答だけこちらに書き込んであった場合、相手側が空なら残す
      if (!it.answer && cur.answer) { it.answer = cur.answer; it.answeredBy = cur.answeredBy; if (it.status === 'open') it.status = cur.status; }
      Object.assign(cur, it); await saveItem(cur); updated++;
    } else skipped++;
  }
  for (const c of data.cats || []) if (!state.cats.includes(c)) state.cats.push(c);
  await saveCats();
  renderAll();
  toast(`取り込み完了：追加 ${added} / 更新 ${updated} / 変更なし ${skipped}`);
}

// ---------- 配線 ----------
async function main() {
  await load();
  ED.init();
  renderAll();

  $('#cats').addEventListener('click', e => {
    const b = e.target.closest('.cat'); if (!b) return;
    const v = b.dataset.cat;
    state.filter.cat = v === '' ? null : v;
    $('#side').classList.remove('open');
    renderAll();
  });
  $('#btnMenu').onclick = () => $('#side').classList.toggle('open');
  $('#list').addEventListener('click', e => {
    const b = e.target.closest('.item'); if (!b) return;
    const it = state.items.find(x => x.id === b.dataset.id); if (it) ED.open(it);
  });
  $('#q').addEventListener('input', e => { state.filter.q = e.target.value; renderList(); });
  $('#statusSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.filter.status = b.dataset.s;
    $$('#statusSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderList();
  });
  $('#fab').onclick = () => ED.open(newItem());
  $('#btnCats').onclick = catDialog;
  $('#btnName').onclick = nameDialog;
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').addEventListener('change', async e => { const f = e.target.files[0]; if (f) await importData(f); e.target.value = ''; });

  // 画面を閉じる/裏に回るときに保存
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.editing && state.dirty) ED.save(); });

  if (!state.me) setTimeout(nameDialog, 400);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
}
main().catch(e => { console.error(e); alert('起動に失敗しました: ' + e.message); });
})();
