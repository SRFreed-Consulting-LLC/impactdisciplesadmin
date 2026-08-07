import { Component, Input, OnInit } from '@angular/core';
import { Form, FormInputs } from 'src/app/page-manager/common/models/editor/form.model';

@Component({
    selector: 'app-select',
    templateUrl: './select.component.html',
    standalone: false
})
export class SelectComponent implements OnInit {
  @Input ('form') form: Form;

  @Input('input') input: FormInputs;

  @Input('view') view: string = "edit";

  @Input('col_count') col_count: number = 0;

  @Input ('formToSubmit') formToSubmit: Form;

  input_backup: FormInputs = {... new FormInputs()};

  viewConfig = false;

  viewEditPage = false;

  constructor() { }

  ngOnInit(): void {}

  showPopup(){
    this.input_backup = Object.assign(this.input_backup, this.input);
    this.viewConfig = true;
  }

  getScreenHeight(): number{
    return window.innerHeight*.5;
  }

  onCustomItemCreating(args) {
    let newValue = args.text;
    args.customItem = {type: 'tag', value: newValue};
  }

  resetForm(){
    this.input_backup = Object.assign(this.input, this.input_backup);
    this.viewConfig = false;
  }

}
