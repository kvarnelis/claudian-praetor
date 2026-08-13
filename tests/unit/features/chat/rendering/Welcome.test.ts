import { createMockEl } from '@test/helpers/mockElement';

import {
  createWelcomeElement,
  renderWelcomeContent,
} from '@/features/chat/rendering/Welcome';

describe('Welcome', () => {
  it('renders Praetor branding before the dynamic greeting', () => {
    const parentEl = createMockEl();

    const welcomeEl = createWelcomeElement(parentEl, 'Good morning');

    expect(welcomeEl.hasClass('praetor-welcome')).toBe(true);
    expect(welcomeEl.children).toHaveLength(2);
    expect(welcomeEl.children[0].hasClass('praetor-welcome-brand')).toBe(true);
    expect(welcomeEl.children[0].hasClass('praetor-welcome-text')).toBe(true);
    expect(welcomeEl.children[0].textContent).toBe('Praetor');
    expect(welcomeEl.children[1].hasClass('praetor-welcome-greeting')).toBe(true);
    expect(welcomeEl.children[1].hasClass('praetor-welcome-text')).toBe(true);
    expect(welcomeEl.children[1].textContent).toBe('Good morning');
  });

  it('replaces existing welcome content instead of duplicating branding', () => {
    const welcomeEl = createMockEl();

    renderWelcomeContent(welcomeEl, 'Hello');
    renderWelcomeContent(welcomeEl, 'Welcome back');

    expect(welcomeEl.children).toHaveLength(2);
    expect(welcomeEl.querySelectorAll('.praetor-welcome-brand')).toHaveLength(1);
    expect(welcomeEl.querySelector('.praetor-welcome-greeting')?.textContent)
      .toBe('Welcome back');
  });

  it('can render the brand before a greeting is available', () => {
    const parentEl = createMockEl();

    const welcomeEl = createWelcomeElement(parentEl);

    expect(welcomeEl.children).toHaveLength(1);
    expect(welcomeEl.children[0].textContent).toBe('Praetor');
  });
});
