import { FormBuilder, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventsComponent } from './events.component';

// CHARACTERIZATION tests, written 2026-08-21 immediately BEFORE splitting
// this component (refactor sweep, bucket A item #5). At 683 lines of TS and
// 440 of template it carries eight separate concerns - list/grid, the
// Mission Control hub, the attendee Command Center, the summit preview, the
// edit form, the attendance-type pills, venue resolution and the image
// uploader - behind eight injected services, with no test of any kind. The
// split is meant to be behaviour-preserving, so these pin what it does NOW.
// If a test here fails after the split, the split changed behaviour.
//
// Deliberately NOT exhaustive coverage of the class: the value is in the
// derivations and the mode state machine (the parts that will be cut across
// component boundaries), not in the Angular wiring. ngOnInit is not called -
// it only subscribes streams together, and every test below sets the state
// it needs directly, which is also what keeps this suite synchronous.
//
// House style (see permission.service.spec.ts): hand-constructed class with
// duck-typed dependencies, no TestBed - this component uses constructor
// injection, so nothing forces one. FormBuilder is the real thing; it is a
// plain class and building a real FormGroup is the point.

/** Minimal stand-ins - only the members this component actually touches. */
function makeDeps(overrides: Record<string, unknown> = {}) {
  const permissions: Record<string, boolean> = {};
  const deps = {
    service: {
      getById: jasmine.createSpy('getById').and.returnValue(Promise.resolve(null)),
      add: jasmine.createSpy('add').and.returnValue(Promise.resolve(null)),
      update: jasmine.createSpy('update').and.returnValue(Promise.resolve(null)),
    },
    registrationService: {},
    organizationService: {},
    locationService: {},
    emailTemplateService: {},
    authService: { dao: { loggedInUser$: new BehaviorSubject<unknown>(null) } },
    permissionService: {
      // Default-allow: individual tests deny specific keys to pin the gates.
      canView: (key: string) => permissions[key] !== false,
      canAdd: (key: string) => permissions[`add:${key}`] !== false,
      canEdit: (key: string) => permissions[`edit:${key}`] !== false,
    },
    fb: new FormBuilder(),
    dialog: { open: jasmine.createSpy('open') },
    snackbar: {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
    },
    route: { snapshot: { queryParamMap: { get: () => null } } },
    permissions,
    ...overrides,
  };
  return deps;
}

function makeComponent(summitMode = false, overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new EventsComponent(
    d.service as never,
    d.registrationService as never,
    d.organizationService as never,
    d.locationService as never,
    d.emailTemplateService as never,
    d.authService as never,
    d.permissionService as never,
    d.fb as never,
    d.dialog as never,
    d.snackbar as never,
    d.route as never,
  );
  component.summitMode = summitMode;
  return { component, deps: d };
}

/** onSave fires a `.then()` chain it does not return, so a single
 *  microtask turn is not enough to observe the outcome. One macrotask
 *  drains the whole chain deterministically, regardless of its depth -
 *  same flush used by library-permission.service.spec.ts. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/** Fills every control updateConditionalValidators() marks required for an
 *  in-person event, so onSave() gets past its validity guard. The required
 *  SET itself is pinned by the 'conditional validators' block below - this
 *  helper exists so the onSave tests are about saving, not validation. */
function fillRequired(component: EventsComponent): void {
  component.form.patchValue({
    eventName: 'Test Event',
    startDate: '2026-09-01T10:00',
    endDate: '2026-09-02T17:00',
    checkIn: '09:00',
    emailTemplate: 'welcome-template',
    organization: 'org-1',
  });
}

function anEvent(extra: Partial<EventModel> = {}): EventModel {
  return { ...new EventModel(), id: 'evt-1', eventName: 'Test Event', ...extra } as EventModel;
}

