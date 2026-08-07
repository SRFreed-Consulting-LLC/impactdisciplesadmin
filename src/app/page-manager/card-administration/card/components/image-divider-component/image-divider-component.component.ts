import { Component, Input, OnInit, ViewChild } from '@angular/core';
import { DxScrollViewComponent } from 'devextreme-angular';
import { image_view_values } from 'src/app/page-manager/common/lists/card-fields.list';
import { CardComponent, CardComponentImage, CardComponentContent } from 'src/app/page-manager/common/models/editor/card.model';

@Component({
    selector: 'app-image-divider-component',
    templateUrl: './image-divider-component.component.html',
    standalone: false
})
export class ImageDividerComponentComponent implements OnInit {
  @ViewChild('scrollView') scrollView: DxScrollViewComponent;

  @Input('component') component: CardComponent;

  @Input('view') view: string = "edit";

  card_backup: CardComponent = {... new CardComponent()};

  image_view: string[] = image_view_values;

  ag_bg_image: {} = {};

  ag_text_overlay: {} = {};

  ag_bg_image_color: {} = {};

  viewConfig = false;

  imageSelectVisible = false;

  textEditorVisible = false;

  editedComponent: CardComponentImage;

  editedTextOverlay: CardComponentContent;

  htmlContent: string;

  editedField: string;


  constructor() {}

  ngOnInit(): void {
    this.card_backup = Object.assign(this.card_backup, this.component);
    this.component.span = 12;

    this.ag_bg_image =  {
      'background-image': 'url(' + this.component.image.url + ')',
      'height': this.component.image.height + 'px',
      'background-repeat': 'no-repeat',
      'background-attachment': this.component.image.view ,
      'background-position': '50% 50%',
      'background-size': 'cover',
      'position': 'relative'
    }
    this.ag_bg_image_color = {
      'height': '100%',
      'width': '100%',
      'top': '0',
      'left': '0',
      'position': 'absolute',
      'background-color': this.component.image.color,
      'opacity': this.component.image.opacity
    }
    this.ag_text_overlay = {
      'position': 'absolute',
      'opacity': '1',
      'word-wrap': 'break-word',
      'top' : '50%',
      'left' : '50%',
      'transform' : 'translate(-50%, -50%)',
    }
  }
  displayCardEditor (fieldname: string, component: CardComponentContent) {
    this.editedField = fieldname;
    this.editedTextOverlay = component;
    this.htmlContent = component[fieldname];
    this.textEditorVisible = true;
  }

  showPopup(){
    this.viewConfig = true;
  }

  imageSelectClosed(event){
    this.imageSelectVisible = event;
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
  }

  displayImageSelection(fieldname: string, component: CardComponentImage){
    this.editedField = fieldname;
    this.editedComponent = component;
    this.imageSelectVisible = true;
  }

  resetForm(){
    this.card_backup = Object.assign(this.component, this.card_backup);
    this.viewConfig = false;
  }

  getScreenHeight(): number{
    return window.innerHeight*.8;
  }



}
