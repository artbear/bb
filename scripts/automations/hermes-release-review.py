"""Daily BB tick; start a review every four Moscow calendar days."""

import json
import os
import signal
from datetime import date, datetime, time
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo


ANCHOR = date(2026, 10, 30)
MOSCOW = ZoneInfo("Europe/Moscow")
PROMPT = r"""Подготовь краткий обзор обновлений Hermes относительно фактически установленного релиза. Пиши по-русски. Это плановый обзор каждые четыре дня, без обновления системы.

Контекст и проверка:
- Используй навык my-hermes-help. Источник контекста установки — /home/hermes/hermes-ops: capabilities/, runbooks/, changes/ и hermes-local summary/show/affected. Каждый раз проверяй актуальное состояние; старые обзоры не заменяют проверку.
- Определи установленную версию, commit/tag и способ установки по безопасным read-only командам (hermes --version, путь исполняемого файла, git describe/status/log фактического checkout). Не считай произвольный checkout установленным релизом. Проверь соответствие registry фактической установке; при расхождении явно укажи DRIFT. Если есть локальные патчи, учти их, не раскрывая секреты.
- Проверь применимость к активным возможностям: gateway, Telegram и маршрутизация топиков/профилей, Codex CLI и Cursor ACP, маршрутизация моделей и OpenRouter fallback, плагины, SMS/webhook, cron, backup/restore, approvals и memory guard. Этот перечень — ориентир; актуальный registry имеет приоритет.
- Не запускай hermes-local inventory: он записывает файл. Читай только необходимые несекретные сведения. Не выводи токены, ключи, полные конфиги и переменные окружения.
- Через интернет определи последнюю опубликованную стабильную версию именно используемого Hermes. Используй официальные release notes, документацию и issue tracker upstream. Исключай draft/prerelease из стабильных релизов. Охвати ВСЕ промежуточные стабильные релизы между установленным и последним. Не ограничивайся заметками последней версии.
- Проверяй текущий статус существенных багов в официальном issue tracker на момент обзора: затрагивающие новые версии регрессии, открытые issues и недавно закрытые issues с исправлениями, ещё не опубликованными в стабильном релизе. Проверяй связанные PR, commits и включение исправления в опубликованный tag; закрытый issue или merged PR сам по себе не доказывает выпуск исправления. Отделяй сообщения пользователей, подтверждение сопровождающих и собственные предположения.

Если достоверно установлено, что новых стабильных релизов относительно установленного нет, ответь ОДНОЙ фразой с установленной/последней версией и ссылкой на официальный источник. Если проверить версию или источник не удалось, прямо укажи неопределённость; не утверждай, что новых релизов нет.

Если обновление доступно, начни с краткой рекомендации «Обновляться сейчас» либо «Подождать» и основных причин; укажи дату проверки по Москве и установленную → последнюю стабильную версии. Затем строго в таком порядке:
1. Сначала важное: критичные исправления, изменения совместимости, удалённые функции, новые требования и необходимые при обновлении действия.
2. Плюсы: улучшения и конкретная польза для этой установки.
3. Минусы: подтверждённые ухудшения поведения, ограничения, дополнительные затраты настройки/обслуживания. Не выдумывай минусы для заполнения раздела.
4. Риски: возможные сбои, миграция, совместимость плагинов и пользовательских настроек; укажи применимость и уверенность.
5. Зарегистрированные и неисправленные баги: для каждой существенной проблемы — затронутые версии, условия проявления, последствия, текущий статус и прямая ссылка на issue. Отдельно отметь исправления, ещё не вошедшие в опубликованный стабильный релиз. Если точные версии/статус/влияние неизвестны, так и напиши. Если релевантных проблем не найдено, ограничь вывод проверенными источниками, не обещай отсутствие багов.

Пиши кратко, самое существенное первым. Подкрепляй выводы прямыми ссылками на первоисточники рядом с утверждениями. Явно разделяй подтверждённые факты и предположения. Не добавляй несвязанные сравнения и альтернативы.

Только анализ и итоговый ответ в этом BB-треде. Не обновляй Hermes, зависимости, плагины или конфигурацию; не выполняй миграции, не перезапускай службы, не исправляй drift, не меняй расписания и не отправляй сообщения во внешние сервисы. Не делегируй обзор другим агентам.
"""


def is_due(now):
    local = now.astimezone(MOSCOW)
    days = (local.date() - ANCHOR).days
    return days >= 0 and days % 4 == 0 and local.time() >= time(19, 27)


def spawn_review(command, prompt, timeout=90):
    environment = os.environ.copy()
    environment.pop("BB_CLI", None)
    with subprocess.Popen(
        command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, env=environment,
        start_new_session=True,
    ) as process:
        try:
            stdout, stderr = process.communicate(prompt, timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate()
            raise
        if process.returncode:
            raise subprocess.CalledProcessError(
                process.returncode, command, output=stdout, stderr=stderr,
            )
        return json.loads(stdout)


def main():
    now = datetime.now(MOSCOW)
    if not is_due(now):
        return
    today = now.date().isoformat()
    marker = Path(__file__).with_name("last-review-date.txt")
    if marker.exists() and marker.read_text().strip() == today:
        return
    command = [
        os.environ.get("BB_CLI") or "bb", "thread", "spawn",
        "--project", os.environ["BB_PROJECT_ID"],
        "--environment", "env_7c4r86thzd",
        "--provider", "acp-cursor", "--model", "claude-opus-5",
        "--reasoning-level", "medium", "--permission-mode", "accept-edits",
        "--title", f"Обзор обновлений Hermes — {today}",
        "--prompt-file", "-", "--json",
    ]
    thread = spawn_review(command, PROMPT)
    thread_id = thread["id"]
    marker.write_text(today + "\n")
    print(f"Обзор Hermes запущен: @thread:{thread_id}")


if __name__ == "__main__":
    main()
