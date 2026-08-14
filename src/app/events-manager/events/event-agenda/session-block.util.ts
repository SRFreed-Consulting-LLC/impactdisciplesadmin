import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { CourseModel } from 'src/app/common/models/domain/course.model';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';

// A "breakout block" - several Course Session AgendaItems (isCourse: true)
// running in parallel at the same time - isn't a stored concept anywhere:
// no blockId on AgendaItem, no separate collection. It's derived here by
// grouping isCourse items that share an identical (startDate, endDate)
// pair. That's deliberate - it's what lets an existing Summit event's
// agendaItems, built one at a time under the old calendar-only UI with no
// notion of "block" at all, group into blocks automatically the moment
// they're opened in the new Wizard/Canvas/Grid UI, with zero migration
// script needed. Plain Agenda Items and Food Breaks are never grouped
// into a block even if two happen to share a time - "block" specifically
// means parallel breakout options, not coincidental timing.
//
// Every date comparison here goes through toMillis(), not raw Date
// arithmetic or .toISOString() - agenda item dates are often stored as a
// plain ISO string rather than a real Firestore Timestamp (see
// MIGRATION.md's "Date fields: inconsistent storage shapes" entry).
// event-breakouts.component.ts has a live, documented bug from grouping
// with `new Date(x).toISOString()` unguarded; this file must not repeat it.

export interface SessionBlock {
  key: string;
  startDate: Date;
  endDate: Date;
  options: AgendaItem[];
}

export type DayScheduleEntry = { kind: 'item'; item: AgendaItem } | { kind: 'block'; block: SessionBlock };

export function groupAgendaItemsIntoBlocks(items: AgendaItem[]): SessionBlock[] {
  const byKey = new Map<string, AgendaItem[]>();

  items
    .filter((item) => item.isCourse)
    .forEach((item) => {
      const key = blockKey(item);
      const list = byKey.get(key) ?? [];
      list.push(item);
      byKey.set(key, list);
    });

  return Array.from(byKey.values())
    .map((options) => ({
      key: blockKey(options[0]),
      startDate: new Date(toMillis(options[0].startDate)),
      endDate: new Date(toMillis(options[0].endDate)),
      options: [...options].sort((a, b) => (a.room ?? '').localeCompare(b.room ?? ''))
    }))
    .sort((a, b) => toMillis(a.startDate) - toMillis(b.startDate));
}

function blockKey(item: AgendaItem): string {
  return `${toMillis(item.startDate)}-${toMillis(item.endDate)}`;
}

// Single (non-course) items and derived blocks, interleaved into one
// chronological schedule for a day - what the Wizard's review step,
// Canvas, and Grid all actually render.
export function buildDaySchedule(items: AgendaItem[]): DayScheduleEntry[] {
  const singles: DayScheduleEntry[] = items.filter((item) => !item.isCourse).map((item) => ({ kind: 'item', item }));
  const blocks: DayScheduleEntry[] = groupAgendaItemsIntoBlocks(items).map((block) => ({ kind: 'block', block }));

  return [...singles, ...blocks].sort((a, b) => entryStart(a) - entryStart(b));
}

function entryStart(entry: DayScheduleEntry): number {
  return entry.kind === 'item' ? toMillis(entry.item.startDate) : toMillis(entry.block.startDate);
}

// Splits an event's full agendaItems into per-day buckets (by calendar
// day, local time) so Wizard/Canvas/Grid can each render a Day 1 / Day 2
// (or however many days the event actually spans) toggle over the same
// underlying array - keyed by dayKey() below.
export function splitByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const byDay = new Map<string, AgendaItem[]>();
  items.forEach((item) => {
    const ms = toMillis(item.startDate);
    if (!ms) return;
    const key = dayKey(new Date(ms));
    const list = byDay.get(key) ?? [];
    list.push(item);
    byDay.set(key, list);
  });
  return byDay;
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Derives the calendar days an event spans (Day 1, Day 2, ...) from its
// own startDate/endDate - used by the Wizard's first step for a brand new
// event, which has no agendaItems yet to derive days from any other way.
export function eventDayDates(startDate: unknown, endDate: unknown): Date[] {
  const startMs = toMillis(startDate);
  if (!startMs) return [];
  const endMs = toMillis(endDate) || startMs;

  const days: Date[] = [];
  let cursor = startOfDay(new Date(startMs));
  const last = startOfDay(new Date(endMs));
  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor);
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Auto-generated block display label ("Breakout Block A", "Breakout Block
// B", ...) by chronological order within the day - blocks don't carry a
// stored name (see the module comment on why blocks aren't stored at
// all), so this is computed fresh on every render rather than persisted.
export function blockLabel(index: number): string {
  return `Breakout Block ${String.fromCharCode(65 + index)}`;
}

// Course-first, AgendaItem-fallback coach display - see CourseModel's own
// comment on coachIds for why. Returns a joined display string ("Dana
// Whitfield, Marcus Ellery") or '—' if nobody's assigned either place.
export function coachLabelFor(item: AgendaItem, course: CourseModel | undefined, coaches: CoachModel[]): string {
  const ids = (course?.coachIds?.length ? course.coachIds : item.coaches) ?? [];
  const names = ids.map((id) => coaches.find((c) => c.id === id)?.fullname).filter((name): name is string => !!name);
  return names.length ? names.join(', ') : '—';
}
