import type { UsageProvider } from "./usage-schema.js";
import { useEffect, useState } from "react";

export function formatCodexResetDate(value: string): string {
  return (
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value)) + " МСК"
  );
}

export function CodexResetCredits({
  value,
}: {
  value: UsageProvider["resetCredits"];
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  if (value == null) return null;
  if (value.status === "error") {
    return (
      <div
        data-codex-reset-credits=""
        className="col-span-full text-2xs text-subtle-foreground"
      >
        Дополнительные сбросы: не удалось обновить
      </div>
    );
  }
  const credits = value.credits
    .filter(
      (credit) =>
        credit.expiresAt === null || new Date(credit.expiresAt).getTime() > now,
    )
    .sort(
      (left, right) =>
        (left.expiresAt === null ? Infinity : Date.parse(left.expiresAt)) -
        (right.expiresAt === null ? Infinity : Date.parse(right.expiresAt)),
    )
    .slice(0, 2);
  return (
    <div
      data-codex-reset-credits=""
      className="col-span-full grid gap-1 text-2xs text-subtle-foreground"
    >
      <span>Дополнительные сбросы: {value.availableCount}</span>
      {credits.map((credit, index) => (
        <span key={credit.id}>
          Сброс {index + 1}:{" "}
          {credit.expiresAt === null ? (
            "без срока действия"
          ) : (
            <>
              использовать до{" "}
              <time dateTime={credit.expiresAt}>
                {formatCodexResetDate(credit.expiresAt)}
              </time>
            </>
          )}
        </span>
      ))}
      {value.availableCount > 0 && credits.length === 0 ? (
        <span>Сроки доступных сбросов не получены.</span>
      ) : null}
    </div>
  );
}
