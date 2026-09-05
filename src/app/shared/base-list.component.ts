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
 *
 * NOT on this class, deliberately (judged 2026-09-05): Admin Users, Form
 * Builder and Shipping Labels. Each is a list PLUS an in-page editor or
 * wizard, and the list half is a dozen lines inside a 300-425 line
 * component with no spec - the editor is the component. Adopting the
 * skeleton would touch all of it to share almost none of it.
 */
@Directive()
export abstract class BaseListComponent<T extends BaseModel> implements OnInit {
  /** Singular display name used in the grid title and snackbars, e.g. 'Coupon'. */
  abstract readonly itemType: string;
  /**
   * NAV_CONFIG screen key the permission checks use, or `null` for a screen
   * that is NOT permission-gated in its own right.
   *
   * `null` is for the dialog-hosted sub-editors (Product Categories, Product
   * Series - opened from the Products screen's menu, no route of their own):
   * they have no NAV_CONFIG entry, and access to them is already gated by the
   * host screen you have to be on to open them. Inventing a key for those
   * would ADD gating where there is none today and could hide New/Delete from
   * staff who use them now.
   */
  protected abstract readonly screenKey: string | null;
  abstract readonly columns: DataGridColumn<T>[];
  /**
   * The add/edit dialog, opened with `data: { item }` (null = new).
   *
   * May be `undefined` since 2026-09-05: a screen that edits IN PAGE
   * (Organizations swaps the grid for a details view) declares it undefined
   * and overrides openEditor() instead. Still abstract on purpose, so "no
   * dialog" is a line the screen writes rather than a field it forgot;
   * declaring undefined WITHOUT the override is caught by openEditor() the
   * first time it is called.
   */
  protected abstract readonly dialogComponent: ComponentType<unknown> | undefined;
  protected readonly dialogConfig: MatDialogConfig = { width: '600px' };
  /**
   * What the delete confirmation asks. Override where a plain "delete this
   * record?" would understate the blast radius - Organizations warns that
   * its locations and member links are not removed with it.
   */
  protected readonly deleteConfirmMessage: string = '<i>Are you sure you want to delete this record?</i>';

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
      visible: () => this.canDeleteHere(),
    },
  ];

  /** True when this screen has no key of its own - see `screenKey`. */
  protected get ungated(): boolean {
    return this.screenKey === null;
  }

  protected canAddHere(): boolean {
    return this.ungated || this.permissionService.canAdd(this.screenKey!);
  }

  protected canEditHere(): boolean {
    return this.ungated || this.permissionService.canEdit(this.screenKey!);
  }

  /**
   * Which permission the delete action rides. Overridable because at least
   * one screen has historically gated delete on canEdit rather than
   * canDelete (Podcast Categories), and quietly "correcting" that here would
   * take the button away from anyone holding edit-without-delete.
   */
  protected canDeleteHere(): boolean {
    return this.ungated || this.permissionService.canDelete(this.screenKey!);
  }

  constructor(
    protected readonly service: BaseService<T>,
    protected readonly permissionService: PermissionService,
    protected readonly dialog: MatDialog,
    protected readonly confirmService: ConfirmService,
    protected readonly snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.items$ = this.loadItems();
    this.headerActions = this.buildHeaderActions();
  }

  /**
   * The header actions for this screen. By default, a permission-gated New.
   *
   * Override for a screen that is deliberately EDIT-ONLY - one whose records
   * are created somewhere else entirely, so a New button here would be wrong
   * even for someone holding the add grant. Coaches is the case this exists
   * for: coaches are created from the Summit agenda's quick-create dialog,
   * and the roster only maintains the fuller profile afterwards.
   * @return {ListHeaderAction[]} The actions to show in the list header.
   */
  protected buildHeaderActions(): ListHeaderAction[] {
    return this.canAddHere()
      ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }]
      : [];
  }

  /** The live list; override for screens that need an ordered/filtered query. */
  protected loadItems(): Observable<T[]> {
    return this.service.streamAll().pipe(tap(() => this.loading$.next(false)));
  }

  showAddModal(): void {
    if (!this.canAddHere()) {
      return;
    }
    this.openEditor(null);
  }

  showEditModal(item: T): void {
    if (!this.canEditHere()) {
      return;
    }
    this.openEditor(item);
  }

  /**
   * How this screen edits an item, once the permission gate has passed.
   * By default a dialog; a screen that edits in page overrides this and
   * declares no dialogComponent.
   * @param item The item to edit, or null to add.
   */
  protected openEditor(item: T | null): void {
    if (!this.dialogComponent) {
      throw new Error(`${this.itemType} list: declare dialogComponent or override openEditor()`);
    }
    this.dialog.open(this.dialogComponent, { ...this.dialogConfig, data: { item } });
  }

  delete(item: T): void {
    if (!this.canDeleteHere()) {
      return;
    }
    this.confirmService.confirm(this.deleteConfirmMessage, 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.service.delete(item.id!).then(() => {
          this.snackbar.success(this.itemType + ' Deleted');
          this.onDeleted(item);
        }).catch((err) => {
          // Until 2026-09-05 a refused delete (rules, network) showed
          // NOTHING - the same silence the dialog base class was created
          // to end, on the other half of every list screen.
          console.error(this.itemType + ' delete failed', err);
          this.snackbar.somethingWentWrong();
        });
      }
    });
  }

  /**
   * Runs after a successful delete. FAQ uses it to drop the row from the
   * event's own list as well as the library.
   * @param item The item that was deleted.
   */
  protected onDeleted(item: T): void {
    void item; // nothing by default
  }
}
