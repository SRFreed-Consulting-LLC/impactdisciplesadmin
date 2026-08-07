import { Component, OnInit, ViewChild } from '@angular/core';
import { DxDataGridComponent } from 'devextreme-angular';
import CustomStore from 'devextreme/data/custom_store';
import { TextEditorMacro } from '../common/models/editor/text-editor-macro.model';
import { MacroService } from '../common/services/macro.service';

@Component({
    selector: 'app-macro-creator',
    templateUrl: './macro-creator.component.html',
    styleUrls: ['./macro-creator.component.scss'],
    standalone: false
})
export class MacroCreatorComponent implements OnInit {
  @ViewChild('macros') macrosList: DxDataGridComponent;
  breadCrumbItems: Array<{}>;
  dataSource: any = {};
  macroEditVisible: boolean = false;

  editedMacro: TextEditorMacro = {... new TextEditorMacro()};

  mode: string = 'edit'

  constructor(macroService: MacroService) {
    this.dataSource = new CustomStore({
      key: "dbId",
      loadMode: "raw",
      load: function (loadOptions: any) {
        return macroService.getAll();
      },
      byKey: function(key: string){
        return macroService.getById(key)
      },
      insert: function(value: TextEditorMacro){
        return macroService.add(value);
      },
      update: function(key: any, value:any) {
        return macroService.update(key, value);
      },
      remove: function (key: any) {
        return macroService.delete(key);
      },
    });
  }

  ngOnInit(): void {
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
          onClick: this.displayAddPage.bind(this)
      }
    });
  }

  displayEditPage(e){
    this.mode = 'edit';
    this.editedMacro = e.row.data;
    this.macroEditVisible = true;
  }

  displayAddPage(e){
    this.mode = "add";
    this.editedMacro = {...new TextEditorMacro()}
    this.macroEditVisible = true;
  }

  closePopup(){
    this.macroEditVisible = false;
  }

  saveMacro(){
    this.macroEditVisible = false;

    if(this.mode == 'edit'){
      this.dataSource.update(this.editedMacro.dbId, this.editedMacro).then(() => this.macrosList.instance.getDataSource().reload()).catch((error) => {
        console.error('Error in Macro Creator Admin.', error);
      });
    } else {
      this.dataSource.insert(this.editedMacro).then(() => this.macrosList.instance.getDataSource().reload()).catch((error) => {
        console.error('Error in Macro Creator Admin.', error);
      });
    }
  }

  getScreenHeight(): number{
    return window.innerHeight*.65;
  }
}
