import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map, Observable } from 'rxjs';
import { Note } from '../models/interfaces';
import { NotesService } from './notes.service';

@Injectable({ providedIn: 'root' })
export class SearchService {
  private searchQuerySubject = new BehaviorSubject<string>('');
  searchQuery$ = this.searchQuerySubject.asObservable();

  constructor(private notesService: NotesService) {}

  setQuery(query: string) {
    this.searchQuerySubject.next(query);
  }

  getFilteredNotes(notes: Note[]): Note[] {
    const query = this.searchQuerySubject.value.trim().toLowerCase();
    if (!query) return [];
    return notes.filter(n => n.content.toLowerCase().includes(query));
  }
}
