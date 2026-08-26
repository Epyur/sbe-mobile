import { Plugin, Notice } from 'obsidian';
import { MOBILE_VIEW_TYPE, MobileView } from './ui/mobile-view';
import { MobileSettingsTab } from './ui/settings-tab';
import { MandatoryNewsModal } from './ui/news-modal';
import { StoreManager } from '../../../.obsidian/plugins/sbe-core/src/store-manager';
import { AuthService } from '../../../.obsidian/plugins/sbe-core/src/auth-client';
import { getServiceSync, publishService, unpublishService } from '../../../.obsidian/plugins/sbe-core/src/bridge';
import { DEFAULT_REGISTRY_URL } from '../../../.obsidian/plugins/sbe-core/src/registry';
import { errorMessage } from '../../../.obsidian/plugins/sbe-core/src/utils/errors';
import type {
  AnnounceUpdateInput,
  InstalledPlugin,
  PluginState,
  SbeApstoreApi,
  UpdateSummary,
} from '../../../.obsidian/plugins/sbe-core/src/types';

/** Стабильный ID секрета: ключ доступа к серверу (тот же, что у десктопного ЦУП). */
export const AUTH_KEY_SECRET = 'sbe-auth-key';

export interface MobileSettings {
  registryUrl: string;
  lastCheckAt: number;
  /** Адрес серверного auth-service (база URL, например https://epyur.fvds.ru). */
  apiUrl: string;
  /** Email пользователя @tn.ru для доступа к серверу. */
  email: string;
  /** UUID устройства — генерируется один раз при первом запуске. */
  deviceId: string;
  /** Версия, для которой уже опубликована новость в канал «Новости» (правило 2026-08-22). */
  lastAnnouncedVersion: string;
}

const DEFAULT_SETTINGS: MobileSettings = {
  registryUrl: DEFAULT_REGISTRY_URL,
  lastCheckAt: 0,
  apiUrl: 'https://epyur.fvds.ru',
  email: '',
  deviceId: '',
  lastAnnouncedVersion: '',
};

function generateDeviceId(): string {
  const cryptoApi = window.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i++) {
    const r = Math.floor(Math.random() * 16);
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[(r & 0x3) | 0x8];
    else s += hex[r];
  }
  return s;
}

/** Плагин «ЦУП Мобайл»: мобильный центр управления плагинами СБЕ для планшетов
 *  испытателей. Публикует логический сервис «sbe-apstore» — на устройстве роль
 *  «ЦУП» занимает либо десктопный плагин, либо этот (кто первый опубликовал). */
export default class SbeMobilePlugin extends Plugin {
  settings!: MobileSettings;
  manager!: StoreManager;
  auth!: AuthService;

  /** Опубликовал ли этот плагин мост (false — если на устройстве уже был десктопный ЦУП). */
  private bridgePublished = false;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.manager = new StoreManager(this.app);
    this.manager.setRegistryUrl(this.settings.registryUrl);
    this.auth = this.buildAuthService();

    this.registerView(MOBILE_VIEW_TYPE, leaf => new MobileView(leaf, this, this.manager, this.auth));

