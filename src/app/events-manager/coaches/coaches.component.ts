import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { CoachModel } from '@impact-common/shared/models/domain/coach.model';
import { CoachService } from 'src/app/common/services/data/coach.service';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { BaseListComponent } from '../../shared/base-list.component';
import { organizationNameOf } from '../../shared/organization-name.util';
import { CoachDialogComponent } from './coach-dialog.component';

// Breakout-instructor-only since the Impact Team split (2026-08) - this
// screen used to also manage who appears on the public "My Team" page
// (teamPageSortOrder); that half moved to its own collection/screen
// (Content Manager > Team Page, team-page.component.ts) since that area owns
// public site content. A former team-page coach can still be selected as a
// breakout instructor here after the split - see the combined Coaches +
// Impact Team picker - this only changed who administers the record and
// where.
//
// Extends BaseListComponent (2026-08-28, sweep P4) like every other small
// CRUD list screen. Team Page is its structural twin but a DIFFERENT screen
// over a DIFFERENT collection (coaches vs impact_team) - they extend the base
// separately rather than sharing a component, because the datasets and the
// add behaviour genuinely differ.
@Component({
    selector: 'app-coaches',
    templateUrl: './coaches.component.html',
    styleUrls: ['./coaches.component.scss'],
    standalone: false
})
export class CoachesComponent extends BaseListComponent<CoachModel>
  implements OnInit, OnDestroy {
  readonly itemType = 'Coach';
  protected readonly screenKey = 'events-manager.coaches';
  protected readonly dialogComponent = CoachDialogComponent;
  protected override readonly dialogConfig = { width: '1150px', maxWidth: '95vw' };

  readonly columns: DataGridColumn<CoachModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'photoUrl', label: 'Photo', filterable: false, sortable: false, value: (item) => item.photoUrl?.name ?? '' },
    { key: 'sortOrder', label: 'Sort Order', type: 'number', filterable: false },
    { key: 'lastName', label: 'Last' },
    { key: 'firstName', label: 'First' },
    { key: 'title', label: 'Title' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) }
  ];

  /** Kept live for organization name lookups in the list - same pattern as
   *  Products' categories/series arrays. */
  organizations: OrganizationModel[] = [];

  /** The template still binds `coaches$`; the base owns it as `items$`. */
  get coaches$() {
    return this.items$;
  }

  private ngUnsubscribe = new Subject<void>();

  constructor(
    service: CoachService,
    private organizationService: OrganizationService,
    permissionService: PermissionService,
    dialog: MatDialog,
    confirmService: ConfirmService,
    snackbar: SnackbarService
  ) {
    super(service, permissionService, dialog, confirmService, snackbar);
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.organizationService.streamAll()
      .pipe(takeUntil(this.ngUnsubscribe))
      .subscribe((organizations) => {
        this.organizations = organizations;
      });
  }

  /**
   * EDIT-ONLY since the 2026-08-19 restructure (user decision): new coaches
   * are created exclusively from the Summit screen's agenda dialogs
   * ("+ Add new coach to this event" - coach-quick-create-dialog); this
   * roster exists to maintain the fuller profile (photo/bio/organization)
   * afterward, so it deliberately has no New action EVEN FOR someone holding
   * the add grant. That is why this overrides rather than relying on the
   * base's permission-gated default.
   * @return {ListHeaderAction[]} Always empty.
   */
  protected override buildHeaderActions(): ListHeaderAction[] {
    return [];
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  organizationName(item: CoachModel): string {
    return organizationNameOf(item, this.organizations);
  }
}
