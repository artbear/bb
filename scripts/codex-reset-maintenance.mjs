import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function isMaintenanceDay(today, anchor) {
  const days =
    (Date.parse(today + "T00:00:00Z") - Date.parse(anchor + "T00:00:00Z")) /
    86_400_000;
  if (!Number.isInteger(days)) throw new Error("Invalid maintenance date");
  return days >= 0 && days % 3 === 0;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const anchor = process.env.BB_CODEX_RESET_ANCHOR;
  const target = process.env.BB_CODEX_RESET_THREAD;
  const checkout = process.env.BB_CODEX_RESET_REPO;
  if (!anchor || !target || !checkout)
    throw new Error(
      "Maintenance anchor, checkout and target thread are required",
    );
  if (isMaintenanceDay(today, anchor)) {
    const prompt = `Плановая проверка Codex reset credits. Пользователь разрешил проверку и восстановление каждые три дня в 00:40 МСК, правку исходников BB на сервере, commit и push в публичный форк https://github.com/artbear/bb, ветка codex-reset-expiry.
Работай в ${checkout}. Если checkout отсутствует, восстанови его из публичного форка, ветка codex-reset-expiry. Прочитай docs/codex-reset-expirations.md и выполни node scripts/codex-reset-deployment.mjs --check.
Проверь наличие исходников до запуска checker, резервную запись /data/codex-reset-deployment.json, текущую версию и путь BB в /data/bb-app-runtime.json. Проверяй фактическую установленную сборку плагина через UI checker: недельный лимит и два ближайших срока действия доступных дополнительных сбросов с датами по Москве. Если всё на месте и UI проверен, сообщи коротко об успехе.
Если нужных исходников, кода в установленной сборке или отображения нет, восстанови реализацию. Сначала проверь git status, сохрани чужие изменения. Для новой версии BB получи gitHead именно установленного релиза, перенеси нашу небольшую правку на актуальные исходники и обнови публичный форк; не подменяй новый провайдер старой сборкой. Запусти относящиеся к изменению тесты и typecheck через Turbo, собери оба плагина штатным bb plugin build, примени node scripts/codex-reset-deployment.mjs --deploy и повтори --check. Внеси необходимые изменения в git, commit и push в origin codex-reset-expiry. Авторизация gh настроена на сервере. Не коммить учётные данные, auth.json, состояние аккаунта, резервные копии и артефакты сборки. Никогда не применяй и не покупай сброс квоты, нужны только GET-запросы. Если проблема только в сети или авторизации, не считай это исчезновением кода: сообщи реальную причину, не фабрикуй даты и не ухудшай работу лимитов.`;
    const result = spawnSync(
      process.env.BB_CLI ?? "bb",
      ["thread", "tell", target, "--mode", "queue", "--message-file", "-"],
      { input: prompt, encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0)
      throw new Error(
        result.stderr || "Could not queue Codex reset maintenance",
      );
    process.stdout.write(result.stdout || "Codex reset maintenance queued.\n");
  }
}