    this.addRibbonIcon('brain', 'ЦУП Мобайл', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-sbe-mobile',
      name: 'Открыть ЦУП Мобайл',
      callback: () => {
        void this.activateView();
      },
    });

    this.addSettingTab(new MobileSettingsTab(this.app, this));

    if (!getServiceSync('sbe-apstore')) {
      publishService<SbeApstoreApi>('sbe-apstore', this.buildApi(), {
        version: this.manifest.version,
        name: this.manifest.name,
      });
      this.bridgePublished = true;
    }

    this.app.workspace.onLayoutReady(() => {
      void this.checkUpdates(true);
      void this.checkMandatoryNews();
      void this.announceIfNeeded();
    });
  }

  onunload(): void {
    if (this.bridgePublished) {
      unpublishService('sbe-apstore');
    }
    this.app.workspace.detachLeavesOfType(MOBILE_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData() as Partial<MobileSettings>) || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!this.settings.deviceId) {
      this.settings.deviceId = generateDeviceId();
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    if (this.auth) {
      this.auth.setConfig({
        apiUrl: this.settings.apiUrl,
        email: this.settings.email,
        deviceId: this.settings.deviceId,
      });
    }
  }

  getSecretValue(secretName: string): string | null {
    try {
      const value = this.app.secretStorage?.getSecret(secretName) ?? null;
      return value && value.trim() ? value : null;
    } catch (e: unknown) {
      console.error('ЦУП Мобайл: не удалось прочитать секрет:', errorMessage(e));
      return null;
    }
  }

  saveSecret(secretName: string, value: string): void {
    try {
      this.app.secretStorage?.setSecret(secretName, value);
    } catch (e: unknown) {
      console.error('ЦУП Мобайл: не удалось сохранить секрет:', errorMessage(e));
    }
  }

  clearSecret(secretName: string): void {
    try {
      this.app.secretStorage?.setSecret(secretName, '');
    } catch (e: unknown) {
      console.error('ЦУП Мобайл: не удалось очистить секрет:', errorMessage(e));
    }
  }

  private buildAuthService(): AuthService {
    return new AuthService(
      {
        apiUrl: this.settings.apiUrl,
        email: this.settings.email,
        deviceId: this.settings.deviceId,
      },
      {
        getKey: () => this.getSecretValue(AUTH_KEY_SECRET),
        setKey: (value) => this.saveSecret(AUTH_KEY_SECRET, value),
        clearKey: () => this.clearSecret(AUTH_KEY_SECRET),
      },
    );
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(MOBILE_VIEW_TYPE).first();
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? undefined;
      if (leaf) {
        await leaf.setViewState({ type: MOBILE_VIEW_TYPE, active: true });
      }
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  /**
   * Проверка обновлений с уведомлением.
   * @param silent при silent=true уведомление показывается только если обновления есть.
   */
  async checkUpdates(silent = false): Promise<UpdateSummary | null> {
    try {
      const summary = await this.manager.checkUpdates();
      this.settings.lastCheckAt = summary.checkedAt;
      await this.saveSettings();
      if (summary.updates.length > 0) {
        new Notice(
          `ЦУП Мобайл: доступно обновлений: ${summary.updates.length}. Откройте ЦУП Мобайл → Сервисы.`,
        );
      } else if (!silent) {
        new Notice('ЦУП Мобайл: обновлений нет');
      }
      return summary;
    } catch (e: unknown) {
      const msg = errorMessage(e);
      if (!silent) new Notice(`ЦУП Мобайл: ошибка проверки: ${msg}`);
      console.warn('ЦУП Мобайл: проверка обновлений не удалась:', msg);
      return null;
    }
  }

  /** При старте ищет первое непрочитанное "обязательное" сообщение и открывает его модалкой. */
  private async checkMandatoryNews(): Promise<void> {
    if (!this.auth.getStatus().authorized) return;
    try {
      const items = await this.auth.listNews();
      const pending = items.find(n => n.mandatory && !n.read);
      if (pending) {
        new MandatoryNewsModal(this.app, this.auth, pending, () => undefined).open();
      }
    } catch (e: unknown) {
      console.warn('ЦУП Мобайл: проверка обязательных новостей не удалась:', errorMessage(e));
    }
  }

  /** Публикует в «Новости» сообщение о своём обновлении — один раз на версию (правило 2026-08-22).
   *  Первый запуск (lastAnnouncedVersion пуст) ничего не анонсирует — только фиксирует версию:
   *  установка плагина не является «обновлением», иначе каждый новый планшет спамил бы канал. */
  private async announceIfNeeded(): Promise<void> {
    if (this.settings.lastAnnouncedVersion === this.manifest.version) return;
    if (!this.auth.getStatus().authorized) return;
    const firstRun = !this.settings.lastAnnouncedVersion;
    try {
      if (!firstRun) {
        await this.announceUpdate({
          appId: this.manifest.id,
          appName: this.manifest.name,
          version: this.manifest.version,
          summary: 'Обновлена мобильная версия центра управления плагинами: исправления и улучшения.',
        });
      }
      this.settings.lastAnnouncedVersion = this.manifest.version;
      await this.saveSettings();
    } catch (e: unknown) {
      console.warn('ЦУП Мобайл: не удалось опубликовать новость об обновлении:', errorMessage(e));
    }
  }

  /** Публикует в канал «Новости» (общий доступ, без авто-открытия). */
  private async announceUpdate(input: AnnounceUpdateInput): Promise<void> {
    await this.auth.createNews({
      title: `Обновление: ${input.appName} → v${input.version}`,
      body: input.summary,
      visibility: 'all',
      mandatory: false,
    });
  }

  private buildApi(): SbeApstoreApi {
    return {
      getRegistry: async () => this.manager.getRegistry(),
      getPluginState: (id: string): PluginState => this.manager.getPluginState(id),
      install: async (id: string) => {
        await this.manager.install(id);
      },
      update: async (id: string) => {
        await this.manager.update(id);
      },
      updateAll: async () => this.manager.updateAll(),
      checkUpdates: async () => this.manager.checkUpdates(),
      listInstalled: (): InstalledPlugin[] => this.manager.listInstalled(),
      auth: {
        getStatus: () => this.auth.getStatus(),
        requestKey: async (email: string) => {
          await this.auth.requestKey(email);
        },
        activateKey: async (key: string) => {
          await this.auth.activateKey(key);
        },
        getToken: async (appId: string) => {
          // Ревью B4: выдача токенов только для известных приложений SBE
          // (произвольные app_id отклоняются — компрометация плагина не даёт
          // токены на чужие сервисы).
          const ALLOWED_TOKEN_APPS = new Set(['mailer', 'documents', 'lab', 'ekn', 'contacts', 'agent']);
          if (!ALLOWED_TOKEN_APPS.has(appId)) {
            throw new Error(`ЦУП Мобайл: приложение «${appId}» не входит в список разрешённых для выдачи токенов.`);
          }
          return this.auth.getToken(appId);
        },
        listDevices: async () => this.auth.listDevices(),
        revokeDevice: async (deviceId: string) => {
          await this.auth.revokeDevice(deviceId);
        },
        getPresence: async () => this.auth.getPresence(),
        listNews: async () => this.auth.listNews(),
        createNews: async (input) => this.auth.createNews(input),
        ackNews: async (id: number) => {
          await this.auth.ackNews(id);
        },
        getNewsReads: async (id: number) => this.auth.getNewsReads(id),
        manageAppSecret: async (input) => this.auth.manageAppSecret(input),
        getAppEnvStatus: async (appId: string) => this.auth.getAppEnvStatus(appId),
        setAppEnv: async (appId: string, values: Record<string, string>) => this.auth.setAppEnv(appId, values),
        listRegistryAdditions: async () => this.auth.listRegistryAdditions(),
        addRegistryPlugin: async (plugin) => this.auth.addRegistryPlugin(plugin),
        removeRegistryAddition: async (registryId) => {
          await this.auth.removeRegistryAddition(registryId);
        },
      },
      announceUpdate: async (input: AnnounceUpdateInput) => {
        await this.auth.createNews({
          title: `Обновление: ${input.appName} → v${input.version}`,
          body: input.summary,
          visibility: 'all',
          mandatory: false,
        });
      },
    };
  }
}
