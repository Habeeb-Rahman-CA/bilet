import { Injectable } from '@angular/core';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface FontEntry {
  name: string;
  family: string;
  isCustom?: boolean;
}

@Injectable({ providedIn: 'root' })
export class FontService {

  readonly defaultFonts: FontEntry[] = [
    { name: 'Cascadia Code', family: "'Cascadia Code', monospace" },
    { name: 'Fira Code', family: "'Fira Code', monospace" },
    { name: 'JetBrains Mono', family: "'JetBrains Mono', monospace" },
  ];

  async getCustomFonts(): Promise<any[]> {
    return invoke<any[]>('get_custom_fonts');
  }

  async uploadCustomFont(name: string, srcPath: string): Promise<string> {
    return invoke<string>('upload_custom_font', { name, srcPath });
  }

  async deleteCustomFont(name: string): Promise<void> {
    await invoke('delete_custom_font', { name });
  }

  async openFontDialog(): Promise<string | null> {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Font', extensions: ['ttf', 'otf'] }],
    });

    if (!selected) return null;
    return typeof selected === 'string' ? selected : String(selected);
  }

  /**
   * Registers a custom font with the browser's FontFace API.
   * Returns the CSS family name to use.
   */
  async registerFontFace(name: string, path: string): Promise<string> {
    const familyName = `Custom-${name}`;
    const assetUrl = convertFileSrc(path);

    try {
      const fontFace = new FontFace(familyName, `url("${assetUrl}")`);
      await fontFace.load();
      (document.fonts as any).add(fontFace);
    } catch (fontErr) {
      // Fallback: inject a <style> tag with @font-face
      const style = document.createElement('style');
      style.textContent = `@font-face { font-family: "${familyName}"; src: url("${assetUrl}"); }`;
      document.head.appendChild(style);
    }

    return familyName;
  }

  setFontCSSVariable(family: string): void {
    document.documentElement.style.setProperty('--main-font', family);
  }
}
