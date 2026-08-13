const WELCOME_BRAND_NAME = "Pocket Codex";

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({
    cls: 'pocket-codex-welcome-brand pocket-codex-welcome-text',
    text: WELCOME_BRAND_NAME,
  });

  if (greeting) {
    welcomeEl.createDiv({
      cls: 'pocket-codex-welcome-greeting pocket-codex-welcome-text',
      text: greeting,
    });
  }
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'pocket-codex-welcome' });
  renderWelcomeContent(welcomeEl, greeting);
  return welcomeEl;
}
