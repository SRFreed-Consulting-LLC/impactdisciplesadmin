import { Component, OnInit } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ConsultationRequestModel } from 'impactdisciplescommon/src/models/domain/consultation-request.model';
import { ConsultationRequestService } from 'impactdisciplescommon/src/services/data/consultation-request.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ConsultationRequestDialogComponent } from './consultation-request-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';

@Component({
    selector: 'app-consultations-requests',
    templateUrl: './consultations-requests.component.html',
    styleUrls: ['./consultations-requests.component.css'],
    standalone: false
})
export class ConsultationsRequestsComponent implements OnInit {
  requests$: Observable<ConsultationRequestModel[]>;
  displayedColumns = ['date', 'lastName', 'firstName', 'email', 'message', 'actions'];

  itemType = 'Consultation Request';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  constructor(
    private service: ConsultationRequestService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.requests$ = this.service.streamAll().pipe(
      map((items) =>
        items.slice().sort((a, b) => {
          const aTime = a.date instanceof Date ? a.date.getTime() : 0;
          const bTime = b.date instanceof Date ? b.date.getTime() : 0;
          return bTime - aTime;
        })
      )
    );
  }

  showAddModal(): void {
    this.dialog.open(ConsultationRequestDialogComponent, {
      width: '500px',
      data: { item: null }
    });
  }

  showEditModal(item: ConsultationRequestModel): void {
    this.dialog.open(ConsultationRequestDialogComponent, {
      width: '500px',
      data: { item }
    });
  }

  delete(item: ConsultationRequestModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
