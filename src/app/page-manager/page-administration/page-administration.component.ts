import { Component, NgZone, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import CustomStore from 'devextreme/data/custom_store';
import { Page } from '../common/models/editor/page.model';
import { PageService } from '../common/services/page.service';

@Component({
    selector: 'app-page-administration',
    templateUrl: './page-administration.component.html',
    standalone: false
})
export class PageAdministrationComponent implements OnInit {
  breadCrumbItems: Array<{}>;

  dataSource: any = {};

  currentPage: Page;

  constructor(public pageService: PageService,
    public ngZone: NgZone,
    public router: Router,) {
    this.dataSource = new CustomStore({
      key: "dbId",
      loadMode: "raw",
      load: function (loadOptions: any) {
        return pageService.getAll();
      },
      update: function(key: any, value:any) {
        return pageService.update(key, value);
      },
      remove: function (key: any) {
        return pageService.delete(key);
      },
    });
  }

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Page Administration', active: true }];
  }

  onRowUpdating(options) {
    options.newData = Object.assign(options.oldData, options.newData);
  }

  displayPagePreview(event: any){
    this.router.navigate(['/pages/page-viewer', event.row.data.dbId, 'preview']);
  }

  displayPageEdit(event: any){
    this.router.navigate(['/pages/page-maker', event.row.data.dbId, 'edit']);
  }

  onToolbarPreparing(e) {
    e.toolbarOptions.items.unshift({
      location: 'after',
      widget: 'dxButton',
      options: {
          icon: 'plus',
          onClick: this.addPage.bind(this)
      }
    });
  }

  addPage(event){
    this.ngZone.run(() => {
      this.router.navigate(['/pages/page-maker']);
    });
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }

  getWindowWidth(): number{
    return window.innerWidth*.85;
  }
}
