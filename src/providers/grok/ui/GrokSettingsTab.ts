import * as fs from 'fs';
import { Setting } from 'obsidian';

import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { t } from '../../../i18n/i18n';
import { renderEnvironmentSettingsSection } from '../../../shared/settings/EnvironmentSettingsSection';
import { getHostnameKey } from '../../../utils/env';
import { expandHomePath } from '../../../utils/path';
import { getGrokProviderSettings, updateGrokProviderSettings } from '../settings';

export const grokSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const grokSettings = getGrokProviderSettings(settingsBag);
    const hostnameKey = getHostnameKey();

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Enable Grok provider')
      .setDesc('When enabled, Grok Build appears in the model selector for new conversations. Existing Grok sessions are preserved.')
      .addToggle((toggle) =>
        toggle
          .setValue(grokSettings.enabled)
          .onChange(async (value) => {
            await context.plugin.mutateSettings((settings) => {
              ProviderSettingsCoordinator.applyProviderEnablement(settings, 'grok', value);
            });
            context.refreshModelSelectors();
            context.refreshTitleGenerationModelOptions();
          })
      );

    const cliPathSetting = new Setting(container)
      .setName(`Grok CLI path (${hostnameKey})`)
      .setDesc('Custom path to the local Grok Build CLI. Leave empty for auto-detection from PATH and ~/.grok/bin.');

    const validationEl = container.createDiv({
      cls: 'claudian-cli-path-validation claudian-setting-validation claudian-setting-validation-error claudian-hidden',
    });

    const validatePath = (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const expandedPath = expandHomePath(trimmed);

      if (!fs.existsSync(expandedPath)) {
        return t('settings.cliPath.validation.notExist');
      }
      const stat = fs.statSync(expandedPath);
      if (!stat.isFile()) {
        return t('settings.cliPath.validation.isDirectory');
      }
      return null;
    };

    const updateCliPathValidation = (value: string, inputEl?: HTMLInputElement): boolean => {
      const error = validatePath(value);
      if (error) {
        validationEl.setText(error);
        validationEl.toggleClass('claudian-hidden', false);
        if (inputEl) {
          inputEl.toggleClass('claudian-input-error', true);
        }
        return false;
      }
      validationEl.toggleClass('claudian-hidden', true);
      if (inputEl) {
        inputEl.toggleClass('claudian-input-error', false);
      }
      return true;
    };

    const cliPathsByHost = { ...grokSettings.cliPathsByHost };
    let cliPathInputEl: HTMLInputElement | null = null;

    const persistCliPath = async (value: string): Promise<boolean> => {
      const isValid = updateCliPathValidation(value, cliPathInputEl ?? undefined);
      if (!isValid) return false;

      const trimmed = value.trim();
      if (trimmed) {
        cliPathsByHost[hostnameKey] = trimmed;
      } else {
        delete cliPathsByHost[hostnameKey];
      }
      await context.plugin.mutateSettings((settings) => {
        updateGrokProviderSettings(settings, { cliPathsByHost: { ...cliPathsByHost } });
      });
      await context.plugin.recycleProviderRuntimes?.('grok');
      return true;
    };

    const currentValue = grokSettings.cliPathsByHost[hostnameKey] || '';

    cliPathSetting.addText((text) => {
      text
        .setPlaceholder('/Users/you/.grok/bin/grok')
        .setValue(currentValue)
        .onChange(async (value) => {
          await persistCliPath(value);
        });
      text.inputEl.addClass('claudian-settings-cli-path-input');
      cliPathInputEl = text.inputEl;

      updateCliPathValidation(currentValue, text.inputEl);
    });

    new Setting(container).setName(t('settings.safety')).setHeading();

    new Setting(container)
      .setName('Grok sandbox')
      .setDesc('Sandbox profile passed to Grok Build in safe mode. YOLO mode uses Grok\'s always-approve flag.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('workspace-write', 'Workspace write')
          .addOption('read-only', 'Read only')
          .setValue(grokSettings.safeMode)
          .onChange(async (value) => {
            await context.plugin.mutateSettings((settings) => {
              updateGrokProviderSettings(
                settings,
                { safeMode: value as 'workspace-write' | 'read-only' },
              );
            });
          });
      });

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:grok',
      heading: t('settings.environment'),
      name: 'Grok environment',
      desc: 'Grok-owned runtime variables only. Use this for GROK_* and XAI_* settings. If Grok auto-detection needs help, add its install directory to shared PATH instead of this provider section.',
      placeholder: 'GROK_DEPLOYMENT_KEY=your-key\nXAI_API_KEY=your-key\nGROK_MODEL=grok-build',
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'grok'),
    });
  },
};
