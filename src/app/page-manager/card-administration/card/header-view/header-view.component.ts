import { Component, Input, OnInit } from '@angular/core';
import { Card } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-card-header-view',
    templateUrl: './header-view.component.html',
    standalone: false
})
export class CardHeaderViewComponentComponent implements OnInit {
  @Input('card') card: Card;

  @Input('view') view: string = "edit";

  textEditorVisible = false;

  htmlContent: string;

  editedCard: Card;

  editedField: string;

  card_line: {} = {};

  constructor() { }

  ngOnInit(): void {
    this.card_line = {
      'height': this.card.line_height + 'px',
      'width': this.card.line_width + '%',
      'background-color': this.card.line_color
    }

  }

  displayCardEditor (fieldname, card: Card) {
    this.editedField = fieldname;
    this.editedCard = card;
    this.htmlContent = card[fieldname];

    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

}
