import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { EventModel } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { EventRegistrationModel } from '@impact-common/shared/models/domain/event-registration.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { AgendaItem } from '@impact-common/shared/models/domain/utils/agenda-item.model';
import { SnackbarService } from '../../../shared/snackbar.service';
import { blockLabel, groupAgendaItemsIntoBlocks, SessionBlock } from '../event-agenda/session-block.util';
import { countsByItemId, noBreakoutRegistrations, weeklyBuckets, WeeklyBucket } from '../summit-stats.util';
import { EventEmailDialogComponent } from '../event-attendees/event-email-dialog.component';
import { SessionAssignmentDialogComponent } from './session-assignment-dialog.component';

// The Summit Attendee Command Center - the attendee report grown into an
// operations screen (user decision 2026-08-19): registration pace,
// per-breakout capacity with alerts, admin-performed breakout sign-ups,
// and a managed WAITING QUEUE per full session ("create a queue for
// waiting attendees so when a space opens up, we can put someone from the
// queue in that spot"). Hosted by EventsComponent's mode === 'attendees'.
//
// Data flow: ONE aggregate load (all of this event's registrations + a
// fresh event doc - the Event Report precedent; eventSessionCounts is
// functions-only in rules, so capacity is always derived here), then pure
// recompute() over in-memory state. Every action applies its known local
// mutation and recomputes - no refetch storms; the REFRESH button and
// re-entry do the true reload. The attendee table itself stays the paged
// app-event-attendees, reused with its sessionManagement opt-in.
@Component({
    selector: 'app-summit-command-center',
    templateUrl: './summit-command-center.component.html',
    styleUrls: ['./summit-command-center.component.scss'],
    standalone: false
})
export class SummitCommandCenterComponent implements OnInit {
  @Input() event: EventModel;

  loading = true;
  registrations: EventRegistrationModel[] = [];
  fresh: EventModel | null = null;

  // Derived by recompute().
  buckets: WeeklyBucket[] = [];
  maxBucket = 1;
  counts = new Map<string, number>();
  blocks: SessionBlock[] = [];
  noBreakoutCount = 0;
  noBreakoutEmails: string[] = [];
  queueTotal = 0;

  blockLabel = blockLabel;

  constructor(
    private eventService: EventService,
    private registrationService: EventRegistrationService,
    private dialog: MatDialog,
    private snackbar: SnackbarService
  ) {}

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  async reload(): Promise<void> {
    this.loading = true;
    try {
      [this.registrations, this.fresh] = await Promise.all([
        this.registrationService.getAllByValue('eventId', this.event.id!),
        this.eventService.getById(this.event.id!)
      ]);
      this.recompute();
    } finally {
      this.loading = false;
    }
  }

  private recompute(): void {
    this.buckets = weeklyBuckets(this.registrations);
    this.maxBucket = Math.max(1, ...this.buckets.map((b) => b.count));
    this.counts = countsByItemId(this.registrations);
    this.blocks = groupAgendaItemsIntoBlocks(this.fresh?.agendaItems ?? []);
    const missing = noBreakoutRegistrations(this.registrations);
    this.noBreakoutCount = missing.length;
    this.noBreakoutEmails = missing.map((r) => r.email).filter((e) => !!e);
    this.queueTotal = (this.fresh?.agendaItems ?? []).reduce((sum, i) => sum + (i.waitList?.length ?? 0), 0);
  }

  countFor(item: AgendaItem): number {
    return this.counts.get(item.id!) ?? 0;
  }

  fillPercent(item: AgendaItem): number {
    if (!item.maxParticipants) return 0;
    return Math.min(100, Math.round((this.countFor(item) / item.maxParticipants) * 100));
  }

  fillTier(item: AgendaItem): 'ok' | 'warn' | 'full' {
    if (!item.maxParticipants) return 'ok';
    const count = this.countFor(item);
    if (count >= item.maxParticipants) return 'full';
    if (count >= item.maxParticipants * 0.9) return 'warn';
    return 'ok';
  }

