#!/usr/bin/env node
/**
 * Mobile (iOS) load simulation for the built plugin bundle (main.js).
 *
 * Obsidian ships one CJS main.js to every platform. On iOS there is no Node:
 * `require('fs')` & friends throw, `process`/`Buffer`/`__dirname` are not
 * defined, and the plugin loader only resolves 'obsidian' plus a few editor
 * packages. This harness re-creates those conditions in-process:
 *
 *  - The bundle is compiled with `new Function('require','module',...)` so we
 *    control the module scope. Node-ish globals (`process`, `Buffer`,
 *    `global`, `setImmediate`, `__dirname`, `__filename`) are shadowed to
 *    `undefined` on the mobile pass, exactly as on iOS.
 *  - `require('obsidian')` returns an inline mock; `electron`/`@codemirror/*`
 *    return stubs; every Node builtin throws `MOBILE-VIOLATION: ...`.
 *    A *caught* violation (the lazy requireNodeModule pattern) is recorded as
 *    informational; an *uncaught* one fails the run with an attributed stack.
 *  - Stack lines are mapped back to source modules using esbuild's
 *    `// src/...` banner comments in the bundle.
 *
 * A second, best-effort DESKTOP pass runs the same bundle with real Node
 * builtins to prove the harness isn't trivially green. Mobile must fully
 * pass; desktop may be reported as partial (deep Obsidian APIs are mocked).
 *
 * Exit code: 0 when the mobile pass (and probes) fully pass, else 1.
 */

import { readFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import nodeProcess from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUNDLE_PATH = path.join(ROOT, 'main.js');
const VIEW_TYPE_CLAUDES_CODEX = 'claudes-codex-view';

const realRequire = createRequire(import.meta.url);

// --- Node builtin detection -------------------------------------------------

const NODE_BUILTINS = new Set(builtinModules);
function isNodeBuiltin(name) {
  const bare = name.startsWith('node:') ? name.slice('node:'.length) : name;
  return NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split('/')[0]);
}

// --- Bundle + stack attribution ----------------------------------------------

const bundleSource = readFileSync(BUNDLE_PATH, 'utf8');

const moduleBanners = [];
{
  const lines = bundleSource.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\/\/ ((?:src|node_modules|\.codex-vendor)\/.*)$/);
    if (m) moduleBanners.push({ line: i + 1, label: m[1] });
  }
}

function attributeBundleLine(lineNo) {
  let best = null;
  for (const banner of moduleBanners) {
    if (banner.line <= lineNo) best = banner;
    else break;
  }
  return best ? best.label : '(bundle prelude)';
}

const FN_PARAMS = [
  'require', 'module', 'exports',
  // Node globals absent from the iOS webview — shadowed per pass.
  'process', 'Buffer', 'global', 'setImmediate', 'clearImmediate',
  '__dirname', '__filename',
  // Webview globals absent from Node — provided per pass.
  'window', 'document', 'navigator', 'localStorage',
  'requestAnimationFrame', 'cancelAnimationFrame',
  'activeWindow', 'activeDocument',
];

// new Function() prepends a header before the body; calibrate the line offset
// so stack line numbers can be mapped onto bundle line numbers.
const LINE_OFFSET = (() => {
  const probe = new Function(...FN_PARAMS, 'return new Error("calib");')();
  const m = probe.stack.match(/<anonymous>:(\d+):\d+/);
  return m ? Number(m[1]) - 1 : 2;
})();

function attributeStack(stack) {
  if (typeof stack !== 'string') return [];
  const frames = [];
  for (const line of stack.split('\n')) {
    const m = line.match(/<anonymous>:(\d+):(\d+)/);
    if (!m) continue;
    const bundleLine = Number(m[1]) - LINE_OFFSET;
    if (bundleLine < 1) continue;
    frames.push({ bundleLine, module: attributeBundleLine(bundleLine) });
  }
  return frames;
}

function formatAttributedStack(stack) {
  const frames = attributeStack(stack);
  if (frames.length === 0) return '    (no bundle frames found in stack)';
  return frames
    .map((f) => `    at main.js:${f.bundleLine}  [${f.module}]`)
    .join('\n');
}

