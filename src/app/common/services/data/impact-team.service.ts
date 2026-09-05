import { Injectable } from '@angular/core';
import { collection, documentId, getDocs, query, where } from '@angular/fire/firestore';
import { FirebaseDAO } from 'src/app/common/dao/firebase.dao';
import { ImpactTeamMemberModel } from '@impact-common/shared/models/domain/impact-team-member.model';
import { tenantPath } from '@impact-common/shared/lists/tenancy';
import { BaseService } from './base.service';

@Injectable({
  providedIn: 'root'
})
export class ImpactTeamService extends BaseService<ImpactTeamMemberModel>{
  constructor(public override dao: FirebaseDAO<ImpactTeamMemberModel> ) {
    super(dao)
    this.table="impact_team"
    this.fromFirestore = ImpactTeamService.fromFirestore
  }

  static readonly fromFirestore = (data: ImpactTeamMemberModel): ImpactTeamMemberModel => {
    data.fullname = data.firstName + " " + data.lastName

    return data;
  };

  // Mirrors CoachService's own getAllByIds() (same batched-`in`-query
  // reasoning) - course-dialog.component.ts's combined picker and the
  // Agenda dialogs' name-resolution both need to look up a mixed list of
  // Coaches + Impact Team ids by id, and this keeps that a single batched
  // read per collection instead of N getById() calls.
  async getAllByIds(ids: string[]): Promise<ImpactTeamMemberModel[]> {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);

    if (uniqueIds.length === 0) return [];

    const chunkSize = 10;
    const chunks: string[][] = [];

    for (let i = 0; i < uniqueIds.length; i += chunkSize) {
      chunks.push(uniqueIds.slice(i, i + chunkSize));
    }

    const snapshots = await Promise.all(chunks.map(chunk =>
      // Through tenantPath (2026-09-05) - this was the database ROOT, which
      // the tenancy guard could not see because it is not a string literal,
      // so after the 2026-09-02 cutover it read an empty collection.
      getDocs(query(collection(this.dao.fs, '/' + tenantPath(this.table)), where(documentId(), 'in', chunk)))
    ));

    return snapshots.flatMap(snapshot =>
      snapshot.docs.map(doc => {
        const data = { ...doc.data(), id: doc.id } as ImpactTeamMemberModel;
        return this.fromFirestore ? this.fromFirestore(data) : data;
      })
    );
  }
}
