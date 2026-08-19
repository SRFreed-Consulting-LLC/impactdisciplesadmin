import { Component, Input, OnInit } from '@angular/core';
import { AnnouncementModel } from 'src/app/common/models/domain/announcement.model.ts';
import { EventModel } from 'src/app/common/models/domain/event.model';
import { BehaviorSubject, Observable, of, tap } from 'rxjs';
import { EventAnnouncementService } from 'src/app/common/services/data/event-announcement.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { AnnouncementDialogComponent } from './announcement-dialog.component';
import { ListHeaderAction } from '../../../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../../../shared/data-grid/data-grid.model';

@Component({
    selector: 'app-announcements',
    templateUrl: './announcements.component.html',
    styleUrls: ['./announcements.component.css'],
    standalone: false
})
export class AnnouncementsComponent implements OnInit {
  @Input() event: EventModel;

  announcements$: Observable<AnnouncementModel[]>;

  columns: DataGridColumn<AnnouncementModel>[] = [
    { key: 'date', label: 'Date', type: 'date', dateFormat: 'short', filterable: false },
    { key: 'sentBy', label: 'Sent By' },
    { key: 'announcement', label: 'Announcement' }
  ];

  itemType = 'Event Announcement';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<AnnouncementModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  constructor(
    private service: EventAnnouncementService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    const source$ = this.event?.id ? this.service.streamAllByValue('eventId', this.event.id) : of([]);
    this.announcements$ = source$.pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    this.dialog.open(AnnouncementDialogComponent, {
      width: '600px',
      data: { item: null, eventId: this.event?.id }
    });
  }

  showEditModal(item: AnnouncementModel): void {
    this.dialog.open(AnnouncementDialogComponent, {
      width: '600px',
      data: { item, eventId: this.event?.id }
    });
  }

  delete(item: AnnouncementModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this announcement?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