// --- DOM-ish chainable stubs --------------------------------------------------

function makeChainable(name) {
  const target = function chainableShell() {};
  target.__shellName = name;
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => `[${name}]`;
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (!(prop in t)) {
        t[prop] = (...args) => {
          // DOM-ish creators should hand back fresh element-like shells.
          if (prop === 'createEl' || prop === 'createDiv' || prop === 'createSpan') {
            return makeChainable(`${name}.${String(prop)}`);
          }
          return proxy;
        };
      }
      return t[prop];
    },
    apply() {
      return proxy;
    },
  });
  return proxy;
}

/** Class shell: instances answer any method chainably, `extends` works. */
function chainableClass(name) {
  return class ChainableShell {
    constructor(...args) {
      this.__shellName = name;
      const proxy = new Proxy(this, {
        get(t, prop, receiver) {
          if (prop in t) return Reflect.get(t, prop, receiver);
          if (prop === Symbol.toPrimitive || prop === 'toString') return () => `[${name}]`;
          if (prop === 'then' || typeof prop === 'symbol') return undefined;
          if (prop === 'containerEl' || prop === 'contentEl' || prop === 'modalEl' || prop === 'titleEl') {
            const el = makeChainable(`${name}.${String(prop)}`);
            t[prop] = el;
            return el;
          }
          const fn = (...args) => proxy;
          t[prop] = fn;
          return fn;
        },
      });
      return proxy;
    }
  };
}

// --- Obsidian mock -------------------------------------------------------------

function createObsidianMock(platformKind) {
  const spies = {
    notices: [],
    registeredViews: [],
    commands: [],
    ribbonIcons: 0,
    settingTabs: 0,
    accessedExports: new Set(),
  };

  const isMobile = platformKind === 'mobile';
  const Platform = {
    isDesktopApp: !isMobile,
    isMobile: isMobile,
    isMobileApp: isMobile,
    isIosApp: isMobile,
    isAndroidApp: false,
    isMacOS: !isMobile,
    isWin: false,
    isLinux: false,
    isPhone: false,
    isTablet: isMobile,
    isSafari: isMobile,
    resourcePathPrefix: isMobile ? 'capacitor://localhost/_capacitor_file_' : 'app://obsidian.md/',
  };

  class Plugin {
    constructor(app, manifest) {
      this.app = app;
      this.manifest = manifest;
      this.loadData = async () => ({});
      this.saveData = async () => {};
    }
    addRibbonIcon() { spies.ribbonIcons += 1; return makeChainable('RibbonIcon'); }
    addCommand(cmd) { spies.commands.push(cmd?.id ?? '(no id)'); return cmd; }
    registerView(type, factory) { spies.registeredViews.push({ type, factory }); }
    addSettingTab() { spies.settingTabs += 1; }
    registerEvent() {}
    registerDomEvent() {}
    registerInterval(id) { return id; }
    register() {}
    addStatusBarItem() { return makeChainable('StatusBarItem'); }
  }

  class Notice {
    constructor(message) {
      spies.notices.push(String(message));
      console.log(`  [notice:${platformKind}]`, String(message).slice(0, 200));
    }
    setMessage() { return this; }
    hide() {}
  }

  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = makeChainable('PluginSettingTab.containerEl');
    }
    display() {}
    hide() {}
  }

  class Events {
    on() { return { __eventRef: true }; }
    off() {}
    offref() {}
    trigger() {}
    tryTrigger() {}
  }

  const exportsTable = {
    Platform,
    Plugin,
    Notice,
    PluginSettingTab,
    Events,
    Modal: chainableClass('Modal'),
    Setting: chainableClass('Setting'),
    MarkdownView: chainableClass('MarkdownView'),
    ItemView: chainableClass('ItemView'),
    Component: chainableClass('Component'),
    TFile: chainableClass('TFile'),
    TFolder: chainableClass('TFolder'),
    TAbstractFile: chainableClass('TAbstractFile'),
    Menu: chainableClass('Menu'),
    Scope: chainableClass('Scope'),
    TextAreaComponent: chainableClass('TextAreaComponent'),
    ToggleComponent: chainableClass('ToggleComponent'),
    TextComponent: chainableClass('TextComponent'),
    ButtonComponent: chainableClass('ButtonComponent'),
    DropdownComponent: chainableClass('DropdownComponent'),
    ExtraButtonComponent: chainableClass('ExtraButtonComponent'),
    SliderComponent: chainableClass('SliderComponent'),
    AbstractInputSuggest: chainableClass('AbstractInputSuggest'),
    SuggestModal: chainableClass('SuggestModal'),
    FuzzySuggestModal: chainableClass('FuzzySuggestModal'),
    MarkdownRenderChild: chainableClass('MarkdownRenderChild'),
    MarkdownRenderer: Object.assign(chainableClass('MarkdownRenderer'), {
      render: async () => {},
      renderMarkdown: async () => {},
    }),
    setIcon: () => {},
    setTooltip: () => {},
    normalizePath: (p) => p,
    requestUrl: async () => { throw new Error('requestUrl mock'); },
    parseYaml: () => ({}),
    stringifyYaml: () => '',
    debounce: (fn) => {
      const wrapped = (...args) => fn(...args);
      wrapped.cancel = () => wrapped;
      wrapped.run = (...args) => fn(...args);
      return wrapped;
    },
    addIcon: () => {},
    getIcon: () => null,
    htmlToMarkdown: (html) => String(html),
    prepareFuzzySearch: () => () => null,
    moment: Object.assign(() => makeChainable('moment'), { locale: () => 'en' }),
  };

  // Getter-per-export keeps access tracking alive even through esbuild's
  // __toESM/__copyProps re-export shims (they delegate to these getters).
  const mock = {};
  for (const [key, value] of Object.entries(exportsTable)) {
    Object.defineProperty(mock, key, {
      enumerable: true,
      configurable: true,
      get() {
        spies.accessedExports.add(key);
        return value;
      },
    });
  }
  Object.defineProperty(mock, '__spies', { enumerable: false, value: spies });
  return mock;
}