describe('EventsComponent (characterization, pre-split)', () => {
  describe('screenKey', () => {
    it('routes permission checks to the summit grant in summit mode', () => {
      expect(makeComponent(true).component.screenKey).toBe('events-manager.summit');
    });

    it('routes permission checks to the events grant otherwise', () => {
      expect(makeComponent(false).component.screenKey).toBe('events-manager.events');
    });
  });

  describe('onRowOpen', () => {
    it('lands a summit row on Mission Control, not the editor', () => {
      const { component } = makeComponent(true);
      const item = anEvent();
      component.onRowOpen(item);
      expect(component.mode).toBe('hub');
      expect(component.hubItem).toBe(item);
    });

    it('takes a regular event row straight to the editor', () => {
      const { component } = makeComponent(false);
      component.onRowOpen(anEvent());
      expect(component.mode).toBe('edit');
      expect(component.hubItem).toBeNull();
    });
  });

  describe('hub / attendees mode machine', () => {
    it('showHub then closeHub returns to the list and clears the item', () => {
      const { component } = makeComponent(true);
      component.showHub(anEvent());
      expect(component.mode).toBe('hub');
      component.closeHub();
      expect(component.mode).toBe('list');
      expect(component.hubItem).toBeNull();
    });

    it('editFromHub leaves the hub, opens the editor and remembers the return', () => {
      const { component } = makeComponent(true);
      const item = anEvent();
      component.showHub(item);
      component.editFromHub('agenda');
      expect(component.mode).toBe('edit');
      expect(component.hubItem).toBeNull();
      // Proven by the return path rather than the private field.
      component.onCancel();
      expect(component.mode).toBe('hub');
      expect(component.hubItem).toBe(item);
    });

    it('commandCenterFromHub opens attendees and returns to the hub on close', () => {
      const { component } = makeComponent(true);
      const item = anEvent();
      component.showHub(item);
      component.commandCenterFromHub();
      expect(component.mode).toBe('attendees');
      expect(component.attendeesItem).toBe(item);
      component.closeAttendees();
      expect(component.mode).toBe('hub');
      expect(component.hubItem).toBe(item);
    });

    it('closeAttendees goes to the list when it was NOT opened from the hub', () => {
      const { component } = makeComponent(true);
      component.showAttendees(anEvent());
      component.closeAttendees();
      expect(component.mode).toBe('list');
      expect(component.attendeesItem).toBeNull();
    });

    it('showAttendees is permission-gated and fails SILENTLY when denied', () => {
      const { component, deps } = makeComponent(true);
      deps.permissions['events-manager.summit.attendees'] = false;
      component.showAttendees(anEvent());
      expect(component.mode).toBe('list');
      expect(component.attendeesItem).toBeNull();
    });
  });

  describe('showAddModal', () => {
    it('sends a NEW summit to the wizard rather than the plain form', () => {
      const { component } = makeComponent(true);
      component.showAddModal();
      expect(component.mode).toBe('wizard');
    });

    it('opens the plain form for a new regular event', () => {
      const { component } = makeComponent(false);
      component.showAddModal();
      expect(component.mode).toBe('edit');
      expect(component.isEdit).toBeFalse();
      expect(component.card).toEqual({});
    });

    it('is permission-gated on add', () => {
      const { component, deps } = makeComponent(false);
      deps.permissions['add:events-manager.events'] = false;
      component.showAddModal();
      expect(component.mode).toBe('list');
    });
  });

  describe('showEditModal', () => {
    it('copies the item, flags edit mode and seeds the image card', () => {
      const { component } = makeComponent(false);
      const image = { name: 'hero.png', url: 'https://x.test/hero.png' };
      const item = anEvent({ imageUrl: image } as Partial<EventModel>);
      component.showEditModal(item);
      expect(component.mode).toBe('edit');
      expect(component.isEdit).toBeTrue();
      expect(component.card.imageUrl).toBe(image as never);
      // A COPY, so cancelling cannot mutate the row in the list.
      expect(component.editingItem).not.toBe(item);
      expect(component.editingItem?.eventName).toBe('Test Event');
    });

    it('is permission-gated on edit', () => {
      const { component, deps } = makeComponent(false);
      deps.permissions['edit:events-manager.events'] = false;
      component.showEditModal(anEvent());
      expect(component.mode).toBe('list');
    });
  });

  describe('organizationName', () => {
    it('resolves an organization held as a plain id string', () => {
      const { component } = makeComponent();
      component.organizations = [{ id: 'org-1', name: 'Impact' }] as never;
      expect(component.organizationName(anEvent({ organization: 'org-1' }))).toBe('Impact');
    });

    it('resolves an organization held as an object', () => {
      const { component } = makeComponent();
      component.organizations = [{ id: 'org-1', name: 'Impact' }] as never;
      const item = anEvent({ organization: { id: 'org-1' } as never });
      expect(component.organizationName(item)).toBe('Impact');
    });

    it('returns empty string for an unknown or absent organization', () => {
      const { component } = makeComponent();
      component.organizations = [{ id: 'org-1', name: 'Impact' }] as never;
      expect(component.organizationName(anEvent({ organization: 'nope' }))).toBe('');
      expect(component.organizationName(anEvent())).toBe('');
    });
  });

  describe('regular-event attendance pills', () => {
    function withForm() {
      const { component } = makeComponent(false);
      component.showAddModal();
      return component;
    }

    it('reads In-Person when neither flag is set', () => {
      expect(withForm().regularAttendanceType()).toBe('inperson');
    });

    it('reads Online when isOnline is set', () => {
      const c = withForm();
      c.form.get('isOnline')?.setValue(true);
      expect(c.regularAttendanceType()).toBe('online');
    });

    it('reads Both when only isKajabiCourse is set', () => {
      const c = withForm();
      c.form.get('isKajabiCourse')?.setValue(true);
      expect(c.regularAttendanceType()).toBe('both');
    });

    it('isOnline wins over isKajabiCourse when both are set', () => {
      const c = withForm();
      c.form.get('isOnline')?.setValue(true);
      c.form.get('isKajabiCourse')?.setValue(true);
      expect(c.regularAttendanceType()).toBe('online');
    });

    it('writes the documented flag pairs and round-trips each pill', () => {
      const c = withForm();
      const flags = () => [c.form.get('isOnline')?.value, c.form.get('isKajabiCourse')?.value];

      c.setRegularAttendanceType('inperson');
      expect(flags()).toEqual([false, false]);
      expect(c.regularAttendanceType()).toBe('inperson');

      c.setRegularAttendanceType('online');
      expect(flags()).toEqual([true, true]);
      expect(c.regularAttendanceType()).toBe('online');

      c.setRegularAttendanceType('both');
      expect(flags()).toEqual([false, true]);
      expect(c.regularAttendanceType()).toBe('both');
    });
  });

  describe('conditional validators', () => {
    // These are easy to lose in a split: they are applied by a private
    // method called from buildForm() AND re-applied by an isOnline
    // valueChanges subscription set up in the same place.
    const requiredOf = (component: EventsComponent) =>
      Object.keys(component.form.controls)
        .filter((key) => component.form.get(key)?.hasValidator?.(Validators.required))
        .sort();

    it('an in-person regular event requires the venue + comms fields', () => {
      const { component } = makeComponent(false);
      component.showAddModal();
      expect(requiredOf(component)).toEqual(
        ['checkIn', 'emailTemplate', 'endDate', 'eventName', 'organization', 'startDate'],
      );
    });

    it('going Online swaps those for the Kajabi URLs', () => {
      const { component } = makeComponent(false);
      component.showAddModal();
      component.setRegularAttendanceType('online');
      expect(requiredOf(component)).toEqual(
        ['eventName', 'kajabiPurchaseURL', 'kajabiSubscribeURL', 'startDate'],
      );
    });

    it('a summit does NOT require an organization (its venue is pinned)', () => {
      const { component } = makeComponent(true);
      component.showEditModal(anEvent());
      expect(requiredOf(component)).not.toContain('organization');
      expect(requiredOf(component)).toContain('checkIn');
    });
  });

  describe('venue resolution', () => {
    const summitVenue = {
      id: 'loc-summit', name: 'Summit Center', isSummitVenue: true,
      address: { address1: '1 Main St' }, organization: 'org-1',
    };
    const orgSite = {
      id: 'loc-a', name: 'North Campus', isSummitVenue: false,
      address: { address1: '2 Oak Ave' }, organization: 'org-1',
    };
    const otherOrgSite = {
      id: 'loc-b', name: 'Other Org Site', isSummitVenue: false,
      address: { address1: '3 Elm St' }, organization: 'org-2',
    };

    it('summitVenue finds the single pinned venue', () => {
      const { component } = makeComponent(true);
      component.locations = [orgSite, summitVenue, otherOrgSite] as never;
      expect(component.summitVenue()?.id).toBe('loc-summit');
    });

    it('orgLocations narrows to the selected organization only', () => {
      const { component } = makeComponent(false);
      component.locations = [orgSite, otherOrgSite] as never;
      component.showAddModal();
      component.form.get('organization')?.setValue('org-1');
      expect(component.orgLocations().map((l) => l.id)).toEqual(['loc-a']);
    });

    it('orgLocations is empty with no organization chosen', () => {
      const { component } = makeComponent(false);
      component.locations = [orgSite] as never;
      component.showAddModal();
      expect(component.orgLocations()).toEqual([]);
    });

    it('previewLocationName is empty before a form exists', () => {
      expect(makeComponent(false).component.previewLocationName()).toBe('');
    });

    it('a summit previews the pinned venue regardless of the form', () => {
      const { component } = makeComponent(true);
      component.locations = [summitVenue, orgSite] as never;
      component.showEditModal(anEvent());
      expect(component.previewLocationName()).toBe('Summit Center');
    });

    it('openVenueRooms opens the rooms dialog', () => {
      const { component, deps } = makeComponent(true);
      component.openVenueRooms();
      expect(deps.dialog.open).toHaveBeenCalled();
    });
  });

  describe('summitPreviewData', () => {
    it('reads live form values so the preview updates before Save', () => {
      const { component } = makeComponent(true);
      component.showEditModal(anEvent({ eventName: 'Original' }));
      component.form.get('eventName')?.setValue('Edited Live');
      expect(component.summitPreviewData().eventName).toBe('Edited Live');
    });

    it('pulls app-experience content from editingItem, which children mutate in place', () => {
      const { component } = makeComponent(true);
      component.showEditModal(anEvent());
      component.editingItem!.whatsNext = 'See you there' as never;
      expect(component.summitPreviewData().whatsNext).toBe('See you there' as never);
    });

    it('uses null rather than undefined for absent app content', () => {
      const { component } = makeComponent(true);
      component.showEditModal(anEvent());
      const preview = component.summitPreviewData();
      expect(preview.agendaItems).toBeNull();
      expect(preview.imageUrl).toBeNull();
      // faqList is the exception, and not by accident: EventModel declares
      // `faqList: FAQModel[] = []` (every other app-content field is an
      // optional with no initialiser), so `?? null` never fires for it and
      // the preview receives an empty ARRAY. Pinned because a split that
      // "tidied" these fields to a uniform null would change what
      // app-summit-preview renders for a summit with no FAQs.
      expect(preview.faqList).toEqual([]);
    });
  });

  describe('image uploader visibility', () => {
    it('toggles the uploader stream', () => {
      const { component } = makeComponent();
      expect(component.isImageUploaderVisible$.value).toBeFalse();
      component.showImageUploader();
      expect(component.isImageUploaderVisible$.value).toBeTrue();
      component.closeImageUploader();
      expect(component.isImageUploaderVisible$.value).toBeFalse();
    });
  });

  describe('onSave', () => {
    it('refuses to save an invalid form and touches it instead', () => {
      const { component, deps } = makeComponent(false);
      component.showAddModal();
      // eventName + startDate are required and empty on a brand new event.
      component.onSave();
      expect(deps.service.add).not.toHaveBeenCalled();
      expect(component.form.touched).toBeTrue();
      expect(component.inProgress$.value).toBeFalse();
    });

    it('OMITS imageUrl entirely when none was uploaded (never undefined)', async () => {
      const { component, deps } = makeComponent(false);
      deps.service.add.and.returnValue(Promise.resolve(anEvent()));
      component.showAddModal();
      fillRequired(component);
      component.onSave();
      await flush();

      const written = deps.service.add.calls.mostRecent().args[0] as Record<string, unknown>;
      // Firestore rejects an explicit `undefined`, so the KEY must be absent.
      expect('imageUrl' in written).toBeFalse();
    });

    it('calls update (not add) when editing, and reports success', async () => {
      const { component, deps } = makeComponent(false);
      const saved = anEvent();
      deps.service.update.and.returnValue(Promise.resolve(saved));
      component.showEditModal(anEvent({ eventName: 'Existing' }));
      fillRequired(component);
      component.onSave();
      await flush();

      expect(deps.service.update).toHaveBeenCalled();
      expect(deps.service.add).not.toHaveBeenCalled();
      expect(deps.snackbar.success).toHaveBeenCalledWith('Event Updated');
      expect(component.mode).toBe('list');
      expect(component.inProgress$.value).toBeFalse();
    });

    it('reports an error and stays put when the service resolves falsy', async () => {
      const { component, deps } = makeComponent(false);
      deps.service.update.and.returnValue(Promise.resolve(null));
      component.showEditModal(anEvent({ eventName: 'Existing' }));
      fillRequired(component);
      component.onSave();
      await flush();

      expect(deps.snackbar.error).toHaveBeenCalledWith('Some Error Occured');
      expect(component.inProgress$.value).toBeFalse();
      expect(component.mode).toBe('edit');
    });

    it('stamps a summit as in-person, non-Kajabi, at the pinned venue', async () => {
      const { component, deps } = makeComponent(true);
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.locations = [{
        id: 'loc-summit', name: 'Summit Center', isSummitVenue: true,
        address: { address1: '1 Main St' }, organization: 'org-1',
      }] as never;
      component.showEditModal(anEvent({ eventName: 'Summit' }));
      fillRequired(component);
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['isOnline']).toBeFalse();
      expect(written['isKajabiCourse']).toBeFalse();
      expect(written['location']).toBe('loc-summit');
      expect((written['venue'] as { name: string }).name).toBe('Summit Center');
    });

    it('returns to Mission Control with the SAVED item when opened from the hub', async () => {
      const { component, deps } = makeComponent(true);
      const saved = anEvent({ eventName: 'Saved Copy' });
      deps.service.update.and.returnValue(Promise.resolve(saved));
      component.showHub(anEvent({ eventName: 'Summit' }));
      component.editFromHub('info');
      fillRequired(component);
      component.onSave();
      await flush();

      expect(component.mode).toBe('hub');
      expect(component.hubItem).toBe(saved);
    });
  });

  describe('onCancel', () => {
    it('returns to the list by default', () => {
      const { component } = makeComponent(false);
      component.showEditModal(anEvent());
      component.onCancel();
      expect(component.mode).toBe('list');
      expect(component.inProgress$.value).toBeFalse();
    });
  });

  // ---------------------------------------------------------------------
  // EXTRACTION BOUNDARY (bucket A item #5, option 2 - pulling the edit form
  // out into its own component). Everything above pins behaviour; this block
  // pins the CONTRACTS that only hold because the form currently lives in
  // the same class as the state it reads.
  //
  // The template hands the same `editingItem` object to three children -
  // <app-event-application>, <app-event-agenda>, <app-event-attendees>, all
  // bound `[event]="item"` - and they MUTATE it in place rather than
  // emitting changes back. onSave then reads those mutations off that same
  // object. Passing a copy across a new component boundary, or rebuilding
  // the object from form values, would silently drop everything the four tab
  // children edit. That is the single most likely way option 2 breaks, and
  // it is invisible to a class-level test unless it is asserted directly.
  // ---------------------------------------------------------------------
  describe('editingItem identity contract', () => {
    it('save reads mutations the tab children made IN PLACE on editingItem', () => {
      const { component, deps } = makeComponent(true);
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.showEditModal(anEvent({ eventName: 'Summit' }));
      fillRequired(component);

      // Exactly what app-event-agenda / app-event-application do today:
      // reach into the bound object and mutate it. No form control, no
      // output event.
      const item = component.editingItem!;
      item.agendaItems = [{ id: 'a1', title: 'Opening Session' }] as never;
      item.diningOptions = 'Boxed lunch' as never;
      item.whatsNext = 'Debrief Monday' as never;

      component.onSave();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['agendaItems']).toEqual([{ id: 'a1', title: 'Opening Session' }] as never);
      expect(written['diningOptions']).toBe('Boxed lunch');
      expect(written['whatsNext']).toBe('Debrief Monday');
    });

    it('the live preview sees those same in-place mutations before save', () => {
      const { component } = makeComponent(true);
      component.showEditModal(anEvent());
      component.editingItem!.checkinInstructions = 'Door B' as never;
      expect(component.summitPreviewData().checkinInstructions).toBe('Door B' as never);
    });

    it('form values WIN over editingItem for keys the form owns', () => {
      // Merge order is {...editingItem, ...formRawValue}. The two field sets
      // are not supposed to overlap, but the precedence is what makes an
      // edit to a form field actually stick.
      const { component, deps } = makeComponent(false);
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.showEditModal(anEvent({ eventName: 'Stale Name' }));
      fillRequired(component);
      component.form.get('eventName')?.setValue('Typed Name');

      component.onSave();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['eventName']).toBe('Typed Name');
    });

    it('editing mutates a COPY, so an abandoned edit cannot corrupt the list row', () => {
      const { component } = makeComponent(false);
      const listRow = anEvent({ eventName: 'On The List' });
      component.showEditModal(listRow);
      component.editingItem!.eventName = 'Scribbled Over';
      component.editingItem!.whatsNext = 'Uncommitted' as never;
      component.onCancel();
      expect(listRow.eventName).toBe('On The List');
      expect(listRow.whatsNext).toBeUndefined();
    });

    it('converts form dates to real Dates on save', () => {
      const { component, deps } = makeComponent(false);
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.showEditModal(anEvent());
      fillRequired(component);

      component.onSave();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['startDate'] instanceof Date).toBeTrue();
      expect((written['startDate'] as Date).getFullYear()).toBe(2026);
    });
  });

  describe('tab selection', () => {
    it('resets to the first tab whenever the editor opens', () => {
      const { component } = makeComponent(true);
      component.showHub(anEvent());
      component.editFromHub('agenda');
      expect(component.selectedTabIndex).toBeGreaterThan(0);
      // Re-opening from the list must not inherit the previous tab.
      component.closeHub();
      component.showEditModal(anEvent());
      expect(component.selectedTabIndex).toBe(0);
    });

    it('derives the tab index from VISIBLE tabs, not a fixed position', () => {
      const { component, deps } = makeComponent(true);
      // Hide the middle summit tab; 'agenda' shifts down a slot.
      deps.permissions['events-manager.summit.application'] = false;
      component.showHub(anEvent());
      component.editFromHub('agenda');
      expect(component.selectedTabIndex).toBe(1);
    });

    it('falls back to the first tab for an unknown or hidden tab key', () => {
      const { component } = makeComponent(true);
      component.showHub(anEvent());
      component.editFromHub('does-not-exist');
      expect(component.selectedTabIndex).toBe(0);
    });

    it('summitSectionLabel names the section the editor is sitting on', () => {
      const { component } = makeComponent(true);
      component.showEditModal(anEvent());
      component.selectedTabIndex = 0;
      expect(component.summitSectionLabel()).toBe('Info & Pricing');
      component.selectedTabIndex = 2;
      expect(component.summitSectionLabel()).toBe('Agenda Builder');
    });

    it('summitSectionLabel follows the VISIBLE tab set', () => {
      const { component, deps } = makeComponent(true);
      deps.permissions['events-manager.summit.info'] = false;
      component.showEditModal(anEvent());
      component.selectedTabIndex = 0;
      expect(component.summitSectionLabel()).toBe('Attendee App Content');
    });
  });
});
