import { Injectable } from '@angular/core';
import { NotesService } from './notes.service';
import { PadsService } from './pads.service';
import { BinItem } from '../models/interfaces';
import { BehaviorSubject, combineLatest, map } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class BinService {
  private binItemsSubject = new BehaviorSubject<BinItem[]>([]);
  binItems$ = this.binItemsSubject.asObservable();

  constructor(
    private notesService: NotesService,
    private padsService: PadsService
  ) {}

  async loadBinItems() {
    try {
      const [binNotes, binPads] = await Promise.all([
        this.notesService.getBinNotes(),
        this.padsService.getBinPads()
      ]);

      const items: BinItem[] = [
        ...binNotes.map(n => ({
          id: n.id,
          type: 'task' as const,
          content: n.content,
          timestamp: n.timestamp
        })),
        ...binPads.map(p => ({
          id: p.id,
          type: 'pad' as const,
          content: p.title || 'Untitled Pad',
          timestamp: p.updated_at
        }))
      ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      this.binItemsSubject.next(items);
    } catch (err) {
      console.error('Failed to load bin items:', err);
    }
  }

  async restoreItem(item: { id: number; type: 'task' | 'pad' }) {
    if (item.type === 'task') {
      await this.notesService.restoreNote(item.id);
    } else {
      await this.padsService.restorePad(item.id);
    }
    await this.loadBinItems();
  }

  async permanentDeleteItem(item: { id: number; type: 'task' | 'pad' }) {
    if (item.type === 'task') {
      await this.notesService.permanentDeleteNote(item.id);
    } else {
      await this.padsService.permanentDeletePad(item.id);
    }
    await this.loadBinItems();
  }

  async clearBin() {
    await Promise.all([
      this.notesService.clearBin(),
      this.padsService.clearPadBin()
    ]);
    await this.loadBinItems();
  }
}