// --- Browser-ish globals (the iOS webview has these; Node does not) -----------

function createMemoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  };
}

function createBrowserGlobals() {
  // Timers .unref() so a stray reconnect timer cannot keep the harness alive.
  const setTimeoutUnref = (fn, ms, ...args) => {
    const t = setTimeout(fn, ms, ...args);
    t.unref?.();
    return t;
  };
  const setIntervalUnref = (fn, ms, ...args) => {
    const t = setInterval(fn, ms, ...args);
    t.unref?.();
    return t;
  };
  const raf = (cb) => setTimeoutUnref(() => cb(Date.now()), 0);
  const caf = (id) => clearTimeout(id);

  const localStorage = createMemoryStorage();
  const documentStub = makeChainable('document');
  const win = {
    setTimeout: setTimeoutUnref,
    clearTimeout: (t) => clearTimeout(t),
    setInterval: setIntervalUnref,
    clearInterval: (t) => clearInterval(t),
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    localStorage,
    sessionStorage: createMemoryStorage(),
    crypto: globalThis.crypto,
    document: documentStub,
    navigator: { userAgent: "Claude's Codex mobile-load-harness", language: 'en' },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    open: () => null,
    location: { href: 'app://obsidian.md/index.html' },
  };
  win.window = win;
  win.activeWindow = win;
  win.activeDocument = documentStub;

  return {
    window: win,
    document: documentStub,
    navigator: win.navigator,
    localStorage,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    activeWindow: win,
    activeDocument: documentStub,
  };
}

// --- Fake Obsidian app ----------------------------------------------------------

