import { Component, ComponentRef, OnInit, ViewChild, ViewContainerRef } from '@angular/core';
import CustomStore from 'devextreme/data/custom_store';
import { CardViewerComponent } from '../card-administration/card-viewer/card-viewer.component';
import { SplashScreen } from '../common/models/ui/splash-screen.model';
import { CardService } from '../common/services/card.service';
import { SplashScreenService } from '../common/services/splash-screen.service';

@Component({
    selector: 'app-splash-screen-admin',
    templateUrl: './splash-screen-admin.component.html',
    styleUrls: ['./splash-screen-admin.component.scss'],
    standalone: false
})
export class SplashScreenAdminComponent implements OnInit {
  @ViewChild('carddiv', { read: ViewContainerRef })
  private vcr: ViewContainerRef;

  breadCrumbItems: Array<{}>;

  dataSource: any = {};

  cardSource: any = {};

  showSplashScreen: boolean = false;

  fieldSource: any[] = [
    {
      name: 'Agency',
      value: 'p_agency_id'
    },
    {
      name: 'Role',
      value: 'role'
    }
  ];

  roleSource: any[] = [
    {
      name: 'Admins',
      value: 'PORTAL_ADMIN'
    },
    {
      name: "MGA's",
      value: 'MGA'
    },
    {
      name: 'Managers',
      value: 'is_manager'
    },
    {
      name: 'RMDs',
      value: 'is_rmd'
    }
  ];

  agencySource: any[] = [];

  constructor(
    public splashScreenService: SplashScreenService,
    public cardService: CardService,
  ) {
    this.dataSource = new CustomStore({
      key: 'dbId',
      loadMode: 'raw',
      load: function (loadOptions: any) {
        return splashScreenService.getAll();
      },
      insert: function (value: SplashScreen) {
        return splashScreenService.add(value);
      },
      update: function (key: any, value: SplashScreen) {
        return splashScreenService.update(key, value);
      },
      remove: function (id: any) {
        return splashScreenService.delete(id);
      }
    });

    this.cardSource = new CustomStore({
      key: 'id',
      loadMode: 'raw',
      load: function (loadOptions: any) {
        return new Promise((resolve, reject) => {
          cardService.getAll().then(
            (snaps) => {
              snaps = snaps.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
              resolve(snaps);
            },
            (err) => console.error('Error in Splash Screen Admin', err)
          );
        });
      }
    });
  }

  ngOnInit() {
    this.breadCrumbItems = [{ label: 'Admin' }, { label: 'Splash Screen Administration', active: true }];
  }

  onRowUpdating(options) {
    options.newData = Object.assign(options.oldData, options.newData);
  }

  getDataSource(v) {
    if (v.row.data.field == 'role') {
      return this.roleSource;
    } else if (v.row.data.field == 'p_agency_id') {
      return this.agencySource;
    }
    return null;
  }

  getScreenHeight(): number {
    return window.innerHeight * 0.3;
  }

  viewSplashScreen(event) {
    this.showSplashScreen = true;
    this.vcr.clear();

    this.cardService.getById(event.row.data.card_id).then(
      (card) => {
        let componentRef: ComponentRef<any> = this.vcr.createComponent(CardViewerComponent);
        let currentComponent = componentRef.instance;
        currentComponent.currentCard = card;
      },
      (err) => console.error('Error in Splash Screen Admin', err)
    );
  }

  hideSplashScreen() {
    this.showSplashScreen = false;
  }
}
