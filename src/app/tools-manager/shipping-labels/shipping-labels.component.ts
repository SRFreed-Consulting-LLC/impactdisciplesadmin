import { Component, OnDestroy, OnInit } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil, tap } from 'rxjs';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ShippingLabelBatchRequest, ShippingLabelRequest } from '@impact-common/shared/models/domain/shipment-label-batch-request.model';
import { ShippingFromAddress } from '@impact-common/shared/models/domain/shipment.model';
import { ShippingLabelBatchService } from 'src/app/common/services/data/shipping-label-batch.service';
import { ShippingLabelService } from 'src/app/common/services/data/shipping-label.service';
import { WebConfigService } from 'src/app/common/services/data/web-config.service';
import { AdminAuthService } from 'src/app/common/forms/admin/admin-auth.service';
import { PermissionService } from 'src/app/common/services/permission.service';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { environment } from 'src/environments/environment';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { ShippingLabelDialogComponent } from './shipping-label-dialog.component';

// Full-page in-place edit view (mode: 'list' | 'edit', no popup - see
// products.component.ts for the established precedent this mirrors)
// replacing the old ShippingBatchDialogComponent, which is folded into this
// component's edit-mode state below. Its two nested dialogs
// (FromAddressDialogComponent, ShippingResultsDialogComponent) are gone too
// - "Return Address" and "Generate" are now steps 2 and 3 of the wizard
// itself rather than popups launched from within a popup; the live
// labelService.streamAllByValue() already reflects each recipient's
// rated/purchased status in place, so there's no separate "results" view to
// build. ShippingLabelDialogComponent (add/edit ONE recipient) stays a
// small popup - that's still the right size for a single-record edit even
// inside a full-screen host, same as e.g. Products' "Manage Categories".
@Component({
    selector: 'app-shipping-labels',
    templateUrl: './shipping-labels.component.html',
    styleUrls: ['./shipping-labels.component.css'],
    standalone: false
})
export class ShippingLabelsComponent implements OnInit, OnDestroy {
  mode: 'list' | 'edit' = 'list';

  // ---- List state ----
  batches$: Observable<ShippingLabelBatchRequest[]>;

  columns: DataGridColumn<ShippingLabelBatchRequest>[] = [
    { key: 'createdDate', label: 'Created Date', type: 'date' },
    { key: 'createdBy', label: 'Created By' },
    { key: 'id', label: 'Id' }
  ];

  // House rule: loading spinner shown until first emission - see
  // contacts.component.ts for the full explanation.
  loading$ = new BehaviorSubject<boolean>(true);

  itemType = 'Shipping Label Batch';

  private readonly screenKey = 'tools-manager.shipping-labels';