function createFakeApp({ withBasePath }) {
  const files = new Map();
  const folders = new Set(['']);

  const norm = (p) => String(p ?? '').replace(/^\.\//, '').replace(/\/+$/, '');

  const adapter = {
    async exists(p) {
      const key = norm(p);
      return files.has(key) || folders.has(key);
    },
    async read(p) {
      const key = norm(p);
      if (!files.has(key)) throw new Error(`ENOENT (harness adapter): ${key}`);
      return files.get(key);
    },
    async write(p, data) {
      files.set(norm(p), String(data));
    },
    async mkdir(p) {
      const key = norm(p);
      const parts = key.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        folders.add(current);
      }
    },
    async list(p) {
      const prefix = norm(p);
      const depth = prefix === '' ? 0 : prefix.split('/').length;
      const childOf = (key) =>
        (prefix === '' ? key !== '' : key.startsWith(`${prefix}/`))
        && key.split('/').length === depth + 1;
      return {
        files: [...files.keys()].filter(childOf),
        folders: [...folders].filter(childOf),
      };
    },
    async stat(p) {
      const key = norm(p);
      if (files.has(key)) {
        return { type: 'file', ctime: Date.now(), mtime: Date.now(), size: files.get(key).length };
      }
      if (folders.has(key)) {
        return { type: 'folder', ctime: Date.now(), mtime: Date.now(), size: 0 };
      }
      return null;
    },
    async remove(p) {
      files.delete(norm(p));
    },
    async rmdir(p) {
      folders.delete(norm(p));
    },
    async rename(a, b) {
      const from = norm(a);
      const to = norm(b);
      if (files.has(from)) {
        files.set(to, files.get(from));
        files.delete(from);
      }
      if (folders.has(from)) {
        folders.delete(from);
        folders.add(to);
      }
    },
    async append(p, data) {
      const key = norm(p);
      files.set(key, (files.get(key) ?? '') + String(data));
    },
  };
  // iOS (Capacitor) adapters expose no basePath; desktop FileSystemAdapter does.
  if (withBasePath) adapter.basePath = path.join(os.tmpdir(), 'claudes-codex-harness-vault');

  const eventRef = () => ({ __eventRef: true });
  return {
    vault: {
      adapter,
      configDir: '.obsidian',
      getName: () => 'harness',
      getRoot: () => ({ path: '/', children: [] }),
      getAbstractFileByPath: () => null,
      getMarkdownFiles: () => [],
      getFiles: () => [],
      getAllLoadedFiles: () => [],
      on: eventRef,
      off: () => {},
      offref: () => {},
      cachedRead: async () => '',
      read: async () => '',
      create: async () => ({}),
      createFolder: async () => ({}),
      delete: async () => {},
      trigger: () => {},
    },
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => null,
      getLeftLeaf: () => null,
      getRightLeaf: () => null,
      getActiveViewOfType: () => null,
      getActiveFile: () => null,
      onLayoutReady: (cb) => { if (typeof cb === 'function') cb(); },
      on: eventRef,
      off: () => {},
      offref: () => {},
      trigger: () => {},
      requestSaveLayout: () => {},
      detachLeavesOfType: () => {},
      revealLeaf: async () => {},
      setActiveLeaf: () => {},
    },
    metadataCache: {
      on: eventRef,
      off: () => {},
      offref: () => {},
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
    },
    fileManager: { processFrontMatter: async () => {} },
    keymap: {},
    scope: {},
    setting: { open: () => {}, openTabById: () => {} },
    internalPlugins: { getPluginById: () => null },
    loadLocalStorage: () => null,
    saveLocalStorage: () => {},
  };
}

// --- Require factories ----------------------------------------------------------

// Obsidian (desktop AND mobile) provides real @codemirror modules to plugins;
// several eager chat/inline-edit modules call define()/subclass WidgetType at
// module scope, so the stub must be structurally plausible, not just {}.
function createCodemirrorStub(name) {
  if (name === '@codemirror/state') {
    return {
      StateEffect: {
        define: () => ({ of: (value) => ({ value }) }),
        appendConfig: { of: (value) => ({ value }) },
      },
      StateField: { define: (spec) => ({ __stateField: true, spec }) },
      RangeSetBuilder: class RangeSetBuilder {
        add() {}
        finish() { return { __rangeSet: true }; }
      },
      Annotation: { define: () => ({ of: (value) => ({ value }) }) },
      EditorState: class EditorState {},
      EditorSelection: { cursor: () => ({}), range: () => ({}) },
      Text: class Text {},
    };
  }
  if (name === '@codemirror/view') {
    return {
      Decoration: {
        none: { __emptyDecorationSet: true },
        mark: () => ({}),
        widget: () => ({}),
        line: () => ({}),
        set: () => ({ __decorationSet: true }),
      },
      EditorView: Object.assign(class EditorView {}, {
        decorations: { from: () => ({}) },
        theme: () => [],
        baseTheme: () => [],
        updateListener: { of: () => ({}) },
      }),
      WidgetType: class WidgetType {},
      ViewPlugin: { fromClass: () => ({}), define: () => ({}) },
      keymap: { of: () => ({}) },
    };
  }
  return {};
}

