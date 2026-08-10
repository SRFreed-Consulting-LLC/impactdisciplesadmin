import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TrainingRoomModel } from 'src/app/common/models/domain/training-room.model';
import { ConfirmService } from '../../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../../shared/snackbar.service';
import { RoomDialogComponent } from './room-dialog.component';
import { ListHeaderAction } from '../../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../../shared/data-grid/data-grid.model';

// Rooms live embedded in the parent Location's own document, not their own
// Firestore collection - this component just mutates the shared
// @Input() trainingRooms array in place (matching the original), and the
// parent's own save picks up the change since it's the same array
// reference. app-data-grid's [rows] input, like the MatTableDataSource this
// replaced, only re-renders on a new array reference, so `rows` here is a
// fresh copy reassigned after every mutation - trainingRooms itself keeps
// its original identity for the parent.
@Component({
    selector: 'app-room',
    templateUrl: './room.component.html',
    styleUrls: ['./room.component.css'],
    standalone: false
})
export class RoomComponent implements OnInit {
  @Input() trainingRooms: TrainingRoomModel[];

  rows: TrainingRoomModel[] = [];

  columns: DataGridColumn<TrainingRoomModel>[] = [
    { key: 'name', label: 'Name' },
    { key: 'capacity', label: 'Capacity' }
  ];

  itemType = 'Rooms';

  headerActions: ListHeaderAction[] = [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }];
  rowActions: DataGridRowAction<TrainingRoomModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  constructor(
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    if (!this.trainingRooms) {
      this.trainingRooms = [];
    }
    this.rows = [...this.trainingRooms];
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
        this.rows = [...this.trainingRooms];
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
          this.rows = [...this.trainingRooms];
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
          this.rows = [...this.trainingRooms];
          this.snackbar.success(this.itemType + ' Deleted');
        }
      }
    });
  }

  private generateRandomId() {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
