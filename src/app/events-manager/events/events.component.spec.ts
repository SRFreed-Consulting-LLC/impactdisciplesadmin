import { BehaviorSubject } from 'rxjs';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventsComponent } from './events.component';

// CHARACTERIZATION tests, originally written 2026-08-21 against the 683-line
// version of this component, immediately BEFORE splitting it (refactor sweep,
// bucket A item #5). They pinned what it did then; the split is meant to
// preserve behaviour, so a failure here means the split changed something.
//
// After the split this file covers only what STAYED: the list screen and the
// mode state machine. Everything about the edit form itself moved to
// event-form.component.spec.ts alongside the code, and everything about the
// Mission Control preview moved to summit-hub.component.spec.ts.
//
// ngOnInit is not called - it only subscribes streams together, and every
// test below sets the state it needs directly, which is what keeps this
// suite synchronous.
//
// House style (see permission.service.spec.ts): hand-constructed class with
// duck-typed dependencies, no TestBed - this component uses constructor
// injection, so nothing forces one.

/** Minimal stand-ins - only the members this component actually touches. */
function makeDeps(overrides: Record<string, unknown> = {}) {
  const permissions: Record<string, boolean> = {};
  const deps = {
    service: {
      getById: jasmine.createSpy('getById').and.returnValue(Promise.resolve(null)),
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
    d.route as never,
  );
  component.summitMode = summitMode;
  return { component, deps: d };
}

function anEvent(extra: Partial<EventModel> = {}): EventModel {
  return { ...new EventModel(), id: 'evt-1', eventName: 'Test Event', ...extra } as EventModel;
}

describe('EventsComponent', () => {
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

    it('editFromHub passes the requested section down as a tab KEY', () => {
      // The real tab INDEX depends on which tabs the admin can see, so it is
      // resolved inside app-event-form; the list screen only states intent.
      const { component } = makeComponent(true);
      component.showHub(anEvent());
      component.editFromHub('agenda');
      expect(component.pendingTabKey).toBe('agenda');
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
      expect(component.pendingTabKey).toBe('info');
      expect(component.editingItem?.id).toBeUndefined();
    });

    it('is permission-gated on add', () => {
      const { component, deps } = makeComponent(false);
      deps.permissions['add:events-manager.events'] = false;
      component.showAddModal();
      expect(component.mode).toBe('list');
    });
  });

  describe('showEditModal', () => {
    it('flags edit mode and hands the editor a COPY of the row', () => {
      const { component } = makeComponent(false);
      const item = anEvent();
      component.showEditModal(item);
      expect(component.mode).toBe('edit');
      expect(component.isEdit).toBeTrue();
      // A COPY, so the editor's in-place tab edits cannot reach the grid.
      expect(component.editingItem).not.toBe(item);
      expect(component.editingItem?.eventName).toBe('Test Event');
    });

    it('is permission-gated on edit', () => {
      const { component, deps } = makeComponent(false);
      deps.permissions['edit:events-manager.events'] = false;
      component.showEditModal(anEvent());
      expect(component.mode).toBe('list');
    });

    it('an abandoned edit cannot corrupt the list row', () => {
      const { component } = makeComponent(false);
      const listRow = anEvent({ eventName: 'On The List' });
      component.showEditModal(listRow);
      component.editingItem!.eventName = 'Scribbled Over';
      component.editingItem!.whatsNext = 'Uncommitted' as never;
      component.onCancel();
      expect(listRow.eventName).toBe('On The List');
      expect(listRow.whatsNext).toBeUndefined();
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

  // Where the editor returns to is the host's job, not the form's -
  // app-event-form just emits (saved) / (cancelled).
  describe('editor return paths', () => {
    it('onFormSaved returns to Mission Control with the SAVED item', () => {
      const { component } = makeComponent(true);
      const saved = anEvent({ eventName: 'Saved Copy' });
      component.showHub(anEvent({ eventName: 'Summit' }));
      component.editFromHub('info');
      component.onFormSaved(saved);
      expect(component.mode).toBe('hub');
      expect(component.hubItem).toBe(saved);
    });

    it('onFormSaved returns to the list when the editor was opened from it', () => {
      const { component } = makeComponent(false);
      component.showEditModal(anEvent());
      component.onFormSaved(anEvent());
      expect(component.mode).toBe('list');
    });

    it('onCancel returns to the list by default', () => {
      const { component } = makeComponent(false);
      component.showEditModal(anEvent());
      component.onCancel();
      expect(component.mode).toBe('list');
    });
  });
});
