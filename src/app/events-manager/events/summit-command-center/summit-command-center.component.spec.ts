import { MatDialog } from '@angular/material/dialog';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { SummitCommandCenterComponent } from './summit-command-center.component';

// Class-only spec (house convention - see permission.service.spec.ts): the
// component is hand-constructed with duck-typed service stubs; no TestBed,
// no Firebase, no template rendering. Dialog-opening methods are exercised
// only as far as "opens with the right payload".

const slotStart = new Date(2026, 7, 24, 9, 0);
const slotEnd = new Date(2026, 7, 24, 10, 30);

function item(overrides: Partial<AgendaItem>): AgendaItem {
  return {
    text: 'Session',
    startDate: slotStart,
    endDate: slotEnd,
    isCourse: true,
    ...overrides
  } as AgendaItem;
}

function reg(overrides: Partial<EventRegistrationModel>): EventRegistrationModel {
  return {
    trainingSessions: [],
    registrationDate: new Date(2026, 7, 4),
    ...overrides
  } as EventRegistrationModel;
}

interface Fixture {
  component: SummitCommandCenterComponent;
  eventService: jasmine.SpyObj<EventService>;
  registrationService: jasmine.SpyObj<EventRegistrationService>;
  dialog: jasmine.SpyObj<MatDialog>;
  snackbar: jasmine.SpyObj<SnackbarService>;
  fresh: EventModel;
  s1: AgendaItem;
  s2: AgendaItem;
  alice: EventRegistrationModel;
  bob: EventRegistrationModel;
  carol: EventRegistrationModel;
}

// One summit: two parallel breakouts (one block). alice + bob hold seats in
// s1; carol picked nothing yet and is queued on s1's waitList.
function makeFixture(opts: { s1Max?: number } = {}): Fixture {
  const s1 = item({ id: 's1', text: 'Session One', maxParticipants: opts.s1Max ?? 2, waitList: ['carol@x.com'] });
  const s2 = item({ id: 's2', text: 'Session Two', maxParticipants: 10 });
  const fresh = { id: 'evt-1', eventName: 'Fall Summit', agendaItems: [s1, s2] } as EventModel;

  const alice = reg({ id: 'reg-a', firstName: 'Alice', lastName: 'Smith', email: 'Alice@Example.com', trainingSessions: ['s1'] });
  const bob = reg({ id: 'reg-b', firstName: 'Bob', lastName: 'Jones', email: 'bob@x.com', trainingSessions: ['s1'], registrationDate: new Date(2026, 7, 11) });
  const carol = reg({ id: 'reg-c', firstName: 'Carol', lastName: 'Nguyen', email: 'carol@x.com', trainingSessions: [], registrationDate: new Date(2026, 7, 11) });

  const registrationService = jasmine.createSpyObj<EventRegistrationService>('EventRegistrationService', [
    'getAllByValue',
    'assignTrainingSession',
    'removeTrainingSession'
  ]);
  registrationService.getAllByValue.and.resolveTo([alice, bob, carol]);
  registrationService.assignTrainingSession.and.resolveTo(undefined);
  registrationService.removeTrainingSession.and.resolveTo(undefined);

  const eventService = jasmine.createSpyObj<EventService>('EventService', ['getById', 'addToWaitList', 'removeFromWaitList']);
  eventService.getById.and.resolveTo(fresh);
  eventService.addToWaitList.and.resolveTo(fresh);
  eventService.removeFromWaitList.and.resolveTo(fresh);

  const dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
  const snackbar = jasmine.createSpyObj<SnackbarService>('SnackbarService', ['success', 'error']);

  const component = new SummitCommandCenterComponent(
    eventService as unknown as EventService,
    registrationService as unknown as EventRegistrationService,
    dialog as unknown as MatDialog,
    snackbar as unknown as SnackbarService
  );
  component.event = { id: 'evt-1', eventName: 'Fall Summit' } as EventModel;

  return { component, eventService, registrationService, dialog, snackbar, fresh, s1, s2, alice, bob, carol };
}

