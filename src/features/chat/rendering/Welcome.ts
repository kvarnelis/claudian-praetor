const WELCOME_BRAND_NAME = "Claude's Codex";

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({
    cls: 'claudes-codex-welcome-brand claudes-codex-welcome-text',
    text: WELCOME_BRAND_NAME,
  });

  if (greeting) {
    welcomeEl.createDiv({
      cls: 'claudes-codex-welcome-greeting claudes-codex-welcome-text',
      text: greeting,
    });
  }
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'claudes-codex-welcome' });
  renderWelcomeContent(welcomeEl, greeting);
  return welcomeEl;
}
