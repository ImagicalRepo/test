// ガント画面のモック用データ（実際のサーバー応答と同じ形）
function pad(n){return n<10?'0'+n:''+n;}
function key(y,m,d){return y+'-'+pad(m)+'-'+pad(d);}

const TODAY = '2026-09-09';
const HOLIDAYS = [
  ['2026-08-11','山の日'],['2026-09-21','敬老の日'],['2026-09-22','国民の休日'],
  ['2026-09-23','秋分の日'],['2026-10-12','スポーツの日'],['2026-11-03','文化の日'],
  ['2026-11-23','勤労感謝の日'],['2026-12-29','年末年始（閉庁）'],['2026-12-30','年末年始（閉庁）'],
  ['2026-12-31','年末年始（閉庁）']
].map(h=>({key:h[0],name:h[1]}));

function lane(workId, workName, color, period, anchorKey, anchorName, items){
  const its = items.map((it,i)=>({
    key: workId+'|'+period+'|'+((i+1)*10),
    seq:(i+1)*10, name:it[0], dueKey:it[1],
    weekday:'', status: it[2]||'未着手', owner: it[3]||'', note:'',
    isAnchor: it[1]===anchorKey,
    overdue: it[1] < TODAY && (it[2]||'未着手')!=='完了',
    remaining: Math.round((new Date(it[1])-new Date(TODAY))/86400000/7*5)
  }));
  return {
    laneKey: workId+'|'+period, workId, workName, period, anchorKey, anchorName, color,
    from: its[0].dueKey, to: its[its.length-1].dueKey, items: its,
    doneCount: its.filter(x=>x.status==='完了').length
  };
}

const LANES = [
  lane('NAN','指定難病 医療費助成（月次審査会）','青','2026-09','2026-09-09','審査会',[
    ['申請受付分の締切','2026-08-12','完了','田中'],
    ['形式審査・不備照会の完了','2026-08-19','完了','田中'],
    ['審査会資料の作成・システム入力','2026-08-26','完了','佐藤'],
    ['資料の最終確認（係内）','2026-08-28','着手中','佐藤'],
    ['審査委員へ資料送付','2026-08-31','未着手','田中'],
    ['審査委員からの意見返送期限','2026-09-04','未着手',''],
    ['審査会','2026-09-09','未着手',''],
    ['審査結果の整理・記録作成','2026-09-10','未着手','佐藤'],
    ['認定/不認定 決裁の起案・システム入力','2026-09-11','未着手','田中'],
    ['決裁完了（見込）','2026-09-16','未着手',''],
    ['受給者証・通知書の印刷','2026-09-17','未着手','鈴木'],
    ['封入封緘・点検','2026-09-18','未着手','鈴木'],
    ['受給者証の発送','2026-09-24','未着手','鈴木'],
    ['台帳更新・報告用データ反映','2026-09-28','未着手','佐藤']
  ]),
  lane('NAN','指定難病 医療費助成（月次審査会）','青','2026-10','2026-10-14','審査会',[
    ['申請受付分の締切','2026-09-15','未着手','田中'],
    ['形式審査・不備照会の完了','2026-09-24','未着手','田中'],
    ['審査会資料の作成・システム入力','2026-09-30','未着手','佐藤'],
    ['審査委員へ資料送付','2026-10-05','未着手','田中'],
    ['審査会','2026-10-14','未着手',''],
    ['決裁完了（見込）','2026-10-21','未着手',''],
    ['受給者証の発送','2026-10-27','未着手','鈴木']
  ]),
  lane('KOSIN','指定難病 更新申請（一斉更新）','緑','2026','2026-09-01','受付開始',[
    ['更新案内の印刷・封入準備','2026-08-04','完了','鈴木'],
    ['更新案内の一斉発送','2026-08-18','完了','鈴木'],
    ['更新申請 受付開始','2026-09-01','着手中',''],
    ['受付期間 中間点検（未提出者の把握）','2026-10-01','未着手','佐藤'],
    ['更新申請 受付締切','2026-11-02','未着手',''],
    ['未提出者への勧奨通知','2026-11-09','未着手','田中']
  ]),
  lane('SHOMAN','小児慢性特定疾病 医療費助成','橙','2026-09','2026-09-22','審査会',[
    ['申請受付分の締切','2026-08-31','未着手','山本'],
    ['医療意見書の確認・審査会資料作成','2026-09-09','未着手','山本'],
    ['審査会','2026-09-24','未着手',''],
    ['決裁起案','2026-09-29','未着手','山本'],
    ['受給者証の発送','2026-10-06','未着手','鈴木']
  ]),
  lane('JIRITSU','自立支援医療（精神通院）','紫','2026-09','2026-09-15','処理締切',[
    ['申請受付分の締切','2026-09-01','完了','高橋'],
    ['審査・システム入力','2026-09-08','着手中','高橋'],
    ['処理締切','2026-09-15','未着手',''],
    ['受給者証の発送','2026-09-25','未着手','鈴木']
  ])
];

