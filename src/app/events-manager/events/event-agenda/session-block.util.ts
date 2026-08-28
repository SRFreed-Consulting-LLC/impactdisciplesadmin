import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';

// Either CoachModel or ImpactTeamMemberModel satisfies this structurally -
// since the Impact Team split (2026-08, see impact-team.service.ts's own
// header comment) a breakout instructor can come from either collection,
// and every place that resolves an id to a display name (coachLabelFor()
// below, plus the Agenda dialogs/canvas/grid that call it) just needs
// id/fullname, not either model's full shape - this avoids committing
// those call sites to importing both concrete models just to type a
// combined array. `source` tags which collection an entry came from so the
// coach pickers can group their options ("Impact Team" / "Coaches") -
// resolution by id still ignores it.
export interface Instructor {
  id?: string;
  fullname: string;
  source?: 'coaches' | 'impact_team';
}

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

// Client-side agenda-item id (13 hex chars) - extracted from the agenda
// dialogs' private copies so the Summit Setup Wizard's copy-agenda-skeleton
// util mints ids the same way. Item ids must stay stable once anyone has
// registered (trainingSessions references them), which is exactly why a
// COPIED skeleton gets fresh ones.
export function generateAgendaItemId(): string {
  return 'xxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// The item's display title - since the 2026-08 Courses retirement a
// breakout carries its own `text` (backfilled from the old course docs by
// scripts/flatten-courses-onto-agenda-items.js). '(unknown breakout)'
// rather than blank so a missed backfill is visible instead of silent.
export function itemTitle(item: AgendaItem): string {
  return item.text || '(unknown breakout)';
}

// Coach display straight off the item - `coaches` (the arg) is the
// combined Coaches + Impact Team array (see event-agenda.component.ts's
// own comment). The old CourseModel.coachIds preference is gone with the
// Courses retirement - no real data ever used it. Returns a joined display
// string ("Dana Whitfield, Marcus Ellery") or '—' if nobody's assigned.
export function coachLabelFor(item: AgendaItem, coaches: Instructor[]): string {
  const ids = item.coaches ?? [];
  const names = ids.map((id) => coaches.find((c) => c.id === id)?.fullname).filter((name): name is string => !!name);
  return names.length ? names.join(', ') : '—';
}