function makeRequire({ platformKind, obsidianMock, attempts }) {
  const stubCache = new Map();
  return function harnessRequire(name) {
    if (name === 'obsidian') return obsidianMock;
    if (name === 'electron' || name.startsWith('@codemirror/') || name.startsWith('@lezer/')) {
      if (!stubCache.has(name)) stubCache.set(name, createCodemirrorStub(name));
      return stubCache.get(name);
    }
    if (isNodeBuiltin(name)) {
      if (platformKind === 'desktop') return realRequire(name);
      const err = new Error(`MOBILE-VIOLATION: require('${name}')`);
      attempts.push({ name, stack: err.stack });
      throw err;
    }
    // Everything else should have been bundled; surface it loudly.
    const err = new Error(
      platformKind === 'mobile'
        ? `MOBILE-VIOLATION: require('${name}') (module is not bundled and not available on iOS)`
        : `Harness: unexpected external require('${name}')`,
    );
    if (platformKind === 'mobile') attempts.push({ name, stack: err.stack });
    throw err;
  };
}

// --- Pass runner -----------------------------------------------------------------

async function runPass(platformKind) {
  const result = {
    platformKind,
    bundleEvaluated: false,
    onloadResolved: false,
    probeFailures: [],
    handledRequireAttempts: [],
    fatalError: null,
    spies: null,
  };

  const obsidianMock = createObsidianMock(platformKind);
  const spies = obsidianMock.__spies;
  result.spies = spies;
  const attempts = [];
  const requireFn = makeRequire({ platformKind, obsidianMock, attempts });
  const browserGlobals = createBrowserGlobals();
  const moduleShim = { exports: {} };

  const args = {
    require: requireFn,
    module: moduleShim,
    exports: moduleShim.exports,
    process: platformKind === 'desktop' ? process : undefined,
    Buffer: platformKind === 'desktop' ? Buffer : undefined,
    global: platformKind === 'desktop' ? globalThis : undefined,
    setImmediate: platformKind === 'desktop' ? setImmediate : undefined,
    clearImmediate: platformKind === 'desktop' ? clearImmediate : undefined,
    __dirname: platformKind === 'desktop' ? ROOT : undefined,
    __filename: platformKind === 'desktop' ? BUNDLE_PATH : undefined,
    window: browserGlobals.window,
    document: browserGlobals.document,
    navigator: browserGlobals.navigator,
    localStorage: browserGlobals.localStorage,
    requestAnimationFrame: browserGlobals.requestAnimationFrame,
    cancelAnimationFrame: browserGlobals.cancelAnimationFrame,
    activeWindow: browserGlobals.activeWindow,
    activeDocument: browserGlobals.activeDocument,
  };

  try {
    const evaluate = new Function(...FN_PARAMS, bundleSource);
    evaluate(...FN_PARAMS.map((p) => args[p]));
    result.bundleEvaluated = true;

    const PluginClass = moduleShim.exports?.default ?? moduleShim.exports;
    if (typeof PluginClass !== 'function') {
      throw new Error(`Bundle did not export a plugin class (got ${typeof PluginClass})`);
    }

    const app = createFakeApp({ withBasePath: platformKind === 'desktop' });
    const plugin = new PluginClass(app, { id: 'claudes-codex', name: "Claude's Codex", version: '0.0.0' });
    await plugin.onload();
    result.onloadResolved = true;

    // Probe: view registration happened.
    const viewTypes = spies.registeredViews.map((v) => v.type);
    if (!viewTypes.includes(VIEW_TYPE_CLAUDES_CODEX)) {
      result.probeFailures.push(`registerView was not called with '${VIEW_TYPE_CLAUDES_CODEX}' (saw: ${JSON.stringify(viewTypes)})`);
    }
    if (!plugin.settings || typeof plugin.settings !== 'object') {
      result.probeFailures.push('plugin.settings was not populated by loadSettings()');
    }
    if (spies.settingTabs < 1) {
      result.probeFailures.push('addSettingTab was never called');
    }

    // Probe: ProviderRegistry has registrations — deleteConversation routes
    // through ProviderRegistry.getConversationHistoryService(providerId),
    // which throws for unregistered providers.
    try {
      const conversation = await plugin.createConversation();
      await plugin.deleteConversation(conversation.id);
    } catch (err) {
      result.probeFailures.push(`ProviderRegistry probe failed (create/delete conversation): ${err?.message ?? err}`);
    }

    // Probe (mobile): the platform gate took the REMOTE branch, which sets
    // plugin.remoteMode (desktop leaves it false). This confirms the local
    // provider graph was never imported on mobile.
    if (platformKind === 'mobile' && plugin.remoteMode !== true) {
      result.probeFailures.push('plugin.remoteMode was not set — the mobile remote-provider branch did not run');
    }
    if (platformKind === 'desktop' && plugin.remoteMode !== false) {
      result.probeFailures.push('plugin.remoteMode should be false on desktop');
    }
  } catch (err) {
    result.fatalError = err;
  }

  result.handledRequireAttempts = attempts;
  return result;
}

