import { Block } from '../Block.js';
import { spacingControls, advancedControls } from '../common-controls.js';

/**
 * List — itens são uma string com um item por linha (props.items).
 * Decisão: evitar bloco "list-item" filho porque inflaria a árvore.
 * Trade-off: itens não podem ter formatação rica individual.
 */
export class List extends Block {
  static type = 'list';
  static label = 'Lista';
  static icon = 'list-ul';
  static schema = {
    props: {
      ordered: false,
      items: 'Item 1\nItem 2\nItem 3',
    },
    classes: [],
    attrs: {},
  };
  static allowedChildren = null;
  static clickToEdit = true;
  static editableMultiline = true;

  /**
   * Edição inline direto no <ul>/<ol>: Enter cria item novo (nativo do
   * contenteditable), Backspace junta itens. O valor é lido por linha do
   * innerText — um item por linha, como em `props.items`.
   */
  static getInlineEditTarget(blockEl, _eventTarget, node) {
    const isGroup = () => node.classes?.includes('list-group');
    return {
      element: blockEl,
      multiline: true,
      read: (n) => String(n.props.items ?? ''),
      write: (_, v) => ({ props: { items: v } }),
      getValue: (el) => el.innerText.split('\n')
        .map((l) => l.trim()).filter(Boolean).join('\n'),
      setValue: (el, v) => {
        el.replaceChildren(...String(v).split('\n')
          .map((l) => l.trim()).filter(Boolean)
          .map((t) => {
            const li = document.createElement('li');
            if (isGroup()) li.className = 'list-group-item';
            li.textContent = t;
            return li;
          }));
      },
    };
  }

  static render(node) {
    const tag = node.props.ordered ? 'ol' : 'ul';
    const list = document.createElement(tag);
    // Quando a classe `list-group` está ativa, os itens recebem
    // `list-group-item` (a classe do <ul>/<ol> vem das classes do nó).
    const isGroup = node.classes?.includes('list-group');
    const itemsRaw = String(node.props.items ?? '');
    for (const line of itemsRaw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const li = document.createElement('li');
      if (isGroup) li.className = 'list-group-item';
      li.textContent = trimmed;
      list.appendChild(li);
    }
    return list;
  }

  static settings(node) {
    return [
      { tab: 'content', type: 'toggle', label: 'Tipo',
        toggleLabel: 'Numerada (<ol>)',
        bind: { kind: 'prop', key: 'ordered' } },
      { tab: 'content', type: 'textarea', label: 'Itens (um por linha)',
        bind: { kind: 'prop', key: 'items' } },

      { tab: 'style', type: 'toggle', label: 'Sem marcadores',
        toggleLabel: 'list-unstyled',
        bind: { kind: 'classToggle', class: 'list-unstyled' } },
      { tab: 'style', type: 'toggle', label: 'Inline',
        toggleLabel: 'list-inline (itens lado a lado)',
        bind: { kind: 'classToggle', class: 'list-inline' } },

      { tab: 'style', type: 'toggle', label: 'Lista em grupo',
        toggleLabel: 'list-group (itens com cartão/borda)',
        help: 'Transforma a lista no componente list-group do Bootstrap.',
        bind: { kind: 'classToggle', class: 'list-group' } },
      { tab: 'style', type: 'toggle', label: 'Sem bordas externas',
        toggleLabel: 'list-group-flush',
        bind: { kind: 'classToggle', class: 'list-group-flush' } },
      { tab: 'style', type: 'toggle', label: 'Numerada (grupo)',
        toggleLabel: 'list-group-numbered',
        bind: { kind: 'classToggle', class: 'list-group-numbered' } },

      ...spacingControls(),
      ...advancedControls(),
    ];
  }
}
