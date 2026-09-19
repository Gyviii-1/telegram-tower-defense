# -*- coding: utf-8 -*-
"""Telegram-бот игры Tower Defense: таблица лидеров, роли и личный рекорд.

Работает в двух режимах:
  * локально:  python bot.py              (токен и ключ из config.py/service-account.json)
  * в облаке (GitHub Actions): всё берётся из переменных окружения

Роли хранятся в Firestore (коллекция "users"). Запись идёт через сервисный
аккаунт (Firebase Admin), поэтому правила Firestore клиентам писать запрещают.
"""

import base64
import json
import os
import time

import requests

try:
    import firebase_admin
    from firebase_admin import credentials, firestore

    FIREBASE_ADMIN_AVAILABLE = True
except ImportError:
    FIREBASE_ADMIN_AVAILABLE = False

BOT_TOKEN = os.environ.get("BOT_TOKEN")
CREATOR_ID = os.environ.get("CREATOR_ID")
PROJECT_ID = "telegram-tower-defense"
API_KEY = "AIzaSyDSIr6tflEu5cYQNXexM0co5hqkDXMVd8Y"
SA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "service-account.json")
SA_B64 = os.environ.get("FIREBASE_SERVICE_ACCOUNT")

# Локальный config.py (не попадает в Git) может переопределить настройки.
try:
    import config

    BOT_TOKEN = BOT_TOKEN or getattr(config, "BOT_TOKEN", None)
    CREATOR_ID = CREATOR_ID or getattr(config, "CREATOR_ID", None)
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

TOP_BUTTON = "🏆 Топ-10"
ME_BUTTON = "📊 Мой рекорд"
SETTINGS_BUTTON = "⚙ Настройки"
MENU_KEYBOARD = {
    "keyboard": [[{"text": TOP_BUTTON}, {"text": ME_BUTTON}], [{"text": SETTINGS_BUTTON}]],
    "resize_keyboard": True,
}

TOP_LIMIT = 10
ROLE_LABELS = {"creator": "создатель", "tester": "тестер", "player": ""}

# --------------------------- Firebase Admin ---------------------------
db = None


def init_firebase():
    """Подключаем Firebase Admin (сервисный аккаунт) — для чтения и записи ролей."""
    global db
    if not FIREBASE_ADMIN_AVAILABLE:
        print("[WARN] firebase-admin не установлен — роли недоступны.")
        return

    try:
        if firebase_admin._apps:
            db = firestore.client()
            return
    except Exception:
        pass

    try:
        if os.path.exists(SA_PATH):
            cred = credentials.Certificate(SA_PATH)
        elif SA_B64:
            cred = credentials.Certificate(json.loads(base64.b64decode(SA_B64)))
        else:
            print("[WARN] Нет ключа сервисного аккаунта — роли недоступны.")
            return

        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("[INFO] Firebase Admin подключён.")
    except Exception as error:
        print("[ERROR] Firebase Admin:", error)


# ----------------------------- Telegram API -----------------------------
def api(method, **params):
    """Вызов метода Telegram Bot API."""
    response = requests.post(f"{API}/{method}", json=params, timeout=40)
    return response.json()


def send_message(chat_id, text, markdown=True, keyboard=None):
    payload = {
        "chat_id": chat_id,
        "text": text,
        "reply_markup": keyboard if keyboard is not None else MENU_KEYBOARD,
    }
    if markdown:
        payload["parse_mode"] = "Markdown"
    api("sendMessage", **payload)


# ------------------------------- Роли -------------------------------
def user_nick(message):
    """Ник игрока из профиля Telegram."""
    user = message.get("from", {})
    if user.get("username"):
        return "@" + user["username"]
    name = " ".join(filter(None, [user.get("first_name"), user.get("last_name")]))
    return name or "Игрок"


