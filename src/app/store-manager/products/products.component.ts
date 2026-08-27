import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ProductModel } from '@impact-common/shared/models/utils/product.model';
import { ProductService } from 'src/app/common/services/data/product.service';
import { TagModel } from '@impact-common/shared/models/domain/tag.model';
import { ProductTagsService } from 'src/app/common/services/data/product-tags.service';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { SeriesModel } from '@impact-common/shared/models/utils/series.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { LibraryBookModel } from 'src/app/common/models/domain/library/library-book.model';
import { LibraryBookService } from 'src/app/common/services/data/library/library-book.service';
import { EnumHelper } from '@impact-common/shared/utils/enum_helper';
import { ImageModel } from '@impact-common/shared/models/utils/image.model';
import { PermissionService } from 'src/app/common/services/permission.service';
import { EmailTemplateEditorService } from 'src/app/common/services/email-template-editor.service';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { ProductCategoriesComponent } from '../product-categories/product-categories.component';
import { ProductSeriesComponent } from '../product-series/product-series.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';
import { SALES_RECEIPT_TEMPLATE_NAME } from 'src/app/common/services/data/purchases.service';

@Component({
    selector: 'app-products',
    templateUrl: './products.component.html',
    styleUrls: ['./products.component.scss'],
    standalone: false
})
export class ProductsComponent implements OnInit {
  // No route/URL involved on purpose - same "full in-page editor, no
  // popup" treatment as Home Page Popups (content-manager), chosen here
  // because this is the densest form in the app (~23 fields across 3
  // tabs) and benefits the most from the full viewport width/height a
  // dialog can't give it.
  mode: 'list' | 'edit' = 'list';

  // ---- List state ----
  columns: DataGridColumn<ProductModel>[] = [
    { key: 'isActive', label: 'Live', filterable: false, sortFn: (a, b) => Number(a.isActive) - Number(b.isActive) },
    { key: 'imageUrl', label: 'Image', filterable: false, sortable: false },
    { key: 'title', label: 'Title' },
    { key: 'cost', label: 'Cost', type: 'currency' },
    { key: 'salePrice', label: 'Sale Price', type: 'currency' },
    { key: 'category', label: 'Category', value: (item) => this.categoryName(item) },
    { key: 'series', label: 'Series', value: (item) => this.seriesName(item) },
    { key: 'isEBook', label: 'eBook', value: (item) => (item.isEBook ? 'Yes' : 'No') },
    { key: 'isDigitalBook', label: 'Digital Book', value: (item) => (item.isDigitalBook ? 'Yes' : 'No') }
  ];

  itemType = 'Product';

  private readonly screenKey = 'store-manager.products';

  headerActions: ListHeaderAction[] = [];

