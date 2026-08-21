import { MatDialogRef } from '@angular/material/dialog';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { SessionBlock } from '../event-agenda/session-block.util';
import { SessionAssignmentDialogComponent } from './session-assignment-dialog.component';
import type { SummitCommandCenterComponent } from './summit-command-center.component';

// Class-only spec (house convention): hand-constructed with a FAKE host
// standing in for the Command Center. The fake's assign/remove mutate
// reg.trainingSessions the same way the real host does, so the dialog's
// swap logic can be asserted on real end state, and its blocks/counts are
// plain mutable fields so the "reads LIVE off the host" contract can be
// proven by mutating them between assertions.

const slotStart = new Date(2026, 7, 24, 9, 0);
const slotEnd = new Date(2026, 7, 24, 10, 30);

function item(id: string, overrides: Partial<AgendaItem> = {}): AgendaItem {
  return { id, text: `Session ${id}`, startDate: slotStart, endDate: slotEnd, isCourse: true, ...overrides } as AgendaItem;
}

function block(key: string, options: AgendaItem[]): SessionBlock {
  return { key, startDate: slotStart, endDate: slotEnd, options };
}

interface FakeHost {
  blocks: SessionBlock[];
  counts: Map<string, number>;
  fullIds: Set<string>;
  calls: string[];
  countFor(i: AgendaItem): number;
  isFull(i: AgendaItem): boolean;
  assign: jasmine.Spy;
  remove: jasmine.Spy;
  enqueue: jasmine.Spy;
}

function makeHost(): FakeHost {
  const calls: string[] = [];
  const host: FakeHost = {
    blocks: [],
    counts: new Map<string, number>(),
    fullIds: new Set<string>(),
    calls,
    countFor(i: AgendaItem): number {
      return this.counts.get(i.id!) ?? 0;
    },
    isFull(i: AgendaItem): boolean {
      return this.fullIds.has(i.id!);
    },
    assign: jasmine.createSpy('assign').and.callFake(async (reg: EventRegistrationModel, i: AgendaItem) => {
      calls.push(`assign:${i.id}`);
      reg.trainingSessions = [...new Set([...(reg.trainingSessions ?? []), i.id!])];
    }),
    remove: jasmine.createSpy('remove').and.callFake(async (reg: EventRegistrationModel, i: AgendaItem) => {
      calls.push(`remove:${i.id}`);
      reg.trainingSessions = (reg.trainingSessions ?? []).filter((id) => id !== i.id);
    }),
    enqueue: jasmine.createSpy('enqueue').and.resolveTo(undefined)
  };
  return host;
}

function makeDialog(host: FakeHost, reg: EventRegistrationModel) {
  const dialogRef = jasmine.createSpyObj<MatDialogRef<SessionAssignmentDialogComponent>>('MatDialogRef', ['close']);
  const dialog = new SessionAssignmentDialogComponent(dialogRef, {
    registration: reg,
    host: host as unknown as SummitCommandCenterComponent
  });
  return { dialog, dialogRef };
}

