import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { SummitHubComponent } from './summit-hub.component';

// The `preview` getter moved here from EventsComponent.hubPreviewData()
// on 2026-08-21 (bucket A item #5) - the parent was deriving preview data
// for a child that already held the object it derived it from. These two
// cases moved with it, verbatim in intent, from
// events.component.spec.ts's own characterization suite: the point of a
// behaviour-preserving split is that the tests follow the code and still
// pass. The rest of this component (async stat loading) is not covered
// here; only what moved is.
//
// House style: hand-constructed, duck-typed deps, no TestBed. ngOnInit is
// never called, so the service stubs stay empty - the getter reads `event`
// only, never the re-fetched `fresh` copy.
function makeComponent(): SummitHubComponent {
  return new SummitHubComponent(
    {} as never, // eventService
    {} as never, // registrationService
    {} as never, // locationService
    {} as never, // dialog
  );
}

function anEvent(extra: Partial<EventModel> = {}): EventModel {
  return { ...new EventModel(), id: 'evt-1', eventName: 'Test Event', ...extra } as EventModel;
}

describe('SummitHubComponent preview', () => {
  it('is an empty object when no event is set', () => {
    const component = makeComponent();
    expect(component.preview).toEqual({});
  });

  it('previews the SAVED item', () => {
    const component = makeComponent();
    component.event = anEvent({
      eventName: 'Summit 2026',
      costInDollars: 199,
      videoId: 'abc123',
    });
    expect(component.preview.eventName).toBe('Summit 2026');
    expect(component.preview.costInDollars).toBe(199);
    expect(component.preview.videoId).toBe('abc123');
  });

  it('normalises checkIn through toTimeValue', () => {
    const component = makeComponent();
    component.event = anEvent({ checkIn: new Date(2026, 8, 1, 9, 5) as never });
    expect(component.preview.checkIn).toBe('09:05');
  });

  it('keeps the null-vs-empty-array split the preview rail relies on', () => {
    // Same asymmetry pinned in events.component.spec.ts before the move:
    // EventModel declares `faqList: FAQModel[] = []` while its sibling
    // app-content fields are bare optionals, so `?? null` never fires for it.
    const component = makeComponent();
    component.event = anEvent();
    expect(component.preview.agendaItems).toBeNull();
    expect(component.preview.imageUrl).toBeNull();
    expect(component.preview.whatsNext).toBeNull();
    expect(component.preview.faqList).toEqual([]);
  });

  it('reads `event`, NOT the re-fetched fresh copy', () => {
    // Deliberate: the parent fed the list's own item, so previewing the
    // fresher doc would be a behaviour change rather than a move.
    const component = makeComponent();
    component.event = anEvent({ eventName: 'From the list' });
    component.fresh = anEvent({ eventName: 'Re-fetched' });
    expect(component.preview.eventName).toBe('From the list');
  });
});