  rowActions: DataGridRowAction<ProductModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item), visible: () => this.permissionService.canDelete(this.screenKey) }];

  paged: PagedCollectionSource<ProductModel>;

  // One-time getAll() fetches, not live streamAll() subscriptions - these
  // are small reference collections that rarely change mid-session, and
  // one-time getDocs()-backed reads avoid opening 5 standing onSnapshot
  // listeners for data that's only read when the screen loads.
  // Trade-off: adding a category/series via "Manage Categories"/"Manage
  // Series" while this screen is open no longer shows up here until the
  // next reload - acceptable for reference data that changes rarely, not
  // worth reintroducing 5 standing listeners to avoid.
  categories: TagModel[] = [];
  series: SeriesModel[] = [];

  // ---- Edit state ----
  form: FormGroup;
  inProgress$ = new BehaviorSubject<boolean>(false);
  isEdit = false;
  richTextModules = RICH_TEXT_TOOLBAR;

  productTags: TagModel[] = [];
  books: LibraryBookModel[] = [];
  emails: { id: string; name: string }[] = [];
  uoms: string[] = EnumHelper.getUOMTypesAsArray();

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  isEBookUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs the two image fields directly, same pattern as every other
  // migrated image-uploader call site (see home-page-image-dialog.component.ts).
  card: { imageUrl?: ImageModel; eBookUrl?: ImageModel } = {};

  /**
   * Whether the Store preview panel is collapsed, remembered across visits -
   * this editor is the densest form in the app and someone working through a
   * batch of products shouldn't have to re-collapse the panel every time.
   * A private window (or storage the browser blocks) just starts expanded.
   */

  private static readonly PREVIEW_COLLAPSED_KEY = 'products.previewCollapsed';



  /**
   * What the storefront would render for the product as currently edited.
   *
   * Read straight off the live form (and `card` for the image, which the
   * uploader writes to rather than to a control), so the preview tracks
   * typing without a subscription.
   */
  get preview(): {
    title: string;
    cost: number;
    salePrice: number;
    imageUrl?: string;
    onSale: boolean;
  } {
    const cost = Number(this.form?.get('cost')?.value ?? 0) || 0;
    const salePrice = Number(this.form?.get('salePrice')?.value ?? 0) || 0;
    return {
      title: (this.form?.get('title')?.value ?? '').trim(),
      cost,
      salePrice,
      imageUrl: this.card.imageUrl?.url,
      // Matches the storefront's own test exactly (`salePrice > 0`), so the
      // preview can't disagree with the real card about whether a product
      // reads as discounted.
      onSale: salePrice > 0,
    };
  }

  /**
   * Why this product wouldn't appear in the Store, if it wouldn't.
   *
   * Two different switches, and they mean different things. `isActive` is
   * whether the product is live at all - off means it exists nowhere.
   * `showInStore` is on by default and only withholds it from the store, for
   * a product that should be available elsewhere but not sold there; that is
   * a deliberate setup rather than a mistake, so it's stated plainly instead
   * of warned about.
   *
   * Worth saying at all because the two live on different tabs of this form,
   * so an admin can otherwise build a perfect-looking card no shopper sees.
   */
  get previewHiddenReason(): string | null {
    if (!this.form) {
      return null;
    }
    const isActive = this.form.get('isActive')?.value === true;
    const showInStore = this.form.get('showInStore')?.value === true;
    if (!isActive) {
      return showInStore
        ? 'This product is not live - use the Live toggle in the header.'
        : 'This product is not live, and is set not to show in the Store.';
    }
    if (!showInStore) {
      return 'Live, but deliberately kept out of the Store - see Show In Store in the Organization section.';
    }
    return null;
  }

  private editingItem: ProductModel | null = null;

  get canEditFollowUpEmail(): boolean {
    return !!this.form.get('followUpEmailId')?.value && this.templateEditor.canEdit();
  }

  editFollowUpEmail(): void {
    const id = this.form.get('followUpEmailId')?.value as string | null;
    if (id) {
      void this.templateEditor.openById(id, { from: 'product' });
    }
  }

  /**
   * The "Select Email" list: templates of kind 'product' ONLY.
   *
   * It used to be getAll() - every template in the collection, campaign
   * starting points and order receipts alike, none of which is a plausible
   * post-purchase follow-up. Filtering by kind is what makes this a list of
   * follow-up emails rather than a list of every email that exists.
   */
  private loadFollowUpEmails(select?: string): void {
    void this.emailTemplatesService.getAllOfKind('product').then((templates) => {
      this.emails = templates.map((t) => ({ id: t.id!, name: t.name }));
      if (select) {
        this.form.get('followUpEmailId')?.setValue(select);
      }
    });
  }

  get canCreateFollowUpEmail(): boolean {
    return this.templateEditor.canEdit();
  }

  get canEditSalesReceipt(): boolean {
    return this.templateEditor.canEdit();
  }

  /** The receipt the checkout Cloud Function sends for every web order,
   *  resolved by the literal name below - which is why it is addressed the
   *  same way here rather than by id. */
  editSalesReceipt(): void {
    void this.templateEditor.openByName(SALES_RECEIPT_TEMPLATE_NAME, { from: 'store' });
  }

  /**
   * Creating a follow-up email from the screen that uses them.
   *
   * Necessary rather than convenient: templates of kind 'product' are hidden
   * from Tools Manager > System Templates, which is where "New Email Design"
   * lives - so without this the list could never gain a second entry. The
   * designer is told the kind up front so what it saves comes back here.
   */
  createFollowUpEmail(): void {
    if (!this.canCreateFollowUpEmail) {
      return;
    }
    this.templateEditor.createNew('product', { from: 'product' });
  }

  constructor(
    private service: ProductService,
    private productTagService: ProductTagsService,
    private productCategoriesService: ProductCategoriesService,
    private seriesService: SeriesService,
    private emailTemplatesService: EMailTemplatesService,
    private bookService: LibraryBookService,
    private permissionService: PermissionService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService,
    // Last, so existing positional construction in the spec still lines up.
    private templateEditor: EmailTemplateEditorService
  ) {
    this.paged = new PagedCollectionSource<ProductModel>(
      (pageSize, cursor) => this.service.getPage(pageSize, cursor, 'title', 'asc'),
      50
    );
  }

  ngOnInit(): void {
    this.productCategoriesService.getAll().then((categories) => {
      this.categories = categories;
    });
    this.seriesService.getAll().then((series) => {
      this.series = series;
    });
    this.productTagService.getAll().then((tags) => {
      this.productTags = tags;
    });
    this.bookService.getAll().then((books) => {
      this.books = books;
    });
    this.loadFollowUpEmails();

    // Each page already comes back ordered by title asc from Firestore, and
    // pages are appended in fetch order - no client-side re-sort needed.
    this.paged.loadFirstPage();

    this.headerActions = [
      ...(this.permissionService.canAdd(this.screenKey) ? [{ label: 'New', icon: 'add', onClick: () => this.showAddModal() }] : []),
      // Categories/Series management is reference-data upkeep for this
      // screen, not a separate registry entry - gated by edit rather than
      // add/view since it's mutating shared lookup data, not this list.
      ...(this.permissionService.canEdit(this.screenKey) ? [{ label: 'Categories', icon: 'view_list', onClick: () => this.manageCategories() }] : []),
      ...(this.permissionService.canEdit(this.screenKey) ? [{ label: 'Series', icon: 'collections_bookmark', onClick: () => this.manageSeries() }] : []),
      // The order receipt is STORE-WIDE configuration, so it belongs to the
      // store rather than to any one product or order. It used to be edited
      // from a purchase's details, which reads backwards: the receipt is
      // queued in the same request that writes the purchase, so by the time
      // an order exists to open, its receipt has already gone. Here it is
      // reachable before there is anything to send.
      ...(this.canEditSalesReceipt ? [{ label: 'Order Receipt', icon: 'mail', onClick: () => this.editSalesReceipt() }] : [])
    ];
  }

  categoryName(item: ProductModel): string {
    return this.categories.find((c) => c.id === item.category)?.tag ?? '';
  }

  seriesName(item: ProductModel): string {
    return this.series.find((s) => s.id === item.series)?.name ?? '';
  }

  manageCategories(): void {
    this.dialog.open(ProductCategoriesComponent, { width: '600px' });
  }

  manageSeries(): void {
    this.dialog.open(ProductSeriesComponent, { width: '700px' });
  }

  delete(item: ProductModel): void {
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

  // ---- Edit view ----

  showAddModal(): void {
    if (!this.permissionService.canAdd(this.screenKey)) {
      return;
    }
    this.editingItem = null;
    this.isEdit = false;
    this.card = {};
    this.buildForm(null);
    this.mode = 'edit';
  }

  showEditModal(item: ProductModel): void {
    if (!this.permissionService.canEdit(this.screenKey)) {
      return;
    }
    this.editingItem = item;
    this.isEdit = true;
    this.card = { imageUrl: item.imageUrl, eBookUrl: item.eBookUrl };
    this.buildForm(item);
    this.mode = 'edit';
  }

  private buildForm(item: ProductModel | null): void {
    this.form = this.fb.group({
      isActive: [item?.isActive ?? false],
      // Dimensions
      weight: [item?.weight ?? null, Validators.required],
      uom: [item?.uom ?? null, Validators.required],
      sizes: [this.toChips(item?.sizes)],
      colors: [this.toChips(item?.colors)],
      languages: [this.toChips(item?.languages)],
      // Details
      title: [item?.title ?? '', Validators.required],
      cost: [item?.cost ?? 0, Validators.required],
      // Campaign Manager v3: campaigns own discounts, so this is a computed
      // display value rather than an input. Not disabled - a disabled control
      // is omitted from form.value, which would drop the field on every save.
      salePrice: [{ value: item?.salePrice ?? 0, disabled: false }],
      isEBook: [item?.isEBook ?? false],
      isDigitalBook: [item?.isDigitalBook ?? false],
      digitalBookId: [item?.digitalBookId ?? null],
      description: [item?.description ?? '', Validators.required],
      sendFollowUpEmail: [item?.sendFollowUpEmail ?? false],
      followUpEmailId: [item?.followUpEmailId ?? null],
      // Organization
      category: [item?.category ?? null, Validators.required],
      categoryOrder: [item?.categoryOrder ?? null],
      series: [item?.series ?? null],
      seriesOrder: [item?.seriesOrder ?? null],
      // Defaults to TRUE, and absence means true. Both the website store and
      // the reader's in-app store list a product when `showInStore !== false`
      // - absent counts as shown - so defaulting the checkbox to false was
      // actively harmful: opening any product saved before this field had an
      // editor rendered it unchecked, and saving then wrote a real `false`
      // and pulled the product from the store without anyone asking for it.
      // `isActive` is the switch for whether a product is live at all; this
      // one only withholds it from the store, for a product that should exist
      // elsewhere but not be sold there.
      showInStore: [item?.showInStore ?? true],
      tags: [item?.tags ?? []]
    });
  }

  showImageUploader(): void {
    this.isImageUploaderVisible$.next(true);
  }

  closeImageUploader(): void {
    this.isImageUploaderVisible$.next(false);
  }

  showEBookUploader(): void {
    this.isEBookUploaderVisible$.next(true);
  }

  closeEBookUploader(): void {
    this.isEBookUploaderVisible$.next(false);
  }

  // sizes/colors/languages have no persisted lookup collection of their own
  // (confirmed: the original only ever built their suggestion lists
  // in-memory, from whatever had already been typed this session) - so
  // "creating" one of these just means adding the chip locally, no service
  // call, matching that original behavior exactly.
  onCreateSizeTag(text: string): void {
    this.addLocalChip('sizes', text);
  }

  onCreateColorTag(text: string): void {
    this.addLocalChip('colors', text);
  }

  onCreateLanguageTag(text: string): void {
    this.addLocalChip('languages', text);
  }

  // Product Tags is the one tag field that IS persisted (its own Firestore
  // collection) - the tag-creation pattern the removed Pod Casts dialog
  // also used.
  onCreateProductTag(text: string): void {
    const tag: TagModel = { ...new TagModel(), tag: text, id: this.generateRandomId() };
    this.productTagService.update(tag.id!, tag);
    this.productTags = [...this.productTags, tag];

    const current: TagModel[] = this.form.value.tags ?? [];
    this.form.patchValue({ tags: [...current, tag] });
  }

  onCancel(): void {
    this.inProgress$.next(false);
    this.mode = 'list';
  }

  onSave(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inProgress$.next(true);
    const raw = this.form.getRawValue();
    const value: ProductModel = {
      ...this.editingItem,
      ...raw,
      sizes: this.fromChips(raw.sizes),
      colors: this.fromChips(raw.colors),
      languages: this.fromChips(raw.languages),
      imageUrl: this.card.imageUrl,
      eBookUrl: this.card.eBookUrl
    };

    const request = this.isEdit ? this.service.update(value.id!, value) : this.service.add(value);

    request.then((result) => {
      if (result) {
        this.snackbar.success(this.itemType + (this.isEdit ? ' Updated' : ' Added'));
        this.mode = 'list';
        this.inProgress$.next(false);
      } else {
        this.inProgress$.next(false);
        this.snackbar.error('Some Error Occured');
      }
    });
  }

  // app-tag-chips works in terms of TagModel[] (it's shared with screens
  // that really do have TagModel-backed fields, e.g. Pod Casts) - sizes/
  // colors/languages are plain string[] on ProductModel itself (not
  // changing that), so these two helpers translate at the form boundary
  // only: the FormGroup holds the wrapped TagModel[] shape the chips
  // component needs, onSave() unwraps back to string[] right before it
  // reaches the service.
  private toChips(values: string[] | undefined): TagModel[] {
    return (values ?? []).map((v) => ({ tag: v }) as TagModel);
  }

  private fromChips(values: TagModel[] | undefined): string[] {
    return (values ?? []).map((t) => t.tag ?? '').filter((t) => !!t);
  }

  private addLocalChip(field: 'sizes' | 'colors' | 'languages', text: string): void {
    const current: TagModel[] = this.form.value[field] ?? [];
    if (current.some((t) => t.tag === text)) {
      return;
    }
    this.form.patchValue({ [field]: [...current, { tag: text } as TagModel] });
  }

  private generateRandomId(): string {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
