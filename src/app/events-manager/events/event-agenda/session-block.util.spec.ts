import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import {
  blockLabel,
  buildDaySchedule,
  coachLabelFor,
  dayKey,
  eventDayDates,
  generateAgendaItemId,
  groupAgendaItemsIntoBlocks,
  Instructor,
  itemTitle,
  splitByDay
} from './session-block.util';

// Fixture times are all in August (no DST transition inside any tested
// range) and built with the LOCAL-time Date constructor so these specs
// pass in any timezone the CI machine happens to run in.
const slotAStart = new Date(2026, 7, 10, 9, 0);
const slotAEnd = new Date(2026, 7, 10, 10, 30);
const slotBStart = new Date(2026, 7, 10, 11, 0);
const slotBEnd = new Date(2026, 7, 10, 12, 0);

function course(overrides: Partial<AgendaItem>): AgendaItem {
  return {
    id: 'item-x',
    text: 'Breakout',
    startDate: slotAStart,
    endDate: slotAEnd,
    isCourse: true,
    ...overrides
  } as AgendaItem;
}

describe('groupAgendaItemsIntoBlocks', () => {
  it('groups isCourse items sharing an identical start/end pair into one block', () => {
    const items = [
      course({ id: 'a', text: 'Option A' }),
      course({ id: 'b', text: 'Option B' })
    ];

    const blocks = groupAgendaItemsIntoBlocks(items);

    expect(blocks.length).toBe(1);
    expect(blocks[0].options.map((o) => o.id)).toEqual(jasmine.arrayWithExactContents(['a', 'b']));
    expect(blocks[0].startDate.getTime()).toBe(slotAStart.getTime());
    expect(blocks[0].endDate.getTime()).toBe(slotAEnd.getTime());
  });

  it('separates items whose times differ, sorted chronologically', () => {
    const items = [
      course({ id: 'late', startDate: slotBStart, endDate: slotBEnd }),
      course({ id: 'early' })
    ];

    const blocks = groupAgendaItemsIntoBlocks(items);

    expect(blocks.length).toBe(2);
    expect(blocks[0].options[0].id).toBe('early');
    expect(blocks[1].options[0].id).toBe('late');
  });

  it('items sharing only a start (different ends) do NOT group', () => {
    const items = [
      course({ id: 'a' }),
      course({ id: 'b', endDate: slotBEnd })
    ];

    expect(groupAgendaItemsIntoBlocks(items).length).toBe(2);
  });

  it('groups a Date-typed item with an ISO-string item at the same instant (the toMillis rule)', () => {
    // Agenda dates are often stored as ISO strings rather than real
    // Timestamps (see MIGRATION.md) - grouping must key on toMillis(),
    // never the raw value.
    const items = [
      course({ id: 'as-date' }),
      course({
        id: 'as-string',
        startDate: slotAStart.toISOString() as unknown as Date,
        endDate: slotAEnd.toISOString() as unknown as Date
      })
    ];

    const blocks = groupAgendaItemsIntoBlocks(items);

    expect(blocks.length).toBe(1);
    expect(blocks[0].options.length).toBe(2);
  });

  it('never groups non-course items, even at a coinciding time', () => {
    const items = [
      course({ id: 'session' }),
      course({ id: 'lunch', isCourse: false, isFoodBreak: true }),
      course({ id: 'plain', isCourse: undefined })
    ];

    const blocks = groupAgendaItemsIntoBlocks(items);

    expect(blocks.length).toBe(1);
    expect(blocks[0].options.map((o) => o.id)).toEqual(['session']);
  });

  it('sorts a block\'s options by room', () => {
    const items = [
      course({ id: 'b', room: 'Room B' }),
      course({ id: 'a', room: 'Room A' }),
      course({ id: 'none', room: undefined })
    ];

    const blocks = groupAgendaItemsIntoBlocks(items);

    // '' (missing room) sorts first under localeCompare.
    expect(blocks[0].options.map((o) => o.id)).toEqual(['none', 'a', 'b']);
  });

  it('returns [] for no items', () => {
    expect(groupAgendaItemsIntoBlocks([])).toEqual([]);
  });
});

describe('buildDaySchedule', () => {
  it('interleaves single items and derived blocks chronologically', () => {
    const items = [
      course({ id: 'bk1-a' }),
      course({ id: 'bk1-b' }),
      course({ id: 'welcome', isCourse: false, startDate: new Date(2026, 7, 10, 8, 0), endDate: new Date(2026, 7, 10, 8, 45) }),
      course({ id: 'lunch', isCourse: false, isFoodBreak: true, startDate: new Date(2026, 7, 10, 10, 30), endDate: new Date(2026, 7, 10, 11, 0) }),
      course({ id: 'bk2-a', startDate: slotBStart, endDate: slotBEnd })
    ];

    const schedule = buildDaySchedule(items);

    expect(schedule.map((e) => e.kind)).toEqual(['item', 'block', 'item', 'block']);
    expect(schedule[0].kind === 'item' && schedule[0].item.id).toBe('welcome');
    expect(schedule[1].kind === 'block' && schedule[1].block.options.length).toBe(2);
    expect(schedule[2].kind === 'item' && schedule[2].item.id).toBe('lunch');
    expect(schedule[3].kind === 'block' && schedule[3].block.options[0].id).toBe('bk2-a');
  });
});

