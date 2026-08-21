import { of } from 'rxjs';
import { CampaignModel } from 'src/app/common/models/domain/campaign.model';
import { CampaignsComponent } from './campaigns.component';

// Covers the pinned-campaigns feature added 2026-08-21. The rest of this
// screen (paging, the Live Now hub, the delete cascade, the ?campaignId=
// deep link) is deliberately not covered here - this suite exists for the
// new behaviour, not as a retrofit of the whole component.
//
// The thing worth pinning down: pinned campaigns are fetched as their OWN
// query and rendered above the list, because the list is a Firestore
// cursor-paged query. Sorting client-side would only float a pinned
// campaign to the top of whichever page it landed on, and adding `pinned`
// to the query's orderBy would drop every campaign that lacks the field.
//
// House style: hand-constructed, duck-typed deps, no TestBed.

function aCampaign(extra: Partial<CampaignModel> = {}): CampaignModel {
  return {
    id: 'c-1',
    name: 'Test Campaign',
    goal: 'other',
    channels: ['email'],
    status: 'draft',
    stats: { sent: 0, uniqueOpens: 0, clicks: 0, purchases: 0, revenue: 0 },
    ...extra,
  } as CampaignModel;
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const permissions: Record<string, boolean> = {};
  return {
    service: {
      getPage: () => Promise.resolve({ items: [], cursor: null }),
      getAllByValue: jasmine.createSpy('getAllByValue').and.returnValue(Promise.resolve([])),
      getById: () => Promise.resolve(null),
      update: jasmine.createSpy('update').and.returnValue(Promise.resolve({})),
    },
    permissionService: {
      canAdd: (k: string) => permissions['add:' + k] !== false,
      canEdit: (k: string) => permissions['edit:' + k] !== false,
      canDelete: (k: string) => permissions['delete:' + k] !== false,
    },
    confirmService: { confirm: () => Promise.resolve(true) },
    snackbar: { success: jasmine.createSpy('success'), error: jasmine.createSpy('error') },
    route: { queryParamMap: of({ get: () => null }) },
    router: { navigate: jasmine.createSpy('navigate') },
    permissions,
    ...overrides,
  };
}

function makeComponent(overrides: Record<string, unknown> = {}) {
  const d = makeDeps(overrides);
  const component = new CampaignsComponent(
    d.service as never,
    d.permissionService as never,
    d.confirmService as never,
    d.snackbar as never,
    d.route as never,
    d.router as never,
  );
  return { component, deps: d };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

const KEY = 'campaigns-manager.campaigns';
/** The pin action is the first of the two push_pin entries; unpin is second. */
const pinAction = (c: CampaignsComponent) => c.rowActions[0];
const unpinAction = (c: CampaignsComponent) => c.rowActions[1];

describe('CampaignsComponent pinning', () => {
  describe('loading pinned campaigns', () => {
    it('fetches them as their OWN query, not by filtering the paged list', async () => {
      const { component, deps } = makeComponent();
      component.ngOnInit();
      await flush();
      expect(deps.service.getAllByValue).toHaveBeenCalledWith('pinned', true);
    });

    it('orders them by name so the strip is stable between loads', async () => {
      const { component } = makeComponent({
        service: {
          ...makeDeps().service,
          getAllByValue: (field: string) => Promise.resolve(
            field === 'pinned'
              ? [aCampaign({ id: 'b', name: 'Prayer Letter' }), aCampaign({ id: 'a', name: 'Monthly Newsletter' })]
              : [],
          ),
        },
      });
      component.ngOnInit();
      await flush();
      expect(component.pinnedCampaigns.map((c) => c.name))
        .toEqual(['Monthly Newsletter', 'Prayer Letter']);
    });

    it('leaves the strip empty when nothing is pinned', async () => {
      const { component } = makeComponent();
      component.ngOnInit();
      await flush();
      expect(component.pinnedCampaigns).toEqual([]);
    });
  });

  describe('row actions', () => {
    it('offers PIN on an unpinned row and UNPIN on a pinned one, never both', () => {
      const { component } = makeComponent();
      const unpinned = aCampaign();
      const pinned = aCampaign({ pinned: true });

      expect(pinAction(component).visible!(unpinned)).toBeTrue();
      expect(unpinAction(component).visible!(unpinned)).toBeFalse();

      expect(pinAction(component).visible!(pinned)).toBeFalse();
      expect(unpinAction(component).visible!(pinned)).toBeTrue();
    });

    it('hides both from someone who cannot edit campaigns', () => {
      const { component, deps } = makeComponent();
      deps.permissions['edit:' + KEY] = false;
      expect(pinAction(component).visible!(aCampaign())).toBeFalse();
      expect(unpinAction(component).visible!(aCampaign({ pinned: true }))).toBeFalse();
    });
  });

  describe('togglePin', () => {
    it('pins an unpinned campaign and reports it', async () => {
      const { component, deps } = makeComponent();
      const item = aCampaign({ name: 'Monthly Newsletter' });
      await component.togglePin(item);
      await flush();

      const [id, written] = deps.service.update.calls.mostRecent().args as [string, CampaignModel];
      expect(id).toBe('c-1');
      expect(written.pinned).toBeTrue();
      expect(deps.snackbar.success).toHaveBeenCalledWith('Monthly Newsletter pinned to top');
    });

    it('unpins a pinned campaign', async () => {
      const { component, deps } = makeComponent();
      const item = aCampaign({ name: 'Monthly Newsletter', pinned: true });
      await component.togglePin(item);
      await flush();

      const written = deps.service.update.calls.mostRecent().args[1] as CampaignModel;
      expect(written.pinned).toBeFalse();
      expect(deps.snackbar.success).toHaveBeenCalledWith('Monthly Newsletter unpinned');
    });

    it('updates the row in place so the icon flips without a list reload', async () => {
      const { component } = makeComponent();
      const item = aCampaign();
      await component.togglePin(item);
      expect(item.pinned).toBeTrue();
      expect(pinAction(component).visible!(item)).toBeFalse();
      expect(unpinAction(component).visible!(item)).toBeTrue();
    });

    it('preserves the rest of the campaign - it writes the WHOLE doc', async () => {
      // update() takes a full model here, so dropping fields would wipe them.
      const { component, deps } = makeComponent();
      await component.togglePin(aCampaign({ name: 'Prayer Letter', couponId: 'SUMMER' }));
      const written = deps.service.update.calls.mostRecent().args[1] as CampaignModel;
      expect(written.name).toBe('Prayer Letter');
      expect(written.couponId).toBe('SUMMER');
    });

    it('refreshes the strip after a change', async () => {
      const { component, deps } = makeComponent();
      deps.service.getAllByValue.calls.reset();
      await component.togglePin(aCampaign());
      await flush();
      expect(deps.service.getAllByValue).toHaveBeenCalledWith('pinned', true);
    });

    it('is permission-gated and writes nothing when denied', async () => {
      const { component, deps } = makeComponent();
      deps.permissions['edit:' + KEY] = false;
      const item = aCampaign();
      await component.togglePin(item);
      expect(deps.service.update).not.toHaveBeenCalled();
      expect(item.pinned).toBeUndefined();
    });

    it('reports a failure and leaves the row unchanged', async () => {
      const { component, deps } = makeComponent();
      deps.service.update.and.returnValue(Promise.reject(new Error('offline')));
      const item = aCampaign();
      await component.togglePin(item);
      await flush();
      expect(deps.snackbar.error).toHaveBeenCalled();
      // Not flipped locally, so the UI still matches what is stored.
      expect(item.pinned).toBeUndefined();
    });
  });
});
