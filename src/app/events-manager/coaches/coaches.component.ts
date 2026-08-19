import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CoachModel } from 'src/app/common/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { CoachDialogComponent } from './coach-dialog.component';

// Breakout-instructor-only since the Impact Team split (2026-08) - this
// screen used to also manage who appears on the public "My Team" page
// (teamPageSortOrder); that half moved to its own collection/screen
// (Web Manager > Team Page, team-page.component.ts) since Web Manager owns
// public site content. A former team-page coach can still be selected as a
// breakout instructor here after the split - see course-dialog.component.ts's
// combined Coaches + Impact Team picker - this only changed who
// administers the record and where.
@Component({
    selector: 'app-coaches',
    templateUrl: './coaches.component.html',
    styleUrls: ['./coaches.component.scss'],
    standalone: false
})
export class CoachesComponent implements OnInit, OnDestroy {
  coaches$: Observable<CoachModel[]>;

  columns: DataGridColumn<CoachModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'photoUrl', label: 'Photo', filterable: false, sortable: false, value: (item) => item.photoUrl?.name ?? '' },
    { key: 'sortOrder', label: 'Sort Order', type: 'number', filterable: false },
    { key: 'lastName', label: 'Last' },
    { key: 'firstName', label: 'First' },
    { key: 'title', label: 'Title' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) }
  ];

  itemType = 'Coach';

  private readonly screenKey = 'events-manager.coaches';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<CoachModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for organization name lookups in the list - same pattern as
  // Products' categories/series arrays.
  organizations: OrganizationModel[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private service: CoachService,
    private organizationService: OrganizationService,
    private permissionService: PermissionService,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.organizationService.streamAll().pipe(takeUntil(this.ngUnsubscribe)).subscribe((organizations) => {
      this.organizations = organizations;
    });

    this.coaches$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    // EDIT-ONLY since the 2026-08 restructure (user decision): new coaches
    // are created exclusively from the Summit screen's agenda dialogs
    // ("+ Add new coach to this event" - coach-quick-create-dialog); this
    // roster exists to maintain the fuller profile (photo/bio/organization)
    // afterward, so it deliberately has no New action.
    this.headerActions = [];
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  organizationName(item: CoachModel): string {
    const orgId = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === orgId)?.name ?? '';
  }

  showEditModal(item: CoachModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(CoachDialogComponent, { width: '900px', maxWidth: '95vw', data: { item } });
  }

  delete(item: CoachModel): void {
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
}
