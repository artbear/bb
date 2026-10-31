# Codex reset credits: перенос на BB 0.48.1

## Результат

- База переноса: `release0.48.1` — `e003e9510cbfd3bb6c26a28630b46ffb1c242a44`.
- Исходное изменение: `artur-bb` — `d395bdbdc238a3a7d54616f16b80205856e6cc03`; оно является предком `artur-bb` на `497c4eab432fc812b96d50e2da11918f4782162f`.
- Локальный commit для cherry-pick: `377718ee328067bf8db1e47d4d04f5576f268b72` (`feat(codex): show reset credit expiry dates`).
- Cherry-pick применился без конфликтов. Сравнение с `0.48.1` показало изменения Codex bridge вне затрагиваемых usage-контрактов; текущие upstream-функции и контракты сохранены.

## Состояние установленного BB

- Feature в исходниках `0.48.1` отсутствовал и перенесён этим commit.
- Feature в текущих runtime-артефактах тоже отсутствует: в plugin bundles `provider-codex` и `provider-usage` нет маркеров `codex.usage.resetCredits` и `Дополнительные сбросы`.
- Запись `/home/hermes/.bb/codex-reset-deployment.json` уже есть, но относится к `0.48.0` и старому `entryPath` `/home/hermes/.bb/app-versions/0.48.0/node_modules/bb-app/dist/bb-app.js`.
- Runtime `/home/hermes/.bb/bb-app-runtime.json` указывает `0.48.1` и `/home/hermes/.bb/app-versions/0.48.1/node_modules/bb-app/dist/bb-app.js`. Поэтому старая запись и её artifact hashes не соответствуют установленным файлам.

## Затронутые пакеты

- `bb-plugin-provider-codex`: read-only host RPC, валидация доступных reset credits, source measurement.
- `bb-plugin-bb--provider-usage`: перенос optional `resetCredits` через server/display contract, отображение двух ближайших сроков в МСК и settings.
- Maintenance: deployment/checker, плановый three-day maintenance script, документация и изолированный Node-тест.

## Проверки

- Пройдено: `node --test scripts/codex-reset-maintenance.test.mjs` — 1 test passed.
- Пройдено: `git diff --check` до commit и `git diff --cached --check` — без ошибок whitespace.
- Не выполнено: `pnpm exec turbo run test typecheck --filter=bb-plugin-provider-codex --filter=bb-plugin-bb--provider-usage`. В worktree нет `pnpm`; зависимостей и тяжёлых сборок по ограничению не устанавливались.
- После централизованной подготовки runtime запустить через Turbo: `pnpm exec turbo run test typecheck lint --filter=bb-plugin-provider-codex --filter=bb-plugin-bb--provider-usage`.

## Безопасная runtime/UI-проверка

В этом треде не выполнялись `--deploy`, plugin reload, `--check`, RPC и доступ к auth. Статическая проверка installed bundles подтверждает, что старая feature не сохранилась при обновлении. После отдельного разрешения на live-операцию релиз-исполнитель должен собрать оба плагина из этого commit, выполнить deployment и только затем checker. `--check` вызывает provider usage RPC, поэтому он выходит за текущий запрет на доступ к auth и не должен запускаться до отдельного разрешения.

## Deployment checker и запись состояния

- Скрипт читает data directory из `BB_DATA_DIR`, а при отсутствии переменной использует `/data`. Фактические runtime и state в этой установке находятся в `/home/hermes/.bb`; при разрешённом запуске потребуется явный `BB_DATA_DIR=/home/hermes/.bb`.
- При смене версии либо `entryPath` checker останавливается до хеширования и UI-проверки с `BB was updated; adapt and redeploy the source patch.` Это ожидаемая защита от копирования артефакта старой версии поверх нового provider.
- Запись состояния не исправлять вручную. Успешный `--deploy` после сборки сам должен заменить `/home/hermes/.bb/codex-reset-deployment.json`: `version: 0.48.1`, точный новый `entryPath`, `deployedAt`, source hashes для 12 перечисленных исходников/checker и artifact hashes девяти файлов двух плагинов.
- Только после записи этих hashes и reload двух плагинов `--check` сможет сопоставить исходники, установленный bundle и UI. В текущем запуске эти действия намеренно не выполнялись.
