import { Directive } from '@angular/core';
import { FormGroup } from '@angular/forms';
import { MatDialogRef } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { BaseModel } from '@impact-common/shared/models/base.model';
import { SnackbarService } from './snackbar.service';

/** The add/edit half of an entity service - all this skeleton needs. */
export interface EntityDialogService<T> {
  add(value: T): Promise<T | undefined>;
  update(id: string, value: T): Promise<T | undefined>;
}

/**
 * The one add/edit DIALOG skeleton (sweep finding C4), the counterpart to
 * BaseListComponent's move for list screens.
 *
 * Ten dialogs carried this verbatim: a form, an inProgress$ spinner flag,
 * an isEdit flag derived the same way in all ten, a Cancel that closes
 * false, and a Save that validates, writes, reports and closes.
 *
 * WHY IT MATTERS, from this repo's own history. On 2026-08-15 a live bug
 * was diagnosed and fixed in coach-dialog.component.ts: a rejected write
 * left inProgress$ stuck true, so the spinner span forever, the dialog
 * never closed, and nothing surfaced beyond the console - indistinguishable
 * from a hang. The fix was written and commented there, and never reached
 * the other copies. Two weeks later the sweep found the same defect still
 * live in 18 of 21 places. That is the cost of a copy-pasted skeleton: not
 * that the code is long, but that a fix cannot propagate.
 *
 * DELIBERATELY NO CONSTRUCTOR. Everything the skeleton needs is declared
 * abstract and satisfied by the subclass's own constructor parameter
 * properties, so converting a dialog does not mean threading arguments
 * through a super() call, and there is no base-constructor-runs-before-
 * subclass-field-initializer ordering trap to fall into (which this repo
 * has already been bitten by - see CLAUDE.md on mixing inject() and
 * constructor DI).
 *
 * To convert a dialog: extend this, drop its own form / inProgress$ /
 * isEdit / onCancel / onSave, widen its `service` / `dialogRef` /
 * `snackbar` constructor params from `private` to `protected`, and make
 * `itemType` public. Override buildValue() if the dialog contributes a
 * field the form does not hold.
 */
@Directive()
export abstract class BaseEntityDialogComponent<T extends BaseModel> {
  /** Singular display name used in the save snackbar, e.g. 'Coupon'. */
  abstract readonly itemType: string;

  protected abstract readonly service: EntityDialogService<T>;
  protected abstract readonly dialogRef: MatDialogRef<unknown, boolean>;
  protected abstract readonly snackbar: SnackbarService;
  /** MAT_DIALOG_DATA. `item` is null when adding. */
  protected abstract readonly data: { item: T | null };

  /** Built by the subclass's constructor. */
  form!: FormGroup;

  readonly inProgress$ = new BehaviorSubject<boolean>(false);

  /**
   * Editing an existing record rather than adding one.
   *
   * Keyed on the id, not on the item being present: every one of the ten
   * dialogs this replaced wrote `!!data.item?.id`, because a dialog can be
   * handed a pre-filled but unsaved item.
   */
  get isEdit(): boolean {
    return !!this.data?.item?.id;
  }

  /**
   * The record to write. Override when the dialog owns a field the form
   * does not - an uploaded image URL, say - and call super.buildValue().
   */
  protected buildValue(): T {
    return { ...(this.data.item ?? {}), ...this.form.value } as T;
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const value = this.buildValue();
    const request = this.isEdit
      ? this.service.update(value.id!, value)
      : this.service.add(value);

    request
      .then((result) => {
        if (result) {
          this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
          this.dialogRef.close(true);
          return;
        }
        // A falsy result is a write that did not happen. The dialog stays
        // open so the work is not lost.
        this.inProgress$.next(false);
        this.snackbar.somethingWentWrong();
      })
      .catch((err) => {
        // THE POINT OF THIS CLASS. Without this branch a rejected write
        // leaves inProgress$ true forever: spinner spinning, dialog stuck,
        // nothing on screen. See the class comment for how long that bug
        // survived across the copies.
        console.error(this.itemType + ' save failed', err);
        this.inProgress$.next(false);
        this.snackbar.somethingWentWrong();
      });
  }
}
