/**
 * Claude's Codex - Instruction modal
 *
 * Unified modal that handles all instruction mode states:
 * - Loading (initial processing)
 * - Clarification (agent asks question)
 * - Confirmation (final instruction review)
 */

import type { App } from 'obsidian';
import { Modal, TextAreaComponent } from 'obsidian';

export type InstructionDecision = 'accept' | 'reject';

type ModalState = 'loading' | 'clarification' | 'confirmation';

export interface InstructionModalCallbacks {
  onAccept: (finalInstruction: string) => void;
  onReject: () => void;
  onClarificationSubmit: (response: string) => Promise<void>;
}

export class InstructionModal extends Modal {
  private rawInstruction: string;
  private callbacks: InstructionModalCallbacks;
  private state: ModalState = 'loading';
  private resolved = false;

  // UI elements
  private contentSectionEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private clarificationEl: HTMLElement | null = null;
  private confirmationEl: HTMLElement | null = null;
  private buttonsEl: HTMLElement | null = null;

  // Clarification state
  private clarificationTextEl: HTMLElement | null = null;
  private responseTextarea: TextAreaComponent | null = null;
  private isSubmitting = false;

  // Confirmation state
  private refinedInstruction: string = '';
  private editTextarea: TextAreaComponent | null = null;
  private isEditing = false;
  private refinedDisplayEl: HTMLElement | null = null;
  private editContainerEl: HTMLElement | null = null;
  private editBtnEl: HTMLButtonElement | null = null;

  constructor(
    app: App,
    rawInstruction: string,
    callbacks: InstructionModalCallbacks
  ) {
    super(app);
    this.rawInstruction = rawInstruction;
    this.callbacks = callbacks;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('claudes-codex-instruction-modal');
    this.setTitle('Add custom instruction');

    // User input section (always visible)
    const inputSection = contentEl.createDiv({ cls: 'claudes-codex-instruction-section' });
    const inputLabel = inputSection.createDiv({ cls: 'claudes-codex-instruction-label' });
    inputLabel.setText('Your input:');
    const inputText = inputSection.createDiv({ cls: 'claudes-codex-instruction-original' });
    inputText.setText(this.rawInstruction);

    // Main content section (changes based on state)
    this.contentSectionEl = contentEl.createDiv({ cls: 'claudes-codex-instruction-content-section' });

    // Loading state
    this.loadingEl = this.contentSectionEl.createDiv({ cls: 'claudes-codex-instruction-loading' });
    this.loadingEl.createDiv({ cls: 'claudes-codex-instruction-spinner' });
    this.loadingEl.createSpan({ text: 'Processing your instruction...' });

    // Clarification state (hidden initially)
    this.clarificationEl = this.contentSectionEl.createDiv({ cls: 'claudes-codex-instruction-clarification-section' });
    this.clarificationEl.addClass('claudes-codex-hidden');
    this.clarificationTextEl = this.clarificationEl.createDiv({ cls: 'claudes-codex-instruction-clarification' });

    const responseSection = this.clarificationEl.createDiv({ cls: 'claudes-codex-instruction-section' });
    const responseLabel = responseSection.createDiv({ cls: 'claudes-codex-instruction-label' });
    responseLabel.setText('Your response:');

    this.responseTextarea = new TextAreaComponent(responseSection);
    this.responseTextarea.inputEl.addClass('claudes-codex-instruction-response-textarea');
    this.responseTextarea.inputEl.rows = 3;
    this.responseTextarea.inputEl.placeholder = 'Provide more details...';

    this.responseTextarea.inputEl.addEventListener('keydown', (e) => {
      // Check !e.isComposing for IME support (Chinese, Japanese, Korean, etc.)
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !this.isSubmitting) {
        e.preventDefault();
        void this.submitClarification();
      }
    });

    // Confirmation state (hidden initially)
    this.confirmationEl = this.contentSectionEl.createDiv({ cls: 'claudes-codex-instruction-confirmation-section' });
    this.confirmationEl.addClass('claudes-codex-hidden');

    // Refined instruction display/edit
    const refinedSection = this.confirmationEl.createDiv({ cls: 'claudes-codex-instruction-section' });
    const refinedLabel = refinedSection.createDiv({ cls: 'claudes-codex-instruction-label' });
    refinedLabel.setText('Refined snippet:');

    this.refinedDisplayEl = refinedSection.createDiv({ cls: 'claudes-codex-instruction-refined' });
    this.editContainerEl = refinedSection.createDiv({ cls: 'claudes-codex-instruction-edit-container' });
    this.editContainerEl.addClass('claudes-codex-hidden');

    this.editTextarea = new TextAreaComponent(this.editContainerEl);
    this.editTextarea.inputEl.addClass('claudes-codex-instruction-edit-textarea');
    this.editTextarea.inputEl.rows = 4;

    // Buttons (changes based on state)
    this.buttonsEl = contentEl.createDiv({ cls: 'claudes-codex-instruction-buttons' });
    this.updateButtons();

