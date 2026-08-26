import { FormBuilder, Validators } from '@angular/forms';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventFormComponent } from './event-form.component';

// These specs moved here from events.component.spec.ts on 2026-08-21 along
// with the code they cover, when the editor was extracted out of
// EventsComponent (bucket A item #5, option 2). They were written BEFORE
// that extraction, against the same logic in its old home, and pass here
// unchanged in substance - which is the evidence that the extraction
// preserved behaviour rather than merely compiled.
//
// House style: hand-constructed class with duck-typed dependencies, no
// TestBed. FormBuilder is the real thing; building a real FormGroup is the
// point. ngOnInit() is called explicitly because that is what builds the
// form - the component is created and destroyed with the editor, so there
// is no ngOnChanges path to worry about.

function makeDeps(overrides: Record<string, unknown> = {}) {
  const permissions: Record<string, boolean> = {};
  return {
    service: {
      add: jasmine.createSpy('add').and.returnValue(Promise.resolve(null)),
      update: jasmine.createSpy('update').and.returnValue(Promise.resolve(null)),
    },
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
    permissions,
    ...overrides,
  };
}

function anEvent(extra: Partial<EventModel> = {}): EventModel {
  return { ...new EventModel(), id: 'evt-1', eventName: 'Test Event', ...extra } as EventModel;
}

/** Builds the component the way EventsComponent's template does, then runs
 *  ngOnInit so `form` exists. `item` is the parent's working COPY. */
function makeComponent(
  summitMode = false,
  opts: { item?: EventModel; isEdit?: boolean; initialTabKey?: string; locations?: unknown[]; organizations?: unknown[] } = {},
) {
  const deps = makeDeps();
  const component = new EventFormComponent(
    deps.service as never,
    deps.permissionService as never,
    deps.fb as never,
    deps.dialog as never,
    deps.snackbar as never,
    // Editing the bound template is a separate, opt-in action; these
    // specs assert workflow behaviour, so it stays unavailable here.
    { canEdit: () => false, openByName: async () => undefined } as never,
  );
  component.summitMode = summitMode;
  component.screenKey = summitMode ? 'events-manager.summit' : 'events-manager.events';
  component.item = opts.item ?? anEvent();
  component.isEdit = opts.isEdit ?? true;
  component.initialTabKey = opts.initialTabKey ?? 'info';
  component.locations = (opts.locations ?? []) as never;
  component.organizations = (opts.organizations ?? []) as never;
  return { component, deps };
}

/** onSave fires a `.then()` chain it does not return, so a single microtask
 *  turn is not enough to observe the outcome. One macrotask drains it. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/** Fills every control updateConditionalValidators() marks required for an
 *  in-person event, so onSave() gets past its validity guard. */
function fillRequired(component: EventFormComponent): void {
  component.form.patchValue({
    eventName: 'Test Event',
    startDate: '2026-09-01T10:00',
    endDate: '2026-09-02T17:00',
    checkIn: '09:00',
    emailTemplate: 'welcome-template',
    organization: 'org-1',
  });
}

