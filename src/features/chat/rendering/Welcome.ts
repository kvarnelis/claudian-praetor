const WELCOME_BRAND_NAME = 'Praetor';

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({
    cls: 'praetor-welcome-brand praetor-welcome-text',
    text: WELCOME_BRAND_NAME,
  });

  if (greeting) {
    welcomeEl.createDiv({
      cls: 'praetor-welcome-greeting praetor-welcome-text',
      text: greeting,
    });
  }
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'praetor-welcome' });
  renderWelcomeContent(welcomeEl, greeting);
  return welcomeEl;
}
