# -*- coding: utf-8 -*-
"""Telegram-бот игры Tower Defense: показывает таблицу лидеров из Firebase.

Работает в двух режимах:
  * локально:  python bot.py              (токен берётся из config.py)
  * в облаке (GitHub Actions): токен берётся из переменной окружения BOT_TOKEN

Бот использует long polling — вебхук, HTTPS и собственный сервер ему не нужны.
"""

import os
import time

import requests

BOT_TOKEN = os.environ.get("BOT_TOKEN")
PROJECT_ID = "telegram-tower-defense"
API_KEY = "AIzaSyDSIr6tflEu5cYQNXexM0co5hqkDXMVd8Y"

# Локальный config.py (не попадает в Git) может переопределить настройки.
try:
    import config

    BOT_TOKEN = BOT_TOKEN or getattr(config, "BOT_TOKEN", None)
    PROJECT_ID = getattr(config, "PROJECT_ID", PROJECT_ID)
    API_KEY = getattr(config, "API_KEY", API_KEY)
except ImportError:
    pass

if not BOT_TOKEN:
    raise SystemExit("Не задан BOT_TOKEN (переменная окружения BOT_TOKEN или config.py).")

API = f"https://api.telegram.org/bot{BOT_TOKEN}"
FIRESTORE_URL = (
    f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}"
    f"/databases/(default)/documents/leaderboard?key={API_KEY}"
)

LEADERBOARD_BUTTON = "🏆 Таблица лидеров"
MENU_KEYBOARD = {
    "keyboard": [[{"text": LEADERBOARD_BUTTON}]],
    "resize_keyboard": True,
}


def api(method, **params):
    """Вызов метода Telegram Bot API. Возвращает ответ как словарь Python."""
    response = requests.post(f"{API}/{method}", json=params, timeout=40)
    return response.json()


def firestore_value(value):
    """Достаём обычное значение из типизированного поля Firestore."""
    if not value:
        return None
    for key in ("integerValue", "stringValue", "doubleValue", "booleanValue"):
        if key in value:
            return value[key]
    return None


def load_leaderboard(limit=10):
    """Читаем коллекцию leaderboard и возвращаем список словарей."""
    response = requests.get(FIRESTORE_URL, timeout=30)
    response.raise_for_status()
    documents = response.json().get("documents", [])

    records = []
    for document in documents:
        fields = document.get("fields", {})
        records.append(
            {
                "nick": firestore_value(fields.get("nick")) or "Игрок",
                "wave": int(firestore_value(fields.get("wave")) or 0),
                "gold": int(firestore_value(fields.get("gold")) or 0),
                "savedAt": firestore_value(fields.get("savedAt")) or "",
            }
        )

    # Самые свежие записи — сверху.
    records.sort(key=lambda record: record["savedAt"], reverse=True)
    return records[:limit]


def format_leaderboard(records):
    """Собираем красивый текст для Telegram."""
    if not records:
        return "📭 Пока нет рекордов. Сыграй в игру и проиграй — рекорд сохранится!"

    lines = ["🏆 *Таблица лидеров*", ""]
    medals = ["🥇", "🥈", "🥉"]
    for index, record in enumerate(records):
        place = medals[index] if index < len(medals) else f"{index + 1}."
        lines.append(f"{place} {record['nick']} — Волна {record['wave']}, {record['gold']} золота")

        saved = record["savedAt"]
        if saved:
            saved = saved.replace("T", " ").replace("Z", "")[:19] + " UTC"
            lines.append(f"     🕒 {saved}")

    return "\n".join(lines)


def send_message(chat_id, text):
    api(
        "sendMessage",
        chat_id=chat_id,
        text=text,
        parse_mode="Markdown",
        reply_markup=MENU_KEYBOARD,
    )


def handle_update(update):
    """Обрабатываем одно входящее сообщение."""
    message = update.get("message")
    if not message:
        return

    chat_id = message["chat"]["id"]
    text = (message.get("text") or "").strip()

    if text in ("/start", "/help", "/menu"):
        send_message(
            chat_id,
            "👋 Привет! Это бот игры *Tower Defense*.\n\n"
            "Нажми кнопку ниже, чтобы посмотреть рекорды.",
        )
    elif text == "/leaderboard" or text == LEADERBOARD_BUTTON:
        try:
            send_message(chat_id, format_leaderboard(load_leaderboard()))
        except Exception as error:
            print("Ошибка чтения Firebase:", error)
            send_message(chat_id, "⚠️ Не удалось загрузить рекорды. Попробуй позже.")


def main():
    print("Бот запущен. Нажми Ctrl+C, чтобы остановить.")

    me = api("getMe")
    if not me.get("ok"):
        print("Ошибка авторизации бота:", me)
        return
    print("Бот:", me["result"]["username"])

    # На всякий случай отключаем вебхук, чтобы long polling точно работал.
    api("deleteWebhook", drop_pending_updates=False)

    offset = 0
    while True:
        try:
            updates = api("getUpdates", offset=offset, timeout=30).get("result", [])
            for update in updates:
                offset = update["update_id"] + 1
                handle_update(update)
        except KeyboardInterrupt:
            print("Остановлено.")
            break
        except Exception as error:
            print("Ошибка сети, повтор через 3 сек:", error)
            time.sleep(3)


if __name__ == "__main__":
    main()
