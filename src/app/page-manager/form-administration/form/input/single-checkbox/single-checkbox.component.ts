import { Component, Input, OnInit } from '@angular/core';
import { Form, FormInputs } from 'src/app/page-manager/common/models/editor/form.model';

@Component({
    selector: 'app-single-checkbox',
    templateUrl: './single-checkbox.component.html',
    standalone: false
})
export class SingleCheckboxComponent implements OnInit {
  @Input ('form') form: Form;

  @Input('input') input: FormInputs;

  @Input('view') view: string = "edit";

  @Input('col_count') col_count: number = 0;

  @Input ('formToSubmit') formToSubmit: Form;

  input_backup: FormInputs = {... new FormInputs()};

  viewConfig = false;

  viewEditPage = false;

  mode:string;

  constructor() { }

  ngOnInit(): void {}

  showPopup(){
    this.input_backup = Object.assign(this.input_backup, this.input);
    this.viewConfig = true;
  }

  getScreenHeight(): number{
    return window.innerHeight*.4;
  }

  resetForm(){
    this.input_backup = Object.assign(this.input, this.input_backup);
    this.viewConfig = false;
  }

}
