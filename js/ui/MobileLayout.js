import { el } from '../utils/dom.js';

/** Mesmo corte do `md` do Bootstrap: abaixo dele as sidebars viram gavetas. */
export const MOBILE_QUERY = '(max-width: 767.98px)';

/**
 * MobileLayout — em telas estreitas as duas sidebars (280 + 320 px) não
 * cabem ao lado do canvas: elas viram gavetas sobre o canvas, FECHADAS ao
 * carregar, com um véu que fecha ao toque.
 *
 * Estado no root:
 *   .editor-shell--mobile        tela estreita (o CSS só age com esta classe)
 *   .editor-shell--left-open     gaveta de blocos aberta
 *   .editor-shell--right-open    gaveta de propriedades aberta
 *
 * Abre por `toggle('left'|'right')` (botões da Topbar e da BlockToolbar).
 * Fecha no véu, no Esc e depois de inserir um bloco — quem abriu a gaveta
 * de blocos quer ver o bloco que acabou de entrar.
 */
export class MobileLayout {
  constructor(editor) {
    this.editor = editor;
    this.root = editor.root;
    this.mq = null;
    this.scrim = null;
  }

  mount() {
    const body = this.root.querySelector('.editor-body');
    if (!body || typeof window.matchMedia !== 'function') return;
    this.mq = window.matchMedia(MOBILE_QUERY);

    this.scrim = el('div', { class: 'editor-drawer-scrim', 'aria-hidden': 'true' });
    this.scrim.addEventListener('click', () => this.close());
    body.appendChild(this.scrim);

    const apply = () => {
      this.root.classList.toggle('editor-shell--mobile', this.mq.matches);
      this.close();
    };
    this.mq.addEventListener?.('change', apply);
    apply();

    this.editor.bus.on('state:changed', (evt) => {
      if (evt?.type === 'insert' && this.isOpen('left')) this.close();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.openSide()) { e.stopPropagation(); this.close(); }
    });
  }

  get isMobile() { return !!this.mq?.matches; }

  openSide() {
    if (this.isOpen('left')) return 'left';
    if (this.isOpen('right')) return 'right';
    return null;
  }

  isOpen(side) { return this.root.classList.contains(`editor-shell--${side}-open`); }

  open(side) {
    if (!this.isMobile) return;
    this.root.classList.remove('editor-shell--left-open', 'editor-shell--right-open');
    this.root.classList.add(`editor-shell--${side}-open`);
    this._sync();
  }

  close() {
    this.root.classList.remove('editor-shell--left-open', 'editor-shell--right-open');
    this._sync();
  }

  toggle(side) {
    if (this.isOpen(side)) this.close();
    else this.open(side);
  }

  /** aria-expanded dos botões que abrem cada gaveta. */
  _sync() {
    for (const btn of this.root.querySelectorAll('[data-drawer-toggle]')) {
      btn.setAttribute('aria-expanded', String(this.isOpen(btn.dataset.drawerToggle)));
    }
  }
}
