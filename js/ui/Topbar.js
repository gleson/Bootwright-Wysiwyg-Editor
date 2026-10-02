import { el, icon } from '../utils/dom.js';
import { t, listLocales, getLocale, setLocale } from '../i18n/index.js';

/**
 * Topbar — comandos globais do editor.
 *
 * Funções:
 *   - Switch de dispositivo (Desktop/Tablet/Mobile) → ajusta data-device do canvas
 *   - Undo/Redo plugados em history:changed
 *   - Salvar (chama editor.save())
 *   - Exportar HTML (placeholder até a Fase 9)
 *   - Esconder/mostrar sidebars (Ctrl+\)
 *   - Atalhos globais de teclado (Ctrl+Z, Ctrl+Shift+Z, Ctrl+S, Ctrl+\, Esc)
 */
export class Topbar {
  constructor(editor) {
    this.editor = editor;
    this.root = editor.root;

    this.canvas = this.root.querySelector('[data-region="canvas"]');
    this.deviceBtns = this.root.querySelectorAll('[data-region="device-switch"] [data-device]');
    this.btnUndo = this.root.querySelector('[data-action="undo"]');
    this.btnRedo = this.root.querySelector('[data-action="redo"]');
    this.btnSave = this.root.querySelector('[data-action="save"]');
    this.actions = this.root.querySelector('[data-region="actions"]');
    this.startGroup = this.root.querySelector('.editor-topbar__group--start');
  }

  mount() {
    this._applyStaticLabels();
    this._injectExtraButtons();
    this._injectLanguageSwitch();
    this._injectSaveStatus();
    this._wireDeviceSwitch();
    this._wireUndoRedo();
    this._wireSave();
    this._wireSaveStatus();
    this._wireKeyboard();
    this._syncHistory({ canUndo: false, canRedo: false });
  }

  /** Aplica i18n nos botões estáticos do index.html. */
  _applyStaticLabels() {
    const set = (sel, key) => {
      const elm = this.root.querySelector(sel);
      if (elm) { elm.title = t(key); elm.setAttribute('aria-label', t(key)); }
    };
    set('[data-device="desktop"]', 'topbar.device.desktop');
    set('[data-device="tablet"]',  'topbar.device.tablet');
    set('[data-device="mobile"]',  'topbar.device.mobile');
    set('[data-action="redo"]',    'topbar.redo');
    if (this.btnSave) {
      this.btnSave.title = t('topbar.save.shortcut');
      this.btnSave.setAttribute('aria-label', t('topbar.save'));
      const span = this.btnSave.querySelector('span');
      if (span) span.textContent = t('topbar.save');
    }
  }

