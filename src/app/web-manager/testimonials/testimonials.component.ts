import { Component, OnInit } from '@angular/core';
import { map, Observable } from 'rxjs';
import { TestimonialModel } from 'impactdisciplescommon/src/models/domain/testimonial.model';
import { TestimonialService } from 'impactdisciplescommon/src/services/data/testimonial.service';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { TestimonialDialogComponent } from './testimonial-dialog.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';

@Component({
    selector: 'app-testimonials',
    templateUrl: './testimonials.component.html',
    styleUrls: ['./testimonials.component.css'],
    standalone: false
})
export class TestimonialsComponent implements OnInit {
  testimonials$: Observable<TestimonialModel[]>;
  displayedColumns = ['isActive', 'author', 'date', 'title', 'type', 'actions'];

  itemType = 'Testimonial';

  actions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() }
  ];

  constructor(
    private service: TestimonialService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.testimonials$ = this.service.streamAll().pipe(
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
    this.dialog.open(TestimonialDialogComponent, {
      width: '600px',
      data: { item: null }
    });
  }

  showEditModal(item: TestimonialModel): void {
    this.dialog.open(TestimonialDialogComponent, {
      width: '600px',
      data: { item }
    });
  }

  delete(item: TestimonialModel): void {
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
        });
      }
    });
  }
}
