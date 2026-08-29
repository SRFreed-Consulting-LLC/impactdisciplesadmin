import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ImpactTeamMemberModel } from '@impact-common/shared/models/domain/impact-team-member.model';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { OrganizationModel } from '@impact-common/shared/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { DataGridColumn } from '../../shared/data-grid/data-grid.model';
import { BaseListComponent } from '../../shared/base-list.component';
import { organizationNameOf } from '../../shared/organization-name.util';
import { TeamPageDialogComponent } from './team-page-dialog.component';

// The public "My Team" page's roster, split out of `coaches` in 2026-08 when
// one record was found to be serving two unrelated purposes: breakout
// instructor AND public team member. This half owns the public-facing one
// and lives in Content Manager because that area owns public site content;
// the `impact_team` collection is its own.
//
// Structurally a twin of Events Manager > Coaches, and both extend
// BaseListComponent (2026-08-28, sweep P4) - but SEPARATELY, not as one
// shared component. Different collections, and Coaches is deliberately
// edit-only while this screen has a normal New.
@Component({
    selector: 'app-team-page',
    templateUrl: './team-page.component.html',
    styleUrls: ['./team-page.component.scss'],
    standalone: false
})
export class TeamPageComponent extends BaseListComponent<ImpactTeamMemberModel>
  implements OnInit, OnDestroy {
  readonly itemType = 'Team Member';
  protected readonly screenKey = 'page-manager.team-page';
  protected readonly dialogComponent = TeamPageDialogComponent;
  protected override readonly dialogConfig = { width: '1150px', maxWidth: '95vw' };

  readonly columns: DataGridColumn<ImpactTeamMemberModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'photoUrl', label: 'Photo', filterable: false, sortable: false, value: (item) => item.photoUrl?.name ?? '' },
    { key: 'sortOrder', label: 'Sort Order', type: 'number', filterable: false },
    { key: 'lastName', label: 'Last' },
    { key: 'firstName', label: 'First' },
    { key: 'title', label: 'Title' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) }
  ];

  organizations: OrganizationModel[] = [];

  /** The template still binds `members$`; the base owns it as `items$`. */
  get members$() {
    return this.items$;
  }

  private ngUnsubscribe = new Subject<void>();

  constructor(
    service: ImpactTeamService,
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

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  organizationName(item: ImpactTeamMemberModel): string {
    return organizationNameOf(item, this.organizations);
  }
}
