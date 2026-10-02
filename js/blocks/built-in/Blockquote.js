import { Block } from '../Block.js';
import { spacingControls, textAlignControl, advancedControls, colorControl } from '../common-controls.js';

export class Blockquote extends Block {
  static type = 'blockquote';
  static label = 'Citação';
  static icon = 'chat-quote';
  static category = 'basic';
  static schema = {
    props: { text: 'Uma citação memorável.', source: 'Autor da citação' },
    classes: ['blockquote'],
    attrs: {},
  };
  static allowedChildren = null;
  static editableProp = 'text';
  static editableMultiline = true;
  /** Edita só o <p> da citação (o rodapé com a fonte fica de fora). */
  static editableSelector = 'p';
  static clickToEdit = true;
  /**
   * Fast-path: só a citação (`text`, no `<p>`) atualiza in-place. `source`
   * cria/remove o `<footer>` condicional → cai no re-render normal.
   */
  static fastUpdate = { text: { target: 'p' } };

  static render(node) {
    const bq = document.createElement('blockquote');
    const p = document.createElement('p');
    p.textContent = node.props.text ?? '';
    p.style.whiteSpace = 'pre-wrap';
    bq.appendChild(p);
    if (node.props.source) {
      const f = document.createElement('footer');
      f.className = 'blockquote-footer';
      f.textContent = node.props.source;
      bq.appendChild(f);
    }
    return bq;
  }

  static settings(node) {
    return [
      { tab: 'content', type: 'textarea', label: 'Texto da citação',
        bind: { kind: 'prop', key: 'text' } },
      { tab: 'content', type: 'text', label: 'Fonte / Autor',
        bind: { kind: 'prop', key: 'source' } },
      ...textAlignControl(),
      ...colorControl('text', 'Cor do texto'),
      ...colorControl('bg', 'Cor de fundo'),
      ...spacingControls(),
      ...advancedControls(),
    ];
  }
}
