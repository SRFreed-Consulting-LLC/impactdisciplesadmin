import { Component, Input, OnInit } from '@angular/core';
import { CardComponent, CardComponentHeader } from '../../common/models/editor/card.model';

@Component({
    selector: 'app-component-header-view',
    templateUrl: './header-view.component.html',
    styleUrls: ['./header-view.component.scss'],
    standalone: false
})
export class ComponentHeaderViewComponent implements OnInit {
  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  textEditorVisible = false;

  htmlContent: string;

  editedComponent: CardComponentHeader;

  editedField: string;

  component_line: {} = {};

  constructor() { }

  ngOnInit(): void {
    this.component_line = {
      'height': this.component.header.line_height + 'px',
      'width': this.component.header.line_width + '%',
      'background-color': this.component.header.line_color
    }
  }

  displayCardEditor (fieldname: string, component: CardComponentHeader) {
    this.editedField = fieldname;
    this.editedComponent = component;
    this.htmlContent = component[fieldname];

    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

}
