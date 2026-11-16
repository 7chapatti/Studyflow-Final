// Works out what has to change in Google Calendar so that it matches the
// study blocks in Duecourse. Pure: no network, no database, so the rules
// can be tested directly.
//
// Every study block maps to exactly one event whose id is derived from the
// block's id. That makes a sync safe to run any number of times: a block
// that is already there is recognised rather than added again, and an
// event whose block has gone (the plan was reorganised, the task was
// finished) is recognised as left over and removed.

export interface DesiredEvent {
  id: string;
  summary: string;
  description: string;
  /** ISO-8601 instants. */
  start: string;
  end: string;
}

export interface ExistingEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  status?: string;
}

export interface CalendarSyncPlan {
  create: DesiredEvent[];
  update: DesiredEvent[];
  remove: string[];
}

// Google event ids may only use lowercase a-v and 0-9. A UUID with its
// dashes removed is 32 hex characters, which fits.
export function eventIdForBlock(blockId: string): string {
  return blockId.replace(/-/g, "").toLowerCase();
}

function sameInstant(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return !Number.isNaN(left) && left === right;
}

function needsUpdate(existing: ExistingEvent, desired: DesiredEvent): boolean {
  return (
    existing.status === "cancelled" ||
    (existing.summary ?? "") !== desired.summary ||
    (existing.description ?? "") !== desired.description ||
    !sameInstant(existing.start, desired.start) ||
    !sameInstant(existing.end, desired.end)
  );
}

export function planCalendarSync(
  desired: DesiredEvent[],
  existing: ExistingEvent[]
): CalendarSyncPlan {
  const existingById = new Map(existing.map((event) => [event.id, event]));
  const desiredIds = new Set(desired.map((event) => event.id));

  const create: DesiredEvent[] = [];
  const update: DesiredEvent[] = [];

  for (const event of desired) {
    const current = existingById.get(event.id);
    if (!current) create.push(event);
    else if (needsUpdate(current, event)) update.push(event);
  }

  const remove = existing
    .filter((event) => !desiredIds.has(event.id) && event.status !== "cancelled")
    .map((event) => event.id);

  return { create, update, remove };
}
