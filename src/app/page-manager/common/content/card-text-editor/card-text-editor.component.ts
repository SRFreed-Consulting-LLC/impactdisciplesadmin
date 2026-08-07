import { Component, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';
import { DxHtmlEditorComponent } from 'devextreme-angular';
import * as DxQuill from "devextreme-quill";
import { Scope } from 'parchment';
import { TextEditorMacro } from '../../models/editor/text-editor-macro.model';
import { MacroService } from '../../services/macro.service';

@Component({
    selector: 'app-card-text-editor',
    templateUrl: './card-text-editor.component.html',
    standalone: false
})

export class CardTextEditorComponent implements OnInit {
  @ViewChild("htmlEditor", { static: false }) htmlEditor: DxHtmlEditorComponent;

  @Output() textEditorClosed = new EventEmitter<boolean>();

  @Input() textEditorVisible = false;
  @Input() card: any;
  @Input() field: string;

  @Input() htmlContent: string;

  highlightedStart: number;
  highlightedLength: number;
  highlightedContent: string;

  styleValues: string[] = [];

  macrosList: TextEditorMacro[] = [];

  clearFormatOptions = { icon: "clear", type: "danger" };

  constructor(private macroService: MacroService) {}

  ngOnInit(): void {
    this.initCustomFormat();

    if(this.card && this.field){
      this.htmlContent = this.card[this.field];
    }

    this.macroService.getAll().then(macros => {
      this.macrosList = macros;

      macros.forEach(macro => {
        this.styleValues.push(macro.name);
      })
    },err => console.error('Error in Card Text Component', err))
  }

  initCustomFormat() {
    const Parchment = DxQuill.import("parchment");

    const PaddingClass = new Parchment.StyleAttributor(
      "padding",
      "padding",
      {scope: Scope.INLINE}
    );
    DxQuill.register(PaddingClass, true);
  }

  saveCardData() {
    this.closeEditorWindow();
    this.card[this.field] = this.htmlContent;
    //this.htmlContent = "";
  }

  closeEditorWindow(){
    this.textEditorVisible = false;
    this.textEditorClosed.emit(false);
  }

  valueChange(value) {
    this.htmlContent = value;
  }

  classSelectOptions :any = {
    onValueChanged: this.showEvent.bind(this)
  }

  showEvent(e){
    if(e.value != null){
      let selectedMacro: TextEditorMacro = this.macrosList.find(m => m.name == e.value);

      Object.keys(selectedMacro).forEach(key => {
        if (key == 'padding'){
          this.htmlEditor.instance.format(key, "20");
        } else if (key == "textTransform"){
          this.htmlEditor.instance.format("text-transform", selectedMacro[key]);
        } else {
          this.htmlEditor.instance.format(key, selectedMacro[key]);
        }
      });
    }
  }
}



