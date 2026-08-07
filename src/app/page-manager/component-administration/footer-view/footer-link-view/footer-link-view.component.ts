import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent, CardComponentImage, CardComponentFooter, CardComponentUrl } from 'src/app/page-manager/common/models/editor/card.model';
import { Page } from 'src/app/page-manager/common/models/editor/page.model';
import { Product } from 'src/app/page-manager/common/models/store/products.model';
import { PageService } from 'src/app/page-manager/common/services/page.service';
import { ProductService } from 'src/app/page-manager/common/services/products.service';

@Component({
    selector: 'app-footer-link-view',
    templateUrl: './footer-link-view.component.html',
    standalone: false
})
export class FooterLinkViewComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  editedComponent: CardComponentImage;

  editedFooter: CardComponentFooter;

  editedField: string;

  imageSelectVisible = false;

  pageSelectVisible = false;

  textEditorVisible = false;

  htmlContent: string;

  pageList: Promise<Page[]>;

  productList: Promise<Product[]>;

  selectedPage: Page[] = [{...new Page()}];

  selectedProduct: Product[] = [{...new Product()}];

  constructor(public pageService: PageService,
    public productsService: ProductService,
    private router: Router) { }

  ngOnInit(): void {
    this.pageList = this.pageService.getAll();
    this.productList = this.productsService.getAll()
  }

  displayPageSelection(fieldname: string, component: CardComponentFooter){
    this.editedField = fieldname;
    this.editedFooter = component;

    this.pageSelectVisible = true;
  }

  selectPage(e){
    this.pageSelectVisible = false;

    let selection: CardComponentUrl = {
      link:'/pages/page-viewer/' + this.selectedPage[0].dbId,
      label: this.selectedPage[0].name
    }

    this.editedFooter[this.editedField] = selection;
  }

  selectProduct(e){
    this.pageSelectVisible = false;

    let selection: CardComponentUrl = {
      link:'/ecommerce/products/' + this.selectedProduct[0].dbId  + '/display',
      label: this.selectedProduct[0].title
    }

    this.editedFooter[this.editedField] = selection;
  }

  closePageWindow(){
    this.pageSelectVisible = false;
  }

  selectItem(footer: CardComponentFooter){
    if(footer.link_external){
      window.open(footer.link.link, '_blank');
    } else {
      this.router.navigate([footer.link.link])
    }
  }

  onSelectionChanged(event){
    if(event.value == 'Internal Link'){
      this.component.footer.link_external = false;
    } else {
      this.component.footer.link_external = true;
    }
  }

  displayCardEditor (fieldname: string, component: CardComponentFooter) {
    this.editedField = fieldname;
    this.editedFooter = component;
    this.htmlContent = component[fieldname];
    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

}
