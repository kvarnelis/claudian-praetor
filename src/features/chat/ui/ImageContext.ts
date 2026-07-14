import { Notice } from 'obsidian';

import type { ImageAttachment, ImageMediaType } from '../../../core/types';
import { ComposerContextTray } from './ComposerContextTray';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** Filename extension (with dot) without relying on Node's `path` on mobile. */
function fileExtension(filename: string): string {
  if (!filename) return '';
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot) : '';
}

const IMAGE_EXTENSIONS: Record<string, ImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface ImageContextCallbacks {
  onImagesChanged?: () => void;
}

export class ImageContextManager {
  private callbacks: ImageContextCallbacks;
  private containerEl: HTMLElement;
  private contextTray: ComposerContextTray;
  private ownedContextTray: ComposerContextTray | null = null;
  private inputEl: HTMLTextAreaElement;
  private dropOverlay: HTMLElement | null = null;
  private attachedImages: Map<string, ImageAttachment> = new Map();
  private enabled = true;

  constructor(
    containerEl: HTMLElement,
    inputEl: HTMLTextAreaElement,
    callbacks: ImageContextCallbacks,
    previewContainerEl?: HTMLElement,
    contextTray?: ComposerContextTray,
  ) {
    this.containerEl = containerEl;
    this.inputEl = inputEl;
    this.callbacks = callbacks;
    const ownedTrayContainer = contextTray
      ? null
      : (previewContainerEl ?? containerEl).createDiv({ cls: 'claudian-context-row' });
    this.contextTray = contextTray ?? new ComposerContextTray(ownedTrayContainer!);
    if (!contextTray) {
      this.ownedContextTray = this.contextTray;
    }

    this.setupDragAndDrop();
    this.setupPasteHandler();
    this.setupAttachButton();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && this.attachedImages.size > 0) {
      this.clearImages();
    }
  }

  getAttachedImages(): ImageAttachment[] {
    return Array.from(this.attachedImages.values());
  }

  hasImages(): boolean {
    return this.attachedImages.size > 0;
  }

  clearImages() {
    this.attachedImages.clear();
    this.updateImagePreview();
    this.callbacks.onImagesChanged?.();
  }

  /** Sets images directly (used for queued messages). */
  setImages(images: ImageAttachment[]) {
    this.attachedImages.clear();
    for (const image of images) {
      this.attachedImages.set(image.id, image);
    }
    this.updateImagePreview();
    this.callbacks.onImagesChanged?.();
  }

  destroy(): void {
    this.contextTray.clearItems('images');
    this.contextTray.clearLeadingAccessory('image-attach');
    this.ownedContextTray?.destroy();
    this.ownedContextTray = null;
  }

  private setupDragAndDrop() {
    const inputWrapper = this.containerEl.querySelector('.claudian-input-wrapper') as HTMLElement;
    if (!inputWrapper) return;

    this.dropOverlay = inputWrapper.createDiv({ cls: 'claudian-drop-overlay' });
    const dropContent = this.dropOverlay.createDiv({ cls: 'claudian-drop-content' });
    const ownerDocument = inputWrapper.ownerDocument ?? window.document;
    const svg = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '32');
    svg.setAttribute('height', '32');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    const pathEl = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4');
    const polyline = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '17 8 12 3 7 8');
    const line = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12');
    line.setAttribute('y1', '3');
    line.setAttribute('x2', '12');
    line.setAttribute('y2', '15');
    svg.appendChild(pathEl);
    svg.appendChild(polyline);
    svg.appendChild(line);
    dropContent.appendChild(svg);
    dropContent.createSpan({ text: 'Drop image here' });

    const dropZone = inputWrapper;

    dropZone.addEventListener('dragenter', (e) => this.handleDragEnter(e));
    dropZone.addEventListener('dragover', (e) => this.handleDragOver(e));
    dropZone.addEventListener('dragleave', (e) => this.handleDragLeave(e));
    dropZone.addEventListener('drop', (e) => {
      void this.handleDrop(e);
    });
  }

  private handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (e.dataTransfer?.types.includes('Files')) {
      this.dropOverlay?.addClass('visible');
    }
  }

  private handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  private handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();

    const inputWrapper = this.containerEl.querySelector('.claudian-input-wrapper');
    if (!inputWrapper) {
      this.dropOverlay?.removeClass('visible');
      return;
    }

    const rect = inputWrapper.getBoundingClientRect();
    if (
      e.clientX <= rect.left ||
      e.clientX >= rect.right ||
      e.clientY <= rect.top ||
      e.clientY >= rect.bottom
    ) {
      this.dropOverlay?.removeClass('visible');
    }
  }

  private async handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    this.dropOverlay?.removeClass('visible');

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (this.isImageFile(file)) {
        await this.addImageFromFile(file, 'drop');
      }
    }
  }

  private setupAttachButton() {
    // An explicit attach button on every platform: on touch it's the only way
    // to attach an image (no clipboard paste or drag-drop into the input); on
    // desktop it sits alongside paste and drag-drop as a discoverable option.
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const button = ownerDocument.createElement('button');
    button.className = 'claudian-image-attach-btn';
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', 'Attach image');
    // Inline SVG rather than setIcon: on iOS, Obsidian's icon lookup paints an
    // empty button for some names / dynamically-created elements, so an inline
    // path is the only reliable option. This is Lucide's "paperclip" glyph.
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = ownerDocument.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const clipPath = ownerDocument.createElementNS(svgNs, 'path');
    clipPath.setAttribute('d', 'm21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48');
    svg.appendChild(clipPath);
    button.appendChild(svg);

    const fileInput = ownerDocument.createElement('input');
    fileInput.className = 'claudian-hidden';
    fileInput.setAttribute('type', 'file');
    fileInput.setAttribute('accept', 'image/*');
    fileInput.multiple = true;

    this.contextTray.setLeadingAccessory('image-attach', [button, fileInput]);

    button.addEventListener('click', () => {
      if (!this.enabled) {
        new Notice('Image attachments are not supported by this provider.');
        return;
      }
      fileInput.value = '';
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      void (async (): Promise<void> => {
        const files = fileInput.files;
        if (!files) return;
        for (let i = 0; i < files.length; i++) {
          await this.addImageFromFile(files[i], 'file');
        }
      })();
    });
  }

  private setupPasteHandler() {
    this.inputEl.addEventListener('paste', (e) => {
      void (async (): Promise<void> => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            await this.addImageFromFile(file, 'paste');
          }
          return;
        }
      }
      })();
    });
  }

  private isImageFile(file: File): boolean {
    return file.type.startsWith('image/') && this.getMediaType(file.name) !== null;
  }

  private getMediaType(filename: string): ImageMediaType | null {
    const ext = fileExtension(filename).toLowerCase();
    return IMAGE_EXTENSIONS[ext] || null;
  }

  private async addImageFromFile(file: File, source: ImageAttachment['source']): Promise<boolean> {
    if (!this.enabled) {
      new Notice('Image attachments are not supported by this provider.');
      return false;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      this.notifyImageError(`Image exceeds ${this.formatSize(MAX_IMAGE_SIZE)} limit.`);
      return false;
    }

    const mediaType = this.getMediaType(file.name) || (file.type as ImageMediaType);
    if (!mediaType) {
      this.notifyImageError('Unsupported image type.');
      return false;
    }

    try {
      const base64 = await this.fileToBase64(file);

      const attachment: ImageAttachment = {
        id: this.generateId(),
        name: file.name || `image-${Date.now()}.${mediaType.split('/')[1]}`,
        mediaType,
        data: base64,
        size: file.size,
        source,
      };

      this.attachedImages.set(attachment.id, attachment);
      this.updateImagePreview();
      this.callbacks.onImagesChanged?.();
      return true;
    } catch (error) {
      this.notifyImageError('Failed to attach image.', error);
      return false;
    }
  }

  private fileToBase64(file: File): Promise<string> {
    // FileReader works on both desktop Electron and the iOS webview; Node's
    // Buffer is unavailable on mobile. Fall back to arrayBuffer+btoa only where
    // FileReader is absent (the Node test environment).
    if (typeof FileReader !== 'undefined') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = typeof reader.result === 'string' ? reader.result : '';
          const comma = result.indexOf(',');
          resolve(comma >= 0 ? result.slice(comma + 1) : '');
        };
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'));
        reader.readAsDataURL(file);
      });
    }

    return file.arrayBuffer().then((arrayBuffer) => {
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    });
  }

  // ============================================
  // Private: Image Preview
  // ============================================

  private updateImagePreview() {
    if (this.attachedImages.size === 0) {
      this.contextTray.clearItems('images');
      return;
    }

    const images = Array.from(this.attachedImages);
    this.contextTray.setItems('images', images.map(([id, image], index) => ({
      id,
      kind: 'image' as const,
      label: images.length === 1 ? 'Image' : `Image ${index + 1}`,
      title: `${image.name} · ${this.formatSize(image.size)}`,
      ariaLabel: `Image attachment: ${image.name}`,
      onActivate: () => this.showFullImage(image),
      onRemove: () => {
        this.attachedImages.delete(id);
        this.updateImagePreview();
        this.callbacks.onImagesChanged?.();
      },
    })));
  }

  private showFullImage(image: ImageAttachment) {
    const ownerDocument = this.containerEl.ownerDocument ?? window.document;
    const overlay = ownerDocument.body.createDiv({ cls: 'claudian-image-modal-overlay' });
    const modal = overlay.createDiv({ cls: 'claudian-image-modal' });

    modal.createEl('img', {
      attr: {
        src: `data:${image.mediaType};base64,${image.data}`,
        alt: image.name,
      },
    });

    const closeBtn = modal.createDiv({ cls: 'claudian-image-modal-close' });
    closeBtn.setText('\u00D7');

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
      }
    };

    const close = () => {
      ownerDocument.removeEventListener('keydown', handleEsc);
      overlay.remove();
    };

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    ownerDocument.addEventListener('keydown', handleEsc);
  }

  private generateId(): string {
    return `img-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private notifyImageError(message: string, error?: unknown) {
    let userMessage = message;
    if (error instanceof Error) {
      if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
        userMessage = `${message} (File not found)`;
      } else if (error.message.includes('EACCES') || error.message.includes('permission denied')) {
        userMessage = `${message} (Permission denied)`;
      }
    }
    new Notice(userMessage);
  }
}
