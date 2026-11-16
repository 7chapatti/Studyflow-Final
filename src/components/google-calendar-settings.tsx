"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarIcon, CheckIcon } from "@/components/icons";

interface CalendarStatus {
  configured: boolean;
  eligible: boolean;
  connected: boolean;
  lastSyncedAt: string | null;
}

// Messages for the ?calendar= value the connect flow comes back with.
const OUTCOME_MESSAGES: Record<string, { text: string; tone: "good" | "bad" }> = {
  connected: { text: "Google Calendar connected. Your study blocks are being added now.", tone: "good" },
  declined: { text: "Google Calendar wasn't connected because access wasn't granted.", tone: "bad" },
  error: { text: "Couldn't connect Google Calendar. Please try again.", tone: "bad" },
  slow_down: { text: "Too many attempts. Please wait a few minutes and try again.", tone: "bad" },
  unavailable: { text: "Google Calendar sync isn't available right now.", tone: "bad" },
};

function formatSyncTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// The Google Calendar section of the settings page. Renders nothing until
// it knows the state, and nothing at all if the feature isn't configured on
// this deployment, so the page never shows a button that can't work.
export default function GoogleCalendarSettings() {
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "good" | "bad" } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch("/api/google/calendar/status");
        const json = await res.json();
        if (!mounted || !res.ok || !json.success) return;

        setStatus(json.data as CalendarStatus);

        const outcome = new URLSearchParams(window.location.search).get("calendar");
        if (outcome && OUTCOME_MESSAGES[outcome]) setNotice(OUTCOME_MESSAGES[outcome]);
      } catch {
        // Leave the section hidden; the rest of settings still works.
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSync() {
    setNotice(null);
    setSyncing(true);
    try {
      const res = await fetch("/api/google/calendar/sync", { method: "POST" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        if (json?.data?.disconnected) {
          setStatus((prev) => (prev ? { ...prev, connected: false, lastSyncedAt: null } : prev));
        }
        setNotice({ text: json?.error ?? "Couldn't sync with Google Calendar.", tone: "bad" });
        return;
      }

      const { created, updated, removed, failed } = json.data as {
        created: number;
        updated: number;
        removed: number;
        failed: number;
      };
      const changed = created + updated + removed;

      setStatus((prev) => (prev ? { ...prev, lastSyncedAt: new Date().toISOString() } : prev));
      if (failed > 0) {
        setNotice({
          text: `Synced, but ${failed} event${failed === 1 ? "" : "s"} couldn't be updated. Try again in a moment.`,
          tone: "bad",
        });
      } else {
        setNotice({
          text:
            changed === 0
              ? "Already up to date."
              : `Synced: ${created} added, ${updated} updated, ${removed} removed.`,
          tone: "good",
        });
      }
    } catch {
      setNotice({ text: "Couldn't sync with Google Calendar.", tone: "bad" });
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (
      !confirm(
        "Disconnect Google Calendar? Duecourse will stop updating it. Events already added stay in your Google Calendar until you delete the Duecourse calendar there."
      )
    ) {
      return;
    }

    setNotice(null);
    setDisconnecting(true);
    try {
      const res = await fetch("/api/google/calendar/disconnect", { method: "POST" });
      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.success) {
        setNotice({ text: json?.error ?? "Couldn't disconnect Google Calendar.", tone: "bad" });
        return;
      }

      setStatus((prev) => (prev ? { ...prev, connected: false, lastSyncedAt: null } : prev));
      setNotice({ text: "Google Calendar disconnected.", tone: "good" });
    } catch {
      setNotice({ text: "Couldn't disconnect Google Calendar.", tone: "bad" });
    } finally {
      setDisconnecting(false);
    }
  }

  if (!status || !status.configured) return null;

  return (
    <section aria-labelledby="gcal-label" className="bg-card border border-border rounded-xl p-5">
      <h2 id="gcal-label" className="flex items-center gap-2 font-display text-base font-semibold text-text mb-2">
        <span className="text-il"><CalendarIcon /></span>
        Google Calendar
      </h2>

      {!status.eligible ? (
        <>
          <p className="text-muted text-sm mb-4">
            See your study blocks alongside everything else in Google Calendar. Available on the
            Premium and Pro plans.
          </p>
          <Link
            href="/upgrade"
            className="inline-block bg-indigo hover:bg-il text-ink text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            View plans →
          </Link>
        </>
      ) : status.connected ? (
        <>
          <p className="flex items-center gap-1 text-green text-sm mb-1">
            <CheckIcon size={13} /> Connected
          </p>
          <p className="text-muted text-sm mb-4">
            Your study blocks appear in a calendar called <strong className="text-text">Duecourse</strong>{" "}
            and update whenever your plan is organised.{" "}
            {status.lastSyncedAt ? (
              <>
                Last synced <time dateTime={status.lastSyncedAt}>{formatSyncTime(status.lastSyncedAt)}</time>.
              </>
            ) : (
              "First sync in progress."
            )}
          </p>
          <p className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || disconnecting}
              className="bg-indigo hover:bg-il text-ink text-sm font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
            >
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={syncing || disconnecting}
              className="text-sm font-medium text-muted hover:text-text border border-border rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          </p>
        </>
      ) : (
        <>
          <p className="text-muted text-sm mb-4">
            Add your study blocks to Google Calendar. Duecourse creates its own calendar called{" "}
            <strong className="text-text">Duecourse</strong> and can only see and change that one,
            not your other calendars or events.
          </p>
          {/* A plain link, not fetch: the server answers with a redirect to
              Google's consent screen, which has to be a full page navigation. */}
          <a
            href="/api/google/calendar/connect"
            className="inline-block bg-indigo hover:bg-il text-ink text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            Connect Google Calendar
          </a>
        </>
      )}

      {notice && (
        <p
          role={notice.tone === "bad" ? "alert" : "status"}
          className={`text-xs mt-3 ${notice.tone === "bad" ? "text-red" : "text-green"}`}
        >
          {notice.text}
        </p>
      )}
    </section>
  );
}
