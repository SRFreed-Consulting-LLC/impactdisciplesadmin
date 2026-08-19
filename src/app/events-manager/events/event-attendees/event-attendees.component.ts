import { Component, EventEmitter, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { Unsubscribe } from 'firebase/firestore';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { EMailModel } from 'src/app/common/models/admin/mail.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { QueryParam, WhereFilterOperandKeys } from 'src/app/common/dao/firebase.dao';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { ListHeaderAction } from '../../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../../shared/new-record-tracking.util';
import { PagedCollectionSource } from '../../../shared/paged-collection-source';
import { EventAttendeeDialogComponent } from './event-attendee-dialog.component';
import { EventEmailDialogComponent } from './event-email-dialog.component';

// Paged (2026-08-19, user request) - a summit has 1,500+ registrations, so
// this works like the app's other big tables (Products/Contacts/Log
// Messages): one-time getPage() fetches ordered lastName DESC server-side
// (eventId-filtered - composite index event-registrations(eventId ASC,
// lastName DESC)), infinite-scroll load-more, no standing whole-event
// listener.
@Component({
    selector: 'app-event-attendees',
    templateUrl: './event-attendees.component.html',
    styleUrls: ['./event-attendees.component.scss'],
    standalone: false
})
export class EventAttendeesComponent implements OnInit, OnDestroy {
  @Input() event: EventModel;

  // Opt-in for the Summit Command Center: adds a BREAKOUTS row action that
  // emits the registration so the host can open its session-assignment
  // dialog. Regular-event hosts pass nothing and are untouched.
  @Input() sessionManagement = false;
  @Output() manageSessions = new EventEmitter<EventRegistrationModel>();

  paged: PagedCollectionSource<EventRegistrationModel>;

  itemType = 'Registered User';

  columns: DataGridColumn<EventRegistrationModel>[] = [
    { key: 'lastName', label: 'Last Name' },
    { key: 'firstName', label: 'First Name' },
    { key: 'email', label: 'Email' },
    { key: 'registrationDate', label: 'Registration Date', type: 'date', dateFormat: 'short', filterable: false },
    { key: 'loggedIn', label: 'Logged In', filterable: false, value: (item) => (item.loggedIn ? 'Yes' : 'No') },
    { key: 'receipt', label: 'Receipt' }
  ];

  selection = new SelectionModel<EventRegistrationModel>(true, []);

  private readonly screenKey = 'events-manager.events.attendees';

  private unsub?: Unsubscribe;

  // See new-record-tracking.util.ts - marks newly-arrived registrations for
  // THIS event seen the moment it's opened, and keeps them highlighted for
  // this page view.
  tracker: NewRecordTracker<EventRegistrationModel>;

  constructor(
    private service: EventRegistrationService,
    private permissionService: PermissionService,
    private emailService: EMailService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    // lastNameLower, not lastName - Firestore orders by code point, so a
    // lowercase-typed "williams" would outrank "Zonn" otherwise. Backfilled
    // + stamped on every write path (see event-registration.model.ts).
    this.paged = new PagedCollectionSource<EventRegistrationModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'lastNameLower', 'desc', [
        new QueryParam('eventId', WhereFilterOperandKeys.equal, this.event?.id ?? '')
      ]),
      50
    );
    // The tracker still marks this event's newly-arrived registrations seen
    // (bell-badge suppression) as pages load in.
    this.paged.rows$.subscribe((items) => this.tracker.capture(items));
    this.paged.loadFirstPage();

    this.headerActions = [
      ...(this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : []),
      // Not really an "add" action (sends to already-registered users), so
      // gated by edit instead - matches "acts on existing records" better
      // than the New button's create-semantics.
      ...(this.permissionService.canEdit(this.screenKey) ? [{ label: 'Email Registered Users', icon: 'email', onClick: () => this.showEmailModal() }] : [])
    ];
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  rowClass = (row: EventRegistrationModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  headerActions: ListHeaderAction[] = [];

  rowActions: DataGridRowAction<EventRegistrationModel>[] = [
    { icon: 'event_seat', tooltip: 'BREAKOUTS', onClick: (item) => this.manageSessions.emit(item), visible: () => this.sessionManagement },
    { icon: 'forward_to_inbox', tooltip: 'RESEND EMAIL', onClick: (item) => this.resendConfirmationEmail(item), visible: (item) => !!item.receiptEmailId },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(EventAttendeeDialogComponent, { width: '700px', data: { item: null, eventId: this.event?.id } });
  }

  showEditModal(item: EventRegistrationModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.unsub?.();
    if (item.receiptEmailId) {
      this.unsub = this.emailService.streamRecord(item.receiptEmailId, (mail: EMailModel) => {
        if (mail?.delivery) {
          item.receiptEmailStatus = mail.delivery.state;
          item.receiptEmailDate = dateFromTimestamp(mail.delivery.endTime);
        }
      });
    } else {
      item.receiptEmailStatus = 'N/A';
    }

    this.dialog.open(EventAttendeeDialogComponent, { width: '700px', data: { item, eventId: this.event?.id } });
  }

  showEmailModal(): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(EventEmailDialogComponent, { width: '900px', maxWidth: '95vw', data: { eventId: this.event?.id, eventName: this.event?.eventName } });
  }

  delete(item: EventRegistrationModel): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }

  resendConfirmationEmail(item: EventRegistrationModel): void {
    this.confirmService.confirm('<i>Are you sure you want resend this Registration Confirmation?</i>', 'Confirm').then((confirmed) => {
      if (confirmed && item.receiptEmailId) {
        this.emailService.getById(item.receiptEmailId).then((mail) => {
          delete mail.delivery;
          return mail;
        }).then((mail) => {
          this.emailService.update(mail.id, mail).then(() => {
            this.snackbar.success('Email Resent Successfully!');
          });
        });
      }
    });
  }
}