  /** Dropdown de idioma. Trocar recarrega a página (strings são fixadas no mount). */
  _injectLanguageSwitch() {
    const select = el('select', {
      class: 'form-select form-select-sm editor-lang-switch ms-2',
      title: t('topbar.language'),
      'aria-label': t('topbar.language'),
      style: { width: 'auto' },
    });
    for (const { code, name } of listLocales()) {
      const opt = el('option', { value: code }, name);
      if (code === getLocale()) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      if (setLocale(select.value)) location.reload();
    });
    this.startGroup.appendChild(select);
  }

  /* ---------- Botões adicionais ---------- */

  _injectExtraButtons() {
    // Toggle de sidebars (no início, antes do brand não — depois do brand)
    this.btnToggleSidebars = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary ms-2',
      title: t('topbar.toggleSidebars'),
    }, [icon('layout-sidebar')]);
    this.btnToggleSidebars.addEventListener('click', () => this._toggleSidebars());
    this.startGroup.appendChild(this.btnToggleSidebars);

    // Editor rápido (CompactEditor) — abre dialog full-screen sem sidebars
    this.btnCompactEditor = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary editor-topbar__btn--compact-editor',
      title: t('topbar.compactEditor'),
    }, [icon('layout-text-window-reverse')]);
    this.btnCompactEditor.addEventListener('click', () => {
      this.editor.ui.compactEditor?.openForEditor(this.editor);
    });
    this.startGroup.appendChild(this.btnCompactEditor);

    // Paleta de comandos (Ctrl+K)
    this.btnCommandPalette = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      title: t('topbar.commandPalette'),
    }, [icon('search')]);
    this.btnCommandPalette.addEventListener('click',
      () => this.editor.ui.commandPalette?.show());
    this.startGroup.appendChild(this.btnCommandPalette);

    // Find & Replace (Ctrl+F)
    this.btnFindReplace = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      title: t('topbar.findReplace'),
    }, [icon('binoculars')]);
    this.btnFindReplace.addEventListener('click',
      () => this.editor.ui.findReplace?.toggle());
    this.startGroup.appendChild(this.btnFindReplace);

    // Personalização (CSS, blocos, templates)
    this.btnCustomization = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      title: t('topbar.customization'),
    }, [icon('gear-fill')]);
    this.btnCustomization.addEventListener('click',
      () => this.editor.ui.customizationDialog?.show());
    this.actions.insertBefore(this.btnCustomization, this.btnSave);

    // Auditoria de acessibilidade
    this.btnA11y = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      title: t('topbar.a11y'),
    }, [icon('universal-access')]);
    this.btnA11y.addEventListener('click', () => this.editor.ui.a11yAudit?.show());
    this.actions.insertBefore(this.btnA11y, this.btnSave);

    // SEO da página
    this.btnSeo = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      title: t('topbar.seo'),
    }, [icon('tags')]);
    this.btnSeo.addEventListener('click', () => this.editor.ui.seoDialog?.show());
    this.actions.insertBefore(this.btnSeo, this.btnSave);

    // Importar / Exportar — dropdown único (HTML / JSON, importar / exportar)
    this._injectImportExportMenu();

    // Editar código-fonte HTML (round-trip: edita o HTML e reconstrói os blocos)
    this.btnHtmlSource = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      title: t('topbar.htmlSource'),
    }, [icon('code-slash')]);
    this.btnHtmlSource.addEventListener('click', () => this.editor.ui.htmlSourceDialog?.show());
    this.actions.insertBefore(this.btnHtmlSource, this.btnSave);
  }

  /**
   * Dropdown "Importar / Exportar" — reúne importação (HTML/Markdown) e as três
   * exportações (HTML, JSON, HTML standalone) num só botão. Usa o dropdown do
   * Bootstrap (bundle já carregado).
   */
  _injectImportExportMenu() {
    const wrap = el('div', { class: 'dropdown editor-io-menu' });

    const toggle = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary dropdown-toggle',
      title: t('topbar.io'),
      'aria-label': t('topbar.io'),
      'data-bs-toggle': 'dropdown',
      'aria-expanded': 'false',
    }, [icon('arrow-down-up')]);

    const item = (iconName, labelKey, onClick) => {
      const li = el('li');
      const btn = el('button', { type: 'button', class: 'dropdown-item' },
        [icon(iconName), ' ', t(labelKey)]);
      btn.addEventListener('click', onClick);
      li.appendChild(btn);
      return li;
    };

    const menu = el('ul', { class: 'dropdown-menu dropdown-menu-end' }, [
      el('li', {}, [el('h6', { class: 'dropdown-header' }, t('topbar.io.import'))]),
      item('box-arrow-in-down', 'topbar.import',
        () => this.editor.ui.importDialog?.show()),
      el('li', {}, [el('hr', { class: 'dropdown-divider' })]),
      el('li', {}, [el('h6', { class: 'dropdown-header' }, t('topbar.io.export'))]),
      item('filetype-html', 'topbar.exportHTML',
        () => this.editor.ui.exportDialog?.showHTML()),
      item('braces', 'topbar.exportJSON',
        () => this.editor.ui.exportDialog?.showJSON()),
      item('file-earmark-code', 'topbar.exportStandalone',
        () => this.editor.ui.exportDialog?.showStandalone()),
    ]);

    wrap.append(toggle, menu);
    this.actions.insertBefore(wrap, this.btnSave);
  }

  _toggleSidebars() {
    const hidden = this.root.classList.toggle('editor-shell--no-sidebars');
    const i = this.btnToggleSidebars.querySelector('i');
    i.className = `bi bi-${hidden ? 'layout-sidebar-inset-reverse' : 'layout-sidebar'}`;
  }

  /* ---------- Switch de dispositivo ---------- */

  _wireDeviceSwitch() {
    for (const btn of this.deviceBtns) {
      btn.disabled = false;
      btn.addEventListener('click', () => this._setDevice(btn.dataset.device, btn));
    }
    // Marca Desktop como ativo por padrão.
    const desktop = this.root.querySelector('[data-device="desktop"]');
    if (desktop) desktop.classList.add('active');
  }

  _setDevice(device, btn) {
    this.canvas.dataset.device = device;
    for (const b of this.deviceBtns) b.classList.toggle('active', b === btn);
  }

  /* ---------- Undo / Redo ---------- */

  _wireUndoRedo() {
    this.btnUndo.addEventListener('click', () => this.editor.undo());
    this.btnRedo.addEventListener('click', () => this.editor.redo());
    this.editor.bus.on('history:changed', (s) => this._syncHistory(s));
  }

  _syncHistory({ canUndo, canRedo, lastLabel }) {
    this.btnUndo.disabled = !canUndo;
    this.btnRedo.disabled = !canRedo;
    if (lastLabel) this.btnUndo.title = t('topbar.undo.labeled', { label: lastLabel });
    else this.btnUndo.title = t('topbar.undo');
  }

  /* ---------- Save ---------- */

  _wireSave() {
    this.btnSave.disabled = false;
    this.btnSave.addEventListener('click', () => this.editor.save());
  }

  /* ---------- Indicador de auto-save ---------- */

  _injectSaveStatus() {
    this.saveStatus = el('span', {
      class: 'editor-save-status',
      role: 'status',
      'aria-live': 'polite',
      title: 'Status do auto-save',
    }, [icon('cloud-check', 'editor-save-status__icon'),
        el('span', { class: 'editor-save-status__text' }, 'Sem alterações')]);
    this.actions.insertBefore(this.saveStatus, this.btnUndo);
    this._lastSavedAt = null;
    this._saveStatusState = 'idle';
  }

  _wireSaveStatus() {
    this.editor.bus.on('state:changed', (evt) => {
      // 'replace' = loadJSON / restore — não trata como dirty.
      if (evt.type === 'replace') return;
      this._setSaveStatus('dirty');
    });
    this.editor.bus.on('autosave:saved', (info) => {
      this._lastSavedAt = info?.savedAt ? new Date(info.savedAt) : new Date();
      this._setSaveStatus('saved');
    });
    this.editor.bus.on('save', () => {
      this._lastSavedAt = new Date();
      this._setSaveStatus('saved');
    });
    // Atualiza tempo relativo periodicamente.
    this._saveStatusTimer = setInterval(() => {
      if (this._saveStatusState === 'saved') this._renderSaveStatus();
    }, 30_000);
  }

  _setSaveStatus(state) {
    this._saveStatusState = state;
    this._renderSaveStatus();
  }

  _renderSaveStatus() {
    if (!this.saveStatus) return;
    const ico  = this.saveStatus.querySelector('.editor-save-status__icon');
    const text = this.saveStatus.querySelector('.editor-save-status__text');
    this.saveStatus.dataset.state = this._saveStatusState;
    if (this._saveStatusState === 'dirty') {
      ico.className  = 'bi bi-cloud-arrow-up editor-save-status__icon';
      text.textContent = 'Não salvo';
    } else if (this._saveStatusState === 'saving') {
      ico.className  = 'bi bi-arrow-repeat editor-save-status__icon editor-save-status__icon--spin';
      text.textContent = 'Salvando…';
    } else if (this._saveStatusState === 'saved') {
      ico.className  = 'bi bi-cloud-check editor-save-status__icon';
      text.textContent = `Salvo ${this._formatRelativeTime(this._lastSavedAt)}`;
    } else {
      ico.className  = 'bi bi-cloud editor-save-status__icon';
      text.textContent = 'Sem alterações';
    }
  }

  _formatRelativeTime(date) {
    if (!date) return 'agora';
    const diff = Math.max(0, (Date.now() - date.getTime()) / 1000);
    if (diff < 5)   return 'agora';
    if (diff < 60)  return `há ${Math.round(diff)}s`;
    if (diff < 3600) return `há ${Math.round(diff / 60)} min`;
    if (diff < 86400) return `há ${Math.round(diff / 3600)} h`;
    return date.toLocaleDateString('pt-BR');
  }

  /* ---------- Helpers de navegação por teclado ---------- */

  _moveSibling(id, delta) {
    const parent = this.editor.getParentOf(id);
    if (!parent) return;
    const idx = parent.children.findIndex((c) => c.id === id);
    const target = idx + delta;
    if (target < 0 || target >= parent.children.length) return;
    this.editor.moveBlock(id, parent.id, target);
  }

  _flatten() {
    const out = [];
    const walk = (n) => {
      if (n.id !== this.editor.rootId) out.push(n);
      for (const c of n.children) walk(c);
    };
    walk(this.editor.getRoot());
    return out;
  }

  _nextBlockId(currentId) {
    const flat = this._flatten();
    if (flat.length === 0) return null;
    const i = flat.findIndex((n) => n.id === currentId);
    return flat[(i + 1) % flat.length]?.id ?? null;
  }

  _previousBlockId(currentId) {
    const flat = this._flatten();
    if (flat.length === 0) return null;
    const i = flat.findIndex((n) => n.id === currentId);
    return flat[(i - 1 + flat.length) % flat.length]?.id ?? null;
  }

  /* ---------- Atalhos globais ---------- */

  _wireKeyboard() {
    // Ctrl+V fora de campos: cola o bloco copiado no editor ou converte o
    // conteúdo externo (Word, Google Docs, web, .txt/.md) em blocos. É
    // tratado no evento `paste` (e não no keydown) para ler o clipboard.
    document.addEventListener('paste', (e) => {
      // Já tratado pela edição inline (que pode ter encerrado o contenteditable).
      if (e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable ||
        t.closest('dialog, [role="dialog"], .modal'))) {
        return;
      }
      if (this.editor.handleClipboardPaste(e.clipboardData)) e.preventDefault();
    });

    document.addEventListener('keydown', (e) => {
      // Esc sempre desseleciona — mesmo dentro de inputs.
      if (e.key === 'Escape' && this.editor.getSelectedId()) {
        e.preventDefault();
        this.editor.deselectBlock();
        return;
      }
      // Demais atalhos: ignorar quando o usuário digita em campos.
      const t = e.target;
      if (t instanceof HTMLElement &&
          (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }

      // Delete (sem Ctrl) → remove o(s) bloco(s) selecionado(s).
      if (e.key === 'Delete') {
        const ids = this.editor.getSelectedIds();
        if (ids.length > 1) {
          e.preventDefault();
          this.editor.removeBlocks(ids);
        } else if (ids.length === 1) {
          e.preventDefault();
          this.editor.removeBlock(ids[0]);
        }
        return;
      }

      // Alt+↑/↓ → reordena o bloco selecionado entre irmãos.
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const sel = this.editor.getSelectedId();
        if (sel) {
          e.preventDefault();
          this._moveSibling(sel, e.key === 'ArrowUp' ? -1 : +1);
        }
        return;
      }

      // Tab / Shift+Tab → navega entre blocos no DFS da árvore (com wrap-around).
      if (e.key === 'Tab') {
        const sel = this.editor.getSelectedId();
        if (sel) {
          e.preventDefault();
          const next = e.shiftKey ? this._previousBlockId(sel) : this._nextBlockId(sel);
          if (next) this.editor.selectBlock(next);
        }
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); this.editor.undo();
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault(); this.editor.redo();
      } else if (e.key === 's') {
        e.preventDefault(); this.editor.save();
      } else if (e.key === 'd') {
        const ids = this.editor.getSelectedIds();
        if (ids.length > 1) {
          e.preventDefault();
          this.editor.duplicateBlocks(ids);
        } else if (ids.length === 1) {
          e.preventDefault();
          this.editor.duplicateBlock(ids[0]);
        }
      } else if (e.key === 'c') {
        // Só intercepta se NÃO há texto selecionado (deixa Ctrl+C nativo copiar texto).
        const sel = this.editor.getSelectedId();
        const textSel = window.getSelection?.()?.toString() ?? '';
        if (sel && !textSel) {
          e.preventDefault();
          this.editor.copyBlock(sel);
        }
      } else if (e.key === '\\') {
        e.preventDefault(); this._toggleSidebars();
      }
    });
  }
}
