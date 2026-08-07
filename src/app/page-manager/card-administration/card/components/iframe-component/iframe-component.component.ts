import { Component, Input, OnInit } from '@angular/core';
import { CardComponent } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-iframe-component',
    templateUrl: './iframe-component.component.html',
    standalone: false
})
export class IframeComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  card_backup: CardComponent = {... new CardComponent()};

  viewConfig = false;

  textEditorVisible = false;

  editedCard: CardComponent;

  htmlContent: string;

  editedField: string;


  constructor() { }

  ngOnInit(): void {
    this.card_backup = Object.assign(this.card_backup, this.component);
  }

  showPopup(){
    this.viewConfig = true;
  }

  displayCardEditor (fieldname, card: CardComponent) {
    this.editedField = fieldname;
    this.editedCard = card;
    this.htmlContent = card[fieldname];
    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }

}
