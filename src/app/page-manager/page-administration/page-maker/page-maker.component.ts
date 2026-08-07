import { Component, NgZone, OnInit } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import { ActivatedRoute, Router } from '@angular/router';
import { take } from 'rxjs/operators';
import { Page } from '../../common/models/editor/page.model';
import { CardService } from '../../common/services/card.service';
import { FormService } from '../../common/services/forms.service';
import { PageService } from '../../common/services/page.service';

@Component({
    selector: 'app-page-wizard',
    templateUrl: './page-maker.component.html',
    standalone: false
})
export class PageMakerComponent implements OnInit {
  loading: Promise<any> = new Promise((resolve) => resolve(false));

  breadCrumbItems: Array<{}>;

  mode:string = 'edit';

  dataSource: any = {};

  formSource: any = {};

  currentPage: Page;

  imageSelectVisible = false;
  confirmPageSaveVisible = false;
  confirmPageCancelVisible = false

  textEditorVisible = false;

  htmlContent: string;

  editedPage: Page;

  editedField: string;

  constructor(public pageService: PageService,
    public cardService: CardService,
    public formService: FormService,
    private route: ActivatedRoute,
    public ngZone: NgZone,
    public router: Router,) {
    this.onReorder = this.onReorder.bind(this);

    this.dataSource = new CustomStore({
      key: "id",
      loadMode: "raw",
      load: function (loadOptions: any) {
        return cardService.getAll()
      }
    });

    this.formSource = new CustomStore({
      key: "id",
      loadMode: "raw",
      load: function (loadOptions: any) {
        return formService.getAll();
      }
    });
  }

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin'},{ label: 'Page Administration', path:"/pages/page-administration" }];

    this.route.params.pipe(take(1)).subscribe(queryParams => {
      if(queryParams['id'] != null){
        this.pageService.getById(queryParams['id']).then(p => {
          this.currentPage = p;
          this.currentPage.dbId = queryParams['id'];
          this.mode = 'edit';

          this.breadCrumbItems.push({ label: 'Edit ' + this.currentPage.name, active: true })
        },err => console.error('Error in Page Maker Admin', err));
      } else {
        this.mode = 'new';

        this.breadCrumbItems.push({ label: 'Create New Page', active: true })

        this.currentPage = { ...new Page()};
      }
    },err => console.error('Error in Page Maker Admin', err));

    this.loading = new Promise((resolve) => resolve(true));
  }

  addCard(card){
    this.currentPage.cards.push(card);
  }
  addForm(form) {
    this.currentPage.cards.push(form);
  }

  returnToPageAdministrator(){
    this.ngZone.run(() => {
      this.router.navigate(['/pages/page-administration']);
    });
  }

  displayPageEditor (fieldname, page: Page) {
    this.editedField = fieldname;
    this.editedPage = page;
    this.htmlContent = page[fieldname];

    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

  displayImageSelection(fieldname: string, page: Page){
    this.editedField = fieldname;
    this.editedPage = page;

    this.imageSelectVisible = true;
  }

  valueChange(value) {
    this.htmlContent = value;
  }

  textEditorClosed(event){
    this.textEditorVisible = event;
  }

  imageSelectClosed(event){
    this.imageSelectVisible = event;
  }

  showSavePopup(){
    this.confirmPageSaveVisible = true;
  }

  showCancelPopup(){
    this.confirmPageCancelVisible = true;
  }

  saveChanges(){
    if(this.currentPage.dbId){
      this.pageService.update(this.currentPage.dbId, this.currentPage);
    } else {
      this.pageService.add(this.currentPage);
    }


    this.returnToPageAdministrator();

    this.closeSaveChanges();
  }

  closeSaveChanges(){
    this.confirmPageSaveVisible = false;
  }

  cancelChanges(){
    this.closeCancelChanges();
    this.returnToPageAdministrator();
  }

  closeCancelChanges(){
    this.confirmPageCancelVisible = false;
  }

  onReorder(e) {
    var visibleRows = e.component.getVisibleRows(),
        toIndex = this.currentPage.cards.indexOf(visibleRows[e.toIndex].data),
        fromIndex = this.currentPage.cards.indexOf(e.itemData);

    this.currentPage.cards.splice(fromIndex, 1);
    this.currentPage.cards.splice(toIndex, 0, e.itemData);
  }
}
