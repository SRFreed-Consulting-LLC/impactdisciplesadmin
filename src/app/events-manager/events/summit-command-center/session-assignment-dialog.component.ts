import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { SessionBlock, blockLabel } from '../event-agenda/session-block.util';
import type { SummitCommandCenterComponent } from './summit-command-center.component';

export interface SessionAssignmentDialogData {
  registration: EventRegistrationModel;
  // The Command Center hands itself in - every write (and the local
  // re-aggregation that follows) stays in that ONE place, and this
  // dialog reads blocks/counts LIVE off the host's recomputed state (a
  // snapshot went stale the moment an enqueue rebuilt host.blocks -
  // live-caught during Phase 2 verification).
  host: SummitCommandCenterComponent;
}

// Admin-performed breakout sign-up for one registrant - blocks with one
// pick per block (mirroring the public site's rule), per-option capacity,
// and "Add to waiting queue" on FULL options (user decision 2026-08-19).
@Component({
    selector: 'app-session-assignment-dialog',
    templateUrl: './session-assignment-dialog.component.html',
    styleUrls: ['./session-assignment-dialog.component.scss'],
    standalone: false
})
export class SessionAssignmentDialogComponent {
  busy$ = new BehaviorSubject<boolean>(false);
  blockLabel = blockLabel;

  constructor(
    private dialogRef: MatDialogRef<SessionAssignmentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: SessionAssignmentDialogData
  ) {}

  get reg(): EventRegistrationModel {
    return this.data.registration;
  }

  // Live off the host - see SessionAssignmentDialogData's comment.
  get blocks(): SessionBlock[] {
    return this.data.host.blocks;
  }

  isAssigned(item: AgendaItem): boolean {
    return (this.reg.trainingSessions ?? []).includes(item.id!);
  }

  isQueued(item: AgendaItem): boolean {
    const email = (this.reg.email ?? '').trim().toLowerCase();
    return (item.waitList ?? []).includes(email);
  }

  // The registrant's existing pick in this block, if any (one per block -
  // the same rule the public schedule enforces).
  blockPick(block: SessionBlock): AgendaItem | undefined {
    return block.options.find((option) => this.isAssigned(option));
  }

  countFor(item: AgendaItem): number {
    return this.data.host.countFor(item);
  }

  isFull(item: AgendaItem): boolean {
    return this.data.host.isFull(item);
  }

  async assign(block: SessionBlock, item: AgendaItem): Promise<void> {
    this.busy$.next(true);
    try {
      // One pick per block: swap out the existing pick first.
      const existing = this.blockPick(block);
      if (existing && existing.id !== item.id) {
        await this.data.host.remove(this.reg, existing);
      }
      await this.data.host.assign(this.reg, item);
    } finally {
      this.busy$.next(false);
    }
  }

  async remove(item: AgendaItem): Promise<void> {
    this.busy$.next(true);
    try {
      await this.data.host.remove(this.reg, item);
    } finally {
      this.busy$.next(false);
    }
  }

  async enqueue(item: AgendaItem): Promise<void> {
    this.busy$.next(true);
    try {
      await this.data.host.enqueue(this.reg, item);
    } finally {
      this.busy$.next(false);
    }
  }

  onClose(): void {
    this.dialogRef.close();
  }
}
