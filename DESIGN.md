---
version: alpha
name: 疑問ノート
description: 新任SVが業務中の疑問をその場で残し、リーダーが回答を書き込むためのiPad用ノートアプリ。iPadOS ヒューマンインターフェイスガイドラインに準拠する。
colors:
  primary: "#0A78FF"
  theme-sky: "#0A78FF"
  theme-mint: "#0E9E86"
  theme-lavender: "#7566EE"
  theme-sakura: "#DE6391"
  theme-apricot: "#D97B36"
  theme-lemon: "#AF8E1F"
  theme-sage: "#6C8D62"
  theme-slate: "#56697E"
  status-open: "#FF3B30"
  status-wip: "#FF9500"
  status-done: "#34C759"
  label: "#000000"
  label-secondary: "rgba(60,60,67,0.60)"
  label-tertiary: "rgba(60,60,67,0.30)"
  separator: "rgba(60,60,67,0.29)"
  background-grouped: "#EDF3FE"
  background-cell: "#FFFFFF"
  background-bar: "rgba(249,249,249,0.94)"
  fill-tertiary: "rgba(118,118,128,0.12)"
  paper: "#FFFFFF"
typography:
  large-title:
    fontFamily: "-apple-system, SF Pro Display, Hiragino Sans"
    fontSize: 2rem
    fontWeight: 700
    lineHeight: 1.21
    letterSpacing: 0.008em
  title-2:
    fontFamily: "-apple-system, SF Pro Display, Hiragino Sans"
    fontSize: 1.294rem
    fontWeight: 700
    lineHeight: 1.27
  headline:
    fontFamily: "-apple-system, SF Pro Text, Hiragino Sans"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.29
  body:
    fontFamily: "-apple-system, SF Pro Text, Hiragino Sans"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.29
  subheadline:
    fontFamily: "-apple-system, SF Pro Text, Hiragino Sans"
    fontSize: 0.882rem
    fontWeight: 400
    lineHeight: 1.33
  footnote:
    fontFamily: "-apple-system, SF Pro Text, Hiragino Sans"
    fontSize: 0.765rem
    fontWeight: 400
    lineHeight: 1.38
  caption:
    fontFamily: "-apple-system, SF Pro Text, Hiragino Sans"
    fontSize: 0.706rem
    fontWeight: 400
    lineHeight: 1.33
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
rounded:
  sm: 7px
  md: 10px
  lg: 14px
  full: 999px
elevation:
  card: "0 1px 2px rgba(22,26,40,.05), 0 6px 16px -10px rgba(22,26,40,.14)"
components:
  cell:
    background: "{colors.background-cell}"
    radius: "{rounded.lg}"
    minHeight: 44px
    paddingInline: "{spacing.lg}"
  navbar:
    background: "{colors.background-bar}"
    minHeight: 50px
    tint: "{colors.primary}"
  segmented:
    background: "{colors.fill-tertiary}"
    radius: 9px
    height: 32px
  popover:
    radius: 13px
    minItemHeight: 46px
  alert:
    width: 270px
    radius: 14px
    actionHeight: 44px
  propchip:
    minHeight: 32px
    radius: "{rounded.full}"
    background: "{colors.background-cell}"
---

# 疑問ノート DESIGN.md

## Overview

引き継ぎが途切れた現場で、新しく入ったスーパーバイザーが「分からない」をその場に置いていくための道具。
書くことへの心理的な抵抗をゼロに近づけることが、この設計の唯一の目的である。
思いついた順に書き、あとから親子に組み替えられること。書く面積を、整理のための表示より優先すること。

操作の作法は iPadOS の標準アプリに従う。部品も配置も独自のものは作らない。
ただし色だけは例外で、テーマから選んだ色相を画面の地に淡く敷く。
毎日長く開くものなので、標準のグレーより、選んだ色の空気の中で書けることを取る。
初めて触る人が、メモやリマインダーで覚えた操作をそのまま持ち込めることを、視覚的な個性より優先する。
落ち着いていて、密度は低め、余白は標準アプリと同じだけ取る。
仕事中に片手で開いて、数秒で閉じられる速度感を保つ。

