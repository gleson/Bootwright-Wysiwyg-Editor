/**
 * Canvas — comportamento do clique na área do canvas.
 *
 * Fase 2: clicar em qualquer nó com data-block-id seleciona o bloco;
 * clicar em vazio deseleciona. Como nada é renderizado ainda
 * (Renderer entra na Fase 3), o efeito visível é apenas a deseleção.
 */
export class Canvas {
  constructor(editor) {
    this.editor = editor;
    this.region = editor.root.querySelector('[data-region="canvas"]');
  }

  mount() {
    // Bloqueia submit de formulários dentro do canvas — o usuário está editando,
    // não testando. (Em produção/exportHTML o submit funciona normalmente.)
    this.region.addEventListener('submit', (e) => {
      e.preventDefault();
    });
    this.region.addEventListener('click', (e) => {
      // Não roubar clique de input em edição inline
      const editing = e.target.closest('[data-editing="true"]');
      if (editing) return;

      const blockEl = e.target.closest('[data-block-id]');
      if (blockEl) {
        // Bloqueia navegação default de <a href> dentro do canvas
        if (e.target.closest('a[href]')) e.preventDefault();
        e.stopPropagation();

        // Tabela já selecionada + clique numa célula → seleção de range de
        // células (clique = âncora, Shift+clique = estende). Usada pelas ações
        // Mesclar/Separar do bloco Table.
        const cellEl = e.target.closest('[data-cell]');
        if (cellEl && blockEl.dataset.blockType === 'table'
            && this.editor.getSelectedId() === blockEl.dataset.blockId) {
          this.editor.selectTableCell(blockEl.dataset.blockId, cellEl.dataset.cell, e.shiftKey);
          return;
        }

        // Shift+click → adiciona/remove da multi-seleção.
        if (e.shiftKey) {
          this.editor.toggleBlockSelection(blockEl.dataset.blockId);
        } else {
          this.editor.selectBlock(blockEl.dataset.blockId);
          if (!e.ctrlKey && !e.metaKey && !e.altKey) this._maybeClickToEdit(blockEl, e);
        }
      } else {
        this.editor.deselectBlock();
      }
    });

    // Duplo-clique: ativa inline edit. O bloco pode oferecer um target customizado
    // via `getInlineEditTarget(blockEl, eventTarget, node)` — usado pela Tabela
    // pra editar célula a célula. Senão, cai no `editableProp` simples.
    this.region.addEventListener('dblclick', (e) => {
      // Já em edição (o clique simples abriu): o duplo-clique nativo só
      // seleciona a palavra — não reinicia a edição.
      if (e.target.closest('[data-editing="true"]')) return;
      const blockEl = e.target.closest('[data-block-id]');
      if (!blockEl) return;
      const id = blockEl.dataset.blockId;
      const node = this.editor.getNode(id);
      if (!node) return;
      const BlockClass = this.editor.registry.get(node.type);
      if (!BlockClass) return;

      let target;
      if (typeof BlockClass.getInlineEditTarget === 'function') {
        target = BlockClass.getInlineEditTarget(blockEl, e.target, node);
        if (!target) return;
      } else if (BlockClass.editableProp) {
        target = BlockClass.editableProp; // string → Editor normaliza
      } else {
        return;
      }

      e.preventDefault();
      this.editor.selectBlock(id);
      this.editor.startInlineEdit(id, target, {
        multiline: BlockClass.editableMultiline === true,
        html:      BlockClass.editableHtml === true,
        sanitizeProfile: BlockClass.richTextProfile,
      });
    });

    // Seleção de texto dentro de um bloco rich-text (editableHtml) entra
    // automaticamente em inline edit — assim a toolbar de formatação aparece
    // sem o usuário precisar dar duplo-clique antes. A seleção é preservada
    // pelo startInlineEdit.
    document.addEventListener('selectionchange', () => {
      if (this._selRaf) cancelAnimationFrame(this._selRaf);
      this._selRaf = requestAnimationFrame(() => {
        this._selRaf = null;
        this._maybeStartRichEditFromSelection();
      });
    });
  }

  /**
   * Clique simples em bloco de texto (`clickToEdit`) entra direto em edição
   * com o cursor piscando no ponto clicado — como num editor de texto comum.
   */
  _maybeClickToEdit(blockEl, e) {
    const id = blockEl.dataset.blockId;
    const node = this.editor.getNode(id);
    const BlockClass = node && this.editor.registry.get(node.type);
    if (!BlockClass?.clickToEdit || this.editor.isLocked(id)) return;
    if (BlockClass.editableSelector && !e.target.closest(BlockClass.editableSelector)) return;

    let target = BlockClass.editableProp;
    if (typeof BlockClass.getInlineEditTarget === 'function') {
      target = BlockClass.getInlineEditTarget(blockEl, e.target, node);
    }
    if (!target) return;
    this.editor.startInlineEdit(id, target, {
      multiline: BlockClass.editableMultiline === true,
      html:      BlockClass.editableHtml === true,
      sanitizeProfile: BlockClass.richTextProfile,
      caret: { x: e.clientX, y: e.clientY },
    });
  }

  _maybeStartRichEditFromSelection() {
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    const startEl = r.startContainer instanceof Element
      ? r.startContainer : r.startContainer.parentElement;
    const endEl = r.endContainer instanceof Element
      ? r.endContainer : r.endContainer.parentElement;
    const startBlock = startEl?.closest?.('[data-block-id]');
    const endBlock = endEl?.closest?.('[data-block-id]');
    // Só age quando a seleção está inteiramente dentro de um único bloco.
    if (!startBlock || startBlock !== endBlock) return;
    // Garante que está dentro do canvas (não em diálogos/inputs externos).
    if (!this.region.contains(startBlock)) return;
    const id = startBlock.dataset.blockId;
    // Já editando este bloco? toolbar já aparece sozinha.
    if (this.editor.inlineEdit?.id === id) return;
    const node = this.editor.getNode(id);
    if (!node) return;
    const BlockClass = this.editor.registry.get(node.type);
    if (!BlockClass?.editableHtml || !BlockClass.editableProp) return;
    this.editor.selectBlock(id);
    this.editor.startInlineEdit(id, BlockClass.editableProp, {
      multiline: BlockClass.editableMultiline === true,
      html: true,
      sanitizeProfile: BlockClass.richTextProfile,
    });
  }
}
