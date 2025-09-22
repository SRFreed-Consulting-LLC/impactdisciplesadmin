import { Component, NgZone, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import CustomStore from 'devextreme/data/custom_store';
import { Form } from '../common/models/editor/form.model';
import { Page } from '../common/models/editor/page.model';
import { FormService } from '../common/services/forms.service';
import { PageService } from '../common/services/page.service';
import notify from 'devextreme/ui/notify';

@Component({
  selector: 'app-form-administration',
  templateUrl: './form-administration.component.html'
})
export class FormAdministrationComponent implements OnInit {
  breadCrumbItems: Array<{}>;

  dataSource: any = {};

  currentForm: Form;

  confirePublishFormVisible = false;

  constructor(public formService: FormService,
    public pageService: PageService,
    public ngZone: NgZone,
    public router: Router) {
      this.dataSource = new CustomStore({
        key: "dbId",
        loadMode: "raw",
        load: function (loadOptions: any) {
          return formService.getAll();
        },
        update: function(key: any, value: Form) {
          return formService.update(key, value)
        },
        remove: function (id: any) {
          return formService.delete(id);
        },
      });
    }

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Form Administration', active: true }];
  }
  onRowUpdating(options) {
    options.newData = Object.assign(options.oldData, options.newData);
  }
  onToolbarPreparing(e) {
    e.toolbarOptions.items.unshift({
      location: 'after',
      widget: 'dxButton',
      options: {
          icon: 'plus',
          onClick: this.addForm.bind(this)
      }
    });
  }
  addForm(){
    this.ngZone.run(() => {
      this.router.navigate(['/forms/form-maker']);
    });
  }
  displayFormPreview(event: any){
    this.router.navigate(['/forms/form-viewer', event.row.data.dbId, 'preview']);
  }
  displayFormEdit(event: any){
    this.router.navigate(['/forms/form-maker', event.row.data.dbId, 'edit']);
  }
  displayPublishFormWarning(e){
    this.currentForm = e.row.data;
    this.confirePublishFormVisible = true;
  }

  closePublishFormWarning(){
    this.confirePublishFormVisible = false;
  }

  publishForm(e){
    this.closePublishFormWarning();

    let pagesToUpdate: Page[] = [];

    new Promise((resolve, reject) => {
      this.pageService.getAll().then(async pages => {
        await pages.forEach(async page => {
          await page.cards.forEach(card => {
            if(card.dbId == this.currentForm.dbId) {
              Object.assign(card, this.currentForm)
              pagesToUpdate.push(page);
            }
          });
        });
        resolve(pagesToUpdate);
      },err => console.error('Error in Form Admin', err))
    }).then( p => {
      pagesToUpdate.forEach(page => {
        this.pageService.update(page.dbId, page);
      });
    }).then(()=>{
      notify({
        message: 'Form successfully published!',
        position: 'top',
        width: 600,
        type: 'success'
      });
    });
  }

  viewFormResults(e){
    this.ngZone.run(() => {
      this.router.navigate(['/forms/form-results', e.row.data.dbId]);
    });
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }
}
