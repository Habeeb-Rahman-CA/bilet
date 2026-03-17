import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewChecked, OnInit, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Note } from '../../models/interfaces';
import { SearchService } from '../../services/search.service';
import { NotesService } from '../../services/notes.service';
import { Observable, combineLatest, map, take } from 'rxjs';

@Component({
  selector: 'app-search',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './search.component.html',
  styleUrl: './search.component.css'
})
export class SearchComponent implements OnInit, OnChanges, AfterViewChecked {
  @Input() show: boolean = false;
  @Input() selectedNoteId: number | null = null;
  
  @Output() close = new EventEmitter<void>();
  @Output() selectResult = new EventEmitter<Note>();

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  searchQuery = '';
  filteredNotes$: Observable<Note[]>;
  private needsFocus = false;

  constructor(
    private searchService: SearchService,
    private notesService: NotesService
  ) {
    this.filteredNotes$ = combineLatest([
      this.notesService.notes$,
      this.searchService.searchQuery$
    ]).pipe(
      map(([notes, query]) => this.searchService.getFilteredNotes(notes))
    );
  }

  ngOnInit() {
    this.searchService.searchQuery$.subscribe(q => this.searchQuery = q);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent) {
    if (!this.show) return;

    if (event.key === "Escape") {
      this.close.emit();
      event.preventDefault();
      return;
    }

    this.filteredNotes$.pipe(take(1)).subscribe(items => {
      if (items.length === 0) return;

      const currentIndex = items.findIndex(n => n.id === this.selectedNoteId);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = (currentIndex + 1) % items.length;
        this.selectResult.emit(items[nextIndex]);
        this.scrollSelectedIntoView();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const prevIndex = (currentIndex - 1 + items.length) % items.length;
        this.selectResult.emit(items[prevIndex]);
        this.scrollSelectedIntoView();
      } else if (event.key === "Enter") {
        if (this.selectedNoteId) {
          const selected = items.find(n => n.id === this.selectedNoteId);
          if (selected) {
            this.selectResult.emit(selected);
            this.close.emit();
            event.preventDefault();
          }
        }
      }
    });
  }

  private scrollSelectedIntoView() {
    setTimeout(() => {
      const element = document.querySelector(".search-result-item.selected");
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }, 10);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['show']?.currentValue) {
      this.needsFocus = true;
    }
  }

  ngAfterViewChecked() {
    if (this.show && this.needsFocus && this.searchInput) {
      this.searchInput.nativeElement.focus();
      this.needsFocus = false;
    }
  }

  onQueryChange(query: string) {
    this.searchService.setQuery(query);
  }

  formatContent(content: string): string {
    // Basic formatting for preview
    return content || '';
  }

  formatDate(timestamp: string): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}
