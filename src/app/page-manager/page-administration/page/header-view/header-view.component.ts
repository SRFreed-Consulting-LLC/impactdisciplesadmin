import { Component, Input, OnInit } from '@angular/core';
import { Page } from 'src/app/page-manager/common/models/editor/page.model';

@Component({
    selector: 'app-page-header-view',
    templateUrl: './header-view.component.html',
    standalone: false
})
export class PageHeaderViewComponent implements OnInit {
  @Input('page') currentPage: Page;
  constructor() { }

  ngOnInit(): void {
  }

}
