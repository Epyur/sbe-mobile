import { ItemView, Modal, Notice, WorkspaceLeaf } from 'obsidian';
import { StoreManager } from '../../../../.obsidian/plugins/sbe-core/src/store-manager';
import { installPlugin, isPluginEnabled, readLocalManifest } from '../../../../.obsidian/plugins/sbe-core/src/installer';
import { getService, isOpenable } from '../../../../.obsidian/plugins/sbe-core/src/bridge';
import { errorMessage } from '../../../../.obsidian/plugins/sbe-core/src/utils/errors';
import type { AuthService } from '../../../../.obsidian/plugins/sbe-core/src/auth-client';
import type { InstalledPlugin, NewsItem, PluginCard } from '../../../../.obsidian/plugins/sbe-core/src/types';
import type { SbeServiceMap } from '../../../../.obsidian/plugins/sbe-core/src/types';
import type SbeMobilePlugin from '../main';

export const MOBILE_VIEW_TYPE = 'sbe-mobile-view';

type Tab = 'services' | 'news' | 'account';

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'services', label: 'Сервисы', icon: '🧩' },
  { id: 'news', label: 'Новости', icon: '📰' },
  { id: 'account', label: 'Аккаунт', icon: '👤' },
];

/** Запрашивает перезапуск Obsidian: на мобиле Obsidian загружает плагины при старте,
 *  поэтому после установки/обновления нужен рестарт (команда app:reload). */