const digestItems = (arr) => arr.map(x=>({
  workId:x.workId, workName:x.workName, color:x.color, period:x.period,
  seq:x.seq, name:x.name, dueKey:x.dueKey, owner:x.owner, status:x.status,
  note:'', remainingBusinessDays:x.remainingBusinessDays
}));

window.MOCK_DATA = {
  today: TODAY,
  from: '2026-08-01',
  to: '2026-12-31',
  works: [
    {id:'NAN', name:'指定難病 医療費助成（月次審査会）', enabled:true, anchorName:'審査会', rule:'毎月第2水', color:'青'},
    {id:'KOSIN', name:'指定難病 更新申請（一斉更新）', enabled:true, anchorName:'受付開始', rule:'毎年9月1日', color:'緑'},
    {id:'SHOMAN', name:'小児慢性特定疾病 医療費助成', enabled:true, anchorName:'審査会', rule:'毎月第4火', color:'橙'},
    {id:'JIRITSU', name:'自立支援医療（精神通院）', enabled:true, anchorName:'処理締切', rule:'毎月15日', color:'紫'}
  ],
  lanes: LANES,
  holidays: HOLIDAYS,
  weekendDays: [0,6],
  editorUrl: '',   // ウェブアプリ公開時のみ値が入る（既定は非表示）
  digest: {
    overdue: digestItems([
      {workId:'NAN',workName:'指定難病 医療費助成',color:'青',period:'2026-09',seq:50,name:'審査委員へ資料送付',dueKey:'2026-08-31',owner:'田中',status:'未着手',remainingBusinessDays:-6},
      {workId:'SHOMAN',workName:'小児慢性特定疾病',color:'橙',period:'2026-09',seq:10,name:'申請受付分の締切',dueKey:'2026-08-31',owner:'山本',status:'未着手',remainingBusinessDays:-6}
    ]),
    today: digestItems([
      {workId:'SHOMAN',workName:'小児慢性特定疾病',color:'橙',period:'2026-09',seq:20,name:'医療意見書の確認・審査会資料作成',dueKey:'2026-09-09',owner:'山本',status:'未着手',remainingBusinessDays:0},
      {workId:'NAN',workName:'指定難病 医療費助成',color:'青',period:'2026-09',seq:70,name:'審査会',dueKey:'2026-09-09',owner:'',status:'未着手',remainingBusinessDays:0}
    ]),
    soon: digestItems([
      {workId:'NAN',workName:'指定難病 医療費助成',color:'青',period:'2026-09',seq:90,name:'認定/不認定 決裁の起案・システム入力',dueKey:'2026-09-11',owner:'田中',status:'未着手',remainingBusinessDays:2},
      {workId:'JIRITSU',workName:'自立支援医療（精神通院）',color:'紫',period:'2026-09',seq:30,name:'処理締切',dueKey:'2026-09-15',owner:'',status:'未着手',remainingBusinessDays:4}
    ]),
    total: 6
  },
  statusList: ['未着手','着手中','完了','対象外']
};

// google.script.run のスタブ
window.google = { script: { run: new Proxy({}, {
  get(t, prop) {
    if (prop === 'withSuccessHandler') return (fn)=>{ window.__ok = fn; return window.google.script.run; };
    if (prop === 'withFailureHandler') return ()=> window.google.script.run;
    return (...args)=>{ setTimeout(()=> window.__ok && window.__ok(window.MOCK_DATA), 10); };
  }
})}};
