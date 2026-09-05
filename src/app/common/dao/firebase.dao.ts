// The Firestore DAO is SHARED with the web site since 2026-09-05 (review
// item 9): @impact-common/shared/data/firebase.dao. This file keeps the
// import path the app's services use; add nothing here - a method belongs
// in the shared class, where the web gets it too.
export * from '@impact-common/shared/data/firebase.dao';
