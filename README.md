# FF14 固定活動スケジューラ Discord Bot

FF14 の固定活動を円滑にするためのシンプルな Discord Bot です。会話で決まった次回予定をその場で記録し、みんなに共有できます。

## 主な機能
- `!set <日時>`: 次回の固定日時を自然言語で登録（例: `来週の水曜日 22時`）。登録時に Discord のイベントも自動作成。
- `!next`: 登録済みの次回予定を確認。
- `!cancel`: 直近の予定を破棄。
- `!ping`: 動作確認。

自然言語の日時パースには `dateparser` を利用しており、日本語/英語の表現をサポートします。

## 動作環境
- Python 3.11 以上を推奨
- Discord Bot Token (環境変数 `DISCORD_TOKEN` で指定)

### 推奨オプション環境変数
- `DEFAULT_TZ`: 既定タイムゾーン (未指定時は `Asia/Tokyo`)
- `EVENT_NAME`: 作成する Discord イベント名 (未指定時は `FF14 固定活動`)
- `EVENT_LOCATION`: イベントの場所表記 (未指定時は `Discord (VC/Party Finder)`)
- `EVENT_DURATION_MINUTES`: イベントの長さ (分) (未指定時は `120`)

## セットアップ
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 起動方法
```bash
export DISCORD_TOKEN="<Your Bot Token>"
# 必要ならタイムゾーンも指定
export DEFAULT_TZ="Asia/Tokyo"
python bot.py
```

## 使い方のイメージ
1. 活動終了後に会話で次回日時を決める。
2. リーダーが決まった日時をそのまま `!set 来週の水曜日 22時` のように発言。
3. Bot が「イベント作っといたよ」と応答し、次回予定を全員に共有。
4. `!next` でいつでも確認、予定が変わったら `!cancel` で破棄して再設定。

## データ保存
予定は `data/events.json` に保存されます。リポジトリには含めず、実行環境内で管理します。

## 今後の拡張例
- 予定作成時に自動でイベント作成やリマインドを送信
- 固定メンバーの通知チャンネル設定
- 週課リセット日を考慮した自動提案