function requestRestart(app: import('obsidian').App): void {
  const modal = new Modal(app);
  modal.titleEl.setText('Перезапустите Obsidian');
  modal.contentEl.createEl('p', {
    text: 'Плагин установлен или обновлён. На мобильном устройстве Obsidian загружает плагины при старте приложения — перезапустите его, чтобы изменения вступили в силу.',
  });
  const row = modal.contentEl.createDiv({ cls: 'tn-mobile-actions' });
  const reloadBtn = row.createEl('button', { cls: 'tn-btn tn-btn-primary tn-btn-lg', text: 'Перезапустить' });
  reloadBtn.addEventListener('click', () => {
    modal.close();
    try {
      const commands = (app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands;
      commands?.executeCommandById?.('app:reload');
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: перезапустите Obsidian вручную (${errorMessage(e)})`);
    }
  });
  const laterBtn = row.createEl('button', { cls: 'tn-btn tn-btn-ghost tn-btn-lg', text: 'Позже' });
  laterBtn.addEventListener('click', () => modal.close());
  modal.open();
}

export class MobileView extends ItemView {
  private plugin: SbeMobilePlugin;
  private manager: StoreManager;
  private auth: AuthService;
  private tab: Tab = 'services';
  private bodyEl!: HTMLElement;
  private busy = false;

  constructor(leaf: WorkspaceLeaf, plugin: SbeMobilePlugin, manager: StoreManager, auth: AuthService) {
    super(leaf);
    this.plugin = plugin;
    this.manager = manager;
    this.auth = auth;
  }

  getViewType(): string {
    return MOBILE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'ЦУП Мобайл';
  }

  getIcon(): string {
    return 'brain';
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('sbe-mobile');
    this.renderNav();
    this.bodyEl = this.contentEl.createDiv({ cls: 'tn-mobile-body' });
    this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    await this.manager.refresh();
    this.render();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private renderNav(): void {
    const nav = this.contentEl.createDiv({ cls: 'tn-mobile-nav' });
    for (const { id, label, icon } of TABS) {
      const btn = nav.createEl('button', { cls: 'tn-mobile-nav-item', attr: { 'data-tab': id } });
      btn.createSpan({ cls: 'tn-mobile-nav-icon', text: icon });
      btn.createSpan({ text: label });
      if (id === this.tab) btn.addClass('active');
      btn.addEventListener('click', () => {
        this.tab = id;
        this.setActiveNav();
        this.render();
      });
    }
  }

  private setActiveNav(): void {
    const buttons = Array.from(this.contentEl.querySelectorAll<HTMLElement>('.tn-mobile-nav-item'));
    buttons.forEach(btn => btn.toggleClass('active', btn.dataset.tab === this.tab));
  }

  private render(): void {
    this.bodyEl.empty();
    switch (this.tab) {
      case 'services':
        this.renderServices();
        break;
      case 'news':
        void this.renderNews();
        break;
      case 'account':
        void this.renderAccount();
        break;
    }
  }

  /** Сервисы: плагины реестра с hasView — установка/обновление/открытие (мини-магазин + лаунчер). */
  private renderServices(): void {
    const cards = this.manager.getCards().filter(c => c.entry.hasView);
    const updatesCount = cards.filter(c => c.state === 'update-available').length;

    const head = this.bodyEl.createDiv({ cls: 'tn-mobile-head' });
    head.createEl('h2', { text: 'Сервисы' });
    const checkBtn = head.createEl('button', { cls: 'tn-btn tn-btn-ghost tn-btn-lg', text: 'Проверить обновления' });
    checkBtn.addEventListener('click', () => void this.runCheck());
    if (updatesCount > 0) {
      head.createDiv({ cls: 'tn-mobile-updates', text: `Доступно обновлений: ${updatesCount}` });
    }

    if (cards.length === 0) {
      this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Реестр недоступен. Проверьте настройки.' });
      return;
    }
    for (const card of cards) {
      this.bodyEl.append(this.buildServiceCard(card));
    }
  }

  private buildServiceCard(card: PluginCard): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tn-mobile-card';
    el.setAttribute('data-id', card.entry.id);

    const head = el.createDiv({ cls: 'tn-mobile-card-head' });
    head.createEl('h4', { text: card.entry.name });
    head.append(this.stateBadge(card));

    const desc = card.remote?.description || card.local?.description || 'Нет описания';
    el.createDiv({ cls: 'tn-mobile-card-desc', text: desc });

    const meta = el.createDiv({ cls: 'tn-mobile-card-meta' });
    const remoteV = card.remote ? `репозиторий: v${card.remote.version}` : 'репозиторий недоступен';
    const localV = card.local ? `локально: v${card.local.version}` : 'не установлен';
    meta.setText(`${remoteV} · ${localV}`);

    el.append(this.actionButton(card));
    return el;
  }

  private stateBadge(card: PluginCard): HTMLElement {
    const badge = document.createElement('span');
    badge.className = 'tn-badge';
    switch (card.state) {
      case 'required':
        badge.addClass('tn-badge-brand');
        badge.setText('Системный');
        break;
      case 'installed':
        badge.addClass('tn-badge-ok');
        badge.setText('Установлен');
        break;
      case 'update-available':
        badge.addClass('tn-badge-warn');
        badge.setText('Есть обновление');
        break;
      default:
        badge.addClass('tn-badge-muted');
        badge.setText('Не установлен');
    }
    return badge;
  }

  private actionButton(card: PluginCard): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'tn-mobile-actions';
    const btn = document.createElement('button');
    btn.className = 'tn-btn tn-btn-lg';
    switch (card.state) {
      case 'not-installed':
        btn.addClass('tn-btn-primary');
        btn.setText('Установить');
        btn.addEventListener('click', () => void this.installMobile(card, false));
        break;
      case 'update-available':
        btn.addClass('tn-btn-primary');
        btn.setText(`Обновить: v${card.local?.version} → v${card.remote?.version}`);
        btn.addEventListener('click', () => void this.installMobile(card, true));
        break;
      default:
        if (card.entry.hasView) {
          btn.setText('Открыть');
          btn.addEventListener('click', () => void this.openPlugin({
            id: card.entry.id,
            dir: card.entry.dir,
            name: card.local?.name || card.entry.name,
            version: card.local?.version || '',
            description: card.local?.description,
            hasView: true,
          }));
          break;
        }
        btn.disabled = true;
        btn.addClass('tn-btn-ghost');
        btn.setText('Установлен');
    }
    actions.append(btn);
    return actions;
  }

  /** Открывает UI плагина (hasView) через его опубликованный сервис. */
  private async openPlugin(p: InstalledPlugin): Promise<void> {
    try {
      const service = await getService(p.id as keyof SbeServiceMap);
      if (!isOpenable(service)) {
        new Notice(`ЦУП Мобайл: у плагина «${p.name}» нет открываемого UI`);
        return;
      }
      await service.open();
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: ${errorMessage(e)}`);
    }
  }

  /** Мобильная установка/обновление:
   *  - самообновление хаба — только файлы (skipReload) + перезапуск;
   *  - остальные — стандартный путь (disable/enable); если плагин после установки не
   *    загружен (свежая установка на мобиле), предлагаем перезапуск;
   *  - если installPlugin упал, но новые файлы записаны (версия совпала с реестром) —
   *    считаем успехом и тоже предлагаем перезапуск. */
  private async installMobile(card: PluginCard, update: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (card.entry.id === 'sbe-mobile') {
        const res = await installPlugin(this.app, {
          dir: card.entry.dir,
          id: card.entry.id,
          repo: card.entry.repo,
          branch: card.entry.branch || 'main',
          hashes: card.entry.hashes,
          skipReload: true,
        });
        if (!res.ok) throw new Error(res.error || 'Не удалось установить');
        new Notice(`ЦУП Мобайл: «${card.entry.name}» обновлён.`);
        void this.manager.refresh().then(() => this.render()).catch(() => undefined);
        requestRestart(this.app);
        return;
      }

      try {
        if (update) {
          await this.manager.update(card.entry.id);
        } else {
          await this.manager.install(card.entry.id);
        }
        new Notice(`ЦУП Мобайл: «${card.entry.name}» ${update ? 'обновлён' : 'установлен'}`);
        this.render();
        if (!isPluginEnabled(this.app, card.entry.id)) {
          requestRestart(this.app);
        }
      } catch (e: unknown) {
        const local = await readLocalManifest(this.app, card.entry.dir);
        if (card.remote && local && local.version === card.remote.version) {
          new Notice(`ЦУП Мобайл: «${card.entry.name}» установлен, требуется перезапуск.`);
          requestRestart(this.app);
        } else {
          new Notice(`ЦУП Мобайл: ${errorMessage(e)}`);
        }
        this.render();
      }
    } finally {
      this.busy = false;
    }
  }

  private async runCheck(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const summary = await this.manager.checkUpdates();
      this.render();
      new Notice(
        summary.updates.length > 0
          ? `ЦУП Мобайл: доступно обновлений: ${summary.updates.length}`
          : 'ЦУП Мобайл: обновлений нет',
      );
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: ошибка проверки: ${errorMessage(e)}`);
    } finally {
      this.busy = false;
    }
  }

  private async renderNews(): Promise<void> {
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: 'tn-mobile-head' }).createEl('h2', { text: 'Новости' });

    if (!this.auth.getStatus().authorized) {
      this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Не авторизован — войдите во вкладке «Аккаунт».' });
      return;
    }
    this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    try {
      const items = await this.auth.listNews();
      this.bodyEl.empty();
      this.bodyEl.createDiv({ cls: 'tn-mobile-head' }).createEl('h2', { text: 'Новости' });
      if (items.length === 0) {
        this.bodyEl.createDiv({ cls: 'tn-empty', text: 'Новостей пока нет.' });
        return;
      }
      for (const item of items) {
        this.bodyEl.append(this.buildNewsCard(item));
      }
    } catch (e: unknown) {
      this.bodyEl.createDiv({ cls: 'tn-empty', text: `Ошибка загрузки новостей: ${errorMessage(e)}` });
    }
  }

  private buildNewsCard(item: NewsItem): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tn-mobile-card tn-news-card';
    if (!item.read) el.addClass('unread');
    if (item.mandatory) el.addClass('mandatory');

    const head = el.createDiv({ cls: 'tn-mobile-card-head' });
    head.createEl('h4', { text: item.title });
    if (item.mandatory) head.createSpan({ cls: 'tn-badge tn-badge-warn', text: 'Обязательно' });
    if (!item.read) head.createSpan({ cls: 'tn-badge tn-badge-brand', text: 'Новое' });

    el.createDiv({ cls: 'tn-mobile-card-desc', text: item.body });

    const meta = el.createDiv({ cls: 'tn-mobile-card-meta' });
    meta.setText(
      `${item.authorEmail} · ${item.createdAt ? new Date(item.createdAt).toLocaleString('ru-RU') : ''}`,
    );

    if (!item.read) {
      const btn = el.createEl('button', {
        cls: 'tn-btn tn-btn-ghost tn-btn-lg',
        text: 'Отметить прочитанным',
      });
      btn.addEventListener('click', () => void this.ackNews(item.id));
    }
    return el;
  }

  private async ackNews(id: number): Promise<void> {
    try {
      await this.auth.ackNews(id);
      this.render();
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: ${errorMessage(e)}`);
    }
  }

  private async renderAccount(): Promise<void> {
    this.bodyEl.empty();
    this.bodyEl.createDiv({ cls: 'tn-mobile-head' }).createEl('h2', { text: 'Аккаунт' });

    const st = this.auth.getStatus();
    if (!st.authorized) {
      this.renderLoginForm();
      return;
    }

    const info = this.bodyEl.createDiv({ cls: 'tn-mobile-card' });
    info.createDiv({ cls: 'tn-mobile-card-meta', text: `Авторизован: ${st.email ?? ''}` });
    const logoutBtn = info.createEl('button', {
      cls: 'tn-btn tn-btn-ghost tn-btn-lg',
      text: 'Выйти (отозвать это устройство)',
    });
    logoutBtn.addEventListener('click', () => void this.revokeDevice(this.plugin.settings.deviceId));

    this.bodyEl.createEl('h4', { text: 'Устройства' });
    const listEl = this.bodyEl.createDiv();
    listEl.createDiv({ cls: 'tn-empty', text: 'Загрузка…' });
    try {
      const devices = await this.auth.listDevices();
      listEl.empty();
      if (devices.length === 0) {
        listEl.createDiv({ cls: 'tn-empty', text: 'Устройств нет.' });
        return;
      }
      for (const device of devices) {
        const card = listEl.createDiv({ cls: 'tn-mobile-card' });
        card.createEl('div', { text: device.label || device.deviceId, cls: 'tn-mobile-card-head-el' });
        card.createDiv({
          cls: 'tn-mobile-card-meta',
          text: `статус: ${device.keyStatus || '-'} · создано: ${
            device.createdAt ? new Date(device.createdAt).toLocaleString('ru-RU') : '-'
          }`,
        });
        const revokeBtn = card.createEl('button', {
          cls: 'tn-btn tn-btn-ghost tn-btn-lg',
          text: 'Отозвать устройство',
        });
        revokeBtn.addEventListener('click', () => void this.revokeDevice(device.deviceId));
      }
    } catch (e: unknown) {
      listEl.empty();
      listEl.createDiv({ cls: 'tn-empty', text: `Ошибка загрузки устройств: ${errorMessage(e)}` });
    }
  }

  private renderLoginForm(): void {
    const card = this.bodyEl.createDiv({ cls: 'tn-mobile-card' });
    card.createEl('p', {
      cls: 'tn-mobile-card-desc',
      text: 'Введите корпоративный адрес @tn.ru — на него придёт ключ доступа. Затем вставьте ключ из письма и активируйте устройство.',
    });

    const emailInput = card.createEl('input', {
      cls: 'tn-input',
      attr: { type: 'email', placeholder: 'user@tn.ru', inputmode: 'email' },
    });
    emailInput.value = this.plugin.settings.email;

    const requestBtn = card.createEl('button', {
      cls: 'tn-btn tn-btn-primary tn-btn-lg',
      text: 'Получить ключ',
    });
    requestBtn.addEventListener('click', () => {
      const email = emailInput.value.trim();
      if (!email) {
        new Notice('ЦУП Мобайл: укажите email');
        return;
      }
      this.plugin.settings.email = email;
      void this.plugin.saveSettings().then(() => this.requestKey(email));
    });

    const keyInput = card.createEl('input', {
      cls: 'tn-input',
      attr: { type: 'text', placeholder: 'ключ из письма', autocomplete: 'off' },
    });

    const activateBtn = card.createEl('button', {
      cls: 'tn-btn tn-btn-primary tn-btn-lg',
      text: 'Активировать ключ',
    });
    activateBtn.addEventListener('click', () => {
      const key = keyInput.value.trim();
      if (!this.plugin.settings.email.trim()) {
        new Notice('ЦУП Мобайл: сначала укажите email и получите ключ');
        return;
      }
      if (!key) {
        new Notice('ЦУП Мобайл: вставьте ключ из письма');
        return;
      }
      void this.activateKey(key);
    });

    card.createDiv({ cls: 'tn-mobile-card-meta', text: `устройство: ${this.plugin.settings.deviceId}` });
  }

  private async requestKey(email: string): Promise<void> {
    try {
      await this.auth.requestKey(email);
      new Notice(`ЦУП Мобайл: ключ отправлен на ${email}. Проверьте почту.`);
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: не удалось получить ключ: ${errorMessage(e)}`);
    }
  }

  private async activateKey(key: string): Promise<void> {
    try {
      await this.auth.activateKey(key);
      new Notice('ЦУП Мобайл: устройство активировано');
      this.render();
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: активация не удалась: ${errorMessage(e)}`);
    }
  }

  private async revokeDevice(deviceId: string): Promise<void> {
    try {
      await this.auth.revokeDevice(deviceId);
      new Notice(`ЦУП Мобайл: устройство ${deviceId} отозвано`);
      this.render();
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: не удалось отозвать устройство: ${errorMessage(e)}`);
    }
  }
}
