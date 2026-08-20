import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import {
  countsByItemId,
  noBreakoutRegistrations,
  pickedPercent,
  sessionsNearCapacity,
  thisWeekCount,
  weeklyBuckets
} from './summit-stats.util';

// 2026-08-02, -09, -16, -23 are consecutive SUNDAYS - week-bucket
// boundaries fall exactly there (weeks start Sunday, local time). All
// fixture dates are local-constructed and inside August, so no DST
// transition can land inside a tested range in any timezone.
const sunAug2 = new Date(2026, 7, 2);
const sunAug9 = new Date(2026, 7, 9);
const sunAug16 = new Date(2026, 7, 16);

function reg(overrides: Partial<EventRegistrationModel>): EventRegistrationModel {
  return {
    id: 'reg-x',
    email: 'someone@example.com',
    trainingSessions: [],
    ...overrides
  } as EventRegistrationModel;
}

describe('weeklyBuckets', () => {
  it('buckets registrations into Sunday-start weeks, oldest first', () => {
    const buckets = weeklyBuckets([
      reg({ registrationDate: new Date(2026, 7, 4, 10, 30) }), // Tue of Aug 2 week
      reg({ registrationDate: new Date(2026, 7, 8, 23, 59) }), // Sat, still Aug 2 week
      reg({ registrationDate: new Date(2026, 7, 11) }) // Tue of Aug 9 week
    ]);

    expect(buckets).toEqual([
      { weekStartMs: sunAug2.getTime(), count: 2 },
      { weekStartMs: sunAug9.getTime(), count: 1 }
    ]);
  });

  it('a registration at exactly Sunday midnight starts its OWN week', () => {
    const buckets = weeklyBuckets([reg({ registrationDate: sunAug9 })]);

    expect(buckets).toEqual([{ weekStartMs: sunAug9.getTime(), count: 1 }]);
  });

  it('fills gap weeks with zero-count buckets instead of compressing them away', () => {
    const buckets = weeklyBuckets([
      reg({ registrationDate: new Date(2026, 7, 4) }),
      reg({ registrationDate: new Date(2026, 7, 18) }) // two weeks later
    ]);

    expect(buckets).toEqual([
      { weekStartMs: sunAug2.getTime(), count: 1 },
      { weekStartMs: sunAug9.getTime(), count: 0 },
      { weekStartMs: sunAug16.getTime(), count: 1 }
    ]);
  });

  it('accepts ISO-string registration dates (toMillis normalization)', () => {
    const buckets = weeklyBuckets([reg({ registrationDate: new Date(2026, 7, 4, 9, 0).toISOString() })]);

    expect(buckets).toEqual([{ weekStartMs: sunAug2.getTime(), count: 1 }]);
  });

  it('skips registrations with a missing or unparseable date', () => {
    const buckets = weeklyBuckets([
      reg({ registrationDate: undefined }),
      reg({ registrationDate: 'not-a-date' }),
      reg({ registrationDate: new Date(2026, 7, 4) })
    ]);

    expect(buckets).toEqual([{ weekStartMs: sunAug2.getTime(), count: 1 }]);
  });

  it('returns [] for no (usable) registrations', () => {
    expect(weeklyBuckets([])).toEqual([]);
    expect(weeklyBuckets([reg({ registrationDate: undefined })])).toEqual([]);
  });
});

describe('thisWeekCount', () => {
  beforeEach(() => {
    jasmine.clock().install();
    // A Wednesday - "this week" began Sunday Aug 16.
    jasmine.clock().mockDate(new Date(2026, 7, 19, 14, 0));
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('counts only registrations on/after the current week\'s Sunday', () => {
    const count = thisWeekCount([
      reg({ registrationDate: sunAug16 }), // boundary: counts
      reg({ registrationDate: new Date(2026, 7, 18) }),
      reg({ registrationDate: new Date(2026, 7, 15, 23, 59) }) // Saturday before: doesn't
    ]);

    expect(count).toBe(2);
  });
});

describe('countsByItemId', () => {
  it('tallies sign-ups per agenda-item id across registrations', () => {
    const counts = countsByItemId([
      reg({ trainingSessions: ['a', 'b'] }),
      reg({ trainingSessions: ['a'] }),
      reg({ trainingSessions: undefined })
    ]);

    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
    expect(counts.has('zzz')).toBeFalse();
  });

  it('returns an empty map for no registrations', () => {
    expect(countsByItemId([]).size).toBe(0);
  });
});

describe('noBreakoutRegistrations', () => {
  it('lists registrations with an empty OR missing trainingSessions array', () => {
    const empty = reg({ id: 'empty', trainingSessions: [] });
    const missing = reg({ id: 'missing', trainingSessions: undefined });
    const picked = reg({ id: 'picked', trainingSessions: ['a'] });

    const result = noBreakoutRegistrations([empty, missing, picked]);

    expect(result.map((r) => r.id)).toEqual(['empty', 'missing']);
  });
});

describe('sessionsNearCapacity', () => {
  const items = [
    { id: 'full', text: 'Full', isCourse: true, maxParticipants: 10 },
    { id: 'warn', text: 'Warn', isCourse: true, maxParticipants: 10 },
    { id: 'ok', text: 'Ok', isCourse: true, maxParticipants: 10 },
    { id: 'not-course', text: 'Lunch', isCourse: false, maxParticipants: 5 },
    { id: 'no-cap', text: 'Uncapped', isCourse: true }
  ] as AgendaItem[];
  const event = { agendaItems: items } as EventModel;
  const counts = new Map<string, number>([
    ['full', 10],
    ['warn', 9],
    ['ok', 8],
    ['not-course', 5],
    ['no-cap', 50]
  ]);

  it('flags items at or above 90% of maxParticipants by default', () => {
    const flagged = sessionsNearCapacity(event, counts);

    expect(flagged.map((i) => i.id)).toEqual(['full', 'warn']);
  });

  it('a stricter ratio of 1 flags only truly full sessions', () => {
    const flagged = sessionsNearCapacity(event, counts, 1);

    expect(flagged.map((i) => i.id)).toEqual(['full']);
  });

  it('ignores non-course items and items without a maxParticipants cap', () => {
    const flagged = sessionsNearCapacity(event, counts, 0.5);

    expect(flagged.map((i) => i.id)).not.toContain('not-course');
    expect(flagged.map((i) => i.id)).not.toContain('no-cap');
  });

  it('handles an event with no agendaItems', () => {
    expect(sessionsNearCapacity({} as EventModel, counts)).toEqual([]);
  });
});

describe('pickedPercent', () => {
  it('is 0 (not NaN) with zero registrations', () => {
    expect(pickedPercent([])).toBe(0);
  });

  it('rounds the picked ratio to a whole percent', () => {
    const one = reg({ trainingSessions: ['a'] });
    const none = reg({ trainingSessions: [] });

    expect(pickedPercent([one, none, none])).toBe(33);
    expect(pickedPercent([one, one, none])).toBe(67);
  });

  it('is 100 when every registrant picked at least one breakout', () => {
    expect(pickedPercent([reg({ trainingSessions: ['a'] }), reg({ trainingSessions: ['b', 'c'] })])).toBe(100);
  });
});
