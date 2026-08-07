import {
  AfterViewInit,
  Component,
  ComponentFactoryResolver,
  ComponentRef,
  OnDestroy,
  OnInit,
  ViewChild,
  ViewContainerRef
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AdminAuthService } from 'impactdisciplescommon/src/forms/admin/admin-auth.service';
import { Subscription } from 'rxjs';
import { CardViewerComponent } from '../../card-administration/card-viewer/card-viewer.component';
import { CardSpacerComponent } from '../../common/content/card-spacer/card-spacer.component';
import { Page } from '../../common/models/editor/page.model';
import { PageService } from '../../common/services/page.service';
import { FormViewerComponent } from '../../form-administration/form-viewer/form-viewer.component';

@Component({
    selector: 'app-page-viewer',
    styleUrls: ['./page-viewer.component.scss'],
    templateUrl: './page-viewer.component.html',
    standalone: false
})
export class PageViewerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('carddiv', { read: ViewContainerRef })
  private vcr: ViewContainerRef;

  breadCrumbItems: Array<{}>;

  mode = 'preview';

  index: number = 0;
  componentsReferences = [];
  currentPage: Page = { ...new Page() };

  $routeSubsciption: Subscription;

  constructor(
    private CFR: ComponentFactoryResolver,
    private pageService: PageService,
    private route: ActivatedRoute,
    private authService: AdminAuthService,
  ) {}

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Page Administration', path: '/pages/page-administration' }];

    this.mode = this.route.snapshot.paramMap.get('view') == '' ? 'display' : this.route.snapshot.paramMap.get('view');
  }

  ngAfterViewInit(): void {
    this.$routeSubsciption = this.route.params.subscribe(
      (queryParams) => {
        this.vcr.clear();

        this.pageService.getById(queryParams['id']).then(
          (p) => {
            this.currentPage = p;

            if (this.mode == 'preview') {
              this.breadCrumbItems.push({
                label: 'View ' + this.currentPage.name,
                active: true
              });
            }

            if (this.currentPage && this.currentPage.cards) {
              this.vcr.createComponent(CardSpacerComponent);

              this.currentPage.cards.forEach((card) => {
                if (card.type == 'Form') {
                  let component: any = FormViewerComponent;

                  let componentFactory = this.CFR.resolveComponentFactory(component);
                  let componentRef: ComponentRef<any> = this.vcr.createComponent(componentFactory);
                  let currentComponent = componentRef.instance;
                  currentComponent.currentForm = card;
                  currentComponent.mode = this.mode;
                }

                if (card.type == 'Card') {
                  let component: any = CardViewerComponent;

                  let componentFactory = this.CFR.resolveComponentFactory(component);
                  let componentRef: ComponentRef<any> = this.vcr.createComponent(componentFactory);
                  let currentComponent = componentRef.instance;
                  currentComponent.currentCard = card;
                  currentComponent.mode = this.mode;
                }

                this.vcr.createComponent(CardSpacerComponent);
              });
            }
          },
          (err) => console.error('Error in Page Viewer Admin', err)
        );
      },
      (err) => console.error('Error in Page Viewer Admin', err)
    );
  }

  ngOnDestroy(): void {
    this.$routeSubsciption.unsubscribe();
  }
}