describe('SessionAssignmentDialogComponent', () => {
  const s1 = item('s1');
  const s2 = item('s2');

  function makeReg(trainingSessions: string[] = []): EventRegistrationModel {
    return { id: 'reg-1', email: 'pat@example.com', trainingSessions: [...trainingSessions] } as EventRegistrationModel;
  }

  describe('live host reads (never a snapshot)', () => {
    it('blocks re-reads the host every time - a host rebuild is visible immediately', () => {
      const host = makeHost();
      const { dialog } = makeDialog(host, makeReg());

      expect(dialog.blocks).toEqual([]);

      // Simulate the host recomputing (e.g. after an enqueue rebuilt
      // host.blocks) AFTER the dialog was opened.
      const rebuilt = [block('b1', [s1, s2])];
      host.blocks = rebuilt;

      expect(dialog.blocks).toBe(rebuilt);
    });

    it('countFor and isFull delegate to the host\'s CURRENT state', () => {
      const host = makeHost();
      const { dialog } = makeDialog(host, makeReg());

      expect(dialog.countFor(s1)).toBe(0);
      expect(dialog.isFull(s1)).toBeFalse();

      host.counts.set('s1', 12);
      host.fullIds.add('s1');

      expect(dialog.countFor(s1)).toBe(12);
      expect(dialog.isFull(s1)).toBeTrue();
    });
  });

  describe('one pick per block', () => {
    it('blockPick finds the registrant\'s existing pick in a block, or undefined', () => {
      const host = makeHost();
      const b = block('b1', [s1, s2]);
      const { dialog } = makeDialog(host, makeReg(['s1']));

      expect(dialog.blockPick(b)).toBe(s1);
      expect(makeDialog(host, makeReg()).dialog.blockPick(b)).toBeUndefined();
    });

    it('choosing another session in the same block swaps: removes the old pick FIRST, then assigns', async () => {
      const host = makeHost();
      const reg = makeReg(['s1']);
      const { dialog } = makeDialog(host, reg);

      await dialog.assign(block('b1', [s1, s2]), s2);

      expect(host.calls).toEqual(['remove:s1', 'assign:s2']);
      expect(reg.trainingSessions).toEqual(['s2']);
    });

    it('re-choosing the already-picked session never removes it', async () => {
      const host = makeHost();
      const reg = makeReg(['s1']);
      const { dialog } = makeDialog(host, reg);

      await dialog.assign(block('b1', [s1, s2]), s1);

      expect(host.remove).not.toHaveBeenCalled();
      expect(reg.trainingSessions).toEqual(['s1']);
    });

    it('a first pick in a block assigns without removing anything', async () => {
      const host = makeHost();
      const reg = makeReg();
      const { dialog } = makeDialog(host, reg);

      await dialog.assign(block('b1', [s1, s2]), s1);

      expect(host.remove).not.toHaveBeenCalled();
      expect(reg.trainingSessions).toEqual(['s1']);
    });

    it('swapping inside one block leaves picks in OTHER blocks alone', async () => {
      const host = makeHost();
      const reg = makeReg(['s1', 'x9']); // x9 belongs to a different block
      const { dialog } = makeDialog(host, reg);

      await dialog.assign(block('b1', [s1, s2]), s2);

      expect(reg.trainingSessions).toEqual(jasmine.arrayWithExactContents(['x9', 's2']));
      expect(host.calls).toEqual(['remove:s1', 'assign:s2']);
    });

    it('resets busy$ even when the host write fails', async () => {
      const host = makeHost();
      host.assign.and.rejectWith(new Error('offline'));
      const { dialog } = makeDialog(host, makeReg());

      await expectAsync(dialog.assign(block('b1', [s1, s2]), s1)).toBeRejected();

      expect(dialog.busy$.value).toBeFalse();
    });
  });

  describe('assignment / queue state reads', () => {
    it('isAssigned reflects the registration\'s trainingSessions', () => {
      const host = makeHost();
      const { dialog } = makeDialog(host, makeReg(['s1']));

      expect(dialog.isAssigned(s1)).toBeTrue();
      expect(dialog.isAssigned(s2)).toBeFalse();
    });

    it('isQueued matches the waitList case-insensitively with trimming', () => {
      const host = makeHost();
      const reg = { id: 'reg-1', email: '  Pat@Example.COM ', trainingSessions: [] } as unknown as EventRegistrationModel;
      const { dialog } = makeDialog(host, reg);

      expect(dialog.isQueued(item('q1', { waitList: ['pat@example.com'] }))).toBeTrue();
      expect(dialog.isQueued(item('q2', { waitList: ['someone@else.com'] }))).toBeFalse();
      expect(dialog.isQueued(item('q3'))).toBeFalse(); // no waitList at all
    });
  });

  describe('delegation', () => {
    it('remove and enqueue route through the host (the ONE write path)', async () => {
      const host = makeHost();
      const reg = makeReg(['s1']);
      const { dialog } = makeDialog(host, reg);

      await dialog.remove(s1);
      expect(host.remove).toHaveBeenCalledWith(reg, s1);

      await dialog.enqueue(s2);
      expect(host.enqueue).toHaveBeenCalledWith(reg, s2);
      expect(dialog.busy$.value).toBeFalse();
    });

    it('onClose closes the dialog ref', () => {
      const host = makeHost();
      const { dialog, dialogRef } = makeDialog(host, makeReg());

      dialog.onClose();

      expect(dialogRef.close).toHaveBeenCalled();
    });
  });
});
