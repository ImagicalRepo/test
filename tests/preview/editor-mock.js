/**
 * 工程テンプレート編集画面のモック。
 * 日付計算は本物のコア関数（01〜03）をそのまま呼ぶので、プレビュー結果は実際と同じになる。
 */
(function () {
  var HOLIDAYS_2026 = [
    '2026-01-01','2026-01-12','2026-02-11','2026-02-23','2026-03-20','2026-04-29',
    '2026-05-03','2026-05-04','2026-05-05','2026-05-06','2026-07-20','2026-08-11',
    '2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23',
    '2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03'
  ];
  var cal = createBusinessCalendar({ holidays: HOLIDAYS_2026 });

  function tpl(seq, name, base, dir, days, unit, remind, note) {
    return { seq: seq, name: name, base: base, direction: dir, days: days, unit: unit,
             adjust: '前営業日', owner: '', remindDays: remind, note: note || '' };
  }

  var EDITOR_DATA = {
    today: '2026-09-09',
    works: [
      { id:'NAN', name:'指定難病 医療費助成（月次審査会）', anchorName:'審査会', rule:'毎月第2水', adjust:'前営業日', enabled:true, color:'青' },
      { id:'KOSIN', name:'指定難病 更新申請（一斉更新）', anchorName:'受付開始', rule:'毎年9月1日', adjust:'翌営業日', enabled:true, color:'緑' },
      { id:'SHOMAN', name:'小児慢性特定疾病 医療費助成', anchorName:'審査会', rule:'毎月第4火', adjust:'前営業日', enabled:true, color:'橙' }
    ],
    templates: {
      NAN: [
        tpl(10,'申請受付分の締切（当月審査会分）','','前',20,'営業日',3,'窓口・郵送分をここで締める'),
        tpl(20,'形式審査・不備照会の完了','','前',15,'営業日',3,'不備は返戻または追加提出を依頼'),
        tpl(30,'審査会資料の作成・システム入力','','前',10,'営業日',3,'入力はここまでに終わらせる'),
        tpl(40,'資料の最終確認（係内）','','前',8,'営業日',2,''),
        tpl(50,'審査委員へ資料送付','','前',7,'営業日',2,'発送日'),
        tpl(60,'審査委員からの意見返送期限','','前',3,'営業日',2,'未着はここで督促'),
        tpl(70,'審査会','','後',0,'営業日',1,'基準日そのもの'),
        tpl(80,'審査結果の整理・記録作成','審査会','後',1,'営業日',1,''),
        tpl(90,'認定/不認定 決裁の起案・システム入力','審査結果の整理・記録作成','後',1,'営業日',1,'起案日'),
        tpl(100,'決裁完了（見込）','認定/不認定 決裁の起案・システム入力','後',3,'営業日',2,'起案からN営業日。実績に合わせて調整する'),
        tpl(110,'受給者証・通知書の印刷','決裁完了（見込）','後',1,'営業日',1,''),
        tpl(120,'封入封緘・点検','受給者証・通知書の印刷','後',1,'営業日',1,'二人体制で突合'),
        tpl(130,'受給者証の発送','封入封緘・点検','後',1,'営業日',1,'到達日を意識して逆算する'),
        tpl(140,'台帳更新・報告用データ反映','受給者証の発送','後',2,'営業日',2,'')
      ],
      KOSIN: [tpl(10,'更新案内の一斉発送','','前',10,'営業日',3,''), tpl(20,'更新申請 受付開始','','後',0,'営業日',1,'')],
      SHOMAN: [tpl(10,'申請受付分の締切','','前',15,'営業日',3,''), tpl(20,'審査会','','後',0,'営業日',1,'')]
    },
    nextAnchors: {
      NAN: { dateKey: '2026-09-09', period: '2026-09' },
      KOSIN: { dateKey: '2026-09-01', period: '2026' },
      SHOMAN: { dateKey: '2026-09-22', period: '2026-09' }
    },
    anchors: {
      NAN: [
        { period:'2026-08', dateKey:'2026-08-12', source:'自動', past:true },
        { period:'2026-09', dateKey:'2026-09-09', source:'自動', past:false },
        { period:'2026-10', dateKey:'2026-10-14', source:'自動', past:false },
        { period:'2026-11', dateKey:'2026-11-11', source:'自動', past:false }
      ],
      KOSIN: [{ period:'2026', dateKey:'2026-09-01', source:'自動', past:false }],
      SHOMAN: [
        { period:'2026-09', dateKey:'2026-09-22', source:'自動', past:false },
        { period:'2026-10', dateKey:'2026-10-27', source:'自動', past:false }
      ]
    },
    defaultRemind: 3,
    colors: ['青','緑','橙','紫','赤','水色','桃','灰'],
    scheduleUrl: ''  // ウェブアプリ公開時のみ値が入る（既定は非表示）
  };

  var handlers = {
    getEditorData: function () { return EDITOR_DATA; },
    previewSchedule: function (rows, anchorKey, anchorName) {
      var input = (rows || []).map(function (r, i) {
        return { seq: r.seq === '' || r.seq === undefined ? (i + 1) * 10 : r.seq,
                 name: r.name, base: r.base, direction: r.direction, days: r.days,
                 unit: r.unit, adjust: r.adjust };
      });
      try {
        var computed = computeSchedule(input, anchorKey, cal, anchorName);
        return { ok: true, items: computed.map(function (r) {
          return { seq: r.seq, name: r.name, dateKey: r.dateKey,
                   weekday: WEEKDAY_LABELS[dayOfWeek(r.dateKey)],
                   isBusinessDay: isBusinessDay(cal, r.dateKey) };
        }) };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    },
    saveWork: function () { return { rows: 0, errors: [] }; },
    saveTemplate: function () { return { rows: 42, errors: [] }; }
  };

  window.google = { script: { run: makeRunner(), host: { close: function () {} } } };

  function makeRunner() {
    var ok = null, ng = null;
    var runner = new Proxy({}, {
      get: function (t, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { ok = fn; return runner; };
        if (prop === 'withFailureHandler') return function (fn) { ng = fn; return runner; };
        return function () {
          var args = Array.prototype.slice.call(arguments);
          var fn = handlers[prop];
          setTimeout(function () {
            if (!fn) { if (ng) ng(new Error('未実装のモック: ' + String(prop))); return; }
            try { if (ok) ok(fn.apply(null, args)); }
            catch (e) { if (ng) ng(e); }
          }, 10);
        };
      }
    });
    return runner;
  }
})();
