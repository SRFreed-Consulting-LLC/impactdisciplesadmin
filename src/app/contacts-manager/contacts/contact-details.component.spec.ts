import { FormBuilder } from '@angular/forms';
import { of } from 'rxjs';
import { ContactModel } from 'src/app/common/models/domain/utils/contact.model';
import { ContactDetailsComponent } from './contact-details.component';

// CHARACTERIZATION tests, written 2026-08-21 immediately BEFORE splitting
// this component (refactor sweep, bucket A item #5 - second god component
// after EventsComponent). 586 lines of TS + 254 of template holding the
// contact form, the merged activity timeline, tags, notes, pending-change
// resolution and subscription flags behind eleven injected services, with
// no test of any kind. The split is meant to preserve behaviour, so a
// failure here afterwards means the split changed something.
//
// Priority was given to the things that are quietly expensive to get wrong:
// the same-as-shipping default (an explicit data-loss guard), the save
// payload, and the timeline merge - not to the Angular wiring.
//
// House style (see permission.service.spec.ts): hand-constructed class with
// duck-typed dependencies, no TestBed - this component uses constructor
// injection, so nothing forces one. FormBuilder is the real thing.

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    fb: new FormBuilder(),
    service: {
      update: jasmine.createSpy('update').and.returnValue(Promise.resolve(null)),
    },
    organizationService: { getAll: () => Promise.resolve([]) },
    purchasesService: { streamAllByValue: () => of([]) },
    eventRegistrationService: { streamAllByValue: () => of([]) },
    tagRuleService: { getAll: () => Promise.resolve([]) },
    tagApplicationService: {
      recordManualApplication: jasmine.createSpy('recordManualApplication')
        .and.returnValue(Promise.resolve(null)),
      removeApplication: jasmine.createSpy('removeApplication')
        .and.returnValue(Promise.resolve(null)),
    },
    authService: {
      getLoggedInUser: () => ({ firstName: 'Sam', lastName: 'Reed' }),
    },
    snackbar: {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
      somethingWentWrong: jasmine.createSpy('somethingWentWrong'),
    },
    confirmService: { confirm: () => Promise.resolve(true) },
    dialog: { open: jasmine.createSpy('open') },
    ...overrides,
  };
}

function aContact(extra: Partial<ContactModel> = {}): ContactModel {
  return {
    id: 'contact-1',
    firstName: 'Alex',
    lastName: 'Doe',
    email: 'alex@test.local',
    ...extra,
  } as ContactModel;
}

function makeComponent(
  contact: ContactModel = aContact(),
  overrides: Record<string, unknown> = {},
) {
  const d = makeDeps(overrides);
  const component = new ContactDetailsComponent(
    d.fb as never,
    d.service as never,
    d.organizationService as never,
    d.purchasesService as never,
    d.eventRegistrationService as never,
    d.tagRuleService as never,
    d.tagApplicationService as never,
    d.authService as never,
    d.snackbar as never,
    d.confirmService as never,
    d.dialog as never,
  );
  component.selectedItem = contact;
  return { component, deps: d };
}

