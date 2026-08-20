import { EventModel } from 'src/app/common/models/domain/event.model';
import { AgendaItem } from 'src/app/common/models/domain/utils/agenda-item.model';
import { FAQModel } from 'src/app/common/models/utils/faq.model';
import { copyAgendaSkeleton, copySummitContent } from './summit-copy.util';

// Source summit: Aug 10-11 2025. Fixture months are all August (source and
// target in the same DST regime), local-time constructed, so the whole-day
// delta math holds in any timezone.
function sourceSummit(): EventModel {
  return {
    id: 'summit-2025',
    eventName: 'Fall Summit 2025',
    startDate: new Date(2025, 7, 10, 8, 0), // deliberate non-midnight time
    endDate: new Date(2025, 7, 11, 17, 0),
    diningOptions: 'Boxed lunches',
    checkinInstructions: 'Check in at the east lobby',
    whatsNext: 'See you next year',
    emailTemplate: 'template-123',
    faqList: [{ sortOrder: 1, question: 'Parking?', answer: 'Lot B' } as FAQModel],
    agendaItems: [
      {
        id: 'src-a',
        text: 'Breakout One',
        name: 'bo1',
        startDate: new Date(2025, 7, 10, 9, 0),
        endDate: new Date(2025, 7, 10, 10, 30),
        isCourse: true,
        coaches: ['c1'],
        room: 'Room A',
        maxParticipants: 20,
        description: 'desc',
        // The three keys a copy must DROP:
        waitList: ['queued@example.com'],
        signedUp: 5,
        course: 'legacy-course-id'
      },
      {
        // Day 2, food break, sparse fields.
        id: 'src-b',
        text: 'Lunch',
        startDate: new Date(2025, 7, 11, 12, 0),
        endDate: new Date(2025, 7, 11, 13, 0),
        isFoodBreak: true
      }
    ] as AgendaItem[]
  } as EventModel;
}

describe('copyAgendaSkeleton', () => {
  // New summit starts Aug 24 2026 - the time-of-day on the picked start
  // date must NOT leak into the shift (only whole days move).
  const newStart = new Date(2026, 7, 24, 13, 45);

  it('shifts every item by the whole-day delta, preserving time-of-day', () => {
    const copies = copyAgendaSkeleton(sourceSummit(), newStart);

    expect(copies.length).toBe(2);
    expect((copies[0].startDate as Date).getTime()).toBe(new Date(2026, 7, 24, 9, 0).getTime());
    expect((copies[0].endDate as Date).getTime()).toBe(new Date(2026, 7, 24, 10, 30).getTime());
  });

  it('preserves multi-day offsets (a day-2 item lands on the new day 2)', () => {
    const copies = copyAgendaSkeleton(sourceSummit(), newStart);

    expect((copies[1].startDate as Date).getTime()).toBe(new Date(2026, 7, 25, 12, 0).getTime());
    expect((copies[1].endDate as Date).getTime()).toBe(new Date(2026, 7, 25, 13, 0).getTime());
  });

  it('accepts an ISO-string source startDate (the shape most events docs store)', () => {
    const source = sourceSummit();
    source.startDate = new Date(2025, 7, 10, 8, 0).toISOString();

    const copies = copyAgendaSkeleton(source, newStart);

    expect((copies[0].startDate as Date).getTime()).toBe(new Date(2026, 7, 24, 9, 0).getTime());
  });

  it('mints a FRESH id per item - never the source\'s (old registrations reference those)', () => {
    const source = sourceSummit();
    const copies = copyAgendaSkeleton(source, newStart);

    const sourceIds = source.agendaItems!.map((i) => i.id);
    for (const copy of copies) {
      expect(copy.id).toMatch(/^[0-9a-f]{13}$/);
      expect(sourceIds).not.toContain(copy.id);
    }
    expect(copies[0].id).not.toBe(copies[1].id);
  });

  it('strips waitList, signedUp, and the legacy course key entirely (not just set to undefined)', () => {
    const copy = copyAgendaSkeleton(sourceSummit(), newStart)[0];

    // Key ABSENCE matters: a key explicitly set to undefined would reject
    // the whole Firestore write (see CLAUDE.md's write gotcha).
    expect('waitList' in copy).toBeFalse();
    expect('signedUp' in copy).toBeFalse();
    expect('course' in copy).toBeFalse();
  });

  it('carries content fields and deep-copies coaches (mutating a copy never touches the source)', () => {
    const source = sourceSummit();
    const copies = copyAgendaSkeleton(source, newStart);

    expect(copies[0].text).toBe('Breakout One');
    expect(copies[0].room).toBe('Room A');
    expect(copies[0].maxParticipants).toBe(20);
    expect(copies[0].description).toBe('desc');
    expect(copies[0].isCourse).toBeTrue();
    expect(copies[1].isFoodBreak).toBeTrue();

    copies[0].coaches!.push('c-added');
    expect(source.agendaItems![0].coaches).toEqual(['c1']);
  });

  it('normalizes missing optional fields to stable defaults rather than undefined', () => {
    const copy = copyAgendaSkeleton(sourceSummit(), newStart)[1];

    expect(copy.name).toBe('');
    expect(copy.isCourse).toBeFalse();
    expect(copy.coaches).toEqual([]);
    expect(copy.room).toBeNull();
    expect(copy.maxParticipants).toBeNull();
    expect(copy.description).toBeNull();
  });

  it('returns [] when the source has no agendaItems', () => {
    const source = sourceSummit();
    source.agendaItems = undefined;

    expect(copyAgendaSkeleton(source, newStart)).toEqual([]);
  });

  it('returns [] when the source has no parseable startDate (no delta can be computed)', () => {
    const source = sourceSummit();
    source.startDate = undefined;

    expect(copyAgendaSkeleton(source, newStart)).toEqual([]);
  });
});

