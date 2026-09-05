import { Component } from '@angular/core';
import { SCREEN_KEYS } from 'src/app/core/main-screen/nav-config';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { TestimonialService } from 'src/app/common/services/data/testimonial.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { BaseListComponent } from '../../shared/base-list.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { TestimonialDialogComponent } from '../../shared/testimonial-dialog/testimonial-dialog.component';

@Component({
    selector: 'app-testimonials',
    templateUrl: './testimonials.component.html',
    styleUrls: ['./testimonials.component.css'],
    standalone: false
})
export class TestimonialsComponent extends BaseListComponent<TestimonialModel> {
  readonly itemType = 'Testimonial';
  protected readonly screenKey = SCREEN_KEYS.data.testimonials;
  protected readonly dialogComponent = TestimonialDialogComponent;
  // Wider than the 600px base default: the editor now sits beside a live
  // preview of the public testimonial.
  protected override readonly dialogConfig: MatDialogConfig = { width: '1100px', maxWidth: '95vw' };

  readonly columns: DataGridColumn<TestimonialModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'author', label: 'Author' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'title', label: 'Title' },
    { key: 'type', label: 'Testimonial Type' }
  ];

  constructor(
    service: TestimonialService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }
}
