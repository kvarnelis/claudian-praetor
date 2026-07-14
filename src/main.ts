import type { Editor, WorkspaceLeaf } from 'obsidian';
import { MarkdownView, Notice, Platform, Plugin } from 'obsidian';

import { ConversationRepository } from './app/conversations/ConversationRepository';
import { ClaudianProviderHost } from './app/providers/ClaudianProviderHost';
import { DEFAULT_CLAUDIAN_SETTINGS } from './app/settings/defaultSettings';
import type { ConditionalSettingsMutation } from './app/settings/SettingsCoordinator';
import { SettingsCoordinator, type SettingsMutation } from './app/settings/SettingsCoordinator';
import { SharedStorageService } from './app/storage/SharedStorageService';
import type { SharedAppStorage } from './core/bootstrap/storage';
import {
  getEnvironmentVariablesForScope as getScopedEnvironmentVariables,
  getRuntimeEnvironmentText,
  setEnvironmentVariablesForScope,
} from './core/providers/providerEnvironment';
import { ProviderRegistry } from './core/providers/ProviderRegistry';
import { ProviderSettingsCoordinator } from './core/providers/ProviderSettingsCoordinator';
import { ProviderWorkspaceRegistry } from './core/providers/ProviderWorkspaceRegistry';
import type {
  ProviderCliResolutionContext,
  ProviderId,
} from './core/providers/types';
import type { AppTabManagerState } from './core/providers/types';
import { DEFAULT_CHAT_PROVIDER_ID } from './core/providers/types';
import type {
  ClaudianSettings,
  Conversation,
  ConversationMeta,
} from './core/types';
import {
  VIEW_TYPE_CLAUDIAN,
} from './core/types';
import type { ChatViewPlacement, EnvironmentScope } from './core/types/settings';
import type { DaemonPairingResult, DaemonStartResult, DaemonSupervisor } from './desktop/daemonSupervisor';
import { isLocalDaemonHostEnabled, setLocalDaemonHostEnabled } from './desktop/localDaemonSettings';
import { ClaudianView } from './features/chat/ClaudianView';
import { MobileDock } from './features/chat/ui/mobileDock';
import { type InlineEditContext, InlineEditModal } from './features/inline-edit/ui/InlineEditModal';
import { ClaudianSettingTab } from './features/settings/ClaudianSettings';
import { setLocale } from './i18n/i18n';
import type { Locale } from './i18n/types';
import { OPENCODE_PLAN_MODE_ID, OPENCODE_SAFE_MODE_ID } from './providers/opencode/modes';
import { buildCursorContext } from './utils/editor';
import { revealWorkspaceLeaf } from './utils/obsidianCompat';
import { getVaultPath } from './utils/path';

const MOBILE_REMOTE_ONBOARDING_SEEN_KEY = 'claudian-praetor.mobileRemoteOnboardingSeen';

function isClaudianView(value: unknown): value is ClaudianView {
  return !!value
    && typeof value === 'object'
    && typeof (value as { getTabManager?: unknown }).getTabManager === 'function';
}

export default class ClaudianPlugin extends Plugin {
  settings!: ClaudianSettings;
  storage!: SharedAppStorage;
  readonly providerHost = new ClaudianProviderHost(this);
  private settingsCoordinator!: SettingsCoordinator<ClaudianSettings>;
  private conversationRepository!: ConversationRepository;
  private lastKnownTabManagerState: AppTabManagerState | null = null;
  private mobileDock!: MobileDock;
  private daemonSupervisor: DaemonSupervisor | null = null;
  /** True when providers are remote-backed (mobile); false for local (desktop). */
  remoteMode = false;

