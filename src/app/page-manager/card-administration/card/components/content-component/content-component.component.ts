import { Component, Input, OnInit } from '@angular/core';
import { CardComponent, CardComponentContent } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-content-component',
    templateUrl: './content-component.component.html',
    standalone: false
})
export class ContentComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  card_backup: CardComponent = {... new CardComponent()};

  viewConfig = false;

  textEditorVisible = false;

  htmlContent: string;

  editedField: string;

  editedComponent: CardComponentContent;

  constructor() { }

  ngOnInit(): void {
    this.card_backup = Object.assign(this.card_backup, this.component);
  }

  showPopup(){
    this.viewConfig = true;
  }

  displayCardEditor (fieldname: string, component: CardComponentContent) {
    this.editedField = fieldname;
    this.editedComponent = component;
    this.htmlContent = component[fieldname];
    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

  resetForm(){
    this.component = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }

}
