import { Directive, OnInit } from '@angular/core';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { ComponentType } from '@angular/cdk/portal';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { BaseService } from 'src/app/common/services/data/base.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { ConfirmService } from './confirm-dialog/confirm.service';
import { SnackbarService } from './snackbar.service';
import { ListHeaderAction } from './list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from './data-grid/data-grid.model';

/**
 * The one CRUD "list screen" skeleton (2026-08-20 refactor sweep) that
 * Coupons, Product Categories, Product Series, Sales, Testimonials, DMMs,
 * Home Page Images, Podcast Categories... each used to carry verbatim: a
 * live `streamAll()` over the collection with the house-rule spinner until
 * the first emission, a permission-gated "New" header action, a
 * permission-gated delete row action with the standard confirm + snackbar,
 * and add/edit via one dialog component fed `{ item }`.
 *
 * Subclasses declare the data (`itemType`, `screenKey`, `columns`,
 * `dialogComponent`, optional `dialogConfig`) and pass their entity service
 * to `super(...)`; their templates bind `<app-data-grid [rows]="(items$ |
 * async) ?? []" [loading]="(loading$ | async) ?? false" ...>` exactly as
 * before. Anything a screen does beyond this (extra actions, custom
 * loading, non-dialog editing) stays in the subclass - override
 * `loadItems()`, `rowActions`, or the modal methods as needed. Plain
 * constructor injection on purpose (house style - see CLAUDE.md).
 */
@Directive()
export abstract class BaseListComponent<T extends BaseModel> implements OnInit {
  /** Singular display name used in the grid title and snackbars, e.g. 'Coupon'. */
  abstract readonly itemType: string;
  /** NAV_CONFIG screen key the permission checks use. */
  protected abstract readonly screenKey: string;
  abstract readonly columns: DataGridColumn<T>[];
  /** The add/edit dialog, opened with `data: { item }` (null = new). */
  protected abstract readonly dialogComponent: ComponentType<unknown>;
  protected readonly dialogConfig: MatDialogConfig = { width: '600px' };

  items$!: Observable<T[]>;

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  readonly loading$ = new BehaviorSubject<boolean>(true);

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<T>[] = [
    {
      icon: 'delete',
      tooltip: 'DELETE',
      onClick: (item) => this.delete(item),
      visible: () => this.permissionService.canDelete(this.screenKey),
    },
  ];

  constructor(
    protected readonly service: BaseService<T>,
    protected readonly permissionService: PermissionService,
    protected readonly dialog: MatDialog,
    protected readonly confirmService: ConfirmService,
    protected readonly snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.items$ = this.loadItems();
    this.headerActions = this.permissionService.canAdd(this.screenKey)
      ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }]
      : [];
  }

  /** The live list; override for screens that need an ordered/filtered query. */
  protected loadItems(): Observable<T[]> {
    return this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(this.dialogComponent, { ...this.dialogConfig, data: { item: null } });
  }

  showEditModal(item: T): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(this.dialogComponent, { ...this.dialogConfig, data: { item } });
  }

  delete(item: T): void {
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
