/**
 * 業務がたくさんあるときのモック。
 *
 * 利用者の実データは「回次ごとに別業務として登録する」ため業務が25個あり、
 * 1業務あたり12〜16工程が数日のうちに固まっている。
 * この形だと凡例が8行に伸び、吹き出しが10段積んで画面がほぼ埋まっていた。
 */
(function () {
  const TODAY = window.MOCK_DATA.today;
  const COLORS = ['青', '緑', '橙', '紫', '赤', '水色', '桃', '灰'];
  const NAMES = [
    '受給者証20260910新規発送（89件）', '受給者証20260910軽症者特例発送（3件）',
    '受給者証20260910副疾患追加発送（1件）', '受給者証20260910按分特例発送（1件）',
    '10月審査会', '療養費決済',
    'No1092 受給者証20260915新規(16疾患)（34件）', 'No1093 受給者証20260915副疾患追加（2件）',
    'No1094 受給者証20260915記載事項変更（1件）', 'No1095 登録証20260915新規（16疾患）（25件）',
    'No1096 受給者証20260918転入（5件）', 'No1097 No1096分転入認定者更新案内（3件）',
    'No1098 受給者証20260918保険変更（3件）', 'No1099 転入No1096分（2件のうち紙0件）（2件）',
    'No1100 受給者証20260914記載事項変更（1件）', 'No1087 受給者証20260916転入（9件）',
    'No1088 No1087分転入認定者更新案内（4件）', 'No1089 No1087分新規2件のうち紙1件（2件）',
    'No1079 受給者証20260917保険変更（164件）', 'No1080 受給者証20260917高長（173件）',
    'No1081 受給者証20260917按分特例（8件）', 'No1082 受給者証20260917基準世帯員変更（17件）',
    'No1084 新規No1079（1件うち紙1件）（1件）', '9月審査会', '受給者証(新規) 発送'
  ];
  const STEPS = ['決済依頼', '決済完了', '書面審査結果一覧確認依頼', '3部コピー', '書面審査済',
    '保留分決済依頼', '保留分決済期限', '封入封緘', '発送', '記載事項確認', 'システム入力',
    '名簿突合', '確認', '軽特勧奨の締め切り', '台帳更新', '報告用データ反映'];
  const pad = n => (n < 10 ? '0' : '') + n;

  const lanes = [], works = [];
  NAMES.forEach(function (name, wi) {
    const id = 'S' + wi, color = COLORS[wi % COLORS.length];
    const items = [];
    const n = 12 + (wi % 5);            // 12〜16工程
    const base = 1 + (wi % 20);
    for (let i = 0; i < n; i++) {
      // 2工程が同じ日に来るので、吹き出しが横に重なって段が積み上がる
      const due = '2026-09-' + pad(Math.min(30, base + Math.floor(i / 2)));
      items.push({
        key: id + '||' + ((i + 1) * 10), seq: (i + 1) * 10, name: STEPS[i % STEPS.length],
        dueKey: due, endKey: '', weekday: '', status: i < 2 ? '完了' : '未着手',
        owner: '', note: '', isAnchor: i === 0,
        overdue: due < TODAY && i >= 2, remaining: 3
      });
    }
    lanes.push({
      laneKey: id + '|', workId: id, workName: name, period: '', color,
      anchorKey: items[0].dueKey, anchorName: '起点',
      from: items[0].dueKey, to: items[items.length - 1].dueKey, items: items, doneCount: 2
    });
    works.push({ id: id, name: name, enabled: true, anchorName: '起点', rule: '', color: color });
  });

  window.MOCK_DATA.works = works;
  window.MOCK_DATA.lanes = lanes;
})();