  headerActions: ListHeaderAction[] = [];
  rowActions: DataGridRowAction<ShippingLabelBatchRequest>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.deleteBatch(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  // ---- Edit state: the 3-step batch wizard ----
  batch: ShippingLabelBatchRequest;
  step = 0;

  labels$: Observable<ShippingLabelRequest[]>;
  labelsLoading$ = new BehaviorSubject<boolean>(true);
  // Kept in sync from labels$ (rather than read via async pipe everywhere)
  // - both the Step 1 "Next" gating and the summary panel need this as a
  // plain number, not an Observable.
  recipientCount = 0;
  // True once this batch has ever had a rate/purchase attempt on any
  // recipient (a real Firestore fact, re-derived from labels$ - not reset
  // by leaving and reopening the batch) OR the instant "Generate Labels" is
  // clicked, for immediate summary-panel feedback before the round trip
  // completes.
  hasGenerated = false;

  labelColumns: DataGridColumn<ShippingLabelRequest>[] = [
    { key: 'name', label: 'Name', value: (item) => item.request?.shipment?.shipTo?.name },
    { key: 'address', label: 'Address', value: (item) => item.request?.shipment?.shipTo?.addressLine1 },
    { key: 'city', label: 'City', value: (item) => item.request?.shipment?.shipTo?.cityLocality },
    { key: 'state', label: 'State', value: (item) => item.request?.shipment?.shipTo?.stateProvince },
    { key: 'country', label: 'Country', value: (item) => item.request?.shipment?.shipTo?.countryCode },
    { key: 'zip', label: 'Zip', value: (item) => item.request?.shipment?.shipTo?.postalCode },
    { key: 'ounces', label: 'Ounces', value: (item) => item.request?.weight },
    { key: 'status', label: 'Status' },
    { key: 'shippingRate', label: 'Shipping Rate', type: 'currency' }
  ];

  labelRowActions: DataGridRowAction<ShippingLabelRequest>[] = [
    { icon: 'download', tooltip: 'DOWNLOAD SHIPPING LABEL', onClick: (item) => this.getShippingLabel(item), visible: (item) => this.isDownloadVisible(item) },
    { icon: 'edit', tooltip: 'EDIT', onClick: (item) => this.showEditModal(item), visible: () => this.permissionService.canEdit(this.screenKey) },
    { icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.deleteLabel(item), visible: () => this.permissionService.canDelete(this.screenKey) }
  ];

  addressForm: FormGroup;

  // 2-letter codes (this screen posts directly to a real shipping carrier
  // API, which requires 2-letter state/country codes) - a different array
  // shape than the rest of the app's state/country dropdowns.
  states: { key: string; value: string }[] = EnumHelper.getState2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));
  countries: { key: string; value: string }[] = EnumHelper.getCountry2LetterTypesAsArray().map((entry: [string, string]) => ({ key: entry[0], value: entry[1] }));

  inProgress$ = new BehaviorSubject<boolean>(false);
  spinnerVisible = false;

  private ngUnsubscribe = new Subject<void>();
  // Was read fresh via authService.getLoggedInUser().email - see
  // events.component.ts for the full explanation (a stale/expired role
  // cookie throwing on a valid Firebase session).
  private currentUserEmail?: string;

  constructor(
    private batchService: ShippingLabelBatchService,
    private labelService: ShippingLabelService,
    private webConfigService: WebConfigService,
    private authService: AdminAuthService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
  ) {}

  ngOnInit(): void {
    this.authService.dao.loggedInUser$.pipe(takeUntil(this.ngUnsubscribe)).subscribe((user) => {
      this.currentUserEmail = user?.email;
    });

    this.batches$ = this.batchService.streamAll().pipe(tap(() => this.loading$.next(false)));

    this.headerActions = this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.addBatch() }] : [];
  }

  ngOnDestroy(): void {
    this.ngUnsubscribe.next();
    this.ngUnsubscribe.complete();
  }

  addBatch(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    const batchRequest: ShippingLabelBatchRequest = {
      ...new ShippingLabelBatchRequest(),
      createdDate: new Date(),
      createdBy: this.currentUserEmail!
    };

    this.batchService.add(batchRequest).then((batch) => {
      this.openBatch(batch);
    });
  }

  editBatch(batch: ShippingLabelBatchRequest): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.openBatch(batch);
  }

  // ---- Step 1: Add Recipients ----

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.dialog.open(ShippingLabelDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: { item: null, batchId: this.batch.id }
    });
  }

  showEditModal(item: ShippingLabelRequest): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.dialog.open(ShippingLabelDialogComponent, {
      width: '700px',
      maxWidth: '95vw',
      data: { item, batchId: this.batch.id }
    });
  }

  deleteLabel(item: ShippingLabelRequest): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.labelService.delete(item.id!).then(() => {
          this.snackbar.success('Shipping Label Deleted');
        });
      }
    });
  }

  // ---- Step 2: Add a Return Address ----

  // Saves and advances in one step (mirrors the old FromAddressDialogComponent's
  // onSave(), minus the dialog) - "Next" out of this step IS the save.
  saveFromAddressAndAdvance(): void {
    if (this.addressForm.invalid) {
      this.addressForm.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const shipFrom: ShippingFromAddress = { ...new ShippingFromAddress(), ...this.addressForm.value };
    const value: ShippingLabelBatchRequest = { ...this.batch, shipFrom };

    this.batchService.update(this.batch.id!, value).then((result) => {
      this.inProgress$.next(false);
      if (result) {
        this.batch = result;
        this.snackbar.success('Return Address Saved');
        this.step = 2;
      } else {
        this.snackbar.error('Some Error Occured');
      }
    }).catch((err) => {
      // Stop-gap (sweep finding C4, 2026-08-27). The next(false) above runs
      // only on RESOLVE, so a rejected write left inProgress$ stuck true: the
      // spinner span forever on step 1 and the wizard never advanced, with
      // nothing beyond the console. coach-dialog.component.ts fixed and
      // documented exactly this on 2026-08-15.
      console.error('Return address save failed', err);
      this.inProgress$.next(false);
      this.snackbar.error('Some Error Occured');
    });
  }

  // ---- Step 3: Generate the Labels ----

  isDownloadVisible(item: ShippingLabelRequest): boolean {
    return (item?.shippingRate ?? 0) > 0;
  }

  private downloadShippingLabel(pdf: string): void {
    const link = document.createElement('a');
    link.setAttribute('target', '_blank');
    link.setAttribute('href', pdf);
    link.setAttribute('download', 'shippinglabel.pdf');
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  getShippingLabel = async (item: ShippingLabelRequest) => {
    this.spinnerVisible = true;

    if (!item.shippingLabel) {
      const idToken = await this.authService.dao.auth.currentUser?.getIdToken();

      const request = await fetch(environment.shippingLabelUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ shipId: item.shippingRateId.rateId })
      });

      const response = await request.json();

      if (response.code == 400) {
        this.snackbar.error(response.error.message);

        item.message = response.error.message;
        item.status = 'FAILED';
        item.shippingLabel = response;
        await this.labelService.update(item.id!, item);

        this.spinnerVisible = false;
      } else {
        item.shippingLabel = response;
        item.status = 'PURCHASED';
        item.purchasedDate = new Date();

        await this.labelService.update(item.id!, item).then((saved) => {
          this.downloadShippingLabel(saved.shippingLabel.labelDownload.pdf);
        });

        this.spinnerVisible = false;
      }
    } else {
      if (item.shippingLabel?.code) {
        this.snackbar.error(item.shippingLabel.error.message);
        this.spinnerVisible = false;
      } else {
        this.downloadShippingLabel(item.shippingLabel.labelDownload.pdf);
        this.spinnerVisible = false;
      }
    }
  };

  generateShippingLabels(): void {
    if (!this.batch.shipFrom) {
      this.snackbar.error('Please verify the return address is correct before generating Shipping Labels');
      return;
    }

    this.confirmService.confirm('<i>Are you sure you want to create these Shipping Labels?</i>', 'Confirm').then((confirmed) => {
      if (!confirmed) {
        return;
      }

      this.spinnerVisible = true;
      this.hasGenerated = true;

      this.labelService.getAllByValue('batchId', this.batch.id).then((labels) => {
        const promises = labels
          .filter((label) => label.status == 'NEW' || label.status == 'FAILED')
          .map((label) => {
            label.request.shipment.shipFrom = this.batch.shipFrom;
            return this.labelService.createRequest(label);
          });

        // No separate results dialog to open - labels$ is a live stream
        // (streamAllByValue), so the Step 1/3 grid's Status/Message/
        // Shipping Rate columns update in place as each createRequest()
        // call writes its result back to Firestore.
        Promise.all(promises).then(() => {
          this.spinnerVisible = false;
        });
      });
    });
  }

  // ---- Wizard shell ----

  // Backs the Batch Summary panel's "Labels generated" line.
  generatedSummary(labels: ShippingLabelRequest[]): string {
    const rated = labels.filter((label) => label.status === 'CREATED' || label.status === 'PURCHASED').length;
    const failed = labels.filter((label) => label.status === 'FAILED').length;
    const parts: string[] = [];
    if (rated) {
      parts.push(rated + ' rated');
    }
    if (failed) {
      parts.push(failed + ' failed');
    }
    return parts.length ? parts.join(', ') : 'Pending…';
  }

  goToStep(step: number): void {
    this.step = step;
  }

  onClose(): void {
    this.mode = 'list';
  }

  private openBatch(batch: ShippingLabelBatchRequest): void {
    this.batch = batch;
    this.step = 0;
    this.hasGenerated = false;
    this.recipientCount = 0;
    this.labelsLoading$.next(true);

    this.labels$ = this.labelService.streamAllByValue('batchId', this.batch.id).pipe(
      tap((labels) => {
        this.recipientCount = labels.length;
        this.hasGenerated = this.hasGenerated || labels.some((label) => label.status !== 'NEW');
        this.labelsLoading$.next(false);
      })
    );

    this.buildAddressForm();
    this.mode = 'edit';
  }

  private buildAddressForm(): void {
    this.addressForm = this.fb.group({
      name: [this.batch.shipFrom?.name ?? '', Validators.required],
      addressLine1: [this.batch.shipFrom?.addressLine1 ?? '', Validators.required],
      cityLocality: [this.batch.shipFrom?.cityLocality ?? '', Validators.required],
      stateProvince: [this.batch.shipFrom?.stateProvince ?? 'GA', Validators.required],
      postalCode: [this.batch.shipFrom?.postalCode ?? '', Validators.required],
      countryCode: [this.batch.shipFrom?.countryCode ?? 'US', Validators.required],
      phone: [this.batch.shipFrom?.phone ?? '', Validators.required]
    });

    // First time through this batch (no return address saved on it yet) -
    // prefill from the org's own configured address, same defaulting the
    // original "SET FROM ADDRESS" button did, rather than leave it blank.
    if (!this.batch.shipFrom) {
      this.webConfigService.getAll().then((configs) => {
        if (this.batch.shipFrom || !configs[0]) {
          return;
        }
        this.addressForm.patchValue({
          name: 'Impact Disciples',
          phone: configs[0].phone,
          addressLine1: configs[0].address.address1,
          cityLocality: configs[0].address.city,
          postalCode: configs[0].address.zip
        });
      });
    }
  }

  deleteBatch(batch: ShippingLabelBatchRequest): void {
    if (!this.permissionService.canDelete(this.screenKey)) {
      return;
    }
    this.confirmService.confirm('<i>Are you sure you want to delete this batch?</i>', 'Confirm').then((confirmed) => {
      if (confirmed) {
        this.labelService.getAllByValue('batchId', batch.id).then((labels) => {
          Promise.all(labels.map((label) => this.labelService.delete(label.id!))).then(() => {
            this.batchService.delete(batch.id!).then(() => {
              this.snackbar.success(this.itemType + ' Deleted');
            });
          });
        });
      }
    });
  }
}
