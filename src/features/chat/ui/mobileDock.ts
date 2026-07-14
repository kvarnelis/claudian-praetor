import { Platform } from 'obsidian';

import type { FeatureHost } from '../../FeatureHost';

const BODY_CLASS = 'claudian-ipad-docked';
const DRAWER_CLASS = 'claudian-dock-drawer';
const ROOT_CLASS = 'claudian-dock-root';

/**
 * iPad side-by-side dock.
 *
 * Obsidian's mobile sidebars slide over the editor and never pin — even in
 * landscape — and main-area splits don't work on mobile. So for the "Beside
 * editor (split)" placement on a tablet we keep Claudian in the right drawer
 * but re-style it: dock the drawer to a fixed-width right column and shrink the
 * editor area to sit beside it (all sizing lives in mobile-dock.css). We toggle
 * marker classes on the *actual* drawer/root elements (found via the view's DOM
 * ancestor and the workspace API, not by guessing Obsidian's internal class
 * names) and re-apply on layout changes, because Obsidian rewrites drawer styles
 * whenever it opens or closes a leaf.
 */
const DOCK_WIDTH_KEY = 'claudian-dock-width';
const MIN_DOCK_PX = 280;

export class MobileDock {
  private handleEl: HTMLElement | null = null;

  constructor(private readonly plugin: FeatureHost) {}

  private get enabledForLayout(): boolean {
    return Boolean(Platform?.isMobile)
      && this.plugin.settings.chatViewPlacement === 'main-split-right';
  }

  /** Apply or clear the dock to match the current placement + open state. */
  sync(): void {
    if (this.enabledForLayout && this.plugin.getView()) {
      this.apply();
    } else {
      this.clear();
    }
  }

  clear(): void {
    if (typeof document === 'undefined') return;
    this.handleEl?.remove();
    this.handleEl = null;
    document.body.classList.remove(BODY_CLASS);
    for (const el of Array.from(document.querySelectorAll(`.${DRAWER_CLASS}`))) {
      el.classList.remove(DRAWER_CLASS);
    }
    for (const el of Array.from(document.querySelectorAll(`.${ROOT_CLASS}`))) {
      el.classList.remove(ROOT_CLASS);
    }
  }

  private apply(): void {
    if (typeof document === 'undefined') return;
    const view = this.plugin.getView();
    const drawer = view?.containerEl?.closest(
      '.workspace-drawer, .workspace-split.mod-right-split, .mod-right',
    );
    const root = this.getRootEl();
    if (!drawer || !root) {
      this.clear();
      return;
    }

    // Reset stale markers (the drawer/root elements can change across layouts).
    this.clear();
    document.body.classList.add(BODY_CLASS);
    drawer.classList.add(DRAWER_CLASS);
    root.classList.add(ROOT_CLASS);
    this.restorePersistedWidth();
    this.ensureHandle();
  }

  private restorePersistedWidth(): void {
    try {
      const saved = window.localStorage?.getItem(DOCK_WIDTH_KEY);
      if (saved) document.body.style.setProperty('--claudian-dock-width', saved);
    } catch {
      // localStorage may be unavailable; fall back to the CSS default.
    }
  }

  private ensureHandle(): void {
    if (this.handleEl?.isConnected) return;
    const handle = document.body.createDiv({ cls: 'claudian-dock-handle' });
    this.handleEl = handle;

    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const fromRight = window.innerWidth - e.clientX;
      const width = Math.max(MIN_DOCK_PX, Math.min(window.innerWidth * 0.75, fromRight));
      document.body.style.setProperty('--claudian-dock-width', `${Math.round(width)}px`);
    });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      try {
        handle.releasePointerCapture(e.pointerId);
        const value = document.body.style.getPropertyValue('--claudian-dock-width');
        if (value) window.localStorage?.setItem(DOCK_WIDTH_KEY, value);
      } catch {
        // ignore capture/storage errors
      }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  private getRootEl(): Element | null {
    const rootSplit = this.plugin.app.workspace.rootSplit as unknown as {
      containerEl?: HTMLElement;
    };
    return rootSplit?.containerEl ?? document.querySelector('.workspace-split.mod-root');
  }
}