describe('copySummitContent', () => {
  it('copies the year-over-year content fields onto the target', () => {
    const source = sourceSummit();
    const target = {} as EventModel;

    copySummitContent(source, target);

    expect(target.diningOptions).toBe('Boxed lunches');
    expect(target.checkinInstructions).toBe('Check in at the east lobby');
    expect(target.whatsNext).toBe('See you next year');
    expect(target.emailTemplate).toBe('template-123');
    expect(target.faqList).toEqual(source.faqList);
  });

  it('deep-copies faqList - wizard edits never alias the source event\'s array', () => {
    const source = sourceSummit();
    const target = {} as EventModel;

    copySummitContent(source, target);
    expect(target.faqList).not.toBe(source.faqList);

    target.faqList[0].answer = 'Lot Z';
    target.faqList.push({ sortOrder: 2, question: 'Wifi?', answer: 'Yes' } as FAQModel);

    expect(source.faqList[0].answer).toBe('Lot B');
    expect(source.faqList.length).toBe(1);
  });

  it('never touches identity or date fields on the target', () => {
    const source = sourceSummit();
    const target = {
      id: 'summit-2026',
      eventName: 'Fall Summit 2026',
      startDate: new Date(2026, 7, 24),
      endDate: new Date(2026, 7, 25),
      isActive: true
    } as EventModel;

    copySummitContent(source, target);

    expect(target.id).toBe('summit-2026');
    expect(target.eventName).toBe('Fall Summit 2026');
    expect((target.startDate as Date).getTime()).toBe(new Date(2026, 7, 24).getTime());
    expect((target.endDate as Date).getTime()).toBe(new Date(2026, 7, 25).getTime());
    expect(target.isActive).toBeTrue();
  });

  it('falls back to safe defaults when the source lacks a field', () => {
    const target = {} as EventModel;

    copySummitContent({} as EventModel, target);

    expect(target.diningOptions).toBe('');
    expect(target.checkinInstructions).toBe('');
    expect(target.whatsNext).toBe('');
    expect(target.emailTemplate).toBeNull();
    expect(target.faqList).toEqual([]);
  });
});
