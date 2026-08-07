import { Component, Input, OnInit } from '@angular/core';
import { cta_button_style_values } from 'src/app/page-manager/common/lists/card-fields.list';
import { CardComponentUrl } from 'src/app/page-manager/common/models/editor/card.model';
import { Form, FormHeader, FormInputs } from 'src/app/page-manager/common/models/editor/form.model';


@Component({
    selector: 'app-form-header-view',
    templateUrl: './header-view.component.html',
    standalone: false
})
export class FormHeaderViewComponent implements OnInit {
  @Input('input') input: FormInputs;

  @Input('form') form: Form;

  @Input('view') view: string = "edit";

  textEditorVisible = false;

  htmlContent: string;

  editedForm: FormHeader;

  buttonStyles: string[] = cta_button_style_values;

  editedField: string;

  form_line: {} = {};

  editedUrl: CardComponentUrl;

  pageSelectVisible = false;

  constructor() { }

  ngOnInit(): void {
    this.form_line = {
      'height': this.form.header.line_height + 'px',
      'width': this.form.header.line_width + '%',
      'background-color': this.form.header.line_color
    }
  }

  displayCardEditor (fieldname, form: FormHeader) {
    this.editedField = fieldname;
    this.editedForm = form;
    this.htmlContent = form[fieldname];

    this.textEditorVisible = true;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }
  onSelectionChanged(event){
    if(event.value == 'Internal Link'){
      this.form.button.link_external = false;
    } else {
      this.form.button.link_external = true;
    }
  }

  displayPageSelection(fieldname: string, component){
    this.editedField = fieldname;
    this.editedUrl = component;

    this.pageSelectVisible = true;
  }


}
