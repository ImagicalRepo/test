import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import dateparser
import discord
from discord.ext import commands


DEFAULT_TZ = os.getenv("DEFAULT_TZ", "Asia/Tokyo")
EVENT_NAME = os.getenv("EVENT_NAME", "FF14 固定活動")
EVENT_LOCATION = os.getenv("EVENT_LOCATION", "Discord (VC/Party Finder)")
EVENT_DURATION_MINUTES = int(os.getenv("EVENT_DURATION_MINUTES", "120"))
DATA_PATH = Path("data/events.json")


def ensure_data_dir() -> None:
    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)


def save_event(start_at: datetime) -> None:
    ensure_data_dir()
    payload = {
        "start": start_at.isoformat(),
        "tz": start_at.tzinfo.key if hasattr(start_at.tzinfo, "key") else DEFAULT_TZ,
        "saved_at": datetime.now(tz=ZoneInfo(DEFAULT_TZ)).isoformat(),
    }
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def load_event() -> datetime | None:
    if not DATA_PATH.exists():
        return None
    try:
        payload = json.loads(DATA_PATH.read_text())
        start = payload.get("start")
        if not start:
            return None
        dt = datetime.fromisoformat(start)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(payload.get("tz", DEFAULT_TZ)))
        return dt
    except (json.JSONDecodeError, OSError, ValueError):
        return None


def cancel_event() -> bool:
    if DATA_PATH.exists():
        DATA_PATH.unlink()
        return True
    return False


def format_event(dt: datetime) -> str:
    display = dt.astimezone(ZoneInfo(DEFAULT_TZ))
    return display.strftime("%Y-%m-%d(%a) %H:%M %Z")


def parse_when(text: str) -> datetime | None:
    settings = {
        "TIMEZONE": DEFAULT_TZ,
        "RETURN_AS_TIMEZONE_AWARE": True,
        "PREFER_DATES_FROM": "future",
    }
    parsed = dateparser.parse(text, settings=settings)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(DEFAULT_TZ))
    return parsed


async def create_scheduled_event(ctx: commands.Context, start: datetime):
    guild = ctx.guild
    if guild is None:
        return None, "サーバー情報が取得できなかったよ。"

    start_utc = start.astimezone(ZoneInfo("UTC"))
    end_utc = (start + timedelta(minutes=EVENT_DURATION_MINUTES)).astimezone(
        ZoneInfo("UTC")
    )

    try:
        event = await guild.create_scheduled_event(
            name=EVENT_NAME,
            start_time=start_utc,
            end_time=end_utc,
            entity_type=discord.EntityType.external,
            location=EVENT_LOCATION,
            privacy_level=discord.PrivacyLevel.guild_only,
            description="次回固定活動の予定です。",
            reason="固定活動の次回予定を登録",
        )
        return event, None
    except discord.Forbidden:
        return (
            None,
            "イベント作成の権限がなかったよ。Bot の権限を確認してね。",
        )
    except discord.HTTPException as exc:
        return (None, f"Discord へのイベント作成に失敗したよ: {exc}")


intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents)


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} (ID: {bot.user.id})")
    print("------")


@bot.command(name="ping")
async def ping(ctx: commands.Context):
    await ctx.reply("Pong!")


@bot.command(name="set")
async def set_event(ctx: commands.Context, *, when: str | None = None):
    if not when:
        await ctx.reply("次回日時を教えてね。例: `!set 来週の水曜日 22時`")
        return
    parsed = parse_when(when)
    if parsed is None:
        await ctx.reply("ごめん、日時をうまく読めなかったよ。もう一度教えて！")
        return
    save_event(parsed)
    event, error = await create_scheduled_event(ctx, parsed)
    if error:
        await ctx.reply(
            f"時間は記録したよ！ 次回は {format_event(parsed)} だよ。\n"
            f"でも Discord のイベント作成でエラーが起きたみたい: {error}"
        )
        return
    await ctx.reply(
        f"イベント作っといたよ！ 次回は {format_event(parsed)} だよ。\n"
        f"イベントURL: {event.url}"
    )


@bot.command(name="next")
async def next_event(ctx: commands.Context):
    event = load_event()
    if event is None:
        await ctx.reply("まだ次回予定が登録されてないみたい。`!set` で教えてね。")
        return
    await ctx.reply(f"次回は {format_event(event)} の予定だよ。")


@bot.command(name="cancel")
async def cancel(ctx: commands.Context):
    removed = cancel_event()
    if removed:
        await ctx.reply("予定を取り消したよ。また決まったら `!set` で教えてね。")
    else:
        await ctx.reply("取り消す予定が見つからなかったよ。")


def main():
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise SystemExit("環境変数 DISCORD_TOKEN を設定してください。")
    bot.run(token)


if __name__ == "__main__":
    main()