/** onSave fires a `.then()` chain it does not return; one macrotask drains
 *  it regardless of depth. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

const SHIPPING = { address1: '1 Main St', address2: '', city: 'Atlanta', state: 'GA', zip: '30301', country: 'US' };

describe('ContactDetailsComponent (characterization, pre-split)', () => {
  // The single most consequential rule in this file: this checkbox is a
  // NEWER field than the records it appears on, so its default has to avoid
  // silently flattening a genuine billing address the first time an old
  // record is opened and saved.
  describe('isBillingSameAsShipping default', () => {
    it('honours an explicitly stored false', () => {
      const { component } = makeComponent(aContact({ isBillingSameAsShipping: false }));
      component.ngOnInit();
      expect(component.isBillingSameAsShipping).toBeFalse();
    });

    it('honours an explicitly stored true', () => {
      const { component } = makeComponent(aContact({ isBillingSameAsShipping: true }));
      component.ngOnInit();
      expect(component.isBillingSameAsShipping).toBeTrue();
    });

    it('defaults a legacy record with NO billing address to "same"', () => {
      const { component } = makeComponent(aContact({ shippingAddress: SHIPPING } as Partial<ContactModel>));
      component.ngOnInit();
      expect(component.isBillingSameAsShipping).toBeTrue();
    });

    it('defaults a legacy record with a DISTINCT billing address to "not same"', () => {
      // The data-loss guard. Defaulting this to true would let a save that
      // never touched the checkbox overwrite a real billing address.
      const { component } = makeComponent(aContact({
        shippingAddress: SHIPPING,
        billingAddress: { ...SHIPPING, address1: '99 Other Rd', city: 'Decatur' },
      } as Partial<ContactModel>));
      component.ngOnInit();
      expect(component.isBillingSameAsShipping).toBeFalse();
    });

    it('treats a billing address IDENTICAL to shipping as "same"', () => {
      const { component } = makeComponent(aContact({
        shippingAddress: SHIPPING,
        billingAddress: { ...SHIPPING },
      } as Partial<ContactModel>));
      component.ngOnInit();
      expect(component.isBillingSameAsShipping).toBeTrue();
    });
  });

  describe('onSameAsShippingToggle', () => {
    it('copies shipping into billing when checked', () => {
      const { component } = makeComponent(aContact({ shippingAddress: SHIPPING } as Partial<ContactModel>));
      component.ngOnInit();
      component.onSameAsShippingToggle(true);
      expect(component.form.get('billingAddress')?.value.address1).toBe('1 Main St');
    });

    it('opens the billing section when unchecked, so it is not left blank', () => {
      const { component } = makeComponent();
      component.ngOnInit();
      component.billingExpanded = false;
      component.onSameAsShippingToggle(false);
      expect(component.billingExpanded).toBeTrue();
    });
  });

  describe('save payload', () => {
    it('re-copies shipping into billing at save time, not just on toggle', async () => {
      // Shipping may be edited AFTER the box was ticked; the payload must
      // reflect the latest shipping either way.
      const { component, deps } = makeComponent(aContact({ isBillingSameAsShipping: true } as Partial<ContactModel>));
      deps.service.update.and.returnValue(Promise.resolve(aContact()));
      component.ngOnInit();
      component.form.get('shippingAddress')?.patchValue({ ...SHIPPING, address1: 'Edited After Ticking' });
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as ContactModel;
      expect(written.billingAddress?.address1).toBe('Edited After Ticking');
    });

    it('leaves billing alone when the box is unchecked', async () => {
      const { component, deps } = makeComponent(aContact({
        isBillingSameAsShipping: false,
        shippingAddress: SHIPPING,
        billingAddress: { ...SHIPPING, address1: '99 Other Rd' },
      } as Partial<ContactModel>));
      deps.service.update.and.returnValue(Promise.resolve(aContact()));
      component.ngOnInit();
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as ContactModel;
      expect(written.billingAddress?.address1).toBe('99 Other Rd');
    });

    it('carries tags, notes and pendingChanges that live OUTSIDE the form', async () => {
      // These are plain class fields, not form controls - rebuilding the
      // payload from form values alone would drop all three.
      const { component, deps } = makeComponent(aContact({ tags: ['vip'] } as Partial<ContactModel>));
      deps.service.update.and.returnValue(Promise.resolve(aContact()));
      component.ngOnInit();
      component.addTag('donor');
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as ContactModel;
      expect(written.tags).toEqual(['vip', 'donor']);
      expect(written.notes).toEqual([]);
      expect(written.pendingChanges).toEqual([]);
    });

    it('refuses to save an invalid form and touches it instead', () => {
      const { component, deps } = makeComponent(aContact({ firstName: '', lastName: '' } as Partial<ContactModel>));
      component.ngOnInit();
      component.onSave();
      expect(deps.service.update).not.toHaveBeenCalled();
      expect(component.form.touched).toBeTrue();
    });

    it('reports an error and stops progress when the service resolves falsy', async () => {
      const { component, deps } = makeComponent();
      deps.service.update.and.returnValue(Promise.resolve(null));
      component.ngOnInit();
      component.onSave();
      await flush();
      expect(deps.snackbar.somethingWentWrong).toHaveBeenCalled();
      expect(component.inProgress$.value).toBeFalse();
    });

    it('stamps a subscription date only on a NEW subscribe', async () => {
      const { component, deps } = makeComponent(aContact({ subscribedToNewsletter: false } as Partial<ContactModel>));
      deps.service.update.and.returnValue(Promise.resolve(aContact()));
      component.ngOnInit();
      component.form.get('subscribedToNewsletter')?.setValue(true);
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['newsletterSubscribedDate']).toBeTruthy();
    });

    it('does NOT re-stamp someone who was already subscribed', async () => {
      const { component, deps } = makeComponent(aContact({ subscribedToNewsletter: true } as Partial<ContactModel>));
      deps.service.update.and.returnValue(Promise.resolve(aContact()));
      component.ngOnInit();
      component.onSave();
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as Record<string, unknown>;
      expect(written['newsletterSubscribedDate']).toBeUndefined();
    });
  });

  describe('timeline', () => {
    const purchase = (receipt: string, dateProcessed: Date) => ({ receipt, dateProcessed, total: 10 });
    const registration = (eventId: string) => ({ eventId, email: 'alex@test.local' });

    function withActivity(purchases: unknown[], registrations: unknown[]) {
      const { component } = makeComponent(aContact(), {
        purchasesService: { streamAllByValue: () => of(purchases) },
        eventRegistrationService: { streamAllByValue: () => of(registrations) },
      });
      return component;
    }

    it('merges purchases, registrations and notes newest-first', (done) => {
      const component = withActivity(
        [purchase('R-1', new Date(2026, 0, 5))],
        [registration('evt-1')],
      );
      component.events = [{ id: 'evt-1', eventName: 'Summit', startDate: new Date(2026, 5, 1) }] as never;
      component.selectedItem.notes = [
        { note: 'Called', date: new Date(2026, 2, 1), addedBy: 'Sam Reed', private: false },
      ] as never;
      component.ngOnInit();

      component.timeline$.subscribe((entries) => {
        expect(entries.map((e) => e.type)).toEqual(['event', 'note', 'purchase']);
        done();
      });
    });

    it('dates an event entry by the EVENT start, not the registration date', (done) => {
      const component = withActivity([], [registration('evt-1')]);
      component.events = [{ id: 'evt-1', eventName: 'Summit', startDate: new Date(2026, 5, 1) }] as never;
      component.ngOnInit();

      component.timeline$.subscribe((entries) => {
        expect(entries[0].date?.getFullYear()).toBe(2026);
        expect(entries[0].date?.getMonth()).toBe(5);
        done();
      });
    });

    it("hides another user's PRIVATE note from the feed entirely", (done) => {
      const component = withActivity([], []);
      component.selectedItem.notes = [
        { note: 'Mine', date: new Date(2026, 2, 1), addedBy: 'Sam Reed', private: true },
        { note: 'Theirs', date: new Date(2026, 2, 2), addedBy: 'Other Person', private: true },
        { note: 'Shared', date: new Date(2026, 2, 3), addedBy: 'Other Person', private: false },
      ] as never;
      component.ngOnInit();

      component.timeline$.subscribe((entries) => {
        expect(entries.length).toBe(2);
        expect(entries.map((e) => e.note?.note)).toEqual(['Shared', 'Mine']);
        done();
      });
    });

    it('keeps undated entries rather than dropping them', (done) => {
      const component = withActivity([{ receipt: 'R-9', total: 5 }], []);
      component.ngOnInit();
      component.timeline$.subscribe((entries) => {
        expect(entries.length).toBe(1);
        expect(entries[0].date).toBeNull();
        done();
      });
    });
  });

  describe('stats', () => {
    it('nets refunds out of lifetime spend', (done) => {
      const { component } = makeComponent(aContact(), {
        purchasesService: {
          streamAllByValue: () => of([
            { total: 100, refundAmount: 40 },
            { total: 25 },
          ]),
        },
        eventRegistrationService: { streamAllByValue: () => of([{ eventId: 'e1' }, { eventId: 'e2' }]) },
      });
      component.ngOnInit();

      component.stats$.subscribe((stats) => {
        // A fully/partly refunded order must not still count as spend.
        expect(stats.spend).toBe(85);
        expect(stats.orders).toBe(2);
        expect(stats.eventsAttended).toBe(2);
        done();
      });
    });
  });

  describe('tags', () => {
    it('adds a trimmed tag and clears the input', () => {
      const { component } = makeComponent();
      component.ngOnInit();
      component.newTag = '  donor  ';
      component.addTag();
      expect(component.tags).toEqual(['donor']);
      expect(component.newTag).toBe('');
    });

    it('ignores blanks and exact duplicates', () => {
      const { component } = makeComponent(aContact({ tags: ['vip'] } as Partial<ContactModel>));
      component.ngOnInit();
      component.addTag('');
      component.addTag('vip');
      expect(component.tags).toEqual(['vip']);
    });

    it('rejects a tag containing "/" and says why', () => {
      // The tag becomes part of a tag_applications doc id.
      const { component, deps } = makeComponent();
      component.ngOnInit();
      component.addTag('a/b');
      expect(component.tags).toEqual([]);
      expect(deps.snackbar.error).toHaveBeenCalled();
    });

    it('removes a tag without touching the others', () => {
      const { component } = makeComponent(aContact({ tags: ['a', 'b', 'c'] } as Partial<ContactModel>));
      component.ngOnInit();
      component.removeTag('b');
      expect(component.tags).toEqual(['a', 'c']);
    });

    it('mirrors adds and removes into tag_applications AFTER a successful save', async () => {
      // This mirror is what lets a manually-tagged contact participate in
      // auto-campaigns (and a removal stop qualifying them). It runs only on
      // success, and only for the delta against the tags loaded at open.
      const { component, deps } = makeComponent(aContact({ tags: ['keep', 'drop'] } as Partial<ContactModel>));
      deps.service.update.and.returnValue(Promise.resolve(aContact()));
      component.ngOnInit();
      component.addTag('fresh');
      component.removeTag('drop');
      component.onSave();
      await flush();

      expect(deps.tagApplicationService.recordManualApplication)
        .toHaveBeenCalledWith('alex@test.local', 'fresh');
      expect(deps.tagApplicationService.removeApplication)
        .toHaveBeenCalledWith('alex@test.local', 'drop');
      // 'keep' was unchanged, so it must not be re-written.
      expect(deps.tagApplicationService.recordManualApplication).toHaveBeenCalledTimes(1);
    });

    it('does NOT mirror tags when the save failed', async () => {
      const { component, deps } = makeComponent();
      deps.service.update.and.returnValue(Promise.resolve(null));
      component.ngOnInit();
      component.addTag('fresh');
      component.onSave();
      await flush();

      expect(deps.tagApplicationService.recordManualApplication).not.toHaveBeenCalled();
    });

    it('suggests only rule tags the contact does not already have', async () => {
      const { component } = makeComponent(aContact({ tags: ['vip'] } as Partial<ContactModel>), {
        tagRuleService: { getAll: () => Promise.resolve([{ tag: 'vip' }, { tag: 'donor' }, { tag: ' donor ' }]) },
      });
      component.ngOnInit();
      await flush();
      expect(component.tagSuggestions()).toEqual(['donor']);
    });
  });

  describe('display helpers', () => {
    it('addressSummary reads as one line, or says nothing is on file', () => {
      const { component } = makeComponent(aContact({ shippingAddress: SHIPPING } as Partial<ContactModel>));
      component.ngOnInit();
      expect(component.addressSummary(component.form.get('shippingAddress')))
        .toBe('1 Main St · Atlanta, GA');
      expect(component.addressSummary(component.form.get('billingAddress')))
        .toBe('No address on file');
      expect(component.addressSummary(null)).toBe('No address on file');
    });

    it('subscriptionLabel names each list', () => {
      const { component } = makeComponent();
      expect(component.subscriptionLabel('prayer')).toBe('Prayer Team');
      expect(component.subscriptionLabel('newsletter')).toBe('Newsletter');
    });

    it('subscriptionDateLabel is blank when no date is stored', () => {
      const { component } = makeComponent();
      expect(component.subscriptionDateLabel('newsletter')).toBe('');
    });
  });

  describe('canSeeNote', () => {
    it('shows public notes and the current user\'s own private ones', () => {
      const { component } = makeComponent();
      component.ngOnInit();
      expect(component.canSeeNote({ private: false, addedBy: 'Other Person' } as never)).toBeTrue();
      expect(component.canSeeNote({ private: true, addedBy: 'Sam Reed' } as never)).toBeTrue();
      expect(component.canSeeNote({ private: true, addedBy: 'Other Person' } as never)).toBeFalse();
    });
  });
});
