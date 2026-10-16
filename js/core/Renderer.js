import { t } from '../i18n/index.js';
import { el, clear, icon } from '../utils/dom.js';
import { safeCss } from '../utils/url.js';

/** Igualdade rasa de arrays (por referência dos itens). */
function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Igualdade rasa de objetos (mesmas chaves, valores `===`). */
function sameObject(a, b) {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Renderer — projeta a árvore JSON no DOM do canvas.
 *
 * Estratégia: diff por evento (sem virtual DOM próprio).
 *   - state:changed { type: 'replace' } → re-render completo do canvas.
 *   - state:changed { type: 'insert',  parentId, index } → renderiza o subtree
 *     novo e o insere no lugar certo.
 *   - state:changed { type: 'remove' } → remove o elemento e seus descendentes
 *     do índice DOM.
 *   - state:changed { type: 'update' } → fast-path se a mudança for "leve"
 *     (só texto / só célula de tabela, via `Block.updateInPlace`); senão
 *     re-renderiza o subtree do nó alterado (preserva a posição via replaceWith).
 *
 * `move` no State é detach + insert, então gera dois eventos consecutivos.
 *
 * Cada elemento renderizado recebe `data-block-id` e `data-block-type` para
 * permitir click-to-select e estilização por tipo.
 *
 * Em caso de erro durante o diff, faz fallback para full re-render — preferível
 * a deixar o DOM inconsistente com o State.
 */
export class Renderer {
  constructor(editor) {
    this.editor = editor;
    this.registry = editor.registry;
    this.sanitizer = editor.sanitizer;
    this.canvas = editor.root.querySelector('[data-region="canvas"]');
    /** @type {Map<string, HTMLElement>} */
    this.nodeElements = new Map();
    /**
     * Snapshot raso do nó no momento do render — base de comparação do
     * fast-path em `_handleUpdate`. @type {Map<string, object>}
     */
    this.nodeSnapshots = new Map();
  }

  mount() {
    this.editor.bus.on('state:changed', (e) => this._handle(e));
    this.editor.bus.on('selection:changed', ({ id, ids }) => this._highlightSelection(id, ids));
    this._renderAll();
  }

  /* ---------- Dispatcher ---------- */

  _handle(evt) {
    try {
      switch (evt.type) {
        case 'replace': this._renderAll(); break;
        case 'insert':  this._handleInsert(evt); break;
        case 'remove':  this._handleRemove(evt); break;
        case 'update':  this._handleUpdate(evt); break;
        default:
          console.warn('[Renderer] tipo de evento desconhecido:', evt.type);
      }
    } catch (err) {
      console.error('[Renderer] erro processando evento, fazendo full re-render:', err);
      this._renderAll();
    }
    this._highlightSelection(this.editor.getSelectedId());
  }

  /* ---------- Full render ---------- */

  _renderAll() {
    clear(this.canvas);
    this.nodeElements.clear();
    this.nodeSnapshots.clear();
    const root = this.editor.getRoot();
    for (const child of root.children) {
      this.canvas.appendChild(this._renderNode(child));
    }
    this._toggleEmptyState();
  }

  _toggleEmptyState() {
    const empty = this.editor.getRoot().children.length === 0;
    const placeholder = this.canvas.querySelector('.editor-canvas__placeholder');
    if (empty && !placeholder) {
      this.canvas.appendChild(this._buildEmptyPlaceholder());
    } else if (!empty && placeholder) {
      placeholder.remove();
    }
  }

  _buildEmptyPlaceholder() {
    return el('div', { class: 'editor-canvas__placeholder' }, [
      icon('cursor-text'),
      el('p', {}, 'Canvas vazio'),
      el('small', {}, 'Use a aba "Blocos" no painel esquerdo para começar. '
        + 'Parágrafos, títulos e linhas podem ir direto aqui — a Seção só é '
        + 'necessária se você quiser o container do Bootstrap.'),
      this._emptyActions(),
    ]);
  }

  /** Atalhos do canvas vazio — no celular as sidebars começam fechadas. */
  _emptyActions() {
    const btn = (iconName, label, onClick) => {
      const b = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary' },
        [icon(iconName), ' ', label]);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
      return b;
    };
    return el('div', { class: 'editor-canvas__placeholder-actions' }, [
      btn('clipboard', t('canvas.empty.paste'), () => this.editor.pasteFromClipboard()),
      btn('plus-lg', t('canvas.empty.addBlock'), () => {
        const mobile = this.editor.ui.mobileLayout;
        if (mobile?.isMobile) mobile.open('left');
        else {
          if (this.editor.root.classList.contains('editor-shell--no-sidebars')) {
            this.editor.ui.topbar?._toggleSidebars();
          }
          this.editor.root.querySelector('[data-region="sidebar-left"] input')?.focus();
        }
      }),
    ]);
  }

  /* ---------- Renderização de um nó ---------- */

  /**
   * Renderiza um nó da árvore. Em modo "frozen" (ex.: filhos de uma instância
   * de componente que vêm do master), não atribui `data-block-id` para que
   * clicks caiam para o ancestor real selecionável.
   */
  _renderNode(node, opts = {}) {
    const frozen = opts.frozen === true;
    const BlockClass = this.registry.get(node.type);
    if (!BlockClass) return this._renderFallback(node);

    const ctx = { sanitizer: this.sanitizer, editor: this.editor };

    let element;
    try {
      element = BlockClass.render(node, ctx);
    } catch (err) {
      console.error(`[Renderer] erro em ${node.type}.render():`, err);
      return this._renderFallback(node);
    }

    if (!frozen) {
      element.dataset.blockId = node.id;
      element.dataset.blockType = node.type;
    } else {
      // Marca visualmente conteúdo de instância de componente (estilo
      // opcional pode usar via [data-frozen]).
      element.dataset.frozen = 'true';
    }

    for (const cls of node.classes) {
      if (cls) element.classList.add(cls);
    }
    for (const [k, v] of Object.entries(node.attrs)) {
      if (v == null) continue;
      if (k === 'style') {
        const prev = element.getAttribute('style') || '';
        const clean = safeCss(v);
        element.setAttribute('style', prev ? `${prev}; ${clean}` : clean);
      } else {
        element.setAttribute(k, String(v));
      }
    }

    // Componentes (via getEffectiveChildren) substituem node.children pelo
    // master tree. Filhos resultantes ficam frozen mesmo que o pai não esteja.
    let effectiveChildren = node.children;
    let childrenAreFrozen = frozen;
    if (typeof BlockClass.getEffectiveChildren === 'function') {
      try {
        effectiveChildren = BlockClass.getEffectiveChildren(node, ctx) ?? [];
        childrenAreFrozen = true;
      } catch (err) {
        console.error(`[Renderer] erro em ${node.type}.getEffectiveChildren():`, err);
        effectiveChildren = [];
      }
    }

    if (effectiveChildren?.length) {
      const container = BlockClass.getChildrenContainer(element);
      for (const child of effectiveChildren) {
        container.appendChild(this._renderNode(child, { frozen: childrenAreFrozen }));
      }
    }

    if (!frozen) {
      this.nodeElements.set(node.id, element);
      this._snapshot(node);
    }
    return element;
  }

  /** Guarda o snapshot raso usado pelo fast-path de `_handleUpdate`. */
  _snapshot(node) {
    this.nodeSnapshots.set(node.id, {
      props: { ...node.props },
      classes: [...node.classes],
      attrs: { ...node.attrs },
      childIds: node.children.map((c) => c.id),
    });
  }

  _renderFallback(node) {
    const fb = el('div', {
      class: 'editor-block-fallback',
      dataset: { blockId: node.id, blockType: node.type },
    }, [`[bloco "${node.type}" não registrado]`]);
    this.nodeElements.set(node.id, fb);
    return fb;
  }

  /* ---------- Handlers de evento ---------- */

  _handleInsert({ id, parentId, index }) {
    const node = this.editor.getNode(id);
    if (!node) return;

    let container;
    if (parentId === this.editor.rootId) {
      this._toggleEmptyState();
      this._removeEmptyPlaceholder();
      container = this.canvas;
    } else {
      const parentEl = this.nodeElements.get(parentId);
      if (!parentEl) {
        // Pai não está renderizado — full re-render é o jeito mais seguro.
        this._renderAll();
        return;
      }
      const ParentClass = this.registry.get(this.editor.getNode(parentId).type);
      container = ParentClass?.getChildrenContainer(parentEl) ?? parentEl;
    }

    const newEl = this._renderNode(node);
    const ref = container.children[index] ?? null;
    if (ref) container.insertBefore(newEl, ref);
    else container.appendChild(newEl);
  }

  _handleRemove({ id }) {
    const element = this.nodeElements.get(id);
    if (element) element.remove();
    this._unindex(id);
    this._toggleEmptyState();
  }

  _handleUpdate({ id }) {
    const node = this.editor.getNode(id);
    if (!node) return;
    const oldEl = this.nodeElements.get(id);
    if (!oldEl) {
      this._renderAll();
      return;
    }
    // Fast-path: mudança "leve" (só texto / só célula) → update in-place,
    // preservando o elemento e o índice/snapshots do subtree.
    if (this._tryFastUpdate(node, oldEl)) return;

    this._unindex(id);
    const newEl = this._renderNode(node);
    oldEl.replaceWith(newEl);
  }

  /**
   * Tenta aplicar o update sem re-renderizar o subtree. Só procede se a
   * estrutura (classes, attrs, ids dos filhos) está intacta e o bloco oferece
   * `updateInPlace`. Retorna true se o bloco confirmou ter tratado a mudança.
   */
  _tryFastUpdate(node, element) {
    const snap = this.nodeSnapshots.get(node.id);
    if (!snap) return false;
    const BlockClass = this.registry.get(node.type);
    if (typeof BlockClass?.updateInPlace !== 'function') return false;
    if (!sameArray(snap.classes, node.classes)) return false;
    if (!sameObject(snap.attrs, node.attrs)) return false;
    if (!sameArray(snap.childIds, node.children.map((c) => c.id))) return false;

    const ctx = { sanitizer: this.sanitizer, editor: this.editor };
    let handled = false;
    try {
      handled = BlockClass.updateInPlace(node, element, snap.props, ctx) === true;
    } catch (err) {
      console.error(`[Renderer] updateInPlace(${node.type}) falhou:`, err);
      return false;
    }
    if (!handled) return false;
    this._snapshot(node); // estrutura igual, props novas
    return true;
  }

  /* ---------- Helpers ---------- */

  _removeEmptyPlaceholder() {
    const ph = this.canvas.querySelector('.editor-canvas__placeholder');
    if (ph) ph.remove();
  }

  _unindex(id) {
    const element = this.nodeElements.get(id);
    this.nodeElements.delete(id);
    this.nodeSnapshots.delete(id);
    if (element) {
      for (const desc of element.querySelectorAll('[data-block-id]')) {
        this.nodeElements.delete(desc.dataset.blockId);
        this.nodeSnapshots.delete(desc.dataset.blockId);
      }
    }
  }

  _highlightSelection(id, ids) {
    for (const e of this.canvas.querySelectorAll('.editor-block--selected, .editor-block--multi')) {
      e.classList.remove('editor-block--selected', 'editor-block--multi');
    }
    const list = Array.isArray(ids) && ids.length ? ids : (id ? [id] : []);
    const multi = list.length > 1;
    for (const bid of list) {
      const target = this.nodeElements.get(bid);
      if (!target) continue;
      target.classList.add('editor-block--selected');
      if (multi) target.classList.add('editor-block--multi');
    }
  }
}
