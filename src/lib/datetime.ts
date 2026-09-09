// src/lib/datetime.ts
//
// Converts a plain date + time (as entered in an HTML date/time input,
// with no timezone info of their own) into the correct UTC instant for a
// given IANA timezone. Used wherever a deadline gets entered or edited, so
// "11:59pm" means 11:59pm in the student's own timezone, not the server's.

export function toIsoWithTimezone(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desiredLocalEpochMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guessUtcMs = desiredLocalEpochMs;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(guessUtcMs));

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const actualLocalEpochMs = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  const offsetMs = actualLocalEpochMs - desiredLocalEpochMs;
  return new Date(guessUtcMs - offsetMs).toISOString();
}
