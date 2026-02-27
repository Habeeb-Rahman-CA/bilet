import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { invoke } from "@tauri-apps/api/core";
import { FormsModule } from '@angular/forms';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { debounceTime, Subject } from 'rxjs';
import Database from '@tauri-apps/plugin-sql';


interface Note {
  id: number;
  content: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, FormsModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  db!: Database;
  notes: Note[] = [];
  newNote = '';
  editingNoteId: number | null = null;
  editContent = '';

  async ngOnInit() {
    console.log('Loading database...');
    try {
      this.db = await Database.load('sqlite:notes.db');
      console.log('Database loaded successfully');
      await this.loadNotes();
    } catch (err) {
      console.error('Failed to load database:', err);
    }
  }

  async loadNotes() {
    this.notes = await this.db.select<Note[]>(
      'SELECT * FROM notes'
    );
    console.log(`Loaded ${this.notes.length} notes`);
  }

  async addNote() {
    console.log('Adding note...', this.newNote);
    if (!this.db) {
      console.warn('Database not initialized');
      return;
    }
    if (!this.newNote.trim()) return;

    try {
      await this.db.execute(
        'INSERT INTO notes (content) VALUES (?1)',
        [this.newNote]
      );
      console.log('Note added to DB');
      this.newNote = '';
      await this.loadNotes();
    } catch (err) {
      console.error('Failed to add note:', err);
    }
  }

  startEdit(note: Note) {
    this.editingNoteId = note.id;
    this.editContent = note.content;
  }

  cancelEdit() {
    this.editingNoteId = null;
    this.editContent = '';
  }

  async updateNote() {
    if (!this.db || !this.editContent.trim() || this.editingNoteId === null) return;

    try {
      await this.db.execute(
        'UPDATE notes SET content = ?1 WHERE id = ?2',
        [this.editContent, this.editingNoteId]
      );
      this.editingNoteId = null;
      this.editContent = '';
      await this.loadNotes();
    } catch (err) {
      console.error('Failed to update note:', err);
    }
  }

  async deleteNote(id: number) {
    if (!this.db) return;
    await this.db.execute(
      'DELETE FROM notes WHERE id = ?1',
      [id]
    );

    await this.loadNotes();
  }

  async minimize() {
    const appWindow = getCurrentWindow();
    await appWindow.minimize();
  }

  async maximize() {
    const appWindow = getCurrentWindow();
    await appWindow.toggleMaximize();
  }

  async close() {
    const appWindow = getCurrentWindow();
    await appWindow.close();
  }
}
