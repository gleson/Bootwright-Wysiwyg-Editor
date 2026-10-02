import { Block } from '../Block.js';
import { spacingControls, advancedControls, colorControl, typographyControl,
  textUtilControls } from '../common-controls.js';

/**
 * Profile DOMPurify para texto rico do Paragraph.
 * Apenas formatação inline + br + link (sem nofollow imposto: o usuário decide).
 */
export const RICH_TEXT_PROFILE = {
  ALLOWED_TAGS: ['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'span'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'style'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

/**
 * Profile DOMPurify "amplo": inline + blocos comuns (headings, listas,
 * blockquote, code, hr). Usado em containers que precisam de conteúdo
 * estruturado — ex.: corpo de tab/accordion. Não inclui mídia (img, iframe)
 * nem scripts.
 */
export const RICH_TEXT_FULL_PROFILE = {
  ALLOWED_TAGS: [
    'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'span',
    'p', 'div',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'code', 'pre', 'hr',
    'small', 'sub', 'sup',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'style', 'class'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

/**
 * Profile DOMPurify para CONTEÚDO DE BLOCO (carrosséis, abas, acordeões).
 * Aceita praticamente qualquer tag estrutural que o próprio editor exporta:
 * incluindo `<img>`, `<button>`, `<iframe>` (vídeo), formulário, tabela, etc.
 * Usado no mini-editor de painéis/slides. Sanitização ainda bloqueia script,
 * on* handlers e protocolos perigosos.
 */
export const BLOCK_CONTENT_PROFILE = {
  ALLOWED_TAGS: [
    // inline
    'b', 'strong', 'i', 'em', 'u', 'a', 'br', 'span', 'small', 'sub', 'sup', 'code', 'kbd', 'mark',
    // bloco
    'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
    'figure', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'blockquote', 'cite', 'pre', 'hr',
    // mídia
    'img', 'picture', 'source', 'video', 'audio', 'track', 'iframe',
    // interativos
    'button',
    // tabela
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // formulário
    'form', 'label', 'input', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'legend',
    // ícone bootstrap (renderiza via classe)
    'i',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel', 'title', 'style', 'class', 'id', 'role', 'tabindex',
    'src', 'srcset', 'alt', 'width', 'height', 'sizes', 'poster',
    'type', 'name', 'value', 'placeholder', 'required', 'disabled', 'readonly',
    'autocomplete', 'pattern', 'min', 'max', 'step', 'maxlength', 'minlength', 'rows', 'cols',
    'checked', 'selected', 'multiple', 'for', 'action', 'method', 'enctype', 'novalidate',
    'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-expanded',
    'aria-hidden', 'aria-current', 'aria-selected', 'aria-live', 'aria-atomic',
    'colspan', 'rowspan', 'scope', 'headers',
    'controls', 'loop', 'autoplay', 'muted', 'playsinline', 'preload',
    'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy',
    'data-*',
  ],
  ALLOW_DATA_ATTR: true,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|#|data:image\/):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  // Sobrescreve o default do Sanitizer que proíbe <form>: aqui formulários
  // dentro do conteúdo são bem-vindos. Mantém script/style/etc. proibidos.
  FORBID_TAGS: ['script', 'style', 'object', 'embed', 'base'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange'],
};

export class Paragraph extends Block {
  static type = 'paragraph';
  static label = 'Parágrafo';
  static icon = 'text-paragraph';
  static schema = {
    props: { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.' },
    classes: [],
    attrs: {},
  };
  static allowedChildren = null;
  static editableProp = 'text';
  static editableMultiline = true;
  /** Texto suporta formatação inline (bold, italic, underline, link, br). */
  static editableHtml = true;
  /** Clique simples já entra em edição com o cursor no ponto clicado. */
  static clickToEdit = true;
  static richTextProfile = RICH_TEXT_PROFILE;

  static render(node, ctx) {
    const p = document.createElement('p');
    const raw = node.props.text ?? '';
    // Se o conteúdo contém tags, sanitiza com allowlist e injeta como HTML.
    // Se for texto puro (legado), o textContent + pre-wrap preserva \n.
    if (typeof raw === 'string' && /<[a-z][\s\S]*>/i.test(raw)) {
      try {
        p.innerHTML = ctx?.sanitizer
          ? ctx.sanitizer.html(raw, RICH_TEXT_PROFILE)
          : raw;
      } catch {
        p.textContent = raw;
      }
    } else {
      p.textContent = raw;
      // pre-wrap só faz sentido pra texto puro com \n (conteúdo legado).
      // Em HTML rico os <br> cuidam das quebras e não polui o markup.
      p.style.whiteSpace = 'pre-wrap';
    }
    return p;
  }

  /**
   * Fast-path do Renderer: se SÓ `props.text` mudou, reescreve o conteúdo do
   * `<p>` (mesma lógica do render) sem recriar o elemento — preserva o
   * `white-space: pre-wrap` já aplicado.
   */
  static updateInPlace(node, element, prevProps, ctx) {
    for (const k of new Set([...Object.keys(prevProps), ...Object.keys(node.props)])) {
      if (k === 'text') continue;
      if (prevProps[k] !== node.props[k]) return false;
    }
    const raw = node.props.text ?? '';
    if (typeof raw === 'string' && /<[a-z][\s\S]*>/i.test(raw)) {
      try {
        element.innerHTML = ctx?.sanitizer
          ? ctx.sanitizer.html(raw, RICH_TEXT_PROFILE)
          : raw;
      } catch {
        element.textContent = raw;
      }
      // Conteúdo virou HTML rico — não precisa mais de pre-wrap legado.
      element.style.whiteSpace = '';
      if (!element.getAttribute('style')) element.removeAttribute('style');
    } else {
      element.textContent = raw;
      element.style.whiteSpace = 'pre-wrap';
    }
    return true;
  }

  static settings(node) {
    return [
      { tab: 'content', type: 'textarea', label: 'Texto',
        bind: { kind: 'prop', key: 'text' } },

      { tab: 'style', type: 'radio-group', label: 'Alinhamento',
        options: [
          { value: 'text-{bp}-start',  label: 'Esquerda', icon: 'text-left' },
          { value: 'text-{bp}-center', label: 'Centro',   icon: 'text-center' },
          { value: 'text-{bp}-end',    label: 'Direita',  icon: 'text-right' },
        ],
        bind: { kind: 'classGroup', responsive: true,
          group: ['text-{bp}-start','text-{bp}-center','text-{bp}-end'] } },

      { tab: 'style', type: 'toggle', label: 'Destaque',
        toggleLabel: 'lead (parágrafo de destaque)',
        help: 'Aumenta o tamanho e o peso visual do parágrafo (classe .lead).',
        bind: { kind: 'classToggle', class: 'lead' } },
      ...typographyControl(),
      ...textUtilControls(),
      ...colorControl('text', 'Cor do texto'),
      ...colorControl('bg', 'Cor de fundo'),

      ...spacingControls(),
      ...advancedControls(),
    ];
  }
}
