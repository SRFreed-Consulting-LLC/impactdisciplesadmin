import { Injectable } from '@angular/core';
import { Timestamp } from 'firebase/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { TestimonialModel } from '@impact-common/shared/models/domain/testimonial.model';
import { dateFromTimestamp } from 'src/app/common/utils/date-from-timestamp';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class TestimonialService extends BaseService<TestimonialModel> {
  constructor(public override dao: FirebaseDAO<TestimonialModel>) {
    super(dao)
    this.table="testimonials"
    this.fromFirestore = TestimonialService.fromFirestore
  }

  static readonly fromFirestore = (data): TestimonialModel => {
    data.date = dateFromTimestamp(data.date as Timestamp)

    return data;
  };
}
