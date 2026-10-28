# Сроки действия дополнительных сбросов Codex

Форк: https://github.com/artbear/bb, ветка `codex-reset-expiry`.
Исходная версия сервера: BB 0.48.0, commit
`1a4a1d254c7b1f70d340ef9c800dad77dbeb8e66` из npm `bb-app@0.48.0`.

Провайдер читает `GET https://chatgpt.com/backend-api/wham/rate-limit-reset-credits`
на машине выбранного аккаунта. Поле `expires_at` задаёт срок использования
сохранённого сброса. Это не дата автоматического обновления недельной квоты.
Выбор двух записей идёт по ближайшему сроку действия. Использованные,
неподдерживаемые и истёкшие сбросы не выводятся. Бессрочные идут после датированных.
Даты показываются в `Europe/Moscow` с явной подписью МСК.

Дополнительный host RPC `codex.usage.resetCredits` не изменяет core-протокол
daemon. Необязательное поле `resetCredits` в measurement совместимо со старыми
источниками и потребителями. Ошибка детализации не скрывает основную квоту.
Сбросы не применяются: реализация использует только чтение.

Проверка и сборка из корня форка:

```sh
pnpm install --frozen-lockfile --ignore-scripts --filter bb --filter 'bb-plugin-provider-codex...' --filter 'bb-plugin-bb--provider-usage...' --filter @bb/app --filter '@bb/db...' --filter @bb/plugin-registry
pnpm exec turbo run build --filter=@get-bb/plugin-sdk
pnpm exec turbo run test typecheck lint --filter=bb-plugin-provider-codex --filter=bb-plugin-bb--provider-usage
node --test scripts/codex-reset-maintenance.test.mjs
bb plugin build plugins/provider-codex
bb plugin build plugins/provider-usage
node scripts/codex-reset-deployment.mjs --deploy
node scripts/codex-reset-deployment.mjs --check
```

Deploy проверяет совпадение версии исходников и установленного BB, сохраняет
резервные копии заменяемых файлов, обновляет только артефакты двух плагинов и
перезагружает эти плагины. Перезапуск сервера и остановка тредов не нужны.
Состояние и контрольные суммы лежат в `/data/codex-reset-deployment.json`;
резервные копии — в `/data/codex-reset-backups/`. Они не попадают в git.
Checker сверяет исходники и установленный код, получает настоящие данные через
RPC и рендерит установленный app bundle с ними через SDK harness в jsdom.
Проверяется наличие дат двух ближайших доступных сбросов и основной квоты.
Если доступных сбросов меньше двух, показывается фактическое количество.

Плановая автоматизация запускает скрипт ежедневно в 00:40 `Europe/Moscow`.
Скрипт пропускает дни, не попадающие в точный интервал три дня от даты
`BB_CODEX_RESET_ANCHOR`. В дни проверки он ставит задачу обслуживающему треду
`BB_CODEX_RESET_THREAD`. Эти параметры заданы в приватной конфигурации
автоматизации, а не в публичном репозитории. `BB_CODEX_RESET_REPO` указывает
checkout; скрипт запускается из стабильного каталога проекта, чтобы восстановить
даже полностью удалённый checkout. Первое плановое выполнение —
29 октября 2026 года, далее 1, 4, 7 ноября и так далее.

При обновлении BB сначала нужно получить `gitHead` установленного npm-релиза,
адаптировать изменение в форке и проверить его на свежих исходниках. Нельзя
восстанавливать старый host bundle поверх новой версии провайдера. После
адаптации — сборка, deploy, UI check, commit и push в `codex-reset-expiry`.
Сбой сети или авторизации сам по себе не означает потерю правки.

Семантика сроков описана в [справке OpenAI](https://help.openai.com/en/articles/20001498-how-resets-work-in-codex).
