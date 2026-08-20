import { EventModel } from 'src/app/common/models/domain/event.model';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { toMillis } from 'src/app/common/utils/date-from-timestamp';
import { generateAgendaItemId } from '../event-agenda/session-block.util';

// "Copy from last summit" (user decision 2026-08-19) - pure functions so
// they're unit-testable and the wizard component stays thin.

// Content fields worth carrying year-over-year. faqList is deep-copied so
// wizard edits never alias the source event's array.
export function copySummitContent(source: EventModel, target: EventModel): void {
  target.diningOptions = source.diningOptions ?? '';
  target.checkinInstructions = source.checkinInstructions ?? '';
  target.whatsNext = source.whatsNext ?? '';
  target.emailTemplate = source.emailTemplate ?? null;
  target.faqList = structuredClone(source.faqList ?? []);
}

// The prior summit's schedule shifted onto the new dates: every item moves
// by the whole-day delta between the two start dates (preserving
// time-of-day and multi-day offsets). Each copied item gets a FRESH id -
// last year's registrations reference the old ids and must not count
// against this year's capacity - and DROPS waitList/signedUp/legacy course.
export function copyAgendaSkeleton(source: EventModel, newStartDate: Date): AgendaItem[] {
  const sourceStart = startOfDay(toMillis(source.startDate));
  const targetStart = startOfDay(newStartDate.getTime());
  if (!sourceStart) return [];
  const delta = targetStart - sourceStart;

  return (source.agendaItems ?? []).map((item) => ({
    id: generateAgendaItemId(),
    text: item.text ?? '',
    name: item.name ?? '',
    startDate: new Date(toMillis(item.startDate) + delta),
    endDate: new Date(toMillis(item.endDate) + delta),
    isCourse: item.isCourse ?? false,
    isFoodBreak: item.isFoodBreak ?? false,
    coaches: [...(item.coaches ?? [])],
    room: item.room ?? null,
    maxParticipants: item.maxParticipants ?? null,
    description: item.description ?? null
  } as AgendaItem));
}

function startOfDay(ms: number): number {
  if (!ms) return 0;
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
