import { Component, Input, OnInit } from '@angular/core';
import { AnnouncementModel } from 'impactdisciplescommon/src/models/domain/announcement.model.ts';
import { EventModel } from 'impactdisciplescommon/src/models/domain/event.model';
import { BehaviorSubject, combineLatest, map, Observable, of, tap } from 'rxjs';
import { EventAnnouncementService } from 'impactdisciplescommon/src/services/data/event-announcement.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../../shared/snackbar.service';
import { AnnouncementDialogComponent } from './announcement-dialog.component';
import { ListHeaderAction } from '../../../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../../../shared/column-filter/column-filter.model';

@Component({
    selector: 'app-announcements',
    templateUrl: './announcements.component.html',
    styleUrls: ['./announcements.component.css'],
    standalone: false
})
export class AnnouncementsComponent implements OnInit {
  @Input('event') event: EventModel;

  announcements$: Observable<AnnouncementModel[]>;
  displayedColumns = ['date', 'sentBy', 'announcement', 'actions'];
  filterColumns = ['date-filter', 'sentBy-filter', 'announcement-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Event Announcement';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  // House rule: loading spinner shown until first emission - see
  // customers.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  private filters$ = new BehaviorSubject<Record<string, ColumnFilterValue>>({});

  constructor(
    private service: EventAnnouncementService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    const source$ = this.event?.id ? this.service.streamAllByValue('eventId', this.event.id) : of([]);

    this.announcements$ = combineLatest([source$, this.filters$]).pipe(
      map(([items, filters]) =>
        items
          .filter((item) =>
            Object.keys(filters).every((field) =>
              matchesColumnFilter(item[field as keyof AnnouncementModel], filters[field], 'text')
            )
          )
          .sort((a, b) => {
            const aTime = a.date instanceof Date ? a.date.getTime() : 0;
            const bTime = b.date instanceof Date ? b.date.getTime() : 0;
            return aTime - bTime;
          })
      ),
      tap(() => this.loading$.next(false))
    );
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters$.next({ ...this.filters$.value, [field]: filter });
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
