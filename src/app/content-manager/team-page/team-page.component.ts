import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil, tap } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ImpactTeamMemberModel } from 'src/app/common/models/domain/impact-team-member.model';
import { ImpactTeamService } from 'src/app/common/services/data/impact-team.service';
import { OrganizationModel } from 'src/app/common/models/domain/organization.model';
import { OrganizationService } from 'src/app/common/services/data/organization.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { TeamPageDialogComponent } from './team-page-dialog.component';

// Split off Coaches (2026-08) - this collection (`impact_team`) is the
// public-facing half of what used to be one shared `coaches` collection:
// whoever appears on the site's own "My Team" page, administered here
// under Web Manager since that's who owns public site content, rather than
// Events Manager where breakout-only instructors stay (see
// coaches.component.ts's own updated header comment). An Impact Team
// member can still be picked as a breakout instructor - see
// course-dialog.component.ts's combined Coaches + Impact Team picker -
// this split only changes who maintains the record, not where it can be
// used. See MIGRATION.md for the one-time move out of `coaches` (anyone
// who had teamPageSortOrder set) and the follow-up needed in
// impactdisciples-web (a separate repo, not editable from here) to read
// this collection instead.
@Component({
    selector: 'app-team-page',
    templateUrl: './team-page.component.html',
    styleUrls: ['./team-page.component.scss'],
    standalone: false
})
export class TeamPageComponent implements OnInit, OnDestroy {
  members$: Observable<ImpactTeamMemberModel[]>;

  columns: DataGridColumn<ImpactTeamMemberModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'photoUrl', label: 'Photo', filterable: false, sortable: false, value: (item) => item.photoUrl?.name ?? '' },
    { key: 'sortOrder', label: 'Sort Order', type: 'number', filterable: false },
    { key: 'lastName', label: 'Last' },
    { key: 'firstName', label: 'First' },
    { key: 'title', label: 'Title' },
    { key: 'organization', label: 'Organization', value: (item) => this.organizationName(item) }
  ];

  itemType = 'Team Member';

  private readonly screenKey = 'content-manager.team-page';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<ImpactTeamMemberModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  // Kept live for organization name lookups in the list - same pattern as
  // coaches.component.ts's own organizations array.
  organizations: OrganizationModel[] = [];

  private ngUnsubscribe = new Subject<void>();

  constructor(
    private service: ImpactTeamService,
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

    this.members$ = this.service.streamAll().pipe(tap(() => this.loading$.next(false)));

    this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : [];
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  organizationName(item: ImpactTeamMemberModel): string {
    const orgId = typeof item.organization === 'string' ? item.organization : item.organization?.id;
    return this.organizations.find((o) => o.id === orgId)?.name ?? '';
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(TeamPageDialogComponent, { width: '900px', maxWidth: '95vw', data: { item: null } });
  }

  showEditModal(item: ImpactTeamMemberModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(TeamPageDialogComponent, { width: '900px', maxWidth: '95vw', data: { item } });
  }

  delete(item: ImpactTeamMemberModel): void {
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