describe('EventFormComponent', () => {
  describe('attendance pills', () => {
    function withForm() {
      const { component } = makeComponent(false);
      component.ngOnInit();
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
    // Applied by a private method called from buildForm AND re-applied by an
    // isOnline valueChanges subscription set up in the same place.
    const requiredOf = (component: EventFormComponent) =>
      Object.keys(component.form.controls)
        .filter((key) => component.form.get(key)?.hasValidator?.(Validators.required))
        .sort();

    it('an in-person regular event requires the venue + comms fields', () => {
      const { component } = makeComponent(false);
      component.ngOnInit();
      expect(requiredOf(component)).toEqual(
        ['checkIn', 'emailTemplate', 'endDate', 'eventName', 'organization', 'startDate'],
      );
    });

    it('going Online swaps those for the Kajabi URLs', () => {
      const { component } = makeComponent(false);
      component.ngOnInit();
      component.setRegularAttendanceType('online');
      expect(requiredOf(component)).toEqual(
        ['eventName', 'kajabiPurchaseURL', 'kajabiSubscribeURL', 'startDate'],
      );
    });

    it('a summit does NOT require an organization (its venue is pinned)', () => {
      const { component } = makeComponent(true);
      component.ngOnInit();
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
      const { component } = makeComponent(true, { locations: [orgSite, summitVenue, otherOrgSite] });
      component.ngOnInit();
      expect(component.summitVenue()?.id).toBe('loc-summit');
    });

    it('orgLocations narrows to the selected organization only', () => {
      const { component } = makeComponent(false, { locations: [orgSite, otherOrgSite] });
      component.ngOnInit();
      component.form.get('organization')?.setValue('org-1');
      expect(component.orgLocations().map((l) => l.id)).toEqual(['loc-a']);
    });

    it('orgLocations is empty with no organization chosen', () => {
      const { component } = makeComponent(false, { locations: [orgSite] });
      component.ngOnInit();
      expect(component.orgLocations()).toEqual([]);
    });

    it('previewLocationName is empty before the form exists', () => {
      const { component } = makeComponent(false);
      expect(component.previewLocationName()).toBe('');
    });

    it('a summit previews the pinned venue regardless of the form', () => {
      const { component } = makeComponent(true, { locations: [summitVenue, orgSite] });
      component.ngOnInit();
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
      const { component } = makeComponent(true, { item: anEvent({ eventName: 'Original' }) });
      component.ngOnInit();
      component.form.get('eventName')?.setValue('Edited Live');
      expect(component.summitPreviewData().eventName).toBe('Edited Live');
    });

    it('pulls app-experience content from item, which children mutate in place', () => {
      const { component } = makeComponent(true);
      component.ngOnInit();
      component.item.whatsNext = 'See you there' as never;
      expect(component.summitPreviewData().whatsNext).toBe('See you there' as never);
    });

    it('uses null rather than undefined for absent app content', () => {
      const { component } = makeComponent(true);
      component.ngOnInit();
      const preview = component.summitPreviewData();
      expect(preview.agendaItems).toBeNull();
      expect(preview.imageUrl).toBeNull();
      // faqList is the exception, and not by accident: EventModel declares
      // `faqList: FAQModel[] = []` (every other app-content field is an
      // optional with no initialiser), so `?? null` never fires for it.
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

  describe('tab selection', () => {
    it('opens on the requested section', () => {
      const { component } = makeComponent(true, { initialTabKey: 'agenda' });
      component.ngOnInit();
      expect(component.selectedTabIndex).toBeGreaterThan(0);
    });

    it('derives the tab index from VISIBLE tabs, not a fixed position', () => {
      const { component, deps } = makeComponent(true, { initialTabKey: 'agenda' });
      // Hide the middle summit tab; 'agenda' shifts down a slot.
      deps.permissions['events-manager.summit.application'] = false;
      component.ngOnInit();
      expect(component.selectedTabIndex).toBe(1);
    });

    it('falls back to the first tab for an unknown or hidden tab key', () => {
      const { component } = makeComponent(true, { initialTabKey: 'does-not-exist' });
      component.ngOnInit();
      expect(component.selectedTabIndex).toBe(0);
    });

    it('summitSectionLabel names the section the editor is sitting on', () => {
      const { component } = makeComponent(true);
      component.ngOnInit();
      component.selectedTabIndex = 0;
      expect(component.summitSectionLabel()).toBe('Info & Pricing');
      component.selectedTabIndex = 2;
      expect(component.summitSectionLabel()).toBe('Agenda Builder');
    });

    it('summitSectionLabel follows the VISIBLE tab set', () => {
      const { component, deps } = makeComponent(true);
      deps.permissions['events-manager.summit.info'] = false;
      component.ngOnInit();
      component.selectedTabIndex = 0;
      expect(component.summitSectionLabel()).toBe('Attendee App Content');
    });
  });

  describe('onSave', () => {
    it('refuses to save an invalid form and touches it instead', () => {
      const { component, deps } = makeComponent(false, { isEdit: false });
      component.ngOnInit();
      // eventName + startDate are required and empty on a brand new event.
      component.item = { ...new EventModel() } as EventModel;
      component.ngOnInit();
      component.onSave();
      expect(deps.service.add).not.toHaveBeenCalled();
      expect(component.form.touched).toBeTrue();
      expect(component.inProgress$.value).toBeFalse();
    });

    it('OMITS imageUrl entirely when none was uploaded (never undefined)', async () => {
      const { component, deps } = makeComponent(false, { isEdit: false });
      deps.service.add.and.returnValue(Promise.resolve(anEvent()));
      component.ngOnInit();
      fillRequired(component);
      component.onSave();
      await flush();

      const written = deps.service.add.calls.mostRecent().args[0] as Record<string, unknown>;
      // Firestore rejects an explicit `undefined`, so the KEY must be absent.
      expect('imageUrl' in written).toBeFalse();
    });

    it('calls update (not add) when editing, and reports success', async () => {
      const { component, deps } = makeComponent(false, { isEdit: true });
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.ngOnInit();
      fillRequired(component);
      component.onSave();
      await flush();

      expect(deps.service.update).toHaveBeenCalled();
      expect(deps.service.add).not.toHaveBeenCalled();
      expect(deps.snackbar.success).toHaveBeenCalledWith('Event Updated');
      expect(component.inProgress$.value).toBeFalse();
    });

    it('emits the SAVED doc so the host decides where to go next', async () => {
      const { component, deps } = makeComponent(false, { isEdit: true });
      const saved = anEvent({ eventName: 'Saved Copy' });
      deps.service.update.and.returnValue(Promise.resolve(saved));
      const emitted: EventModel[] = [];
      component.saved.subscribe((e) => emitted.push(e));
      component.ngOnInit();
      fillRequired(component);
      component.onSave();
      await flush();

      expect(emitted).toEqual([saved]);
    });

    it('reports an error and emits nothing when the service resolves falsy', async () => {
      const { component, deps } = makeComponent(false, { isEdit: true });
      deps.service.update.and.returnValue(Promise.resolve(null));
      const emitted: EventModel[] = [];
      component.saved.subscribe((e) => emitted.push(e));
      component.ngOnInit();
      fillRequired(component);
      component.onSave();
      await flush();

      expect(deps.snackbar.error).toHaveBeenCalledWith('Some Error Occured');
      expect(component.inProgress$.value).toBeFalse();
      expect(emitted).toEqual([]);
    });

    it('stamps a summit as in-person, non-Kajabi, at the pinned venue', async () => {
      const { component, deps } = makeComponent(true, {
        isEdit: true,
        locations: [{
          id: 'loc-summit', name: 'Summit Center', isSummitVenue: true,
          address: { address1: '1 Main St' }, organization: 'org-1',
        }],
      });
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.ngOnInit();
      fillRequired(component);
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['isOnline']).toBeFalse();
      expect(written['isKajabiCourse']).toBeFalse();
      expect(written['location']).toBe('loc-summit');
      expect((written['venue'] as { name: string }).name).toBe('Summit Center');
    });

    it('converts form dates to real Dates on save', async () => {
      const { component, deps } = makeComponent(false, { isEdit: true });
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.ngOnInit();
      fillRequired(component);
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['startDate'] instanceof Date).toBeTrue();
      expect((written['startDate'] as Date).getFullYear()).toBe(2026);
    });
  });

  // The contract that makes this component safe to have extracted at all.
  describe('item identity contract', () => {
    it('save reads mutations the tab children made IN PLACE on item', () => {
      const { component, deps } = makeComponent(true, { isEdit: true });
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.ngOnInit();
      fillRequired(component);

      // Exactly what app-event-agenda / app-event-application do today:
      // reach into the bound object and mutate it. No form control, no
      // output event.
      component.item.agendaItems = [{ id: 'a1', title: 'Opening Session' }] as never;
      component.item.diningOptions = 'Boxed lunch' as never;
      component.item.whatsNext = 'Debrief Monday' as never;

      component.onSave();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['agendaItems']).toEqual([{ id: 'a1', title: 'Opening Session' }] as never);
      expect(written['diningOptions']).toBe('Boxed lunch');
      expect(written['whatsNext']).toBe('Debrief Monday');
    });

    it('does NOT clone item - the object it saves is the one it was handed', () => {
      // Cloning on input would break the tab children, which mutate the
      // reference the HOST still owns.
      const handed = anEvent();
      const { component } = makeComponent(true, { item: handed });
      component.ngOnInit();
      expect(component.item).toBe(handed);
    });

    it('the live preview sees in-place mutations before save', () => {
      const { component } = makeComponent(true);
      component.ngOnInit();
      component.item.checkinInstructions = 'Door B' as never;
      expect(component.summitPreviewData().checkinInstructions).toBe('Door B' as never);
    });

    it('form values WIN over item for keys the form owns', async () => {
      // Merge order is {...item, ...formRawValue}. The two field sets are
      // not supposed to overlap, but the precedence is what makes an edit to
      // a form field actually stick.
      const { component, deps } = makeComponent(false, {
        isEdit: true, item: anEvent({ eventName: 'Stale Name' }),
      });
      deps.service.update.and.returnValue(Promise.resolve(anEvent()));
      component.ngOnInit();
      fillRequired(component);
      component.form.get('eventName')?.setValue('Typed Name');
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['eventName']).toBe('Typed Name');
    });
  });
});
