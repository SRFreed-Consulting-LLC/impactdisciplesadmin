import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LogMessagesComponent } from './log-messages/log-messages.component';
import { AdminUsersComponent } from './admin-users/admin-users.component';
import { E2eDashboardComponent } from './e2e-dashboard/e2e-dashboard.component';
import { ImpactDisciplesCommonModule } from 'src/app/common/impactdisciples.common.module';
import { AdminManagerComponent } from './admin-manager.component';
import { SharedModule } from '../shared/shared.module';
import { AdminManagerRoutingModule } from './admin-manager-routing.module';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatToolbarModule } from '@angular/material/toolbar';

// Down to just Logs + Admin Users - Customers/Web Config/Email Templates/
// Shipping Labels moved to ContactsManagerModule/ToolsManagerModule (see
// nav-config.ts's own comment on the reorg). This module/route still
// exists - Logs and Admin Users are both hideFromNav + employeeGrantable:
// false, reached only from the user-menu dropdown now (see main-screen.
// component.html) - but they still need a real shell to render into.
@NgModule({
  imports: [
    CommonModule,
    AdminManagerRoutingModule,
    ImpactDisciplesCommonModule,
    SharedModule,
    FormsModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatSelectModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
    MatToolbarModule
  ],
  declarations: [
    AdminManagerComponent,
    LogMessagesComponent,
    AdminUsersComponent,
    E2eDashboardComponent
  ]
})
export class AdminManagerModule { }