def ensure_user(user_id, nick, username):
    """Заводим/обновляем пользователя. Роль по умолчанию — player."""
    if db is None:
        return
    ref = db.collection("users").document(str(user_id))
    snapshot = ref.get()
    is_creator = str(user_id) == str(CREATOR_ID)

    if not snapshot.exists:
        data = {
            "nick": nick,
            "role": "creator" if is_creator else "player",
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if username:
            data["username"] = username.lower()
        ref.set(data)
    else:
        update = {"nick": nick, "updatedAt": firestore.SERVER_TIMESTAMP}
        if username:
            update["username"] = username.lower()
        if is_creator:
            update["role"] = "creator"
        ref.set(update, merge=True)


def set_role(user_id, role):
    """Выдать роль пользователю (создаёт документ, если его нет)."""
    if db is None:
        return False
    db.collection("users").document(str(user_id)).set(
        {"role": role, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True
    )
    return True


def resolve_target(target):
    """Находит игрока по @username или числовому ID. Возвращает (doc_id, ошибка)."""
    if db is None:
        return None, "Роли недоступны (нет ключа сервисного аккаунта)."

    target = (target or "").strip()
    if target.startswith("@"):
        target = target[1:]

    if target.isdigit():
        return target, None
    if not target:
        return None, "Не указан пользователь."

    docs = db.collection("users").where("username", "==", target.lower()).limit(1).stream()
    for document in docs:
        return document.id, None

    return None, (
        "Не нашёл такого пользователя. Пусть он сначала напишет боту /start, "
        "или укажи числовой ID."
    )


def get_user_data(user_id):
    """Данные пользователя из Firestore (роль, скрыт и т.д.)."""
    if db is None:
        return {}
    snapshot = db.collection("users").document(str(user_id)).get()
    return snapshot.to_dict() if snapshot.exists else {}


def settings_text(user_id):
    hidden = "Да" if get_user_data(user_id).get("hidden") else "Нет"
    return f"⚙ Настройки\n\nСкрыт из списка: {hidden}"


def settings_keyboard(user_id):
    hidden = bool(get_user_data(user_id).get("hidden"))
    label = "Показать в списке" if hidden else "Скрыть из списка"
    return {"inline_keyboard": [[{"text": label, "callback_data": "toggle_hidden"}]]}


def toggle_hidden(user_id):
    """Переключает «скрыт из списка». Возвращает новое значение или None."""
    if db is None:
        return None
    new_value = not bool(get_user_data(user_id).get("hidden"))
    db.collection("users").document(str(user_id)).set(
        {"hidden": new_value, "updatedAt": firestore.SERVER_TIMESTAMP}, merge=True
    )
    return new_value


def commands_text(role):
    """Список доступных команд с учётом роли."""
    lines = [
        "📋 *Команды*",
        "",
        "/start — приветствие",
        "/top — топ-10 игроков",
        "/me — мой личный рекорд",
        "/whoami — мой ID и роль",
        "/settings — настройки (скрыть из списка)",
        "/help — этот список",
    ]
    if role == "creator":
        lines += [
            "",
            "*Только для создателя:*",
            "/tester @user или ID — выдать тестер",
            "/untester @user или ID — забрать тестер",
            "/players — список пользователей",
        ]
    return "\n".join(lines)


# --------------------------- Таблица лидеров ---------------------------
def firestore_value(value):
    if not value:
        return None
    for key in ("integerValue", "stringValue", "doubleValue", "booleanValue"):
        if key in value:
            return value[key]
    return None


def load_hidden_ids():
    """ID игроков, которые скрылись из списка."""
    if db is None:
        return set()
    try:
        return {document.id for document in db.collection("users").where("hidden", "==", True).stream()}
    except Exception as error:
        print("Ошибка чтения скрытых:", error)
        return set()


def load_leaderboard():
    response = requests.get(FIRESTORE_URL, timeout=30)
    response.raise_for_status()
    documents = response.json().get("documents", [])

    records = []
    for document in documents:
        doc_id = document["name"].rsplit("/", 1)[-1]
        fields = document.get("fields", {})
        records.append({
            "id": doc_id,
            "nick": firestore_value(fields.get("nick")) or "Игрок",
            "wave": int(firestore_value(fields.get("wave")) or 0),
            "gold": int(firestore_value(fields.get("gold")) or 0),
        })

    # Скрытых игроков не показываем.
    hidden = load_hidden_ids()
    records = [record for record in records if record["id"] not in hidden]

    records.sort(key=lambda r: (r["wave"], r["gold"]), reverse=True)
    return records


def format_top(records):
    if not records:
        return "📭 Пока нет рекордов. Сыграй в игру и проиграй — рекорд сохранится!"

    lines = ["🏆 *Топ игроков*", ""]
    medals = ["🥇", "🥈", "🥉"]
    for index, record in enumerate(records[:TOP_LIMIT]):
        place = medals[index] if index < len(medals) else f"{index + 1}."
        lines.append(f"{place} {record['nick']} — Волна {record['wave']}, {record['gold']} золота")
    return "\n".join(lines)


def format_player(player_id, records):
    for index, record in enumerate(records):
        if record["id"] == player_id:
            return (
                "📊 *Твой рекорд*\n\n"
                f"Волна: *{record['wave']}*\n"
                f"Золото: *{record['gold']}*\n"
                f"Место в топе: *{index + 1}* из {len(records)}"
            )
    return "🤷 Ты ещё не играл. Пройди игру до Game Over — рекорд сохранится автоматически."


# ------------------------------ Обработка ------------------------------
def handle_callback(callback):
    """Нажатия на inline-кнопки (например, переключатель «скрыт из списка»)."""
    data = callback.get("data", "")
    message = callback.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    message_id = message.get("message_id")
    user_id = str(callback.get("from", {}).get("id", ""))

    if data == "toggle_hidden":
        new_value = toggle_hidden(user_id)
        api("answerCallbackQuery", callback_query_id=callback.get("id"))
        if new_value is None:
            return
        api(
            "editMessageText",
            chat_id=chat_id,
            message_id=message_id,
            text=settings_text(user_id),
            reply_markup=settings_keyboard(user_id),
        )


def handle_update(update):
    callback = update.get("callback_query")
    if callback:
        handle_callback(callback)
        return

    message = update.get("message")
    if not message:
        return

    chat_id = message["chat"]["id"]
    sender = message.get("from", {})
    user_id = str(sender.get("id", ""))
    username = sender.get("username")
    text = (message.get("text") or "").strip()

    ensure_user(user_id, user_nick(message), username)
    is_creator = str(user_id) == str(CREATOR_ID)

    role = "player"
    if db is not None:
        snapshot = db.collection("users").document(user_id).get()
        if snapshot.exists:
            role = snapshot.to_dict().get("role", "player")
    if is_creator:
        role = "creator"

    if text in ("/start", "/menu"):
        send_message(
            chat_id,
            "👋 Привет! Это бот игры *Tower Defense*.\n\n" + commands_text(role),
        )
    elif text in ("/help", "/commands"):
        send_message(chat_id, commands_text(role))
    elif text in ("/settings", SETTINGS_BUTTON):
        send_message(
            chat_id,
            settings_text(user_id),
            markdown=False,
            keyboard=settings_keyboard(user_id),
        )
    elif text in ("/top", "/leaderboard", TOP_BUTTON):
        try:
            send_message(chat_id, format_top(load_leaderboard()), markdown=False)
        except Exception as error:
            print("Ошибка чтения Firebase:", error)
            send_message(chat_id, "⚠️ Не удалось загрузить рекорды. Попробуй позже.")
    elif text in ("/me", "/stats", ME_BUTTON):
        try:
            if user_id in load_hidden_ids():
                send_message(
                    chat_id,
                    "🙈 Ты скрыт из списка. Вернуть можно кнопкой ⚙ Настройки.",
                    markdown=False,
                )
            else:
                send_message(chat_id, format_player(user_id, load_leaderboard()))
        except Exception as error:
            print("Ошибка чтения Firebase:", error)
            send_message(chat_id, "⚠️ Не удалось загрузить рекорд. Попробуй позже.")
    elif text == "/whoami":
        send_message(chat_id, f"Твой ID: `{user_id}`\nРоль: *{role}*")
    elif text.startswith("/tester") or text.startswith("/untester"):
        if not is_creator:
            send_message(chat_id, "⛔ Команда только для создателя.")
            return
        parts = text.split(maxsplit=1)
        if len(parts) < 2 or not parts[1].strip():
            send_message(chat_id, "Укажи пользователя: `/tester @username` или `/tester 123456789`")
            return
        target = parts[1].strip()
        new_role = "tester" if text.startswith("/tester") else "player"
        doc_id, error = resolve_target(target)
        if error:
            send_message(chat_id, f"⚠️ {error}")
            return
        if set_role(doc_id, new_role):
            label = ROLE_LABELS.get(new_role) or "player"
            send_message(chat_id, f"✅ `{target}` — роль: *{label}*")
        else:
            send_message(chat_id, "⚠️ Не удалось сохранить роль.")
    elif text == "/players":
        if not is_creator:
            send_message(chat_id, "⛔ Команда только для создателя.")
            return
        if db is None:
            send_message(chat_id, "⚠️ Роли недоступны.")
            return
        lines = ["👥 Пользователи", ""]
        for document in db.collection("users").stream():
            data = document.to_dict()
            nick = data.get("nick", "")
            username = data.get("username")
            # Не дублируем, если ник уже содержит @username.
            if username and ("@" + username) != nick:
                nick = f"{nick} @{username}" if nick else f"@{username}"
            hidden = " (скрыт)" if data.get("hidden") else ""
            lines.append(f"{document.id} — {data.get('role', 'player')} — {nick}{hidden}")
        send_message(chat_id, "\n".join(lines[:40]), markdown=False)


def main():
    print("Бот запущен. Нажми Ctrl+C, чтобы остановить.")

    init_firebase()

    me = api("getMe")
    if not me.get("ok"):
        print("Ошибка авторизации бота:", me)
        return
    print("Бот:", me["result"]["username"])

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
