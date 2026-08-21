import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { EventModel, EventVenue } from '@impact-common/shared/models/domain/event.model';
import { EventService } from 'src/app/common/services/data/event.service';
import { LocationModel } from '@impact-common/shared/models/domain/location.model';
import { LocationService } from 'src/app/common/services/data/location.service';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { TrainingRoomModel } from '@impact-common/shared/models/domain/training-room.model';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { toMillis } from '@impact-common/shared/utils/date-from-timestamp';
import { SnackbarService } from '../../../shared/snackbar.service';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { RICH_TEXT_TOOLBAR } from '../../../shared/rich-text-editor/quill-toolbar.config';
import { Instructor } from '../event-agenda/session-block.util';
import { VenueRoomsDialogComponent } from '../venue-rooms-dialog.component';
import { SummitPreviewData } from '../summit-preview/summit-preview.component';
import { copyAgendaSkeleton, copySummitContent } from './summit-copy.util';

interface WizardStep {
  key: string;
  label: string;
}

// The New Summit guided setup (user decision 2026-08-19: the checklist
// mockup as a wizard, the time-grid concept in its Agenda step, a live
// public-page preview on EVERY step). NEW summits only - once created,
// day-to-day edits use the existing tab editor.
//
// Draft semantics: a plain in-memory EventModel. NOTHING persists until
// Publish (one EventService.add) or "Save draft & exit" (same add, early,
// isActive false - finished later in the edit screen; deliberately no
// wizard-resume/sessionStorage). The agenda components mutate
// draft.agendaItems in place and never read event.id, so the existing
// agenda-wizard/agenda-grid work against the unsaved draft as-is.
@Component({
    selector: 'app-summit-setup-wizard',
    templateUrl: './summit-setup-wizard.component.html',
    styleUrls: ['./summit-setup-wizard.component.scss'],
    standalone: false
})
export class SummitSetupWizardComponent implements OnInit {
  @Input() priorSummits: EventModel[] = [];
  @Output() closed = new EventEmitter<void>();
  // Emits the created event's id (published or draft-saved).
  @Output() published = new EventEmitter<string>();

  steps: WizardStep[] = [
    { key: 'basics', label: 'Basics' },
    { key: 'venue', label: 'Venue & Rooms' },
    { key: 'public', label: 'Public Page' },
    { key: 'content', label: 'App Content' },
    { key: 'agenda', label: 'Agenda' },
    { key: 'email', label: 'Confirmation Email' },
    { key: 'review', label: 'Review & Publish' }
  ];
  step = 0;

  draft: EventModel = {
    ...new EventModel(),
    isSummit: true,
    isActive: false,
    isOnline: false,
    isKajabiCourse: false,
    agendaItems: [],
    faqList: []
  };

  form: FormGroup;
  richTextModules = RICH_TEXT_TOOLBAR;
  saving$ = new BehaviorSubject<boolean>(false);
  dirty = false;

  // Copy-from source.
  copySourceId: string | null = null;

  // Reference data (loaded once, same conventions as event-agenda /
  // events.component).
  venue: LocationModel | null = null;
  rooms: TrainingRoomModel[] = [];
  coaches: Instructor[] = [];
  emailTemplates: string[] = [];

