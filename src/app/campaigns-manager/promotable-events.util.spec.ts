import { EventModel } from '@impact-common/shared/models/domain/event.model';
import {
  isPromotableEvent,
  promotableEventLabel,
  promotableEvents,
} from './promotable-events.util';

function event(overrides: Partial<EventModel> = {}): EventModel {
  return { eventName: 'An Event', isActive: false, ...overrides } as EventModel;
}

describe('isPromotableEvent', () => {
  it('includes a live event', () => {
    expect(isPromotableEvent(event({ isActive: true }))).toBe(true);
  });

  it('includes a NOT-LIVE event with early registration open', () => {
    // The whole point. A summit created via CREATE (NOT LIVE) with early
    // registration ticked accepts real sign-ups, so a campaign must be able
    // to promote it - this is the case the old isActive-only filter hid.
    expect(isPromotableEvent(
      event({ isActive: false, earlyRegistration: true }))).toBe(true);
  });

  it('excludes a plain inactive event', () => {
    // Nobody can register for it, so promoting it would be a dead end.
    expect(isPromotableEvent(event({ isActive: false }))).toBe(false);
    expect(isPromotableEvent(
      event({ isActive: false, earlyRegistration: false }))).toBe(false);
  });

  it('matches the server rule for a live event with early reg also set', () => {
    // Going live supersedes earlyRegistration; both true is still promotable.
    expect(isPromotableEvent(
      event({ isActive: true, earlyRegistration: true }))).toBe(true);
  });
});

describe('promotableEventLabel', () => {
  it('shows a live event by name alone', () => {
    expect(promotableEventLabel(event({ eventName: 'Summit 2027', isActive: true })))
      .toBe('Summit 2027');
  });

  it('spells out that an early-registration event is not live', () => {
    // Without this an early-reg event is indistinguishable from a live one,
    // and staff cannot tell the page it points at is still a placeholder.
    expect(promotableEventLabel(
      event({ eventName: 'Summit 2027', isActive: false, earlyRegistration: true })))
      .toBe('Summit 2027 (early registration — page not live)');
  });

  it('falls back for a missing or blank name', () => {
    expect(promotableEventLabel(event({ eventName: undefined, isActive: true })))
      .toBe('(unnamed event)');
    expect(promotableEventLabel(event({ eventName: '   ', isActive: true })))
      .toBe('(unnamed event)');
  });
});

describe('promotableEvents', () => {
  it('drops non-promotable events and puts live ones first', () => {
    const result = promotableEvents([
      event({ eventName: 'Early Summit', isActive: false, earlyRegistration: true }),
      event({ eventName: 'Archived', isActive: false }),
      event({ eventName: 'Live Seminar', isActive: true }),
    ]);
    expect(result.map((e) => e.eventName)).toEqual(['Live Seminar', 'Early Summit']);
  });

  it('sorts alphabetically within each group', () => {
    const result = promotableEvents([
      event({ eventName: 'Zulu', isActive: true }),
      event({ eventName: 'Bravo', isActive: false, earlyRegistration: true }),
      event({ eventName: 'Alpha', isActive: true }),
    ]);
    expect(result.map((e) => e.eventName)).toEqual(['Alpha', 'Zulu', 'Bravo']);
  });

  it('returns an empty list rather than failing when nothing qualifies', () => {
    expect(promotableEvents([event(), event()])).toEqual([]);
    expect(promotableEvents([])).toEqual([]);
  });
});
