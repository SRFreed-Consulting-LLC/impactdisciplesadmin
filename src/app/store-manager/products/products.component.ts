import { Component, OnInit, ViewChild } from '@angular/core';
import { DxDropDownBoxComponent, DxFormComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';
import { Observable, BehaviorSubject, map } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';
import { ProductModel } from 'impactdisciplescommon/src/models/utils/product.model';
import { ProductService } from 'impactdisciplescommon/src/services/data/product.service';
import { DxTagBoxTypes } from 'devextreme-angular/ui/tag-box';
import { TagModel } from 'impactdisciplescommon/src/models/domain/tag.model';
import { SeriesService } from 'impactdisciplescommon/src/services/data/series.service';
import { ProductCategoriesService } from 'impactdisciplescommon/src/services/data/product-categories.service';
import { SeriesModel } from 'impactdisciplescommon/src/models/utils/series.model';
import { ShowProductCategoriesModal } from '../product-categories/product-categories-modal.actions';
import { Store } from '@ngxs/store';
import { ShowProductSeriesModal } from '../product-series/product-series-modal.actions';
import { ShowSeriesModal } from '../product-series/series-modal/series-modal.actions';
import { ShowCategoryModal } from '../product-categories/category-modal/category-modal.actions';
import { EnumHelper } from 'impactdisciplescommon/src/utils/enum_helper';
import { ProductTagsService } from 'impactdisciplescommon/src/services/data/product-tags.service';
import { BookModel } from 'impactdisciplespwacommon/src/models/book.model';
import { BookService } from 'impactdisciplespwacommon/src/services/book.service';
import { MailTemplateModel } from 'impactdisciplescommon/src/models/admin/mail.model';
import { EMailTemplatesService } from 'impactdisciplescommon/src/services/data/email-templates.service';

@Component({
    selector: 'app-products',
    templateUrl: './products.component.html',
    styleUrls: ['./products.component.scss'],
    standalone: false
})
export class ProductsComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @ViewChild('categoryDropbox', { static: false }) categoryDropbox: DxDropDownBoxComponent;
  @ViewChild('seriesDropbox', { static: false }) seriesDropbox: DxDropDownBoxComponent;

  datasource$: Observable<DataSource>;
  selectedItem: ProductModel;

  itemType = 'Product';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);
  public isSeriesVisible$ = new BehaviorSubject<boolean>(false);
  public isCategoriesVisible$ = new BehaviorSubject<boolean>(false);

  public isSingleImageVisible$ = new BehaviorSubject<boolean>(false);
  public isEBookVisible$ = new BehaviorSubject<boolean>(false);

  sizes: string[] = [];
  colors: string[] = [];
  languages: string[] = [];
  productTags: TagModel[] = [];
  productCategories: TagModel[] = [];
  series: SeriesModel[] = [];
  books: BookModel[] = [];
  emails: any[] = []
  selectedCategory: TagModel;
  selectedSeries: SeriesModel;
  gridFilter: any = null;

  uoms: string[] = EnumHelper.getUOMTypesAsArray();

  constructor(
    private service: ProductService,
    private bookService: BookService,
    private productTagService: ProductTagsService,
    private seriesService: SeriesService,
    private productCategoriesService: ProductCategoriesService,
    public emailTemplatesService: EMailTemplatesService,
    private store: Store
  ) {}

  async ngOnInit() {
    this.datasource$ = this.service.streamAll().pipe(
      map(
        (items) =>
          new DataSource({
            reshapeOnPush: true,
            pushAggregationTimeout: 100,
            store: new CustomStore({
              key: 'id',
              loadMode: 'raw',
              load: function (loadOptions: any) {
                return items;
              }
            })
          })
      )
    );

    this.productTagService.streamAll().subscribe(tags =>{
      this.productTags = tags;
    });

    this.productCategoriesService.streamAll().subscribe(productCategories => {
      this.productCategories = productCategories;
    });

    this.seriesService.streamAll().subscribe(series => {
      this.series = series;
    });

    this.emailTemplatesService.streamAll().pipe(
      map(items => {
        items.forEach(item => {
          this.emails.push({id: item.id, name: item.name})
        })
      })
    ).subscribe();

    this.bookService.streamAll().subscribe(books => {
      this.books = books;
    });
  }

  onCategoryFilterChanged(event: any) {
    if(event.value) {
      this.selectedSeries = null;
      this.selectedCategory = this.productCategories.find(category => category.id === event.value) || null;
      this.gridFilter = ['category', '=', this.selectedCategory.id];
    } else if(!event.value && !this.selectedSeries) {
      this.gridFilter = null;
    }
  }

  onSeriesFilterChanged(event: any) {
    if(event.value) {
      this.selectedCategory = null;
      this.selectedSeries = this.series.find(series => series.id === event.value) || null;
      this.gridFilter = ['series', '=', this.selectedSeries.id];
    } else if(!event.value && !this.selectedCategory) {
      this.gridFilter = null;
    }
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    if(this.selectedItem.sizes && this.selectedItem.sizes.length > 0){
      this.sizes = this.selectedItem?.sizes;
    } else {
      this.sizes = [];
    }

    if(this.selectedItem.colors && this.selectedItem.colors.length > 0){
      this.colors = this.selectedItem?.colors;
    } else {
      this.colors = [];
    }

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new ProductModel()};

    this.isVisible$.next(true);
  }

  showProductSeriesModal = () => {
    this.store.dispatch(new ShowProductSeriesModal());
  }

  showProductCategoriesModal = () => {
    this.store.dispatch(new ShowProductCategoriesModal());
  }

  showSeriesModal = () => {
    this.store.dispatch(new ShowSeriesModal());
  }

  showCategoriesModal = () => {
    this.store.dispatch(new ShowCategoryModal());
  }

  selectCategory(event: any) {
    if (event && event.itemData) {
      this.selectedItem.category = event.itemData.id;
      this.categoryDropbox.instance.close();
    }
  }

  selectSeries(event: any) {
    if (event && event.itemData) {
      this.selectedItem.series = event.itemData.id;
      this.seriesDropbox.instance.close();
    }
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        this.service.delete(data.id).then(() => {
          notify({
            message: this.itemType + ' Deleted',
            position: 'top',
            width: 600,
            type: 'success'
          });
        })
      }
    });
  }

  onSave(item: ProductModel) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item.id) {
        item.sizes = this.selectedItem.sizes || [];
        item.colors = this.selectedItem.colors || [];

        this.service.update(item.id, item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Updated',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'success'
            });
          }
        })
      } else {
        this.service.add(item).then((item) => {
          if(item) {
            notify({
              message: this.itemType + ' Added',
              position: 'top',
              width: 600,
              type: 'success'
            });
            this.onCancel();
          } else {
            this.inProgress$.next(false);
            notify({
              message: 'Some Error Occured',
              position: 'top',
              width: 600,
              type: 'error'
            });
          }
        })
      }
    }
  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  onCustomItemCreating(args: DxTagBoxTypes.CustomItemCreatingEvent) {
    if(args.text){
      let productTag: TagModel = {... new TagModel()}
      productTag.tag = args.text;
      productTag.id = this.generateRandomId();

      const isItemInDataSource = this.productTags.some((item) => item.tag === productTag.tag);

      if (!isItemInDataSource) {
        this.productTagService.update(productTag.id, productTag)
      }

      args.customItem = productTag;
    }
  }

  onSizesCreating(args: DxTagBoxTypes.CustomItemCreatingEvent) {
    if(args.text){
      const isItemInDataSource = this.sizes.some((item) => item === args.text);

      if (!isItemInDataSource) {
        this.sizes.push(args.text);
      }

      args.customItem = args.text;
    }
  }

  onColorsCreating(args: DxTagBoxTypes.CustomItemCreatingEvent) {
    if(args.text){

      const isItemInDataSource = this.colors.some((item) => item === args.text);

      if (!isItemInDataSource) {
        this.colors.push(args.text);
      }

      args.customItem = args.text;
    }
  }

  onLanguagesCreating(args: DxTagBoxTypes.CustomItemCreatingEvent) {
    if(args.text){
      const isItemInDataSource = this.languages.some((item) => item === args.text);

      if (!isItemInDataSource) {
        this.languages.push(args.text);
      }

      args.customItem = args.text;
    }
  }

  private generateRandomId() {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  showSingleImageModal = () => {
    this.isSingleImageVisible$.next(true);
  }

  closeSingleImageModal = () => {
    this.isSingleImageVisible$.next(false);
  }

  showEBookModal = () => {
    this.isEBookVisible$.next(true);
  }

  closeEBookModal = () => {
    this.isEBookVisible$.next(false);
  }
}