  // Image uploader plumbing (the events.component pattern).
  card: { imageUrl?: ImageModel } = {};
  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);

  agendaView: 'wizard' | 'grid' = 'wizard';

  constructor(
    private fb: FormBuilder,
    private eventService: EventService,
    private locationService: LocationService,
    private coachService: CoachService,
    private impactTeamService: ImpactTeamService,
    private emailTemplateService: EMailTemplatesService,
    private dialog: MatDialog,
    private snackbar: SnackbarService,
    private confirmService: ConfirmService
  ) {}

  async ngOnInit(): Promise<void> {
    this.form = this.fb.group({
      eventName: ['', Validators.required],
      startDate: ['', Validators.required],
      endDate: [''],
      checkIn: [''],
      costInDollars: [0],
      videoId: [''],
      description: [''],
      emailTemplate: [null]
    });
    this.form.valueChanges.subscribe(() => (this.dirty = true));

    const [venues, coaches, impactTeam, templates] = await Promise.all([
      this.locationService.getAllByValue('isSummitVenue', true),
      this.coachService.getAll(),
      this.impactTeamService.getAll(),
      this.emailTemplateService.getAll()
    ]);
    this.venue = venues[0] ?? null;
    this.rooms = this.venue?.trainingrooms ?? [];
    this.coaches = [
      ...coaches.map((c) => ({ id: c.id, fullname: c.fullname, source: 'coaches' as const })),
      ...impactTeam.map((c) => ({ id: c.id, fullname: c.fullname, source: 'impact_team' as const }))
    ];
    this.emailTemplates = templates.map((t) => t.name);
  }

  // ---- Step navigation ----

  goToStep(index: number): void {
    if (index > 0 && !this.basicsValid()) {
      this.form.markAllAsTouched();
      this.snackbar.error('Name and Start Date first - the rest of the wizard builds on them.');
      return;
    }
    this.step = Math.max(0, Math.min(this.steps.length - 1, index));
    this.syncDraftDates();
  }

  next(): void {
    this.goToStep(this.step + 1);
  }

  back(): void {
    this.step = Math.max(0, this.step - 1);
  }

  basicsValid(): boolean {
    return !!this.form?.get('eventName')?.valid && !!this.form?.get('startDate')?.valid;
  }

  // The agenda components derive days from draft.startDate/endDate - keep
  // the draft in step with the Basics form whenever navigation happens.
  private syncDraftDates(): void {
    const raw = this.form.getRawValue();
    this.draft.startDate = raw.startDate ? new Date(raw.startDate) : undefined;
    this.draft.endDate = raw.endDate ? new Date(raw.endDate) : undefined;
    this.draft.eventName = raw.eventName;
  }

  // ---- Copy from last summit ----

  copySource(): EventModel | undefined {
    return this.priorSummits.find((s) => s.id === this.copySourceId);
  }

  copyContent(): void {
    const source = this.copySource();
    if (!source) return;
    copySummitContent(source, this.draft);
    this.form.patchValue({ emailTemplate: this.draft.emailTemplate ?? null });
    this.dirty = true;
    this.snackbar.success(`Dining, check-in, what's next, FAQs and email template copied from "${source.eventName}"`);
  }

  async copyAgenda(): Promise<void> {
    const source = this.copySource();
    const raw = this.form.getRawValue();
    if (!source || !raw.startDate) return;
    if ((this.draft.agendaItems ?? []).length > 0) {
      const confirmed = await this.confirmService.confirm('<i>Replace the agenda built so far with a copy of the previous summit\'s schedule?</i>', 'Confirm');
      if (!confirmed) return;
    }
    this.draft.agendaItems = copyAgendaSkeleton(source, new Date(raw.startDate));
    this.agendaView = 'grid';
    this.dirty = true;
    this.snackbar.success(`${this.draft.agendaItems.length} agenda items copied (times shifted to the new dates, fresh sign-up lists)`);
  }

  // ---- Venue rooms popup ----

  openVenueRooms(): void {
    const ref = this.dialog.open(VenueRoomsDialogComponent, { width: '760px', maxWidth: '95vw' });
    ref.afterClosed().subscribe(async () => {
      const venues = await this.locationService.getAllByValue('isSummitVenue', true);
      this.venue = venues[0] ?? this.venue;
      this.rooms = this.venue?.trainingrooms ?? [];
    });
  }

  // ---- Image uploader ----

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
    this.dirty = true;
  }

  // ---- Live preview ----

  previewData(): SummitPreviewData {
    const raw = this.form.getRawValue();
    return {
      eventName: raw.eventName,
      startDate: raw.startDate,
      endDate: raw.endDate,
      checkIn: raw.checkIn,
      description: raw.description,
      videoId: raw.videoId,
      imageUrl: this.card.imageUrl ?? null,
      venue: this.venueSnapshot(),
      costInDollars: raw.costInDollars,
      // The rail's APP view - the draft carries these (App Content +
      // Agenda steps mutate it in place).
      diningOptions: this.draft.diningOptions ?? null,
      checkinInstructions: this.draft.checkinInstructions ?? null,
      whatsNext: this.draft.whatsNext ?? null,
      faqList: this.draft.faqList ?? null,
      agendaItems: this.draft.agendaItems ?? null
    };
  }

  private venueSnapshot(): EventVenue | null {
    return this.venue ? { name: this.venue.name, address: this.venue.address ?? {} } : null;
  }

  // ---- Readiness (Review step) ----

  checklist(): { label: string; done: boolean }[] {
    const raw = this.form.getRawValue();
    return [
      { label: 'Name, dates & cost', done: this.basicsValid() },
      { label: 'Venue pinned', done: !!this.venue },
      { label: 'Hero image', done: !!this.card.imageUrl },
      { label: 'Web description', done: !!raw.description },
      { label: 'App content (dining / check-in / what\'s next)', done: !!(this.draft.diningOptions && this.draft.checkinInstructions && this.draft.whatsNext) },
      { label: 'Agenda built', done: (this.draft.agendaItems ?? []).length > 0 },
      { label: 'Confirmation email template', done: !!raw.emailTemplate }
    ];
  }

  readyCount(): number {
    return this.checklist().filter((c) => c.done).length;
  }

  breakoutCount(): number {
    return (this.draft.agendaItems ?? []).filter((i) => i.isCourse).length;
  }

  // ---- Persistence: ONE add(), at Publish or Save-draft-&-exit ----

  // Review-step choice: open sign-ups while NOT live (see
  // EventModel.earlyRegistration) - only meaningful for CREATE (NOT LIVE);
  // going live supersedes it.
  earlyRegistration = false;

  private assembleDoc(goLive: boolean): EventModel {
    const raw = this.form.getRawValue();
    const venue = this.venueSnapshot();
    return {
      ...this.draft,
      earlyRegistration: this.earlyRegistration,
      eventName: raw.eventName,
      startDate: raw.startDate ? new Date(raw.startDate) : undefined,
      endDate: raw.endDate ? new Date(raw.endDate) : undefined,
      checkIn: raw.checkIn || null,
      costInDollars: raw.costInDollars ?? 0,
      videoId: raw.videoId ?? '',
      description: raw.description ?? '',
      emailTemplate: raw.emailTemplate ?? null,
      isSummit: true,
      isActive: goLive,
      // A Summit is always in-person at the pinned venue, never Kajabi -
      // same stamps as events.component.onSave()'s summit branch.
      isOnline: false,
      isKajabiCourse: false,
      venue: venue,
      ...(this.venue?.id ? { location: this.venue.id } : {}),
      ...(this.card.imageUrl ? { imageUrl: this.card.imageUrl } : {})
    } as EventModel;
  }

  async publish(goLive: boolean): Promise<void> {
    if (!this.basicsValid()) {
      this.form.markAllAsTouched();
      this.goToStep(0);
      return;
    }
    this.saving$.next(true);
    try {
      const created = await this.eventService.add(this.assembleDoc(goLive));
      this.snackbar.success(goLive ? 'Summit published and LIVE' : 'Summit created (not live yet)');
      this.published.emit(created?.id);
    } catch {
      this.snackbar.error('Some Error Occured');
    } finally {
      this.saving$.next(false);
    }
  }

  async saveDraftAndExit(): Promise<void> {
    await this.publish(false);
  }

  async onCancel(): Promise<void> {
    if (this.dirty || (this.draft.agendaItems ?? []).length > 0) {
      const confirmed = await this.confirmService.confirm('<i>Discard this summit? Nothing has been saved.</i>', 'Confirm');
      if (!confirmed) return;
    }
    this.closed.emit();
  }

  daysSet(): boolean {
    return !!toMillis(this.form?.get('startDate')?.value);
  }
}
