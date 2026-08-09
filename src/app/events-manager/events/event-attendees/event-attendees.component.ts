import { Component, Input, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable, of, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { SelectionModel } from '@angular/cdk/collections';
import jsPDF from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { Unsubscribe } from 'firebase/firestore';
import { EventRegistrationModel } from 'src/app/common/models/domain/event-registration.model';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { EventRegistrationService } from 'src/app/common/services/data/event-registration.service';
import { EMailService } from 'src/app/common/services/data/email.service';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { ListHeaderAction } from '../../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../../shared/column-filter/column-filter.model';
import { ExcelColumn, exportToExcel } from '../../../shared/table-export.util';
import { NewRecordTracker } from '../../../shared/new-record-tracking.util';
import { EventAttendeeDialogComponent } from './event-attendee-dialog.component';
import { EventEmailDialogComponent } from './event-email-dialog.component';

interface ColumnDef {
  key: string;
  label: string;
  visible: boolean;
}

@Component({
    selector: 'app-event-attendees',
    templateUrl: './event-attendees.component.html',
    styleUrls: ['./event-attendees.component.scss'],
    standalone: false
})
export class EventAttendeesComponent implements OnInit, OnDestroy {
  @Input() event: EventModel;

  attendees$: Observable<EventRegistrationModel[]>;
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Registered User';

  columns: ColumnDef[] = [
    { key: 'lastName', label: 'Last Name', visible: true },
    { key: 'firstName', label: 'First Name', visible: true },
    { key: 'email', label: 'Email', visible: true },
    { key: 'registrationDate', label: 'Registration Date', visible: true },
    { key: 'loggedIn', label: 'Logged In', visible: true },
    { key: 'receipt', label: 'Receipt', visible: true }
  ];

  selection = new SelectionModel<EventRegistrationModel>(true, []);

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  currentRows: EventRegistrationModel[] = [];

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});
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

    this.attendees$ = combineLatest([source$, this.filters$]).pipe(
      tap(([items]) => this.tracker.capture(items)),
      map(([items, filters]) => {
        const filtered = items
          .filter((item) => Object.keys(filters).every((field) => matchesColumnFilter((item as any)[field], filters[field], 'text')))
          .sort((a, b) => (a.lastName ?? '').localeCompare(b.lastName ?? ''));
        this.currentRows = filtered;
        return filtered;
      }),
      tap(() => this.loading$.next(false))
    );
  }

  ngOnDestroy(): void {
    this.unsub?.();
  }

  get displayedColumns(): string[] {
    return ['select', ...this.columns.filter((c) => c.visible).map((c) => c.key), 'actions'];
  }

  get filterColumns(): string[] {
    return ['select-filter', ...this.columns.filter((c) => c.visible).map((c) => `${c.key}-filter`), 'actions-filter'];
  }

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
    { label: 'Email Registered Users', icon: 'email', onClick: () => this.showEmailModal() },
    { label: 'Export to PDF', icon: 'picture_as_pdf', onClick: () => this.exportPdf() }
  ];

  toggleColumn(column: ColumnDef): void {
    column.visible = !column.visible;
  }

  isAllSelected(): boolean {
    return this.currentRows.length > 0 && this.currentRows.every((row) => this.selection.isSelected(row));
  }

  masterToggle(): void {
    this.isAllSelected() ? this.selection.clear() : this.currentRows.forEach((row) => this.selection.select(row));
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
  }

  showAddModal(): void {
    this.dialog.open(EventAttendeeDialogComponent, { width: '700px', data: { item: null, eventId: this.event?.id } });
  }

  showEditModal(item: EventRegistrationModel): void {
    this.unsub?.();
    if (item.receiptEmailId) {
      this.unsub = this.emailService.streamRecord(item.receiptEmailId, (mail: any) => {
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
        this.emailService.getById(item.receiptEmailId).then((mail: any) => {
          delete mail['delivery'];
          return mail;
        }).then((mail) => {
          this.emailService.update(mail.id, mail).then(() => {
            this.snackbar.success('Email Resent Successfully!');
          });
        });
      }
    });
  }

  exportPdf(): void {
    const doc = new jsPDF();
    autoTable(doc, {
      startY: 12,
      head: [['Last Name', 'First Name', 'Email', 'Registration Date']],
      body: this.currentRows.map((row) => [
        row.lastName ?? '',
        row.firstName ?? '',
        row.email ?? '',
        row.registrationDate instanceof Date ? row.registrationDate.toLocaleDateString() : ''
      ])
    });
    doc.save('attendee_list.pdf');
  }

  exportExcel(): void {
    const columns: ExcelColumn<EventRegistrationModel>[] = [
      { header: 'Last Name', value: (r) => r.lastName ?? '' },
      { header: 'First Name', value: (r) => r.firstName ?? '' },
      { header: 'Email', value: (r) => r.email ?? '' },
      { header: 'Registration Date', value: (r) => (r.registrationDate instanceof Date ? r.registrationDate : '') },
      { header: 'Logged In', value: (r) => (r.loggedIn ? 'Yes' : 'No') },
      { header: 'Receipt', value: (r) => r.receipt ?? '' }
    ];
    exportToExcel(this.currentRows, columns, 'attendee_list.xlsx');
  }
}
