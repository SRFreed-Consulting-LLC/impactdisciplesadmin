import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { cta_button_style_values } from 'src/app/page-manager/common/lists/card-fields.list';
import { CardComponent, CardComponentUrl, CardComponentButton } from 'src/app/page-manager/common/models/editor/card.model';
import { Page } from 'src/app/page-manager/common/models/editor/page.model';
import { Product } from 'src/app/page-manager/common/models/store/products.model';
import { PageService } from 'src/app/page-manager/common/services/page.service';
import { ProductService } from 'src/app/page-manager/common/services/products.service';

@Component({
    selector: 'app-button-component',
    templateUrl: './button-component.component.html',
    standalone: false
})
export class ButtonComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  @Input('col_count') col_count: number = 0;

  card_backup: CardComponent = {... new CardComponent()};

  buttonStyles: string[] = cta_button_style_values;

  pageList: Promise<Page[]>;

  productList: Promise<Product[]>;

  selectedPage: Page[] = [{...new Page()}];

  selectedProduct: Product[] = [{...new Product()}];

  button_component: {} = {};

  button_area: {} = {};

  viewConfig = false;

  textEditorVisible = false;

  pageSelectVisible = false;

  productSelectVisible = false;

  htmlContent: string;

  editedField: string;

  editedUrl: CardComponentUrl;

  constructor(private pageService: PageService, private productService: ProductService, private router: Router) {}

  ngOnInit(): void {
    this.card_backup = Object.assign(this.card_backup, this.component);

    this.pageList = this.pageService.getAll();

    this.productList = this.productService.getAll();

    this.button_component = {
      'font-size': this.component.button.button_size + 'px',
      'border-width': this.component.button.button_border + 'px',
      'margin-top': this.component.button.button_margin_top + '%',
      'margin-left': this.component.button.button_margin_left + '%'
    }
    this.button_area = {
      'background-color': this.component.button.button_area,
      'height': '100%',
      'width': '100%'
    }
  }

  showPopup(){
    this.viewConfig = true;
  }

  onSelectionChanged(event){
    if(event.value == 'Internal Link' || event.value == 'Product Link'){
      this.component.button.link_external = false;
    } else {
      this.component.button.link_external = true;
    }
  }

  displayPageSelection(fieldname: string, component){
    this.editedField = fieldname;
    this.editedUrl = component;
    this.pageSelectVisible = true;
  }

  displayProductSelection(fieldname: string, component){
    this.editedField = fieldname;
    this.editedUrl = component;
    this.productSelectVisible = true;
  }

  selectPage(e){
    this.pageSelectVisible = false;
    let selection: CardComponentUrl = {
      link:'/pages/page-viewer/' + this.selectedPage[0].dbId,
      label: this.selectedPage[0].name,
    }

    this.component.button[this.editedField] = selection;
  }

  selectProduct(e){
    this.pageSelectVisible = false;
    let selection: CardComponentUrl = {
      link:'/ecommerce/products/' + this.selectedProduct[0].dbId + '/display',
      label: this.selectedProduct[0].title,
    }

    this.component.button[this.editedField] = selection;
  }

  selectItem(button: CardComponentButton){
    if(button.link_external){
      window.open(button.link.link, '_blank');
    } else {
      this.router.navigate([button.link.link])
    }
  }

  closePageWindow(){
    this.pageSelectVisible = false;
  }

  closeProductWindow(){
    this.productSelectVisible = false;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }

}
