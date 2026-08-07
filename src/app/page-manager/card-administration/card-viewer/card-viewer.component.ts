import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Card } from '../../common/models/editor/card.model';
import { CardService } from '../../common/services/card.service';

@Component({
    selector: 'app-card-previewer',
    templateUrl: './card-viewer.component.html',
    standalone: false
})
export class CardViewerComponent implements OnInit {
  loading: Promise<any> = new Promise((resolve) => resolve(false));

  breadCrumbItems: Array<{}>;

  card_line: {} = {};

  mode: string = 'edit';

  currentCard: Card;

  constructor(private route: ActivatedRoute,
    public  cardService: CardService) { }

  ngOnInit(): void {
    this.breadCrumbItems = [{ label: 'Admin'}, { label: 'Card Administration', path: '/cards/card-administration' }];

    this.mode=this.route.snapshot.paramMap.get('view') == null? 'display': this.route.snapshot.paramMap.get('view');

    if(this.currentCard == null){
      this.initData(this.route.snapshot.paramMap.get('id')).then(card => {
        if(card != null){
          this.currentCard = card;
          this.currentCard.dbId = this.route.snapshot.paramMap.get('id');
          this.card_line = {
            'height': this.currentCard.line_height + 'px',
            'width': this.currentCard.line_width + '%',
            'background-color': this.currentCard.line_color
          }
          this.breadCrumbItems.push({ label: 'View ' + this.currentCard.name, active: true })
          return card;
        }
        return null;
      }).then (card => {
        if(card != null){
          this.initView(card);
        }
      })
    } else {
      this.initView(this.currentCard);
    }
    this.loading = new Promise((resolve) => resolve(true));
  }

  initData(id: string) {
    return new Promise<Card>((resolve, reject) => {
      this.cardService.getById(id).then(card => {
        resolve(card);
      },err => console.error('Error in Card Viewer Admin', err));
    });
  }

  initView(card: Card): void {
    card.rows.forEach(row=>{
      if(row.components){
        row.components.forEach(component => {
          if(component.custom_item && component.custom_item.custom_script){
            var s = document.createElement("script");
            s.type = "text/javascript";
            s.src = component.custom_item.script_source_file;
            document.getElementById('script_anchor').appendChild(s);
          }
          if(component.custom_item && component.custom_item.custom_script != null){
            var t = document.createElement("script");
            t.type = "text/javascript";
            t.innerText = component.custom_item.custom_script;
            document.getElementById('script_anchor').appendChild(t);
          }
        })
      }
    })
  }
}
