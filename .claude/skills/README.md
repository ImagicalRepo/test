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

## 使い方

Claude Code のセッションで `/hig-foundations` のように名前で呼び出すか、
「HIG のカラーに沿っているか見て」「UI を点検して」のように話しかけると読み込まれます。

## 取り込んでいないもの

OpenDesign 本体のプラグイン（`.claude-plugin/`）は、ローカルで `od` デーモンを動かして
MCP 経由でつなぐ構成です。macOS / Windows のデスクトップアプリが必要なため、
このリポジトリには入れていません。使う場合は https://open-design.ai/ から本体を入れてください。
