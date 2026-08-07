import { Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CardComponent, CardComponentImage, CardComponentFooter, CardComponentUrl } from 'src/app/page-manager/common/models/editor/card.model';
import { Page } from 'src/app/page-manager/common/models/editor/page.model';
import { PageService } from 'src/app/page-manager/common/services/page.service';

@Component({
    selector: 'app-footer-image-view',
    templateUrl: './footer-image-view.component.html',
    standalone: false
})
export class FooterImageViewComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  editedComponent: CardComponentImage;

  editedFooter: CardComponentFooter;

  editedField: string;

  imageSelectVisible = false;

  pageSelectVisible = false;

  pageList:Page[] = [];

  selectedPage: Page[] = [{...new Page()}];

  img_component: {} = {};

  constructor(private pageService: PageService, private router: Router) { }

  ngOnInit(): void {
    this.pageService.getAll().then(pages => {
      this.pageList = pages;
    },err => console.error('Error in Footer Image Component', err))
    this.img_component = {
      'height': this.component.image.height + 'px',
      'width': 'auto'
    }
  }

  displayImageSelection(fieldname: string, component: CardComponentImage){
    this.editedField = fieldname;
    this.editedComponent = component;

    this.imageSelectVisible = true;
  }

  imageSelectClosed(event){
    this.imageSelectVisible = event;
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
      label: this.selectedPage[0].name,
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
}
