import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DxFormComponent } from 'devextreme-angular';
import notify from 'devextreme/ui/notify';
import { TrainingRoomModel } from 'impactdisciplescommon/src/models/domain/training-room.model';
import { BehaviorSubject, map } from 'rxjs';
import { confirm } from 'devextreme/ui/dialog';

@Component({
    selector: 'app-room',
    templateUrl: './room.component.html',
    styleUrls: ['./room.component.css'],
    standalone: false
})
export class RoomComponent implements OnInit {
  @ViewChild('addEditForm', { static: false }) addEditForm: DxFormComponent;
  @Input() trainingRooms: TrainingRoomModel[];

  selectedItem: TrainingRoomModel;

  itemType = 'Rooms';

  public inProgress$ = new BehaviorSubject<boolean>(false)
  public isVisible$ = new BehaviorSubject<boolean>(false);

  constructor() {}

  ngOnInit() {
    if(!this.trainingRooms){
      this.trainingRooms = [];
    }
  }

  showEditModal = (e) => {
    this.selectedItem = (Object.assign({}, e.data));

    this.isVisible$.next(true);
  }

  showAddModal = () => {
    this.selectedItem = {... new TrainingRoomModel()};
    this.selectedItem.id = this.generateRandomId();
    this.isVisible$.next(true);
  }

  delete = ({ row: { data } }) => {
    confirm('<i>Are you sure you want to delete this record?</i>', 'Confirm').then((dialogResult) => {
      if (dialogResult) {
        let i: number = this.trainingRooms.findIndex(room => room.id === data.id);

        this.trainingRooms.splice(i, 1);

          notify({
            message: this.itemType + ' Deleted',
            position: 'top',
            width: 600,
            type: 'success'
          });
      }
    });
  }

  onSave(item: TrainingRoomModel) {
    if(this.addEditForm.instance.validate().isValid) {
      this.inProgress$.next(true);

      if(item) {
        let i: number = this.trainingRooms.findIndex(room => room.id === item.id);

        if(i == -1){
          this.trainingRooms.push(item);

          notify({
            message: this.itemType + ' Added',
            position: 'top',
            width: 600,
            type: 'success'
          });

          this.onCancel();
        } else {
          this.trainingRooms.splice(i, 1, item);

          notify({
            message: this.itemType + ' Updated',
            position: 'top',
            width: 600,
            type: 'success'
          });

          this.onCancel();
        }
      }
    }

  }

  onCancel() {
    this.selectedItem = null;
    this.inProgress$.next(false);
    this.isVisible$.next(false);
  }

  private generateRandomId() {
    return 'xxxxxxxxxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c == 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

}
