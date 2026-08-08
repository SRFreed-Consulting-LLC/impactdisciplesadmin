import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardsAdminModule } from './card-administration/cards-admin.module';
import { ComponentAdminModule } from './component-administration/component-admin.module';
import { FormsAdminModule } from './form-administration/forms-admin.module';
import { MacroAdminModule } from './macro-administration/macro-admin.module';
import { MenuAdminModule } from './menu-administration/menu-admin.module';
import { PagesAdminModule } from './page-administration/pages-admin.module';
import { SplashScreenAdminModule } from './splash-screen-admin/splash-screen-admin.module';
import { PageManagerComponent } from './page-manager.component';
import { DxTabsModule } from 'devextreme-angular';
import { PageManagerRoutingModule } from './page-manager-routing.module';



@NgModule({
  declarations: [
    PageManagerComponent
  ],
  imports: [
    CommonModule,
    PageManagerRoutingModule,
    CardsAdminModule,
    ComponentAdminModule,
    FormsAdminModule,
    MacroAdminModule,
    MenuAdminModule,
    PagesAdminModule,
    SplashScreenAdminModule,
    DxTabsModule
  ],
  exports:[
    PageManagerComponent
  ]
})
export class PageManagerModule { }
