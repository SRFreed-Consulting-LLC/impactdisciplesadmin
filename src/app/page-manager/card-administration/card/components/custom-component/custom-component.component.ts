import { Component, Input, OnInit } from '@angular/core';
import { CardComponent } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-custom-component',
    templateUrl: './custom-component.component.html',
    standalone: false
})
export class CustomComponentComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  card_backup: CardComponent = {... new CardComponent()};

  viewConfig = false;


  constructor() { }

  ngOnInit(): void {
    this.card_backup = Object.assign(this.card_backup, this.component);
  }

  showPopup(){
    this.viewConfig = true;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.7;
  }

}
