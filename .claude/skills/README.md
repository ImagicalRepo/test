# このフォルダについて

Claude Code がこのリポジトリで作業するときに読み込むスキルです。
外部リポジトリから取り込んだもので、出典とライセンスは以下のとおりです。

## Apple HIG 関連（13個）

`hig-*` の各フォルダ。iOS / iPadOS / macOS のヒューマンインターフェイスガイドラインを、
配色・タイポグラフィ・レイアウト・入力・各コンポーネントごとにまとめたもの。

- 出典: https://github.com/raintree-technology/apple-hig-skills
- ライセンス: MIT（`LICENSE-apple-hig-skills.txt`）
- 取り込んでいないもの: `hig-technologies`（HealthKit や Siri など、このアプリに関係しないため）

## web-design-guidelines

Vercel の Web Interface Guidelines に沿って UI コードを点検するスキル。
レイアウト、タイポグラフィ、配色、モーション、アクセシビリティを扱う。

- 出典: https://github.com/nexu-io/open-design （原典は https://github.com/vercel-labs/web-interface-guidelines ）
- ライセンス: Apache 2.0（`LICENSE-open-design.txt`）

## impeccable-design-polish

出来上がった画面を仕上げるためのスキル。視覚的な優先順位の点検、AI っぽさの除去、
文言の引き締め、控えめなモーションの追加、レスポンシブとアクセシビリティの補強。

- 出典: https://github.com/nexu-io/open-design （原典は https://github.com/pbakaus/impeccable ）
- ライセンス: Apache 2.0（`LICENSE-open-design.txt`）

## typeui-fundamentals

design system に依存しない普遍的な UI/UX 原則。視覚的な優先順位、余白の原則、
UX の法則、タイポグラフィ、WCAG 2.1/2.2 のアクセシビリティ要件。
HIG に書かれていない事柄を判断するときに使う。

- 出典: https://github.com/bergside/typeui （ https://www.typeui.sh ）
- ライセンス: MIT（`LICENSE-typeui.md`）

## 使い方

Claude Code のセッションで `/hig-foundations` のように名前で呼び出すか、
「HIG のカラーに沿っているか見て」「UI を点検して」のように話しかけると読み込まれます。

## DESIGN.md について

リポジトリ直下の `DESIGN.md` が、このアプリの design system の正本です。
配色・文字・余白・角丸・部品の決まりを、DESIGN.md の公開フォーマット
（ https://github.com/google-labs-code/design.md ）に沿って書いてあります。
UI を触る前にこれを読むと、判断がぶれません。

優先順位は次のとおりです。

1. 具体的な値（色、サイズ、余白）は `DESIGN.md` が決める
2. Apple の作法は `hig-*` が決める
3. 普遍的な原則とアクセシビリティは `typeui-fundamentals` が決める
4. 出来上がったものの仕上げは `impeccable-design-polish` と `web-design-guidelines`

アクセシビリティはどの層よりも優先されます。

## 取り込んでいないもの

OpenDesign 本体のプラグイン（`.claude-plugin/`）は、ローカルで `od` デーモンを動かして
MCP 経由でつなぐ構成です。macOS / Windows のデスクトップアプリが必要なため、
このリポジトリには入れていません。使う場合は https://open-design.ai/ から本体を入れてください。

TypeUI の 50件以上ある design system 集（brutalist、neumorphism など様式ごとのもの）も入れていません。
このアプリは iPadOS の標準に寄せる方針なので、様式集は判断を濁らせるためです。
必要になったら https://github.com/bergside/awesome-design-skills から個別に取れます。

neuform.ai、aura.build、designmd.supply、designmd.me、design-md.hyperbrowser.ai は、
いずれも URL から DESIGN.md を生成するホスト型のサービスです。
インストールできる形の配布物はないため、成果物である `DESIGN.md` を自前で書いています。
