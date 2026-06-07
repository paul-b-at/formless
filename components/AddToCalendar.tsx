"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar01Icon,
  Download01Icon,
} from "@hugeicons/core-free-icons";

import {
  buildCalendarEvent,
  buildGoogleCalendarUrl,
  buildIcsWebcalUrl,
  downloadIcsFile,
  openIcsInCalendarApp,
  type CalendarEventInput,
} from "@/components/calendar-export";
import { Button } from "@/components/ui/button";

type AddToCalendarProps = {
  eventInput: CalendarEventInput;
  className?: string;
};

export function AddToCalendar({
  eventInput,
  className,
}: AddToCalendarProps): React.ReactElement {
  const event = useMemo(() => buildCalendarEvent(eventInput), [eventInput]);
  const googleCalendarUrl = useMemo(
    () => buildGoogleCalendarUrl(event),
    [event],
  );
  const webcalUrl = useMemo(() => buildIcsWebcalUrl(event), [event]);

  return (
    <div className={className}>
      <p className="text-sm font-medium text-foreground">Add to calendar</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" size="sm" asChild>
          <a
            href={googleCalendarUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            <HugeiconsIcon icon={Calendar01Icon} strokeWidth={2} data-icon="inline-start" />
            Add to Google Calendar
          </a>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => downloadIcsFile(event)}
        >
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} data-icon="inline-start" />
          Apple Calendar / Outlook (.ics)
        </Button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        On iPhone or Mac,{" "}
        <a
          href={webcalUrl}
          className="font-medium text-primary underline-offset-2 hover:underline"
          onClick={(clickEvent) => {
            clickEvent.preventDefault();
            openIcsInCalendarApp(event);
          }}
        >
          open in Calendar app
        </a>{" "}
        (same .ics file). Download the .ics above if your device does not open it
        automatically.
      </p>
    </div>
  );
}