  isFull(item: AgendaItem): boolean {
    return this.fillTier(item) === 'full';
  }

  registrationFor(email: string): EventRegistrationModel | undefined {
    const normalized = email.trim().toLowerCase();
    return this.registrations.find((r) => (r.email ?? '').trim().toLowerCase() === normalized);
  }

  queueName(email: string): string {
    const reg = this.registrationFor(email);
    return reg ? `${reg.firstName} ${reg.lastName}`.trim() || email : email;
  }

  // ---- Writes (the ONE place; the assignment dialog calls back in) ----

  // The reg the dialog hands back may be a DIFFERENT OBJECT than the one in
  // this.registrations - the attendee table's row action emits its own
  // paged-fetch instance. recompute() derives counts/no-breakout lists from
  // this.registrations, so the mutation must land on the canonical instance
  // too, or the tiles/bars silently miss the change until a full RELOAD
  // (live-diagnosed by the cross-app e2e suite).
  private mutateSessions(
    reg: EventRegistrationModel,
    change: (sessions: string[]) => string[]
  ): void {
    const canonical = this.registrations.find((r) => r.id === reg.id);
    for (const target of new Set([reg, canonical].filter(Boolean))) {
      target!.trainingSessions = change(target!.trainingSessions ?? []);
    }
  }

  async assign(reg: EventRegistrationModel, item: AgendaItem): Promise<void> {
    await this.registrationService.assignTrainingSession(reg.id!, item.id!);
    this.mutateSessions(reg, (sessions) => [...new Set([...sessions, item.id!])]);
    this.recompute();
  }

  async remove(reg: EventRegistrationModel, item: AgendaItem): Promise<void> {
    await this.registrationService.removeTrainingSession(reg.id!, item.id!);
    this.mutateSessions(reg, (sessions) => sessions.filter((id) => id !== item.id));
    this.recompute();
  }

  async enqueue(reg: EventRegistrationModel, item: AgendaItem): Promise<void> {
    this.fresh = await this.eventService.addToWaitList(this.event.id!, item.id!, reg.email);
    this.recompute();
    this.snackbar.success(`${reg.firstName} added to the waiting queue for "${item.text}"`);
  }

  async dequeue(item: AgendaItem, email: string): Promise<void> {
    this.fresh = await this.eventService.removeFromWaitList(this.event.id!, item.id!, email);
    this.recompute();
  }

  // Promote the queue's next-in-line (or a chosen email) into the session.
  // ORDER MATTERS: grant the seat FIRST, then dequeue - a failure between
  // the two leaves a visible, harmless duplicate that re-clicking heals
  // (assign is idempotent); the reverse order could silently lose someone
  // from both places.
  async promote(item: AgendaItem, email: string): Promise<void> {
    const reg = this.registrationFor(email);
    if (!reg) {
      this.snackbar.error(`${email} has no registration for this event - remove them from the queue manually.`);
      return;
    }
    if (this.isFull(item)) {
      this.snackbar.error('Session is still full - free a seat (or raise Max Participants on the Agenda) first.');
      return;
    }
    await this.assign(reg, item);
    this.fresh = await this.eventService.removeFromWaitList(this.event.id!, item.id!, email);
    this.recompute();
    this.snackbar.success(`${this.queueName(email)} promoted into "${item.text}"`);
  }

  // ---- UI actions ----

  openAssignments(reg: EventRegistrationModel): void {
    this.dialog.open(SessionAssignmentDialogComponent, {
      width: '860px',
      maxWidth: '95vw',
      data: {
        registration: reg,
        host: this
      }
    });
  }

  sendNoBreakoutReminder(): void {
    this.dialog.open(EventEmailDialogComponent, {
      width: '900px',
      maxWidth: '95vw',
      data: {
        eventId: this.event.id,
        eventName: this.event.eventName,
        recipients: this.noBreakoutEmails,
        subjectPrefill: `Pick your breakout sessions — ${this.event.eventName}`
      }
    });
  }

  bucketLabel(bucket: WeeklyBucket): string {
    return new Date(bucket.weekStartMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