判断に迷ったときは、Apple のヒューマンインターフェイスガイドラインに従う。
ガイドラインに書かれていない事柄は、普遍的な UI 原則とアクセシビリティ要件で決める。
どちらでも決まらない場合だけ、書き手の負担が小さいほうを選ぶ。

## Colors

意味を持つ色は iOS のシステムカラーに従う。操作の色と画面の地だけがテーマで変わる。
ダークモードでは、いずれも対応するダーク版へ自動的に切り替わる。

- **Primary（テーマ連動。既定はスカイ #0A78FF）:** 操作できるものすべて。ボタン、リンク、選択状態、アイコン。
  この色が付いていないものは押せない、という約束を全画面で守る。
- **Status Open (#FF3B30):** 未解決。放置されていることが一目で分かるよう、赤を未解決だけに使う。
- **Status WIP (#FF9500):** 確認中。回答待ちで止まっている状態。
- **Status Done (#34C759):** 解決。完了の合図であり、FAQ に載る目印でもある。
- **Label (#000000) / Secondary (60,60,67,.60) / Tertiary (.30):** 本文、補足、無効。
  文字色は3段階までに抑え、それ以上の階層は太さと大きさで作る。
- **Grouped Background（テーマ連動のパステル）と Cell (#FFFFFF):** 地とカードの2層構造。
  地は無彩色のグレーを使わない。選ばれたテーマの色相を、彩度を落として敷く。
  白いカードが浮き、画面全体がその色の空気をまとう。
  枠線は引かず、この明度差と 0.5px の区切り線、ごく薄い影だけで領域を分ける。
- **Paper (#FFFFFF):** 手書きの紙。ダークモードでも明るいまま保つ。
  暗い紙に黒い線を引くと見えなくなり、書いたものを他の人と共有したときにも見え方が変わってしまうため。

色だけで意味を伝えない。ステータスは必ず色の丸と「未解決」「確認中」「解決」の語をあわせて出す。

### テーマ（8色）

操作の色と画面の地の色は、使う人が8つから選ぶ。長時間見るものなので、好みで選べることを優先した。

スカイ、ミント、ラベンダー、サクラ、アプリコット、レモン、セージ、スレート。

各テーマは2つの値を持つ。ひとつは操作に使う色で、白地の上で本文として読める濃さを必ず確保する。
もうひとつは画面の地に敷くパステルで、白いカードとの明度差が十分に小さく、文字の邪魔をしない。
設定の見本では、パステルの円の中心に操作の色を置いて、この2つの関係をそのまま見せる。

ステータスの赤・黄・緑はテーマで変えない。意味を持つ色だからである。

## Typography

SF Pro の標準テキストスタイルをそのまま使う。独自のスケールは作らない。
ルート要素に `font: -apple-system-body` を当てているため、iPad の文字サイズ設定（Dynamic Type）に追従する。
すべてのサイズは rem による比率で、拡大しても破綻しない。

- **Large Title (34pt / 700):** ホームの挨拶とサイドバーのアプリ名。1画面に1つまで。
- **Title 2 (22pt / 700):** ページのタイトル入力欄。
- **Headline (17pt / 600):** 一覧セルのタイトル。同じサイズの本文と、太さだけで差をつける。
- **Body (17pt / 400):** 本文、入力欄、メニュー項目。読ませるものはすべてこれ。
- **Subheadline (15pt):** 一覧セルの抜粋。2行で打ち切る。
- **Footnote (13pt):** セクション見出し、日付、業務名、補足説明。
- **Caption (12pt):** 統計タイルのラベルなど、最小限の添え物。

日本語はラテン文字より字面が大きいため、字間を -0.01em 詰める。見出しだけは +0.008em で開ける。

## Layout & Spacing

4の倍数を基本とし、標準アプリと同じ余白量を使う。

- 画面の左右余白は 20px（コンパクト幅では 16px）。
- インセットグループドリストは左右 16px の外側余白、セル内は上下 11px・左右 16px。
- 区切り線は隣接セルの間だけに引き、テキストの先頭位置までインセットする。アイコンがある行は 44px。
- セクションとセクションの間は 22px 空け、見出しと本体の間は 7px。
- サイドバーは幅 288px の固定。768px 以下ではオーバーレイに変わる。
- コンテンツ列の最大幅は 920px。それ以上広い画面では中央に寄せ、1行が長くなりすぎないようにする。

すべてのタップ対象は 44×44pt 以上。文字だけのボタンも、見えない余白で 44pt を確保する。

## Elevation & Depth

影は薄く、広く、1種類だけ。濃い影で立体を作らない。

- ナビゲーションバーとツールパレットは、背景をぼかす素材（backdrop-filter）で浮かせる。
- ポップオーバーとアラートは、強いぼかしと大きな影で最前面に置く。
- カード（リスト、ブロック、統計、入力欄）は、ごく薄い影を1段だけ持つ。
  色の付いた地の上で白いカードの輪郭を保つための最小限であり、立体感を出すためではない。
- ページを開くときは右から差し込み、下の一覧を 22% だけ左へ送る。iOS のプッシュ遷移と同じ視差。

`prefers-reduced-motion` が指定されている場合、遷移とアニメーションはすべて無効にする。

## Shapes

- リストのコンテナ、ブロック、カードは 14px。
- シートとアラートは 14px。
- ボタン、チップ、トークンは完全な丸（999px）。
- 手書きの紙とサムネイルは 6px。

角丸の値は3段階までに留める。要素ごとに違う丸みを与えない。

## Components

標準の部品に置き換えられるものは、独自に作らない。

- **ナビゲーションバー:** 高さ 50pt。左に戻る、中央にタイトル、右に操作。操作は3つまで。
- **セグメンテッドコントロール:** ステータスの絞り込み。選択中は白い錠剤と影で示す。
- **インセットグループドリスト:** 一覧、設定、子ページ、履歴。値は右端、押せる行には山形記号を付ける。
- **ポップオーバー:** メニューと選択。コンパクト幅では自動的に下からのシートに変わる。
- **アラート:** 破壊的な操作の確認と、1行の入力。幅 270pt、取り消しを左、破壊的な操作を赤で右。
- **フォームシート:** 設定と業務カテゴリの編集。左にキャンセル、右に完了。
- **浮動ツールパレット:** 手書きの道具。紙の内側の下端に置き、指で描く前提の 38pt の当たり判定を取る。
- **属性チップ:** ステータス・業務・タグを、タイトルの直下に1行で並べる。
  それぞれを押すとポップオーバーが開く。行を3つ積むと手書きの領域をその分だけ奪うため、
  書くための面積を属性表示より優先する。
- **ツリー:** ページは別のページにぶら下げられる。一覧では親の直下に、
  枝の線とインデントで2階層まで表示する。子は親と別のステータスを持てる。

## Do's and Don'ts

**する**

- ステータスは色と文字の両方で示す。
- 保存は自動で行い、「保存」ボタンを置かない。空のページは保存しない。
- 破壊的な操作の前に必ず確認を挟み、実行側を赤で示す。
- 空の画面には、次に何をすればよいかを1文で書く。
- 数字はタブラー数字で揃える。

**しない**

- 画面右下に浮かぶ丸い追加ボタン（FAB）を置かない。作成はナビゲーションバーの右に置く。
- 作成に選択肢を挟まない。作成ボタンは1タップで手書きの紙を開く。形を選びたい人だけがメニューへ行く。
- 絵文字をアイコンとして使わない。線画のグリフに統一する。
- 文字サイズと角丸を増やさない。色はテーマの8色とステータスの3色に限り、それ以外を足さない。
- 無彩色のグレーを地に使わない。
- 影を2種類以上作らない。
- ユーザーが起こしていない動きを足さない。動きは操作の結果を見せるときだけ。
- 手書きに検索性を期待させない。あとで探したいものはテキストで書くよう促す。
