import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTableDataSource } from '@angular/material/table';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { RoomDialogComponent } from './room-dialog.component';
import { ListHeaderAction } from '../../../shared/list-header/list-header.component';
import { ColumnFilterValue, matchesColumnFilter, TEXT_FILTER_OPERATORS } from '../../../shared/column-filter/column-filter.model';

// Rooms live embedded in the parent Location's own document, not their own
// Firestore collection - this component just mutates the shared
// @Input() trainingRooms array in place (matching the original), and the
// parent's own save picks up the change since it's the same array
// reference. MatTable doesn't observe in-place array mutations though, so
// a MatTableDataSource is used here (unlike the Observable-backed tables
// elsewhere) and its `.data` is explicitly reassigned after every mutation
// to force a re-render.
@Component({
    selector: 'app-room',
    templateUrl: './room.component.html',
    styleUrls: ['./room.component.css'],
    standalone: false
})
export class RoomComponent implements OnInit {
  @Input() trainingRooms: TrainingRoomModel[];

  dataSource = new MatTableDataSource<TrainingRoomModel>([]);
  displayedColumns = ['name', 'capacity', 'actions'];
  filterColumns = ['name-filter', 'capacity-filter', 'actions-filter'];
  textOperators = TEXT_FILTER_OPERATORS;

  itemType = 'Rooms';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  private filters: Record<string, ColumnFilterValue> = {};

  constructor(
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    if (!this.trainingRooms) {
      this.trainingRooms = [];
    }
    this.dataSource.data = this.trainingRooms;
  }

  onFilterChange(field: string, filter: ColumnFilterValue): void {
    this.filters = { ...this.filters, [field]: filter };
    this.dataSource.data = this.trainingRooms.filter((room) =>
      Object.keys(this.filters).every((f) =>
        matchesColumnFilter(room[f as keyof TrainingRoomModel], this.filters[f], 'text')
      )
    );
  }

  showAddModal(): void {
    const dialogRef = this.dialog.open(RoomDialogComponent, {
      width: '400px',
      data: { item: null }
    });

    dialogRef.afterClosed().subscribe((result: TrainingRoomModel | false) => {
      if (result) {
        result.id = this.generateRandomId();
        this.trainingRooms.push(result);
        this.dataSource.data = this.trainingRooms;
        this.snackbar.success(this.itemType + ' Added');
      }
    });
  }

  showEditModal(item: TrainingRoomModel): void {
    const dialogRef = this.dialog.open(RoomDialogComponent, {
      width: '400px',
      data: { item }
    });

    dialogRef.afterClosed().subscribe((result: TrainingRoomModel | false) => {
      if (result) {
        const i = this.trainingRooms.findIndex((room) => room.id === result.id);
        if (i > -1) {
          this.trainingRooms.splice(i, 1, result);
          this.dataSource.data = this.trainingRooms;
          this.snackbar.success(this.itemType + ' Updated');
        }
      }
    });
  }

  delete(item: TrainingRoomModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        const i = this.trainingRooms.findIndex((room) => room.id === item.id);
        if (i > -1) {
          this.trainingRooms.splice(i, 1);
          this.dataSource.data = this.trainingRooms;
          this.snackbar.success(this.itemType + ' Deleted');
        }
      }
    });
  }

  private generateRandomId() {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
