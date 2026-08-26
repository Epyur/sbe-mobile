import { App, PluginSettingTab, Setting } from 'obsidian';
import type SbeMobilePlugin from '../main';

export class MobileSettingsTab extends PluginSettingTab {
  private plugin: SbeMobilePlugin;

  constructor(app: App, plugin: SbeMobilePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'ЦУП Мобайл' });

    new Setting(containerEl)
      .setName('Адрес сервера')
      .setDesc('Базовый URL серверного auth-service (без слэша в конце).')
      .addText(text => text
        .setPlaceholder('https://epyur.fvds.ru')
        .setValue(this.plugin.settings.apiUrl)
        .onChange(async (value) => {
          this.plugin.settings.apiUrl = value.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('URL реестра')
      .setDesc('Адрес registry.json (по умолчанию наш сервер).')
      .addText(text => text
        .setPlaceholder('https://epyur.fvds.ru/registry.json')
        .setValue(this.plugin.settings.registryUrl)
        .onChange(async (value) => {
          this.plugin.settings.registryUrl = value.trim();
          this.plugin.manager.setRegistryUrl(this.plugin.settings.registryUrl);
          await this.plugin.saveSettings();
        }));
  }
}