describe('SummitCommandCenterComponent', () => {
  describe('reload + recompute', () => {
    it('derives counts, blocks, no-breakout list, and queue total from one aggregate load', async () => {
      const f = makeFixture();

      await f.component.reload();

      expect(f.component.loading).toBeFalse();
      expect(f.component.countFor(f.s1)).toBe(2);
      expect(f.component.countFor(f.s2)).toBe(0);
      // s1 + s2 share a start/end pair -> ONE breakout block, two options.
      expect(f.component.blocks.length).toBe(1);
      expect(f.component.blocks[0].options.length).toBe(2);
      expect(f.component.noBreakoutCount).toBe(1);
      expect(f.component.noBreakoutEmails).toEqual(['carol@x.com']);
      expect(f.component.queueTotal).toBe(1);
      expect(f.component.buckets.length).toBeGreaterThan(0);
      expect(f.component.maxBucket).toBe(2); // bob + carol registered the same week
    });

    it('clears loading even if the load fails', async () => {
      const f = makeFixture();
      f.registrationService.getAllByValue.and.rejectWith(new Error('offline'));

      await expectAsync(f.component.reload()).toBeRejected();

      expect(f.component.loading).toBeFalse();
    });
  });

  describe('capacity tiers', () => {
    it('classifies ok / warn (>=90%) / full (>=max), and uncapped items as ok', () => {
      const f = makeFixture();
      const capped = item({ id: 'x', maxParticipants: 10 });
      const uncapped = item({ id: 'y', maxParticipants: undefined });

      f.component.counts = new Map([['x', 8]]);
      expect(f.component.fillTier(capped)).toBe('ok');

      f.component.counts = new Map([['x', 9]]);
      expect(f.component.fillTier(capped)).toBe('warn');

      f.component.counts = new Map([['x', 10]]);
      expect(f.component.fillTier(capped)).toBe('full');
      expect(f.component.isFull(capped)).toBeTrue();

      // Over-full (data raced past the cap) still reads as full.
      f.component.counts = new Map([['x', 11]]);
      expect(f.component.fillTier(capped)).toBe('full');

      f.component.counts = new Map([['y', 500]]);
      expect(f.component.fillTier(uncapped)).toBe('ok');
    });

    it('fillPercent rounds, caps at 100, and is 0 for uncapped items', () => {
      const f = makeFixture();
      const capped = item({ id: 'x', maxParticipants: 3 });

      f.component.counts = new Map([['x', 1]]);
      expect(f.component.fillPercent(capped)).toBe(33);

      f.component.counts = new Map([['x', 5]]);
      expect(f.component.fillPercent(capped)).toBe(100);

      expect(f.component.fillPercent(item({ id: 'y' }))).toBe(0);
    });
  });

  describe('queue name resolution', () => {
    it('resolves a queued email against loaded registrations case-insensitively', async () => {
      const f = makeFixture();
      await f.component.reload();

      // Stored email is 'Alice@Example.com'; the queue stores lowercase.
      expect(f.component.queueName('alice@example.com')).toBe('Alice Smith');
    });

    it('falls back to the raw email for unknown addresses and blank names', async () => {
      const f = makeFixture();
      f.carol.firstName = '';
      f.carol.lastName = '';
      await f.component.reload();

      expect(f.component.queueName('nobody@x.com')).toBe('nobody@x.com');
      expect(f.component.queueName('carol@x.com')).toBe('carol@x.com');
    });
  });

  describe('assign / remove recompute', () => {
    it('assign persists, dedupes locally, and recomputes counts', async () => {
      const f = makeFixture();
      await f.component.reload();

      await f.component.assign(f.carol, f.s2);
      expect(f.registrationService.assignTrainingSession).toHaveBeenCalledWith('reg-c', 's2');
      expect(f.carol.trainingSessions).toEqual(['s2']);
      expect(f.component.countFor(f.s2)).toBe(1);
      expect(f.component.noBreakoutCount).toBe(0);

      // Idempotent: re-assigning never double-counts.
      await f.component.assign(f.carol, f.s2);
      expect(f.carol.trainingSessions).toEqual(['s2']);
      expect(f.component.countFor(f.s2)).toBe(1);
    });

    it('remove persists and recomputes counts', async () => {
      const f = makeFixture();
      await f.component.reload();

      await f.component.remove(f.alice, f.s1);

      expect(f.registrationService.removeTrainingSession).toHaveBeenCalledWith('reg-a', 's1');
      expect(f.alice.trainingSessions).toEqual([]);
      expect(f.component.countFor(f.s1)).toBe(1);
      // alice just lost her only pick AND carol never had one -> 2.
      expect(f.component.noBreakoutCount).toBe(2);
    });
  });

  describe('promote', () => {
    it('refuses when the session is still full - no seat, no promote, no dequeue', async () => {
      const f = makeFixture({ s1Max: 2 }); // alice + bob already fill s1
      await f.component.reload();

      await f.component.promote(f.s1, 'carol@x.com');

      expect(f.snackbar.error).toHaveBeenCalled();
      expect(f.registrationService.assignTrainingSession).not.toHaveBeenCalled();
      expect(f.eventService.removeFromWaitList).not.toHaveBeenCalled();
      expect(f.carol.trainingSessions).toEqual([]);
    });

    it('refuses an email with no registration on this event', async () => {
      const f = makeFixture({ s1Max: 3 });
      await f.component.reload();

      await f.component.promote(f.s1, 'stranger@x.com');

      expect(f.snackbar.error).toHaveBeenCalled();
      expect(f.registrationService.assignTrainingSession).not.toHaveBeenCalled();
      expect(f.eventService.removeFromWaitList).not.toHaveBeenCalled();
    });

    it('with a free seat: grants the seat, dequeues, recomputes, and reports by name', async () => {
      const f = makeFixture({ s1Max: 3 }); // 2 of 3 seats taken - one free
      await f.component.reload();
      const drained = {
        ...f.fresh,
        agendaItems: [{ ...f.s1, waitList: [] }, f.s2]
      } as EventModel;
      f.eventService.removeFromWaitList.and.resolveTo(drained);

      await f.component.promote(f.s1, 'carol@x.com');

      expect(f.registrationService.assignTrainingSession).toHaveBeenCalledWith('reg-c', 's1');
      expect(f.eventService.removeFromWaitList).toHaveBeenCalledWith('evt-1', 's1', 'carol@x.com');
      expect(f.carol.trainingSessions).toEqual(['s1']);
      expect(f.component.countFor(f.s1)).toBe(3);
      expect(f.component.queueTotal).toBe(0); // recomputed off the drained event doc
      expect(f.snackbar.success).toHaveBeenCalledWith(jasmine.stringContaining('Carol Nguyen'));
      expect(f.snackbar.error).not.toHaveBeenCalled();
    });
  });

  describe('enqueue / dequeue', () => {
    it('enqueue adopts the updated event doc and recomputes the queue total', async () => {
      const f = makeFixture();
      await f.component.reload();
      const updated = {
        ...f.fresh,
        agendaItems: [{ ...f.s1, waitList: ['carol@x.com', 'bob@x.com'] }, f.s2]
      } as EventModel;
      f.eventService.addToWaitList.and.resolveTo(updated);

      await f.component.enqueue(f.bob, f.s1);

      expect(f.eventService.addToWaitList).toHaveBeenCalledWith('evt-1', 's1', 'bob@x.com');
      expect(f.component.queueTotal).toBe(2);
      expect(f.snackbar.success).toHaveBeenCalled();
    });
  });

  describe('dialog payloads', () => {
    it('openAssignments hands the dialog the registration AND the component itself as live host', async () => {
      const f = makeFixture();
      await f.component.reload();

      f.component.openAssignments(f.carol);

      expect(f.dialog.open).toHaveBeenCalled();
      const config = f.dialog.open.calls.mostRecent().args[1] as { data: { registration: EventRegistrationModel; host: unknown } };
      expect(config.data.registration).toBe(f.carol);
      expect(config.data.host).toBe(f.component);
    });

    it('sendNoBreakoutReminder targets exactly the no-breakout emails', async () => {
      const f = makeFixture();
      await f.component.reload();

      f.component.sendNoBreakoutReminder();

      const config = f.dialog.open.calls.mostRecent().args[1] as { data: { recipients: string[] } };
      expect(config.data.recipients).toEqual(['carol@x.com']);
    });
  });
});
