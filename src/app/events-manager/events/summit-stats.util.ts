import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';

// Pure derivations over one event's registrations + agenda items - shared
// by the Summit Mission Control hub and the Attendee Command Center, both
// of which do the same one-time aggregate load (getAllByValue('eventId'),
// the Event Report precedent; eventSessionCounts is functions-only in
// rules, so capacity is always DERIVED client-side, never read).

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface WeeklyBucket {
  weekStartMs: number;
  count: number;
}

// Registrations bucketed by calendar week (local time, weeks starting
// Sunday), oldest first, with empty weeks filled in so a pace chart shows
// real gaps rather than compressing them away.
export function weeklyBuckets(registrations: EventRegistrationModel[]): WeeklyBucket[] {
  const counts = new Map<number, number>();
  for (const reg of registrations) {
    const ms = toMillis(reg.registrationDate);
    if (!ms) continue;
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    counts.set(d.getTime(), (counts.get(d.getTime()) ?? 0) + 1);
  }
  if (!counts.size) return [];
  const keys = [...counts.keys()].sort((a, b) => a - b);
  const buckets: WeeklyBucket[] = [];
  for (let ms = keys[0]; ms <= keys[keys.length - 1]; ms += WEEK_MS) {
    buckets.push({ weekStartMs: ms, count: counts.get(ms) ?? 0 });
  }
  return buckets;
}

// Registrations whose registrationDate falls in the current calendar week.
export function thisWeekCount(registrations: EventRegistrationModel[]): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  now.setDate(now.getDate() - now.getDay());
  const weekStart = now.getTime();
  return registrations.filter((r) => toMillis(r.registrationDate) >= weekStart).length;
}

// Sign-up count per agenda-item id, derived from trainingSessions - the
// same join flattenBreakouts() uses in the Event Report.
export function countsByItemId(registrations: EventRegistrationModel[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const reg of registrations) {
    for (const id of reg.trainingSessions ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

export function noBreakoutRegistrations(registrations: EventRegistrationModel[]): EventRegistrationModel[] {
  return registrations.filter((r) => (r.trainingSessions ?? []).length === 0);
}

// Breakout items at/over the given fill ratio of their maxParticipants.
export function sessionsNearCapacity(event: EventModel, counts: Map<string, number>, ratio = 0.9): AgendaItem[] {
  return (event.agendaItems ?? []).filter((item) => {
    if (!item.isCourse || !item.maxParticipants) return false;
    return (counts.get(item.id!) ?? 0) >= item.maxParticipants * ratio;
  });
}

// % of registrants who have picked at least one breakout (0-100, rounded).
export function pickedPercent(registrations: EventRegistrationModel[]): number {
  if (!registrations.length) return 0;
  const picked = registrations.length - noBreakoutRegistrations(registrations).length;
  return Math.round((picked / registrations.length) * 100);
}