    this.showState('loading');
  }

  showClarification(clarification: string) {
    if (this.clarificationTextEl) {
      this.clarificationTextEl.setText(clarification);
    }
    if (this.responseTextarea) {
      this.responseTextarea.setValue('');
    }
    this.isSubmitting = false;
    this.showState('clarification');
    this.responseTextarea?.inputEl.focus();
  }

  showConfirmation(refinedInstruction: string) {
    this.refinedInstruction = refinedInstruction;

    if (this.refinedDisplayEl) {
      this.refinedDisplayEl.setText(refinedInstruction);
    }
    if (this.editTextarea) {
      this.editTextarea.setValue(refinedInstruction);
    }

    this.showState('confirmation');
  }

  showError(error: string) {
    // Just close - the error notice will be shown by caller
    this.resolved = true;
    this.close();
  }

  showClarificationLoading() {
    this.isSubmitting = true;
    if (this.loadingEl) {
      this.loadingEl.querySelector('.claudes-codex-instruction-spinner');
      const text = this.loadingEl.querySelector('span');
      if (text) text.textContent = 'Processing...';
    }
    this.showState('loading');
  }

  private showState(state: ModalState) {
    this.state = state;

    if (this.loadingEl) {
      this.loadingEl.toggleClass('claudes-codex-hidden', state !== 'loading');
    }
    if (this.clarificationEl) {
      this.clarificationEl.toggleClass('claudes-codex-hidden', state !== 'clarification');
    }
    if (this.confirmationEl) {
      this.confirmationEl.toggleClass('claudes-codex-hidden', state !== 'confirmation');
    }

    this.updateButtons();
  }

  private updateButtons() {
    if (!this.buttonsEl) return;
    this.buttonsEl.empty();

    const cancelBtn = this.buttonsEl.createEl('button', {
      text: 'Cancel',
      cls: 'claudes-codex-instruction-btn claudes-codex-instruction-reject-btn',
      attr: { 'aria-label': 'Cancel' }
    });
    cancelBtn.addEventListener('click', () => this.handleReject());

    if (this.state === 'clarification') {
      const submitBtn = this.buttonsEl.createEl('button', {
        text: 'Submit',
        cls: 'claudes-codex-instruction-btn claudes-codex-instruction-accept-btn',
        attr: { 'aria-label': 'Submit response' }
      });
      submitBtn.addEventListener('click', () => {
        void this.submitClarification();
      });
    } else if (this.state === 'confirmation') {
      this.editBtnEl = this.buttonsEl.createEl('button', {
        text: 'Edit',
        cls: 'claudes-codex-instruction-btn claudes-codex-instruction-edit-btn',
        attr: { 'aria-label': 'Edit instruction' }
      });
      this.editBtnEl.addEventListener('click', () => this.toggleEdit());

      const acceptBtn = this.buttonsEl.createEl('button', {
        text: 'Accept',
        cls: 'claudes-codex-instruction-btn claudes-codex-instruction-accept-btn',
        attr: { 'aria-label': 'Accept instruction' }
      });
      acceptBtn.addEventListener('click', () => this.handleAccept());
      acceptBtn.focus();
    }
  }

  private async submitClarification() {
    const response = this.responseTextarea?.getValue().trim();
    if (!response || this.isSubmitting) return;

    this.showClarificationLoading();

    try {
      await this.callbacks.onClarificationSubmit(response);
    } catch {
      // On error, go back to clarification state
      this.isSubmitting = false;
      this.showState('clarification');
    }
  }

  private toggleEdit() {
    this.isEditing = !this.isEditing;

    if (this.isEditing) {
      this.refinedDisplayEl?.addClass('claudes-codex-hidden');
      this.editContainerEl?.removeClass('claudes-codex-hidden');
      if (this.editBtnEl) this.editBtnEl.setText('Preview');
      this.editTextarea?.inputEl.focus();
    } else {
      const edited = this.editTextarea?.getValue() || this.refinedInstruction;
      this.refinedInstruction = edited;
      if (this.refinedDisplayEl) {
        this.refinedDisplayEl.setText(edited);
        this.refinedDisplayEl.removeClass('claudes-codex-hidden');
      }
      this.editContainerEl?.addClass('claudes-codex-hidden');
      if (this.editBtnEl) this.editBtnEl.setText('Edit');
    }
  }

  private handleAccept() {
    if (this.resolved) return;
    this.resolved = true;

    const finalInstruction = this.isEditing
      ? (this.editTextarea?.getValue() || this.refinedInstruction)
      : this.refinedInstruction;

    this.callbacks.onAccept(finalInstruction);
    this.close();
  }

  private handleReject() {
    if (this.resolved) return;
    this.resolved = true;
    this.callbacks.onReject();
    this.close();
  }

  onClose() {
    if (!this.resolved) {
      this.resolved = true;
      this.callbacks.onReject();
    }
    this.contentEl.empty();
  }
}