// --- Reporting --------------------------------------------------------------------

function summarizeAttempts(attempts) {
  const byModule = new Map();
  for (const attempt of attempts) {
    const frames = attributeStack(attempt.stack);
    // Attribute to the first bundle frame that is not the lazy-require helper
    // itself, i.e. the module that asked for the builtin.
    const caller = frames.find((f) => !f.module.includes('utils/nodeCompat'));
    const where = caller?.module ?? frames[0]?.module ?? '(unknown)';
    const key = `${attempt.name} <- ${where}`;
    byModule.set(key, (byModule.get(key) ?? 0) + 1);
  }
  return byModule;
}

function reportPass(result) {
  const tag = result.platformKind.toUpperCase();
  console.log(`\n=== ${tag} PASS REPORT ===`);
  console.log(`  bundle evaluated: ${result.bundleEvaluated}`);
  console.log(`  onload resolved:  ${result.onloadResolved}`);

  if (result.platformKind === 'mobile') {
    const summary = summarizeAttempts(result.handledRequireAttempts);
    if (summary.size > 0) {
      console.log('  handled (caught) Node require attempts — sanctioned lazy pattern:');
      for (const [key, count] of summary) {
        console.log(`    - ${key}${count > 1 ? ` (x${count})` : ''}`);
      }
    } else {
      console.log('  handled Node require attempts: none');
    }
  }

  if (result.spies) {
    console.log(`  obsidian exports touched: ${[...result.spies.accessedExports].sort().join(', ')}`);
    console.log(`  commands registered: ${result.spies.commands.length}; views: ${result.spies.registeredViews.length}; setting tabs: ${result.spies.settingTabs}`);
  }

  for (const failure of result.probeFailures) {
    console.log(`  PROBE FAILURE: ${failure}`);
  }

  if (result.fatalError) {
    const err = result.fatalError;
    console.log(`  FATAL: ${err?.message ?? err}`);
    if (err?.stack) {
      console.log('  attributed stack:');
      console.log(formatAttributedStack(err.stack));
    }
  }
}

// --- Main -------------------------------------------------------------------------

const mobileResult = await runPass('mobile');
reportPass(mobileResult);

const desktopResult = await runPass('desktop');
reportPass(desktopResult);

const mobileOk = mobileResult.bundleEvaluated
  && mobileResult.onloadResolved
  && !mobileResult.fatalError
  && mobileResult.probeFailures.length === 0;

const desktopOk = desktopResult.bundleEvaluated
  && desktopResult.onloadResolved
  && !desktopResult.fatalError
  && desktopResult.probeFailures.length === 0;

console.log('\n=== SUMMARY ===');
console.log(mobileOk ? 'PASS: mobile (iOS) simulated load' : 'FAIL: mobile (iOS) simulated load');
console.log(
  desktopOk
    ? 'PASS: desktop simulated load'
    : 'PARTIAL: desktop simulated load (mock depth — verify in the real app)',
);

nodeProcess.exit(mobileOk ? 0 : 1);
