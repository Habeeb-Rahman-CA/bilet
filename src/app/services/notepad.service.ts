import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NotepadService {
  private padLineMarks: { [padId: number]: Set<number> } = {};
  private lineMarksSubject = new BehaviorSubject<{ [padId: number]: Set<number> }>({});
  lineMarks$ = this.lineMarksSubject.asObservable();

  getLineMarks(padId: number): Set<number> {
    if (!this.padLineMarks[padId]) {
      this.padLineMarks[padId] = new Set<number>();
    }
    return this.padLineMarks[padId];
  }

  toggleLineMark(padId: number, num: number) {
    const marks = this.getLineMarks(padId);
    if (marks.has(num)) {
      marks.delete(num);
    } else {
      marks.add(num);
    }
    this.lineMarksSubject.next({ ...this.padLineMarks });
  }

  setLineMarks(padId: number, marks: Set<number>) {
    this.padLineMarks[padId] = marks;
    this.lineMarksSubject.next({ ...this.padLineMarks });
  }

  clearMarks(padId: number) {
    this.padLineMarks[padId] = new Set<number>();
    this.lineMarksSubject.next({ ...this.padLineMarks });
  }
}