describe('splitByDay', () => {
  it('splits a 2-day event\'s items into per-calendar-day buckets', () => {
    const items = [
      course({ id: 'd1-a' }),
      course({ id: 'd2-a', startDate: new Date(2026, 7, 11, 9, 0), endDate: new Date(2026, 7, 11, 10, 0) }),
      course({ id: 'd1-b', startDate: new Date(2026, 7, 10, 23, 59), endDate: new Date(2026, 7, 11, 0, 30) })
    ];

    const byDay = splitByDay(items);

    expect([...byDay.keys()]).toEqual(jasmine.arrayWithExactContents(['2026-08-10', '2026-08-11']));
    // A late-night item belongs to its START date's day.
    expect(byDay.get('2026-08-10')!.map((i) => i.id)).toEqual(['d1-a', 'd1-b']);
    expect(byDay.get('2026-08-11')!.map((i) => i.id)).toEqual(['d2-a']);
  });

  it('drops items with a missing or unparseable startDate rather than inventing a day', () => {
    const items = [
      course({ id: 'good' }),
      course({ id: 'no-date', startDate: undefined }),
      course({ id: 'garbage', startDate: 'not-a-date' as unknown as Date })
    ];

    const byDay = splitByDay(items);

    expect(byDay.size).toBe(1);
    expect(byDay.get('2026-08-10')!.map((i) => i.id)).toEqual(['good']);
  });
});

describe('dayKey', () => {
  it('zero-pads month and day', () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('uses the local calendar day', () => {
    expect(dayKey(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });
});

describe('eventDayDates', () => {
  it('spans every calendar day from start to end inclusive, at local midnight', () => {
    const days = eventDayDates(new Date(2026, 7, 10, 9, 0), new Date(2026, 7, 12, 15, 0));

    expect(days.length).toBe(3);
    expect(days[0].getTime()).toBe(new Date(2026, 7, 10).getTime());
    expect(days[1].getTime()).toBe(new Date(2026, 7, 11).getTime());
    expect(days[2].getTime()).toBe(new Date(2026, 7, 12).getTime());
  });

  it('a missing endDate collapses to a single-day event', () => {
    const days = eventDayDates(new Date(2026, 7, 10, 9, 0), undefined);

    expect(days.length).toBe(1);
    expect(days[0].getTime()).toBe(new Date(2026, 7, 10).getTime());
  });

  it('accepts ISO strings (the shape most events docs actually store)', () => {
    const days = eventDayDates(new Date(2026, 7, 10, 9, 0).toISOString(), new Date(2026, 7, 11, 16, 0).toISOString());

    expect(days.length).toBe(2);
  });

  it('returns [] with no parseable startDate', () => {
    expect(eventDayDates(undefined, new Date(2026, 7, 12))).toEqual([]);
    expect(eventDayDates('nonsense', new Date(2026, 7, 12))).toEqual([]);
  });
});

describe('blockLabel', () => {
  it('labels blocks A, B, C... by index', () => {
    expect(blockLabel(0)).toBe('Breakout Block A');
    expect(blockLabel(1)).toBe('Breakout Block B');
    expect(blockLabel(2)).toBe('Breakout Block C');
  });
});

describe('generateAgendaItemId', () => {
  it('mints a 13-char lowercase hex id', () => {
    expect(generateAgendaItemId()).toMatch(/^[0-9a-f]{13}$/);
  });

  it('mints distinct ids across successive calls', () => {
    const ids = new Set(Array.from({ length: 25 }, () => generateAgendaItemId()));
    expect(ids.size).toBe(25);
  });
});

describe('itemTitle', () => {
  it('uses the item\'s own text', () => {
    expect(itemTitle(course({ text: 'Discipleship 101' }))).toBe('Discipleship 101');
  });

  it('falls back to "(unknown breakout)" when text is empty - name and legacy course are deliberately NOT fallbacks', () => {
    // Post-Courses-retirement the title lives on `text` (backfilled by
    // scripts/flatten-courses-onto-agenda-items.js); a missing one should
    // be VISIBLE, not papered over by name/course.
    const item = course({ text: '', name: 'internal-name', course: 'legacy-course-id' });
    expect(itemTitle(item)).toBe('(unknown breakout)');
  });
});

describe('coachLabelFor', () => {
  const merged: Instructor[] = [
    { id: 'c1', fullname: 'Dana Whitfield', source: 'coaches' },
    { id: 't1', fullname: 'Marcus Ellery', source: 'impact_team' }
  ];

  it('resolves ids against the merged Coaches + Impact Team array, regardless of source', () => {
    expect(coachLabelFor(course({ coaches: ['c1', 't1'] }), merged)).toBe('Dana Whitfield, Marcus Ellery');
  });

  it('skips unknown ids but keeps the resolvable ones', () => {
    expect(coachLabelFor(course({ coaches: ['ghost', 'c1'] }), merged)).toBe('Dana Whitfield');
  });

  it('returns the em-dash placeholder when nobody is assigned or nothing resolves', () => {
    expect(coachLabelFor(course({ coaches: undefined }), merged)).toBe('—');
    expect(coachLabelFor(course({ coaches: [] }), merged)).toBe('—');
    expect(coachLabelFor(course({ coaches: ['ghost'] }), merged)).toBe('—');
  });
});
