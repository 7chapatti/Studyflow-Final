// Thin wrapper over the handful of Google Calendar REST calls the sync
// needs. Plain fetch rather than the googleapis SDK: that package is very
// large, and this is six endpoints.
import type { DesiredEvent, ExistingEvent } from "./sync-plan";

const BASE = "https://www.googleapis.com/calendar/v3";
export const DUECOURSE_CALENDAR_NAME = "Duecourse";

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

async function call(accessToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function fail(response: Response, what: string): Promise<never> {
  throw new GoogleApiError(response.status, `${what} failed with HTTP ${response.status}`);
}

function eventsPath(calendarId: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events`;
}

function eventBody(event: DesiredEvent) {
  return {
    summary: event.summary,
    description: event.description,
    start: { dateTime: event.start },
    end: { dateTime: event.end },
    status: "confirmed",
  };
}

export async function createDuecourseCalendar(accessToken: string, timeZone: string): Promise<string> {
  const response = await call(accessToken, "/calendars", {
    method: "POST",
    body: JSON.stringify({
      summary: DUECOURSE_CALENDAR_NAME,
      description: "Study blocks planned by Duecourse. Managed automatically: changes made here are overwritten on the next sync.",
      timeZone,
    }),
  });
  if (!response.ok) await fail(response, "Creating the calendar");

  const json = (await response.json()) as { id?: string };
  if (!json.id) throw new GoogleApiError(502, "Google returned no calendar id");
  return json.id;
}

// False when the user has deleted the calendar in Google.
export async function calendarExists(accessToken: string, calendarId: string): Promise<boolean> {
  const response = await call(accessToken, `/calendars/${encodeURIComponent(calendarId)}`);
  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) await fail(response, "Checking the calendar");
  return true;
}

// Every event on the Duecourse calendar that ends after `timeMinIso`,
// including ones the user deleted (so they can be restored).
export async function listUpcomingEvents(
  accessToken: string,
  calendarId: string,
  timeMinIso: string
): Promise<ExistingEvent[]> {
  const events: ExistingEvent[] = [];
  let pageToken: string | undefined;

  // Hard stop so a paging bug on either side can't loop forever.
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({
      timeMin: timeMinIso,
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "250",
      fields: "nextPageToken,items(id,summary,description,status,start/dateTime,end/dateTime)",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await call(accessToken, `${eventsPath(calendarId)}?${params.toString()}`);
    if (!response.ok) await fail(response, "Listing events");

    const json = (await response.json()) as {
      nextPageToken?: string;
      items?: Array<{
        id: string;
        summary?: string;
        description?: string;
        status?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
      }>;
    };

    for (const item of json.items ?? []) {
      events.push({
        id: item.id,
        summary: item.summary,
        description: item.description,
        status: item.status,
        start: item.start?.dateTime,
        end: item.end?.dateTime,
      });
    }

    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }

  return events;
}

export async function updateEvent(accessToken: string, calendarId: string, event: DesiredEvent): Promise<void> {
  const response = await call(accessToken, `${eventsPath(calendarId)}/${event.id}`, {
    method: "PATCH",
    body: JSON.stringify(eventBody(event)),
  });
  if (!response.ok) await fail(response, "Updating an event");
}

export async function createEvent(accessToken: string, calendarId: string, event: DesiredEvent): Promise<void> {
  const response = await call(accessToken, eventsPath(calendarId), {
    method: "POST",
    body: JSON.stringify({ id: event.id, ...eventBody(event) }),
  });

  // 409: this id is already in use, e.g. two syncs overlapped. The event
  // exists, so bring it up to date instead of treating that as a failure.
  if (response.status === 409) {
    await updateEvent(accessToken, calendarId, event);
    return;
  }
  if (!response.ok) await fail(response, "Creating an event");
}

export async function deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
  const response = await call(accessToken, `${eventsPath(calendarId)}/${eventId}`, { method: "DELETE" });
  // Already gone is the outcome we wanted.
  if (response.status === 404 || response.status === 410) return;
  if (!response.ok) await fail(response, "Deleting an event");
}
