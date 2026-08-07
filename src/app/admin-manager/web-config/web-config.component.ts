import { Component, OnInit } from '@angular/core';
import { WebConfigModel } from 'impactdisciplescommon/src/models/utils/web-config.model';
import { WebConfigService } from 'impactdisciplescommon/src/services/data/web-config.service';
import { BehaviorSubject, map, Observable } from 'rxjs';
import DataSource from 'devextreme/data/data_source';
import notify from 'devextreme/ui/notify';

@Component({
    selector: 'app-web-config',
    templateUrl: './web-config.component.html',
    styleUrls: ['./web-config.component.css'],
    standalone: false
})
export class WebConfigComponent implements OnInit{
  datasource$: Observable<DataSource>;

  public isVisible$ = new BehaviorSubject<boolean>(false);

  selectedItem: WebConfigModel;

  spinnerVisible: boolean = true;

  itemType = 'Web Configuration';

  loadingVisible = false;

  constructor(private service: WebConfigService) {}

  async ngOnInit() {
    this.selectedItem = await this.service.getAll().then(config => {
      this.spinnerVisible = false;

      if(config && config.length == 1){
        return config[0];
      } else {
        return {...new WebConfigModel()};
      }
    });
  }

  save = async () => {
    this.spinnerVisible = true;

    if(this.selectedItem.id){
      this.selectedItem = await this.service.update(this.selectedItem.id, {... this.selectedItem});
    } else {
      this.selectedItem = await this.service.add({... this.selectedItem});
    }

    notify({
      message: "Configuration Saved Successfully!",
      position: 'top',
      width: 600,
      type: 'success'
    });

    this.spinnerVisible = false;
  }
}
