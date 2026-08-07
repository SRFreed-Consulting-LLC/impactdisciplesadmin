import { Component, Input, OnInit } from '@angular/core';
import { card_type_values } from 'src/app/page-manager/common/lists/card-fields.list';
import { Card, CardComponent, CardRow } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-card-body-view',
    templateUrl: './body-view.html',
    standalone: false
})
export class CardBodyViewComponent implements OnInit {
  @Input('card') card: Card;

  @Input('view') view: string = "edit";

  cardTypes: string[] = card_type_values;

  helpVisible = false;


  constructor() {}

  toggleHelp() {
      this.helpVisible = !this.helpVisible;
  }

  ngOnInit(): void {

  }

  addrow(){
    this.card.rows.push({ ... new CardRow() });
  }

  deleterow(row: number){
    this.card.rows.splice(row, 1);
  }

  addcard(row: number){
    let retval: CardComponent = {... new CardComponent()};
    retval.span=12
    this.card.rows[row].components.push({...retval});
  }

  deletecard(row: number, card: number){
    this.card.rows[row].components.splice(card, 1);
  }

  onListReorder(e){
    const list = this.card.rows.splice(e.fromIndex, 1)[0];
    this.card.rows.splice(e.toIndex, 0, list);
  }

  slide(e, components){
    const list = components.splice(e.fromIndex, 1)[0];
    components.splice(e.toIndex, 0, list);
  }
}
