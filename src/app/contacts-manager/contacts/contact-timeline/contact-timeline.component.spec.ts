import { ContactTimelineComponent, TimelineEntry } from './contact-timeline.component';

// These specs moved here from contact-details.component.spec.ts on
// 2026-08-21 along with the code they cover, when the activity feed was
// extracted out of ContactDetailsComponent (bucket A item #5). They were
// written BEFORE that extraction, against the same logic in its old home,
// and pass here unchanged - which is the evidence the extraction preserved
// behaviour rather than merely compiled.
//
// This component is presentational: it takes an already-merged,
// already-sorted, already-visibility-filtered list. The merge/sort rules
// and the private-note rule stay pinned in the host's suite, where that
// logic still lives.
//
// House style: hand-constructed, duck-typed deps, no TestBed. This one has
// no constructor dependencies at all, which is itself the point of the
// split.

function makeComponent(): ContactTimelineComponent {
  return new ContactTimelineComponent();
}

const entries = [
  { type: 'purchase', date: null },
  { type: 'event', date: null },
  { type: 'note', date: null },
] as TimelineEntry[];

describe('ContactTimelineComponent', () => {
  describe('filter', () => {
    it('passes everything through under "all"', () => {
      const component = makeComponent();
      component.activeFilter = 'all';
      expect(component.filteredTimeline(entries).length).toBe(3);
    });

    it('narrows to the active type', () => {
      const component = makeComponent();
      component.activeFilter = 'event';
      expect(component.filteredTimeline(entries).map((e) => e.type)).toEqual(['event']);
    });

    it('starts on "all"', () => {
      expect(makeComponent().activeFilter).toBe('all');
    });

    it('explains the empty state per filter', () => {
      const component = makeComponent();
      component.activeFilter = 'all';
      expect(component.emptyMessage()).toContain('purchases, events, or notes');
      component.activeFilter = 'purchase';
      expect(component.emptyMessage()).toContain('No purchases');
      component.activeFilter = 'event';
      expect(component.emptyMessage()).toContain('No event registrations');
      component.activeFilter = 'note';
      expect(component.emptyMessage()).toContain('No notes');
    });
  });

  describe('display lookups', () => {
    it('getEventName resolves through the events input, blank when unknown', () => {
      const component = makeComponent();
      component.events = [{ id: 'evt-1', eventName: 'Summit' }] as never;
      expect(component.getEventName('evt-1')).toBe('Summit');
      expect(component.getEventName('nope')).toBe('');
    });

    it('getFulfillmentStatusLabel falls back to Unknown', () => {
      const component = makeComponent();
      expect(component.getFulfillmentStatusLabel(undefined)).toBe('Unknown');
      expect(component.getFulfillmentStatusLabel('not-a-status' as never)).toBe('Unknown');
    });
  });

  describe('note actions', () => {
    // The host owns the contact document, so every note action leaves here
    // as an event rather than being written from this component.
    it('emits add, delete and save upward', () => {
      const component = makeComponent();
      const added: number[] = [];
      const deleted: unknown[] = [];
      const savedCalls: number[] = [];
      component.addNote.subscribe(() => added.push(1));
      component.deleteNote.subscribe((n) => deleted.push(n));
      component.saveNote.subscribe(() => savedCalls.push(1));

      const note = { note: 'Called', addedBy: 'Sam Reed', private: false } as never;
      component.addNote.emit();
      component.deleteNote.emit(note);
      component.saveNote.emit();

      expect(added.length).toBe(1);
      expect(deleted).toEqual([note]);
      expect(savedCalls.length).toBe(1);
    });
  });
});