  async onload() {
    // The iOS webview has no Node `process` global, but shared UI utils
    // (InputToolbar.shortenPath, utils/path, cliBinaryLocator, …) read
    // process.platform/process.env unguarded. Without this shim the first such
    // read throws "Can't find variable: process" and aborts tab creation on
    // mobile (which also kills the image-attach button built later in tab init).
    // Desktop keeps the real Node process. Must run before any view/tab is built.
    if (!Platform.isDesktopApp && typeof process === 'undefined') {
      (window as { process?: unknown }).process = {
        platform: 'ios',
        env: {},
        cwd: () => '/',
        argv: [] as string[],
        version: '',
        versions: {} as Record<string, string>,
        nextTick: (fn: (...a: unknown[]) => void, ...args: unknown[]) => {
          window.setTimeout(() => fn(...args), 0);
        },
      };
    }

    // Provider registration is platform-gated: the local provider graph pulls
    // Node APIs at module-init time, so it must never load on mobile. Dynamic
    // imports keep those module initializers from running off-desktop.
    if (Platform.isDesktopApp) {
      const { patchSetMaxListenersForElectron } = await import('./utils/electronCompat');
      patchSetMaxListenersForElectron();
      await import('./providers');
    } else {
      const { registerRemoteProviders } = await import('./remote/registration');
      registerRemoteProviders(this);
      this.remoteMode = true;
      // A class we own, so mobile CSS never has to guess between Obsidian's
      // is-mobile / is-tablet / is-phone body classes (iPad uses is-tablet).
      if (typeof document !== 'undefined') document.body?.classList?.add('claudian-mobile');
    }

    await this.loadSettings();
    this.showMobileRemoteOnboardingNotice();
    await ProviderWorkspaceRegistry.initializeAll(this.providerHost);

    // Desktop auto-start: keep the daemon alive for mobile clients by spawning
    // it on load (opt-in). Dynamic import so the Node-only module never loads
    // on mobile; fully guarded so it can't break desktop plugin load.
    if (Platform.isDesktopApp && this.isLocalDaemonHostEnabled()) {
      void this.startMobileDaemonHost({ retry: true }).catch(() => undefined);
    }

    this.mobileDock = new MobileDock(this);
    // Obsidian rewrites drawer styles on open/close, so re-apply the iPad dock
    // whenever the layout changes (also clears it when the view closes).
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mobileDock.sync()));

    this.registerView(
      VIEW_TYPE_CLAUDIAN,
      (leaf) => new ClaudianView(leaf, this)
    );

    this.addRibbonIcon('bot', 'Open Claudian', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Open chat view',
      callback: () => {
        void this.activateView();
      },
    });

    this.addCommand({
      id: 'copy-last-interaction',
      name: 'Copy last interaction',
      callback: () => {
        void (async () => {
          const copied = await this.getView()?.copyLastInteraction();
          if (copied) new Notice('Copied!');
        })();
      },
    });

    this.addCommand({
      id: 'inline-edit',
      name: 'Inline edit',
      editorCallback: async (editor: Editor, ctx) => {
        const view = ctx instanceof MarkdownView
          ? ctx
          : this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
          new Notice('Inline edit unavailable: could not access the active Markdown view.');
          return;
        }

        const selectedText = editor.getSelection();
        const notePath = view.file?.path || 'unknown';

        let editContext: InlineEditContext;
        if (selectedText.trim()) {
          editContext = { mode: 'selection', selectedText };
        } else {
          const cursor = editor.getCursor();
          const cursorContext = buildCursorContext(
            (line) => editor.getLine(line),
            editor.lineCount(),
            cursor.line,
            cursor.ch
          );
          editContext = { mode: 'cursor', cursorContext };
        }

        const modal = new InlineEditModal(
          this.app,
          this,
          editor,
          view,
          editContext,
          notePath,
          () => this.getView()?.getActiveTab()?.ui.externalContextSelector?.getExternalContexts() ?? []
        );
        const result = await modal.openAndWait();

        if (result.decision === 'accept' && result.editedText !== undefined) {
          new Notice(editContext.mode === 'cursor' ? 'Inserted' : 'Edit applied');
        }
      },
    });

    this.addCommand({
      id: 'new-tab',
      name: 'New tab',
      checkCallback: (checking: boolean) => {
        if (!this.canCreateNewTab()) return false;

        if (!checking) {
          void this.openNewTab();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'new-session',
      name: 'New session (in current tab)',
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        const activeTab = tabManager.getActiveTab();
        if (!activeTab) return false;

        if (activeTab.state.isStreaming) return false;

        if (!checking) {
          void tabManager.createNewConversation();
        }
        return true;
      },
    });

    this.addCommand({
      id: 'close-current-tab',
      name: 'Close current tab',
      checkCallback: (checking: boolean) => {
        const view = this.getView();
        if (!view) return false;

        const tabManager = view.getTabManager();
        if (!tabManager) return false;

        if (!checking) {
          const activeTabId = tabManager.getActiveTabId();
          if (activeTabId) {
            void tabManager.closeTab(activeTabId);
          }
        }
        return true;
      },
    });

    this.addSettingTab(new ClaudianSettingTab(this.app, this));
  }

  onunload(): void {
    this.mobileDock?.clear();
    if (typeof document !== 'undefined') document.body?.classList?.remove('claudian-mobile');
    void this.persistOpenTabStates();
  }

  private async persistOpenTabStates(): Promise<void> {
    // Ensures state is saved even if Obsidian quits without calling onClose()
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (tabManager) {
        const state = tabManager.getPersistedState();
        await this.persistTabManagerState(state);
      }
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN)[0];

    if (!leaf) {
      const newLeaf = this.getLeafForPlacement(this.settings.chatViewPlacement);
      if (newLeaf) {
        await newLeaf.setViewState({
          type: VIEW_TYPE_CLAUDIAN,
          active: true,
        });
        leaf = newLeaf;
      }
    }

    if (leaf) {
      await revealWorkspaceLeaf(workspace, leaf);
    }

    this.mobileDock?.sync();
  }

  private getLeafForPlacement(placement: ChatViewPlacement): WorkspaceLeaf | null {
    const { workspace } = this.app;
    switch (placement) {
      case 'main-tab':
        return workspace.getLeaf('tab');
      case 'main-split-right':
        // Desktop gets a real main-area split. Mobile can't split the main
        // area, so use the right drawer and dock it beside the editor via
        // MobileDock CSS instead.
        return Platform.isMobile
          ? workspace.getRightLeaf(false)
          : workspace.getLeaf('split', 'vertical');
      case 'left-sidebar':
        return workspace.getLeftLeaf(false);
      case 'right-sidebar':
        return workspace.getRightLeaf(false);
    }
  }

  private canCreateNewTab(): boolean {
    const hasClaudianLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN).length > 0;
    const view = this.getView();
    const tabManager = view?.getTabManager();

    if (tabManager) {
      return tabManager.canCreateTab();
    }

    if (hasClaudianLeaf) {
      return false;
    }

    return this.getLastKnownOpenTabCount() < this.getMaxTabsLimit();
  }

  private async ensureViewOpen(): Promise<ClaudianView | null> {
    const existingView = this.getView();
    if (existingView) {
      return existingView;
    }

    await this.activateView();
    return this.getView();
  }

  private async openNewTab(): Promise<void> {
    const existingView = this.getView();
    if (existingView) {
      await existingView.createNewTab();
      return;
    }

    const restoredTabCount = this.getLastKnownOpenTabCount();
    const view = await this.ensureViewOpen();
    if (!view) {
      return;
    }

    // A cold-open view creates its initial tab during restore. Avoid stacking
    // an extra blank tab on top when there was no prior layout to restore.
    if (restoredTabCount === 0) {
      return;
    }

    await view.createNewTab();
  }

  async loadSettings() {
    this.storage = new SharedStorageService(this);
    const { claudian } = await this.storage.initialize();
    this.lastKnownTabManagerState = await this.storage.getTabManagerState();

    this.settings = {
      ...DEFAULT_CLAUDIAN_SETTINGS,
      ...claudian,
    };
    this.settingsCoordinator = new SettingsCoordinator(
      this.settings,
      async (settings) => {
        ProviderSettingsCoordinator.normalizeProviderSelection(settings);
        ProviderSettingsCoordinator.persistProjectedProviderState(settings);
        await this.storage.saveClaudianSettings(settings);
      },
    );
    this.conversationRepository = new ConversationRepository({
      getSettings: () => this.settings,
      getVaultPath: () => getVaultPath(this.app),
      sessions: this.storage.sessions,
      onConversationDeleted: (conversationId) => this.resetDeletedConversationTabs(conversationId),
    });

    // Remote daemon config lives in plugin data.json (Sync-carried), not the
    // hidden .claudian/ vault folder; it takes precedence over any vault copy.
    const remoteDaemon = await this.storage.getRemoteDaemonConfig();
    if (remoteDaemon) {
      this.settings.remoteDaemon = remoteDaemon;
    }

    const didMigrateLegacyDaemonAutoStart = this.settings.legacyDaemonAutoStart === true;
    delete this.settings.legacyDaemonAutoStart;
    if (Platform.isDesktopApp && didMigrateLegacyDaemonAutoStart && !isLocalDaemonHostEnabled()) {
      setLocalDaemonHostEnabled(true);
    }

    // Plan mode is ephemeral — normalize back to normal on load so the app
    // doesn't start stuck in plan mode after a restart (prePlanPermissionMode is lost)
    if (this.settings.permissionMode === 'plan') {
      this.settings.permissionMode = 'normal';
    }
    if (
      this.settings.savedProviderPermissionMode
      && typeof this.settings.savedProviderPermissionMode === 'object'
      && !Array.isArray(this.settings.savedProviderPermissionMode)
    ) {
      for (const [providerId, mode] of Object.entries(this.settings.savedProviderPermissionMode)) {
        if (mode === 'plan') {
          this.settings.savedProviderPermissionMode[providerId] = 'normal';
        }
      }
    }
    const opencodeConfig = this.settings.providerConfigs?.opencode;
    if (
      opencodeConfig
      && typeof opencodeConfig === 'object'
      && !Array.isArray(opencodeConfig)
      && opencodeConfig.selectedMode === OPENCODE_PLAN_MODE_ID
    ) {
      opencodeConfig.selectedMode = OPENCODE_SAFE_MODE_ID;
    }

    const didNormalizeProviderSelection = ProviderSettingsCoordinator.normalizeProviderSelection(
      this.settings,
    );
    const didNormalizeModelVariants = this.normalizeModelVariantSettings();

    const allMetadata = await this.storage.sessions.listMetadata();
    this.conversationRepository.replaceAll(allMetadata.map(meta => {
      const resumeSessionId = meta.sessionId !== undefined ? meta.sessionId : meta.id;

      return {
        id: meta.id,
        providerId: meta.providerId ?? DEFAULT_CHAT_PROVIDER_ID,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lastResponseAt: meta.lastResponseAt,
        sessionId: resumeSessionId,
        selectedModel: meta.selectedModel,
        providerState: meta.providerState,
        messages: [],
        currentNote: meta.currentNote,
        externalContextPaths: meta.externalContextPaths,
        enabledMcpServers: meta.enabledMcpServers,
        usage: meta.usage,
        titleGenerationStatus: meta.titleGenerationStatus,
        resumeAtMessageId: meta.resumeAtMessageId,
      };
    }).sort(
      (a, b) => (b.lastResponseAt ?? b.updatedAt) - (a.lastResponseAt ?? a.updatedAt)
    ));
    setLocale(this.settings.locale as Locale);

    const backfilledConversations = this.conversationRepository.backfillResponseTimestamps();

    const { changed, invalidatedConversations } = this.reconcileModelWithEnvironment();

    ProviderSettingsCoordinator.projectActiveProviderState(
      this.settings,
    );

    if (changed || didNormalizeModelVariants || didNormalizeProviderSelection || didMigrateLegacyDaemonAutoStart) {
      await this.saveSettings();
    }

    const conversationsToSave = new Set([...backfilledConversations, ...invalidatedConversations]);
    for (const conv of conversationsToSave) {
      await this.storage.sessions.saveMetadata(
        this.storage.sessions.toSessionMetadata(conv)
      );
    }
  }

  normalizeModelVariantSettings(): boolean {
    return ProviderSettingsCoordinator.normalizeAllModelVariants(
      this.settings,
    );
  }

  /** Persist the remote daemon URL to Sync-carried plugin data. Pairing stays local to the Mac. */
  async saveRemoteDaemonConfig(config: { url: string } | null): Promise<void> {
    await this.storage.setRemoteDaemonConfig(config);
    this.settings.remoteDaemon = config ?? undefined;
    if (Platform.isMobile && config) {
      const { getRemoteClient } = await import('./remote/registration');
      getRemoteClient().configure(config);
    }
  }

  isLocalDaemonHostEnabled(): boolean {
    return Platform.isDesktopApp && isLocalDaemonHostEnabled();
  }

  async setLocalDaemonHostEnabled(enabled: boolean): Promise<DaemonStartResult | null> {
    if (!Platform.isDesktopApp) return null;

    setLocalDaemonHostEnabled(enabled);
    if (!enabled) {
      this.daemonSupervisor?.stop();
      this.daemonSupervisor = null;
      return null;
    }

    return this.startMobileDaemonHost({ retry: false, notify: true });
  }

  async startMobileDaemonHost(options: { retry?: boolean; notify?: boolean } = {}): Promise<DaemonStartResult | null> {
    if (!Platform.isDesktopApp) return null;

    const { DaemonSupervisor } = await import('./desktop/daemonSupervisor');
    if (!this.daemonSupervisor) {
      this.daemonSupervisor = new DaemonSupervisor(this);
    }

    const result = await this.daemonSupervisor.start({ retry: options.retry });
    if (options.notify) {
      if (result.status === 'started') {
        new Notice(`Claudian Praetor: mobile daemon started at ${result.url}.`, 8000);
      } else if (result.status === 'already-running') {
        new Notice(`Claudian Praetor: mobile daemon already running at ${result.url}.`, 8000);
      } else if ('message' in result) {
        new Notice(`Claudian Praetor: ${result.message}`, 8000);
      }
    }
    return result;
  }

  async openMobileDaemonPairing(): Promise<DaemonPairingResult | null> {
    if (!Platform.isDesktopApp) return null;
    if (!this.daemonSupervisor) {
      const { DaemonSupervisor } = await import('./desktop/daemonSupervisor');
      this.daemonSupervisor = new DaemonSupervisor(this);
    }
    const startResult = await this.startMobileDaemonHost({ retry: false });
    if (!startResult) return null;
    if (
      startResult.status === 'no-tailnet'
      || startResult.status === 'missing-vault'
      || startResult.status === 'error'
    ) {
      return startResult;
    }
    return this.daemonSupervisor.openPairing();
  }

  private showMobileRemoteOnboardingNotice(): void {
    if (!Platform.isMobile) return;

    try {
      if (window.localStorage.getItem(MOBILE_REMOTE_ONBOARDING_SEEN_KEY) === 'true') return;
      window.localStorage.setItem(MOBILE_REMOTE_ONBOARDING_SEEN_KEY, 'true');
    } catch {
      // Local storage can be unavailable in constrained webviews; the notice is harmless.
    }

    new Notice(
      'Claudian mobile uses your Mac over Tailscale. Connect Tailscale on both devices, then on the Mac enable Mobile daemon and choose Pair iPhone or iPad.',
      15_000,
    );
  }

  async saveSettings() {
    await this.settingsCoordinator.persistCurrent();
  }

  async mutateSettings(mutation: SettingsMutation<ClaudianSettings>): Promise<void> {
    await this.settingsCoordinator.mutate(mutation);
  }

  async mutateSettingsConditionally(
    mutation: ConditionalSettingsMutation<ClaudianSettings>,
  ): Promise<void> {
    await this.settingsCoordinator.mutateConditionally(mutation);
  }

  /** Updates and persists environment variables, restarting processes to apply changes. */
  async applyEnvironmentVariables(scope: EnvironmentScope, envText: string): Promise<void> {
    await this.applyEnvironmentVariablesBatch([{ scope, envText }]);
  }

  async applyEnvironmentVariablesBatch(
    updates: Array<{ scope: EnvironmentScope; envText: string }>,
  ): Promise<void> {
    const nextEnvironmentByScope = new Map<EnvironmentScope, string>();
    for (const update of updates) {
      nextEnvironmentByScope.set(update.scope, update.envText);
    }

    let affectedProviderIds: ProviderId[] = [];
    let changed = false;
    let invalidatedConversations: Conversation[] = [];
    await this.mutateSettings((settings) => {
      const settingsBag = settings as unknown as Record<string, unknown>;
      const changedScopes: EnvironmentScope[] = [];
      for (const [scope, envText] of nextEnvironmentByScope) {
        const currentValue = getScopedEnvironmentVariables(settingsBag, scope);
        if (currentValue !== envText) {
          changedScopes.push(scope);
        }
        setEnvironmentVariablesForScope(settingsBag, scope, envText);
      }
      affectedProviderIds = this.getAffectedEnvironmentProviders(changedScopes);
      ProviderSettingsCoordinator.handleEnvironmentChange(settingsBag, affectedProviderIds);
      const reconciliation = this.reconcileModelWithEnvironment(affectedProviderIds);
      changed = reconciliation.changed;
      invalidatedConversations = reconciliation.invalidatedConversations;
    });

    if (affectedProviderIds.length === 0) {
      return;
    }

    const modelCatalogDiagnostics: string[] = [];
    for (const providerId of affectedProviderIds) {
      if (ProviderRegistry.isEnabled(providerId, this.settings)) {
        const result = await ProviderWorkspaceRegistry.refreshModelCatalog(providerId);
        if (result.diagnostics) {
          modelCatalogDiagnostics.push(
            `${ProviderRegistry.getProviderDisplayName(providerId)}: ${result.diagnostics}`,
          );
        }
        await ProviderWorkspaceRegistry.refreshAgentMentions(providerId);
      }
    }
    if (invalidatedConversations.length > 0) {
      for (const conv of invalidatedConversations) {
        await this.storage.sessions.saveMetadata(
          this.storage.sessions.toSessionMetadata(conv)
        );
      }
    }

    const openViews = this.getAllViews();
    let failedTabs = 0;
    for (const openView of openViews) {
      failedTabs += await this.restartEnvironmentAffectedRuntimes(
        openView,
        affectedProviderIds,
        changed,
      );
      openView.invalidateProviderCommandCaches(affectedProviderIds);
      openView.refreshModelSelector();
    }
    if (failedTabs > 0) {
      new Notice(`Environment changes applied, but ${failedTabs} affected tab(s) failed to restart.`);
    }

    const noticeText = changed
      ? 'Environment variables applied. Sessions will be rebuilt on next message.'
      : 'Environment variables applied.';
    new Notice(noticeText);
    if (modelCatalogDiagnostics.length > 0) {
      new Notice(`Model catalog refresh failed:\n${modelCatalogDiagnostics.join('\n')}`);
    }
  }

  private async restartEnvironmentAffectedRuntimes(
    view: ClaudianView,
    affectedProviderIds: ProviderId[],
    resetSessions: boolean,
  ): Promise<number> {
    const tabManager = view.getTabManager();
    if (!tabManager) return 0;

    const affectedTabs = tabManager.getAllTabs().filter((tab) => (
      affectedProviderIds.includes(tab.providerId ?? DEFAULT_CHAT_PROVIDER_ID)
    ));
    const syncTabRuntimeState = (tab: (typeof affectedTabs)[number]): void => {
      if (!tab.service || !tab.serviceInitialized) return;

      const conversation = tab.conversationId
        ? this.getConversationSync(tab.conversationId)
        : null;
      const hasConversationContext = (conversation?.messages.length ?? 0) > 0;
      const externalContextPaths = tab.ui.externalContextSelector?.getExternalContexts()
        ?? (hasConversationContext
          ? conversation?.externalContextPaths ?? []
          : this.settings.persistentExternalContextPaths ?? []);

      tab.service.syncConversationState(conversation, externalContextPaths);
    };

    for (const tab of affectedTabs) {
      if (tab.state.isStreaming) {
        tab.controllers.inputController?.cancelStreaming();
      }
    }

    let failedTabs = 0;
    for (const tab of affectedTabs) {
      if (!tab.service || !tab.serviceInitialized) continue;
      try {
        syncTabRuntimeState(tab);
        if (resetSessions) {
          tab.service.resetSession();
          await tab.service.ensureReady();
        } else {
          await tab.service.ensureReady({ force: true });
        }
      } catch {
        failedTabs++;
      }
    }
    return failedTabs;
  }

  /** Returns the runtime environment variables (fixed at plugin load). */
  getActiveEnvironmentVariables(
    providerId: ProviderId = ProviderRegistry.resolveSettingsProviderId(
      this.settings,
    ),
  ): string {
    return getRuntimeEnvironmentText(
      this.settings,
      providerId,
    );
  }

  getEnvironmentVariablesForScope(scope: EnvironmentScope): string {
    return getScopedEnvironmentVariables(
      this.settings,
      scope,
    );
  }

  getResolvedProviderCliPath(
    providerId: ProviderId,
    context?: ProviderCliResolutionContext,
  ): string | null {
    const cliResolver = ProviderWorkspaceRegistry.getCliResolver(providerId);
    if (!cliResolver) {
      return null;
    }

    return cliResolver.resolveFromSettings(this.settings, context);
  }

  private reconcileModelWithEnvironment(providerIds: ProviderId[] = ProviderRegistry.getRegisteredProviderIds()): {
    changed: boolean;
    invalidatedConversations: Conversation[];
  } {
    return ProviderSettingsCoordinator.reconcileProviders(
      this.settings,
      this.conversationRepository.getAll(),
      providerIds,
    );
  }

  private getAffectedEnvironmentProviders(scopes: EnvironmentScope[]): ProviderId[] {
    const registeredProviderIds = new Set(ProviderRegistry.getRegisteredProviderIds());
    const affectedProviderIds = new Set<ProviderId>();

    for (const scope of scopes) {
      if (scope === 'shared') {
        for (const providerId of registeredProviderIds) {
          affectedProviderIds.add(providerId);
        }
        continue;
      }

      const providerId = scope.slice('provider:'.length);
      if (registeredProviderIds.has(providerId)) {
        affectedProviderIds.add(providerId);
      }
    }

    return Array.from(affectedProviderIds);
  }

  async createConversation(options?: {
    providerId?: ProviderId;
    sessionId?: string;
    selectedModel?: string;
  }): Promise<Conversation> {
    return this.conversationRepository.create(options);
  }

  async switchConversation(id: string): Promise<Conversation | null> {
    return this.conversationRepository.switchTo(id);
  }

  async deleteConversation(
    id: string,
    options: { deleteProviderSession?: boolean } = {},
  ): Promise<void> {
    await this.conversationRepository.delete(id, options);
  }

  private async resetDeletedConversationTabs(id: string): Promise<void> {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      for (const tab of tabManager.getAllTabs()) {
        if (tab.conversationId === id) {
          tab.controllers.inputController?.cancelStreaming();
          await tab.controllers.conversationController?.createNew({ force: true });
        }
      }
    }
  }

  async handleMissingProviderSession(
    id: string,
    missingProviderSessionId?: string,
  ): Promise<'deleted' | 'reset' | 'preserved' | 'not_found'> {
    return this.conversationRepository.handleMissingProviderSession(id, missingProviderSessionId);
  }

  async renameConversation(id: string, title: string): Promise<void> {
    await this.conversationRepository.rename(id, title);
  }

  async updateConversation(id: string, updates: Partial<Conversation>): Promise<void> {
    await this.conversationRepository.update(id, updates);
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    return this.conversationRepository.getById(id);
  }

  getConversationSync(id: string): Conversation | null {
    return this.conversationRepository.getSync(id);
  }

  findEmptyConversation(): Conversation | null {
    return this.conversationRepository.findEmpty();
  }

  getConversationList(): ConversationMeta[] {
    return this.conversationRepository.list();
  }

  async persistTabManagerState(state: AppTabManagerState): Promise<void> {
    this.lastKnownTabManagerState = state;
    await this.storage.setTabManagerState(state);
  }

  getView(): ClaudianView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).find(isClaudianView) ?? null;
  }

  getAllViews(): ClaudianView[] {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CLAUDIAN);
    return leaves.map(leaf => leaf.view).filter(isClaudianView);
  }

  findConversationAcrossViews(conversationId: string): { view: ClaudianView; tabId: string } | null {
    for (const view of this.getAllViews()) {
      const tabManager = view.getTabManager();
      if (!tabManager) continue;

      const tabs = tabManager.getAllTabs();
      for (const tab of tabs) {
        if (tab.conversationId === conversationId) {
          return { view, tabId: tab.id };
        }
      }
    }
    return null;
  }

  private getLastKnownOpenTabCount(): number {
    return this.lastKnownTabManagerState?.openTabs.length ?? 0;
  }

  private getMaxTabsLimit(): number {
    const maxTabs = this.settings.maxTabs ?? 3;
    return Math.max(3, Math.min(10, maxTabs));
  }

}
