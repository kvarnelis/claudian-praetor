/**
 * Stand-in for the 'obsidian' module when Claudian sources are bundled into
 * the praetord daemon (plain Node, no Electron renderer).
 *
 * Only the runtime-reachable surface matters: storage adapters, provider
 * runtimes, and workspace services. UI classes are inert placeholders that
 * exist so bundled-but-unused settings/UI modules can be defined without
 * resolving against the real Obsidian API.
 */

export const Platform = {
  isDesktopApp: true,
  isMobile: false,
  isMobileApp: false,
  isIosApp: false,
  isAndroidApp: false,
  isPhone: false,
  isTablet: false,
  isMacOS: process.platform === 'darwin',
  isWin: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  isSafari: false,
};

export class Notice {
  constructor(message: unknown, _timeout?: number) {
    console.error('[notice]', String(message));
  }

  setMessage(_message: unknown): this {
    return this;
  }

  hide(): void {
    // no-op
  }
}

/** Returns `receiver` from every unknown method so builder chains keep working. */
function chainable<T extends object>(target: T): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol') return Reflect.get(t, prop, receiver);
      if (prop in t) return Reflect.get(t, prop, receiver);
      // Never look thenable; `await` probes for `then`.
      if (prop === 'then') return undefined;
      return (..._args: unknown[]) => receiver;
    },
  });
}

export class App {}
export class Component {
  load(): void {}
  unload(): void {}
  addChild<T>(child: T): T {
    return child;
  }
  removeChild<T>(child: T): T {
    return child;
  }
  register(_cb: unknown): void {}
  registerEvent(_ref: unknown): void {}
  registerInterval(id: number): number {
    return id;
  }
}
export class Events {
  on(): unknown {
    return {};
  }
  off(): void {}
  trigger(): void {}
}
export class Plugin extends Component {}
export class Modal {
  app: unknown;
  contentEl: unknown = chainable({});
  titleEl: unknown = chainable({});
  modalEl: unknown = chainable({});
  constructor(app?: unknown) {
    this.app = app;
  }
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}
export class ItemView extends Component {}
export class MarkdownView {}
export class PluginSettingTab {
  app: unknown;
  containerEl: unknown = chainable({});
  constructor(app?: unknown, _plugin?: unknown) {
    this.app = app;
  }
  display(): void {}
  hide(): void {}
}
export class Setting {
  constructor(..._args: unknown[]) {
    return chainable(this);
  }
}
export class Menu {
  constructor() {
    return chainable(this);
  }
}
export class Scope {
  register(): unknown {
    return {};
  }
  unregister(): void {}
}
export class TextAreaComponent {
  constructor(..._args: unknown[]) {
    return chainable(this);
  }
}
export class ToggleComponent {
  constructor(..._args: unknown[]) {
    return chainable(this);
  }
}
export class TAbstractFile {
  path = '';
  name = '';
}
export class TFile extends TAbstractFile {
  extension = '';
}
export class TFolder extends TAbstractFile {
  children: unknown[] = [];
}
export class Workspace {}
export class WorkspaceLeaf {}
export class Editor {}

export const MarkdownRenderer = {
  render: async (): Promise<void> => {
    // no-op: nothing renders in the daemon
  },
  renderMarkdown: async (): Promise<void> => {
    // no-op
  },
};

export function setIcon(_el: unknown, _icon: string): void {
  // no-op
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * Throws on purpose: utils/frontmatter.ts catches and falls back to its own
 * line-based parser, which covers the simple frontmatter used by commands,
 * skills, and agents.
 */
export function parseYaml(_yaml: string): unknown {
  throw new Error('parseYaml is unavailable in praetord; callers fall back to plain parsing');
}

export function stringifyYaml(_value: unknown): string {
  throw new Error('stringifyYaml is unavailable in praetord');
}

export const requestUrl = async (): Promise<never> => {
  throw new Error('requestUrl unavailable in praetord');
};

export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  wait = 0,
): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: never[]): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  return wrapped as unknown as T;
}
