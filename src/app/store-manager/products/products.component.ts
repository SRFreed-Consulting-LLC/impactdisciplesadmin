import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { ProductModel } from 'src/app/common/models/utils/product.model';
import { ProductService } from 'src/app/common/services/data/product.service';
import { TagModel } from 'src/app/common/models/domain/tag.model';
import { ProductTagsService } from 'src/app/common/services/data/product-tags.service';
import { ProductCategoriesService } from 'src/app/common/services/data/product-categories.service';
import { SeriesModel } from 'src/app/common/models/utils/series.model';
import { SeriesService } from 'src/app/common/services/data/series.service';
import { EMailTemplatesService } from 'src/app/common/services/data/email-templates.service';
import { BookModel } from 'src/app/common/models/domain/book.model';
import { BookService } from 'src/app/common/services/data/book.service';
import { EnumHelper } from 'src/app/common/utils/enum_helper';
import { ImageModel } from 'src/app/common/models/utils/image.model';
import { ConfirmService } from '../../shared/confirm-dialog/confirm.service';
import { SnackbarService } from '../../shared/snackbar.service';
import { RICH_TEXT_TOOLBAR } from '../../shared/rich-text-editor/quill-toolbar.config';
import { ProductCategoriesComponent } from '../product-categories/product-categories.component';
import { ProductSeriesComponent } from '../product-series/product-series.component';
import { ListHeaderAction } from '../../shared/list-header/list-header.component';
import { DataGridColumn, DataGridRowAction } from '../../shared/data-grid/data-grid.model';
import { PagedCollectionSource } from '../../shared/paged-collection-source';

@Component({
    selector: 'app-products',
    templateUrl: './products.component.html',
    styleUrls: ['./products.component.scss'],
    standalone: false
})
export class ProductsComponent implements OnInit {
  // No route/URL involved on purpose - same "full in-page editor, no
  // popup" treatment as Home Page Popups (web-manager), chosen here
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

  headerActions: ListHeaderAction[] = [
    { label: 'New', icon: 'add', onClick: () => this.showAddModal() },
    { label: 'Categories', icon: 'view_list', onClick: () => this.manageCategories() },
    { label: 'Series', icon: 'collections_bookmark', onClick: () => this.manageSeries() }
  ];

  rowActions: DataGridRowAction<ProductModel>[] = [{ icon: 'delete', tooltip: 'DELETE', onClick: (item) => this.delete(item) }];

  paged: PagedCollectionSource<ProductModel>;

  // One-time getAll() fetches, not live streamAll() subscriptions - these
  // are small reference collections that rarely change mid-session, and a
  // cold load already fires this component's 5 reference-data reads plus
  // the paginated product fetch all in the same tick; that many onSnapshot
  // listeners attaching at once is exactly the WebChannel handshake race
  // documented on retryDelay() in firebase.dao.ts (occasionally exhausting
  // even the 4-attempt jittered retry there). getDocs()-backed getAll()
  // doesn't open a standing listener, so it isn't part of that race.
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
  books: BookModel[] = [];
  emails: { id: string; name: string }[] = [];
  uoms: string[] = EnumHelper.getUOMTypesAsArray();

  isImageUploaderVisible$ = new BehaviorSubject<boolean>(false);
  isEBookUploaderVisible$ = new BehaviorSubject<boolean>(false);

  // Backs the two image fields directly, same pattern as every other
  // migrated image-uploader call site (see home-page-image-dialog.component.ts).
  card: { imageUrl?: ImageModel; eBookUrl?: ImageModel } = {};

  private editingItem: ProductModel | null = null;

  constructor(
    private service: ProductService,
    private productTagService: ProductTagsService,
    private productCategoriesService: ProductCategoriesService,
    private seriesService: SeriesService,
    private emailTemplatesService: EMailTemplatesService,
    private bookService: BookService,
    private fb: FormBuilder,
    private dialog: MatDialog,
    private confirmService: ConfirmService,
    private snackbar: SnackbarService
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
    this.emailTemplatesService.getAll().then((templates) => {
      this.emails = templates.map((t) => ({ id: t.id!, name: t.name }));
    });

    // Each page already comes back ordered by title asc from Firestore, and
    // pages are appended in fetch order - no client-side re-sort needed.
    this.paged.loadFirstPage();
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
    this.editingItem = null;
    this.isEdit = false;
    this.card = {};
    this.buildForm(null);
    this.mode = 'edit';
  }

  showEditModal(item: ProductModel): void {
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
      salePrice: [item?.salePrice ?? 0, Validators.required],
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
      // Exists on the model but had no editor anywhere in the original UI -
      // there was no admin path to ever set this real, persisted field.
      showInStore: [item?.showInStore ?? false],
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
  // collection) - mirrors PodCastDialogComponent.onCreateTag exactly.
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
