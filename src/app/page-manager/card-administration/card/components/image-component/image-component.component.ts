import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent, CardComponentImage, CardComponentContent } from 'src/app/page-manager/common/models/editor/card.model';
import { Page } from 'src/app/page-manager/common/models/editor/page.model';
import { Product } from 'src/app/page-manager/common/models/store/products.model';
import { PageService } from 'src/app/page-manager/common/services/page.service';
import { ProductService } from 'src/app/page-manager/common/services/products.service';

@Component({
    selector: 'app-image-component',
    templateUrl: './image-component.component.html',
    standalone: false
})
export class ImageComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  @Input('col_count') col_count: number = 0;

  card_backup: CardComponent = {... new CardComponent()};

  img_component: {} = {};

  viewConfig = false;

  textEditorVisible = false;

  imageSelectVisible = false;

  editedCard: CardComponent;

  editedComponent: CardComponentImage;

  editedTextOverlay: CardComponentContent;

  editedField: string;

  htmlContent: string;

  pageList: Promise<Page[]>;

  productList: Promise<Product[]>;

  selectedPage: Page[] = [{...new Page()}];

  selectedProduct: Product[] = [{...new Product()}];

  pageSelectVisible = false;

  constructor(private pageService: PageService,
    public productService: ProductService,
    public router: Router) { }

  ngOnInit(): void {
    this.pageList = this.pageService.getAll();
    this.productList = this.productService.getAll()

    this.card_backup = Object.assign(this.card_backup, this.component);
    this.img_component = {
      'background-image': 'url(' + this.component.image.url + ')',
      'height': this.component.image.height + 'px',
      'opacity': this.component.image.opacity,
      'background-repeat': 'no-repeat',
      'background-position': '50% 50%',
      'background-size': 'contain',
      'position': 'relative',
    }
  }

  displayPageSelection(fieldname: string, component: CardComponentImage){
    this.editedField = fieldname;
    this.editedComponent = component;

    this.pageSelectVisible = true;
  }

  selectPage(e){
    this.pageSelectVisible = false;

    let selection: string = '/pages/page-viewer/' + this.selectedPage[0].dbId

    this.editedComponent[this.editedField] = selection;
  }

  selectProduct(e){
    this.pageSelectVisible = false;

    let selection: string = '/ecommerce/products/' + this.selectedProduct[0].dbId + '/display'

    this.editedComponent[this.editedField] = selection;
  }

  closePageWindow(){
    this.pageSelectVisible = false;
  }

  selectItem(image: CardComponentImage){
    if(image.link_external){
      window.open(image.click_url, '_blank');
    } else {
      this.router.navigate([image.click_url])
    }
  }

  showPopup(){
    this.viewConfig = true;
  }

  displayCardEditor (fieldname, component: CardComponentContent) {
    this.editedField = fieldname;
    this.editedTextOverlay = component;
    this.htmlContent = this.component[fieldname];
    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

  displayImageSelection(fieldname: string, component: CardComponentImage){
    this.editedField = fieldname;
    this.editedComponent = component;
    this.imageSelectVisible = true;
  }

  imageSelectClosed(event){
    this.imageSelectVisible = event;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.8;
  }

  onSelectionChanged(event){
    if(event.value == 'Internal Link'){
      this.component.image.link_external = false;
    } else {
      this.component.image.link_external = true;
    }
  }
}
