import { App, Modal, Notice } from 'obsidian';
import { errorMessage } from '../../../../.obsidian/plugins/sbe-core/src/utils/errors';
import type { AuthService } from '../../../../.obsidian/plugins/sbe-core/src/auth-client';
import type { NewsItem } from '../../../../.obsidian/plugins/sbe-core/src/types';

/** Модалка обязательного (mandatory) сообщения — открывается при старте Obsidian,
 *  пока первое непрочитанное обязательное сообщение не будет отмечено прочитанным. */
export class MandatoryNewsModal extends Modal {
  private auth: AuthService;
  private item: NewsItem;
  private onAck: () => void;

  constructor(app: App, auth: AuthService, item: NewsItem, onAck: () => void) {
    super(app);
    this.auth = auth;
    this.item = item;
    this.onAck = onAck;
    this.modalEl.addClass('tn-mobile-news-modal');
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h3', { text: this.item.title });
    contentEl.createEl('p', { text: this.item.body });
    contentEl.createEl('div', {
      cls: 'tn-mobile-card-meta',
      text: `${this.item.authorEmail} · ${
        this.item.createdAt ? new Date(this.item.createdAt).toLocaleString('ru-RU') : ''
      }`,
    });
    const row = contentEl.createDiv({ cls: 'tn-mobile-actions' });
    const ackBtn = row.createEl('button', { cls: 'tn-btn tn-btn-primary tn-btn-lg', text: 'Прочитано' });
    ackBtn.addEventListener('click', () => {
      void this.ack();
    });
    const laterBtn = row.createEl('button', { cls: 'tn-btn tn-btn-ghost tn-btn-lg', text: 'Позже' });
    laterBtn.addEventListener('click', () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async ack(): Promise<void> {
    try {
      await this.auth.ackNews(this.item.id);
      this.onAck();
      this.close();
    } catch (e: unknown) {
      new Notice(`ЦУП Мобайл: ${errorMessage(e)}`);
    }
  }
}
