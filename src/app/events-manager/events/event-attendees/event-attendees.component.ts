import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, of, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import { Unsubscribe } from 'firebase/firestore';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { EMailModel } from 'src/app/common/models/admin/mail.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { ListHeaderAction } from '../../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../../shared/data-grid/data-grid.model';
import { NewRecordTracker } from '../../../shared/new-record-tracking.util';
import { EventAttendeeDialogComponent } from './event-attendee-dialog.component';
import { EventEmailDialogComponent } from './event-email-dialog.component';

@Component({
    selector: 'app-event-attendees',
    templateUrl: './event-attendees.component.html',
    styleUrls: ['./event-attendees.component.scss'],
    standalone: false
})
export class EventAttendeesComponent implements OnInit, OnDestroy {
  @Input() event: EventModel;

  attendees$: Observable<EventRegistrationModel[]>;

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

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private unsub?: Unsubscribe;

  // See new-record-tracking.util.ts - marks newly-arrived registrations for
  // THIS event seen the moment it's opened, and keeps them highlighted for
  // this page view.
  tracker: NewRecordTracker<EventRegistrationModel>;

  constructor(
    private service: EventRegistrationService,
    private emailService: EMailService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {
    this.tracker = new NewRecordTracker(this.service);
  }

  ngOnInit(): void {
    const source$ = this.event?.id ? this.service.streamAllByValue('eventId', this.event.id) : of([]);

    this.attendees$ = source$.pipe(
      tap((items) => this.tracker.capture(items)),
      tap(() => this.loading$.next(false))
    );
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  rowClass = (row: EventRegistrationModel): string => (this.tracker.newIds.has(row.id!) ? 'row--new' : '');

  headerActions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
    { label: 'Email Registered Users', icon: 'email', onClick: () => this.showEmailModal() }
  ];

  rowActions: DataGridRowAction<EventRegistrationModel>[] = [
    { icon: 'forward_to_inbox', tooltip: 'RESEND EMAIL', onClick: (item) => this.resendConfirmationEmail(item), visible: (item) => !!item.receiptEmailId },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }
  ];

  showAddModal(): void {
    this.dialog.open(EventAttendeeDialogComponent, { width: '700px', data: { item: null, eventId: this.event?.id } });
  }

  showEditModal(item: EventRegistrationModel): void {
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
    this.dialog.open(EventEmailDialogComponent, { width: '900px', maxWidth: '95vw', data: { eventId: this.event?.id } });
  }

  delete(item: EventRegistrationModel): void {
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
