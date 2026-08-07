import { Component, Input, OnInit } from '@angular/core';
import { CardComponent } from '../../common/models/editor/card.model';
import { cta_type_values } from '../../common/lists/card-fields.list';


@Component({
    selector: 'app-footer-view',
    templateUrl: './footer-view.component.html',
    standalone: false
})
export class ComponentFooterViewComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  ctaStyles: string[] = cta_type_values;


  constructor() { }

  ngOnInit(): void {
  }

}
