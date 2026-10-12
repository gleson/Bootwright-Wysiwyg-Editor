import { el, icon, clear } from '../utils/dom.js';
import {
  resolveTemplate, setGroupValue, findInGroup,
  toggleClass, isClassActive,
  readSpacing, writeSpacing,
} from '../utils/classManager.js';
import { readStyleProp, writeStyleProp, removeStyleProps, parseColor, serializeColor } from '../utils/styleManager.js';

/* Presets de gradiente para o controle de cor (target=bg). Chave = id estável
 * salvo no inline style; valor = string CSS. */
export const GRADIENT_PRESETS = [
  { id: 'sunset',     label: 'Pôr do sol',  css: 'linear-gradient(135deg, #ff6a00 0%, #ee0979 100%)' },
  { id: 'ocean',      label: 'Oceano',      css: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)' },
  { id: 'mint',       label: 'Hortelã',     css: 'linear-gradient(135deg, #00b09b 0%, #96c93d 100%)' },
  { id: 'royal',      label: 'Real',        css: 'linear-gradient(135deg, #141e30 0%, #243b55 100%)' },
  { id: 'peach',      label: 'Pêssego',     css: 'linear-gradient(135deg, #ed6ea0 0%, #ec8c69 100%)' },
  { id: 'cosmic',     label: 'Cósmico',     css: 'linear-gradient(135deg, #6a11cb 0%, #2575fc 100%)' },
  { id: 'sunshine',   label: 'Sol',         css: 'linear-gradient(135deg, #f7971e 0%, #ffd200 100%)' },
  { id: 'forest',     label: 'Floresta',    css: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
  { id: 'lavender',   label: 'Lavanda',     css: 'linear-gradient(135deg, #834d9b 0%, #d04ed6 100%)' },
  { id: 'silver',     label: 'Prata',       css: 'linear-gradient(135deg, #bdc3c7 0%, #2c3e50 100%)' },
];

const TEXT_CLASS_OPTIONS = [
  { value: 'text-primary',   label: 'Primária' },
  { value: 'text-secondary', label: 'Secundária' },
  { value: 'text-success',   label: 'Sucesso' },
  { value: 'text-danger',    label: 'Perigo' },
  { value: 'text-warning',   label: 'Aviso' },
  { value: 'text-info',      label: 'Info' },
  { value: 'text-light',     label: 'Clara' },
  { value: 'text-dark',      label: 'Escura' },
  { value: 'text-muted',     label: 'Suave' },
  { value: 'text-white',     label: 'Branca' },
  { value: 'text-black',     label: 'Preta' },
];

const BG_CLASS_OPTIONS = [
  { value: 'bg-primary',       label: 'Primária' },
  { value: 'bg-secondary',     label: 'Secundária' },
  { value: 'bg-success',       label: 'Sucesso' },
  { value: 'bg-danger',        label: 'Perigo' },
  { value: 'bg-warning',       label: 'Aviso' },
  { value: 'bg-info',          label: 'Info' },
  { value: 'bg-light',         label: 'Clara' },
  { value: 'bg-dark',          label: 'Escura' },
  { value: 'bg-body-tertiary', label: 'Terciária' },
  { value: 'bg-white',         label: 'Branca' },
  { value: 'bg-black',         label: 'Preta' },
  { value: 'bg-transparent',   label: 'Transparente' },
];

/* ---------- Tipografia composta ---------- */

const FONT_FAMILY_OPTIONS = [
  { value: '',              label: 'Padrão (sistema)' },
  { value: 'font-monospace', label: 'Monospace' },
];
const FONT_FAMILY_GROUP = ['font-monospace'];

const FONT_SIZE_OPTIONS = [
  { value: '', label: '— padrão —' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ value: `fs-${n}`, label: `fs-${n}` })),
];
const FONT_SIZE_GROUP = ['fs-1', 'fs-2', 'fs-3', 'fs-4', 'fs-5', 'fs-6'];

const FONT_WEIGHT_OPTIONS = [
  { value: '',              label: 'Normal (400)' },
  { value: 'fw-light',      label: 'Light (300)' },
  { value: 'fw-medium',     label: 'Medium (500)' },
  { value: 'fw-semibold',   label: 'Semibold (600)' },
  { value: 'fw-bold',       label: 'Bold (700)' },
  { value: 'fw-bolder',     label: 'Bolder' },
];
const FONT_WEIGHT_GROUP = ['fw-light', 'fw-normal', 'fw-medium', 'fw-semibold', 'fw-bold', 'fw-bolder'];

const COLOR_CONFIG = {
  text: {
    label: 'texto',
    classOptions: TEXT_CLASS_OPTIONS,
    classPrefix: 'text-',
    cssProp: 'color',
    supportsGradient: false,
  },
  bg: {
    label: 'fundo',
    classOptions: BG_CLASS_OPTIONS,
    classPrefix: 'bg-',
    cssProp: 'background-color',
    cssGradientProp: 'background-image',
    supportsGradient: true,
  },
};

function getColorConfig(target) {
  return COLOR_CONFIG[target] ?? COLOR_CONFIG.text;
}

/**
 * Converte um CSS de gradiente em "id" (preset built-in OU 'user:<id>'). Se
 * nada bater, retorna o próprio CSS — assim o select cai pra string crua.
 */
function gradientCssToId(css, editor) {
  if (!css) return '';
  const builtIn = GRADIENT_PRESETS.find((g) => g.css === css);
  if (builtIn) return builtIn.id;
  const userList = editor?.listGradients?.() ?? [];
  const user = userList.find((g) => g.css === css);
  if (user) return 'user:' + user.id;
  return '';
}

function gradientIdToCss(id, editor) {
  if (!id) return '';
  if (id.startsWith('user:')) {
    const uid = id.slice(5);
    return editor?.customizations?.getGradient(uid)?.css ?? '';
  }
  return GRADIENT_PRESETS.find((g) => g.id === id)?.css ?? '';
}

/**
 * ControlFactory — gera campos de input no painel de propriedades a partir de
 * um schema declarativo (retornado por Block.settings(node)).
 *
 * Schema de um controle:
 *   {
 *     tab:        'content' | 'style' | 'advanced',
 *     type:       'text'|'textarea'|'number'|'select'|'toggle'|
 *                 'range'|'radio-group'|'color'|'spacing',
 *     label:      string,
 *     help?:      string,
 *     toggleLabel?: string,                     // para 'toggle'
 *     options?:   [{value, label, icon?}],      // para select/radio-group
 *     min?, max?, step?:                        // para number/range
 *     bind: {
 *       kind: 'prop'|'attr'|'classToggle'|'classGroup'|'classes'|'spacing'
 *       key?:        string                   // prop/attr
 *       class?:      string (template)        // classToggle
 *       group?:      string[] (templates)     // classGroup
 *       removes?, addsWhenOff?: string[]      // classToggle
 *       property?:   'm'|'p'                  // spacing
 *       responsive?: boolean                  // se true, usa editor.activeBreakpoint
 *     }
 *   }
 *
 * `create(schema, node)` devolve `{ field, input, schema }`. Guarde o objeto
 * para chamar `sync(input, schema, node)` depois — útil quando o nó muda por
 * fora (undo, console, switch de breakpoint) e queremos atualizar valores
 * sem reconstruir o painel (preserva o caret / foco do usuário).
 *
 * Coalescência: para inputs de texto livre (text/textarea com bind.kind=prop),
 * o factory passa `coalesceKey` para `editor.updateBlock`, fazendo digitação
 * contínua virar um único registro de undo.
 */

let UID = 0;
const nextUid = () => `ctl-${++UID}`;

export class ControlFactory {
  constructor(editor) {
    this.editor = editor;
  }

  create(schema, node) {
    // 'action' é botão; não tem label externa nem leitura inicial de bind.
    if (schema.type === 'action') {
      const input = this._buildInput(schema, null);
      this._wireWriteListener(input, schema, node);
      const helpEl = schema.help
        ? el('small', { class: 'editor-control__help' }, schema.help)
        : null;
      const field = el('div', { class: 'editor-control editor-control--action' },
        [input, helpEl]);
      return { field, input, schema };
    }

    // 'class-picker': insere classes vindas do CSS personalizado.
    // Esconde o controle inteiro se não há classes detectadas — campo "vazio"
    // só polui o painel.
    if (schema.type === 'class-picker') {
      const names = this.editor.getCustomClassNames?.() ?? [];
      if (names.length === 0) {
        const field = el('div', { class: 'editor-control', hidden: true });
        return { field, input: field, schema };
      }
      const input = this._buildClassPicker(names, node);
      const labelEl = schema.label
        ? el('label', { class: 'editor-control__label' }, schema.label)
        : null;
      const helpEl = schema.help
        ? el('small', { class: 'editor-control__help' }, schema.help)
        : null;
      const field = el('div', { class: 'editor-control' }, [labelEl, input, helpEl]);
      return { field, input, schema };
    }

    const value = this._read(schema.bind, node);
    const input = this._buildInput(schema, value);

    const labelEl = schema.label
      ? el('label', { class: 'editor-control__label' }, schema.label)
      : null;
    const helpEl = schema.help
      ? el('small', { class: 'editor-control__help' }, schema.help)
      : null;
    const field = el('div', { class: 'editor-control' }, [labelEl, input, helpEl]);

    this._wireWriteListener(input, schema, node);
    return { field, input, schema };
  }

  /** Atualiza valor do controle a partir do nó. Pula se o input está focado. */
  sync(input, schema, node) {
    if (schema.type === 'action' || schema.type === 'class-picker') return;
    // items-list não pula pelo foco: o foco costuma estar nos PRÓPRIOS botões
    // dela (Adicionar, ↑/↓, remover) logo depois do clique, e pular deixava a
    // lista do painel desatualizada (aba nova no canvas, ausente no painel).
    // `_setItemsListValue` já preserva o input em que se está digitando.
    if (schema.type !== 'items-list') {
      const inner = this._innerInput(input, schema);
      if (this._isFocused(inner ?? input)) return;
    }
    const value = this._read(schema.bind, node);
    this._setValue(input, schema, value);
  }

  _buildClassPicker(names, node) {
    const wrap = el('div', { class: 'editor-control__class-picker input-group input-group-sm' });
    const sel = el('select', { class: 'form-select form-select-sm' });
    sel.appendChild(el('option', { value: '' }, '— escolha uma classe —'));
    for (const name of names) {
      sel.appendChild(el('option', { value: name }, '.' + name));
    }
    const btn = el('button', { type: 'button', class: 'btn btn-outline-primary' },
      [icon('plus-lg'), ' Adicionar']);
    btn.addEventListener('click', () => {
      const cls = sel.value;
      if (!cls) return;
      const fresh = this.editor.getNode(node.id);
      if (!fresh) return;
      if (fresh.classes.includes(cls)) {
        sel.value = '';
        return;
      }
      const next = [...fresh.classes, cls];
      this.editor.updateBlock(node.id, { classes: next });
      sel.value = '';
    });
    wrap.append(sel, btn);
    return wrap;
  }

  _isFocused(target) {
    if (!target) return false;
    const active = document.activeElement;
    if (target === active) return true;
    if (target instanceof Element && target.contains?.(active)) return true;
    return false;
  }

  _bp(bind) {
    return bind?.responsive ? (this.editor.activeBreakpoint ?? '') : '';
  }

  /* ---------- read / write ---------- */

  _read(bind, node) {
    if (!bind) return null;
    const bp = this._bp(bind);
    switch (bind.kind) {
      case 'prop':         return node.props[bind.key];
      case 'attr':         return node.attrs[bind.key] ?? '';
      case 'classToggle':  return isClassActive(node.classes, bind.class, bp);
      case 'classGroup':   return findInGroup(node.classes, bind.group, bp);
      case 'classes':      return node.classes.join(' ');
      case 'spacing':      return readSpacing(node.classes, bind.property, bp);
      case 'color':        return this._readColor(bind, node);
      case 'typography':   return this._readTypography(node);
      default:             return null;
    }
  }

  _readTypography(node) {
    const find = (group) => node.classes.find((c) => group.includes(c)) ?? '';
    let family = find(FONT_FAMILY_GROUP);
    // Se houver inline `font-family`, tenta casar com uma fonte do usuário.
    if (!family) {
      const inlineFamily = readStyleProp(node.attrs.style, 'font-family');
      if (inlineFamily) {
        const userFonts = this.editor.listFonts?.() ?? [];
        const match = userFonts.find((f) => f.stack === inlineFamily);
        family = match ? 'user:' + match.id : '__inline__';
      }
    }
    return {
      family,
      size:   find(FONT_SIZE_GROUP),
      weight: find(FONT_WEIGHT_GROUP),
      italic: node.classes.includes('fst-italic'),
    };
  }

  /**
   * Lê o estado do controle de cor compound. Retorna:
   *   { mode: 'class'|'custom'|'gradient'|'', value: string }
   *
   * Prioridade: classe → gradiente inline → cor inline → vazio.
   */
  _readColor(bind, node) {
    const cfg = getColorConfig(bind.target);
    // 1. Classe Bootstrap presente? (busca SOMENTE entre as opções válidas para
    // não confundir text-center/text-{bp}-center com cores de texto.)
    const validValues = new Set(cfg.classOptions.map((o) => o.value));
    const classMatch = node.classes.find((c) => validValues.has(c));
    if (classMatch) return { mode: 'class', value: classMatch };
    // 2. Gradiente inline (apenas para bg)
    if (cfg.supportsGradient) {
      const gradient = readStyleProp(node.attrs.style, cfg.cssGradientProp);
      if (gradient) {
        return { mode: 'gradient', value: gradientCssToId(gradient, this.editor) || gradient };
      }
    }
    // 3. Cor sólida inline
    const solid = readStyleProp(node.attrs.style, cfg.cssProp);
    if (solid) return { mode: 'custom', value: solid };
    return { mode: '', value: '' };
  }

  _write(bind, node, value, schema) {
    // schema.onChange override: o controle define o patch por inteiro.
    // Recebe (value, node, ctx) — ctx expõe { editor, sanitizer } para casos
    // como sanitização de HTML cru no próprio source.
    if (typeof schema?.onChange === 'function') {
      const ctx = { editor: this.editor, sanitizer: this.editor.sanitizer };
      const patch = schema.onChange(value, node, ctx);
      if (patch) this.editor.updateBlock(node.id, patch);
      return;
    }
    if (!bind) return;
    const bp = this._bp(bind);
    const patch = {};
    switch (bind.kind) {
      case 'prop':
        patch.props = { [bind.key]: value };
        break;
      case 'attr':
        patch.attrs = { [bind.key]: value };
        break;
      case 'classToggle':
        patch.classes = toggleClass(node.classes, bind.class, !!value,
          { removes: bind.removes, addsWhenOff: bind.addsWhenOff }, bp);
        break;
      case 'classGroup':
        patch.classes = setGroupValue(node.classes, bind.group, value, bp);
        break;
      case 'classes':
        patch.classes = String(value ?? '').split(/\s+/).filter(Boolean);
        break;
      case 'spacing':
        patch.classes = writeSpacing(node.classes, bind.property, value, bp);
        break;
      case 'typography': {
        // value = { family, size, weight, italic }
        const v = value ?? {};
        // Limpa todas as classes de tipografia que conhecemos.
        const ALL = [...FONT_FAMILY_GROUP, ...FONT_SIZE_GROUP, ...FONT_WEIGHT_GROUP, 'fst-italic'];
        let next = node.classes.filter((c) => !ALL.includes(c));
        // Família: classe Bootstrap, fonte do usuário (inline) ou nada.
        let nextStyle = node.attrs.style ?? '';
        if (v.family && v.family.startsWith('user:')) {
          // Fonte personalizada → inline style font-family.
          const font = this.editor.customizations?.getFont(v.family.slice(5));
          if (font?.stack) nextStyle = writeStyleProp(nextStyle, 'font-family', font.stack);
          else             nextStyle = writeStyleProp(nextStyle, 'font-family', '');
        } else if (v.family && v.family !== '__inline__') {
          // Classe Bootstrap (ex.: font-monospace).
          next.push(v.family);
          nextStyle = writeStyleProp(nextStyle, 'font-family', '');
        } else {
          // Padrão / sistema → limpa inline e classe.
          nextStyle = writeStyleProp(nextStyle, 'font-family', '');
        }
        if (v.size)   next.push(v.size);
        if (v.weight) next.push(v.weight);
        if (v.italic) next.push('fst-italic');
        patch.classes = next;
        patch.attrs   = { ...node.attrs, style: nextStyle || undefined };
        break;
      }
      case 'color': {
        const cfg = getColorConfig(bind.target);
        // value = { mode, value }
        const mode = value?.mode ?? '';
        const v    = value?.value ?? '';
        // Sempre limpa qualquer classe do prefixo + props inline relevantes
        const cleanedClasses = node.classes.filter(
          (c) => !cfg.classOptions.some((o) => o.value === c)
        );
        const styleProps = cfg.supportsGradient
          ? [cfg.cssProp, cfg.cssGradientProp]
          : [cfg.cssProp];
        const cleanedStyle = removeStyleProps(node.attrs.style ?? '', styleProps);
        if (mode === 'class' && v) {
          patch.classes = [...cleanedClasses, v];
          patch.attrs   = { ...node.attrs, style: cleanedStyle || undefined };
        } else if (mode === 'custom' && v) {
          patch.classes = cleanedClasses;
          patch.attrs   = { ...node.attrs, style: writeStyleProp(cleanedStyle, cfg.cssProp, v) };
        } else if (mode === 'gradient' && v && cfg.supportsGradient) {
          const css = gradientIdToCss(v, this.editor) || v;
          patch.classes = cleanedClasses;
          patch.attrs   = { ...node.attrs, style: writeStyleProp(cleanedStyle, cfg.cssGradientProp, css) };
        } else {
          // Mode '' = limpa tudo
          patch.classes = cleanedClasses;
          patch.attrs   = { ...node.attrs, style: cleanedStyle || undefined };
        }
        break;
      }
      default:
        return;
    }

    // Coalesce typing em um único registro de undo
    const isTyping = bind.kind === 'prop'
      && (schema?.type === 'text' || schema?.type === 'textarea');
    const opts = isTyping
      ? { coalesceKey: `update:${node.id}:prop:${bind.key}` }
      : {};
    this.editor.updateBlock(node.id, patch, opts);
  }

  /* ---------- build input ---------- */

  _buildInput(schema, value) {
    switch (schema.type) {
      case 'text':
        return el('input', { type: 'text',
          class: 'form-control form-control-sm', value: value ?? '' });

      case 'textarea': {
        const ta = el('textarea', { class: 'form-control form-control-sm', rows: 3 });
        ta.value = value ?? '';
        return ta;
      }

      case 'number':
        return el('input', { type: 'number',
          class: 'form-control form-control-sm',
          value: value ?? '', min: schema.min, max: schema.max, step: schema.step });

      case 'color':
        return this._buildColorCompound(schema, value);

      case 'typography':
        return this._buildTypographyCompound(schema, value);

      case 'select': {
        const sel = el('select', { class: 'form-select form-select-sm' });
        for (const opt of schema.options ?? []) {
          // Resolve template se for responsivo (option representa classe alvo)
          const optionValue = (schema.bind?.responsive && typeof opt.value === 'string')
            ? resolveTemplate(opt.value, this._bp(schema.bind))
            : opt.value;
          const o = el('option', { value: optionValue }, opt.label);
          if (String(optionValue) === String(value ?? '')) o.selected = true;
          sel.appendChild(o);
        }
        return sel;
      }

      case 'toggle': {
        const id = nextUid();
        const wrap = el('div', { class: 'form-check form-switch' });
        const input = el('input', { type: 'checkbox', class: 'form-check-input', id });
        if (value) input.checked = true;
        const lbl = el('label', { class: 'form-check-label small', for: id },
          schema.toggleLabel ?? '');
        wrap.append(input, lbl);
        return wrap;
      }

      case 'range': {
        const wrap = el('div', { class: 'editor-control__range' });
        const input = el('input', { type: 'range', class: 'form-range',
          value: value ?? schema.min ?? 0,
          min: schema.min, max: schema.max, step: schema.step });
        const valueLabel = el('span', { class: 'editor-control__range-value' },
          String(value ?? schema.min ?? 0));
        wrap.append(input, valueLabel);
        return wrap;
      }

      case 'radio-group': {
        const groupName = nextUid();
        const wrap = el('div', { class: 'editor-control__radio-group btn-group btn-group-sm w-100' });
        const bp = this._bp(schema.bind);
        for (const opt of schema.options ?? []) {
          const optionValue = (schema.bind?.responsive && typeof opt.value === 'string')
            ? resolveTemplate(opt.value, bp) : opt.value;
          const safeKey = String(optionValue).replace(/\W+/g, '_') || 'empty';
          const id = `${groupName}-${safeKey}`;
          const input = el('input', { type: 'radio', class: 'btn-check',
            name: groupName, id, value: String(optionValue) });
          if (String(optionValue) === String(value ?? '')) input.checked = true;
          const label = el('label',
            { class: 'btn btn-outline-secondary', for: id, title: opt.label },
            opt.icon ? [icon(opt.icon)] : opt.label);
          wrap.append(input, label);
        }
        return wrap;
      }

      case 'file': {
        const wrap = el('div', { class: 'editor-control__file' });
        const input = el('input', {
          type: 'file',
          class: 'form-control form-control-sm',
          accept: schema.accept ?? '',
        });
        const libBtn = el('button', {
          type: 'button',
          class: 'btn btn-sm btn-outline-secondary editor-control__file-lib',
          title: 'Escolher da biblioteca de assets',
          'aria-label': 'Escolher da biblioteca de assets',
        }, [icon('images')]);
        wrap.append(input, libBtn);
        return wrap;
      }

      case 'action': {
        return el('button', {
          type: 'button',
          class: 'btn btn-sm btn-outline-secondary w-100 d-inline-flex align-items-center justify-content-center gap-1',
        }, [
          schema.icon ? icon(schema.icon) : null,
          schema.label || 'Ação',
        ]);
      }

      case 'items-list':
        return this._buildItemsList(schema, value);

      case 'spacing': {
        const wrap = el('div', { class: 'editor-control__spacing' });
        const sides = [
          { key: 't', icon: 'arrow-up',    title: 'Topo' },
          { key: 'e', icon: 'arrow-right', title: 'Direita' },
          { key: 'b', icon: 'arrow-down',  title: 'Base' },
          { key: 's', icon: 'arrow-left',  title: 'Esquerda' },
        ];
        const opts = ['', '0', '1', '2', '3', '4', '5', 'auto'];
        for (const side of sides) {
          const cell = el('div', { class: 'editor-control__spacing-side' });
          cell.appendChild(el('i', { class: `bi bi-${side.icon}`, title: side.title }));
          const sel = el('select', {
            class: 'form-select form-select-sm',
            dataset: { side: side.key },
            title: side.title,
          });
          for (const v of opts) {
            sel.appendChild(el('option', { value: v }, v === '' ? '—' : v));
          }
          sel.value = value?.[side.key] ?? '';
          cell.appendChild(sel);
          wrap.appendChild(cell);
        }
        return wrap;
      }

      default:
        return el('div', { class: 'text-warning small' },
          `Tipo de controle desconhecido: ${schema.type}`);
    }
  }

  /* ---------- color compound ---------- */

  /**
   * Constrói o controle de cor compound: pills de modo + painel ativo.
   *
   * value = { mode: ''|'class'|'custom'|'gradient', value: string }
   *
   * O wrap guarda a lógica de leitura via dataset/refs (_readValue lê daqui).
   */
  _buildColorCompound(schema, value) {
    const cfg = getColorConfig(schema.bind?.target);
    const wrap = el('div', {
      class: 'editor-control__color',
      dataset: { target: schema.bind?.target ?? 'text' },
    });

    const modes = [
      { id: 'class',  label: 'Classe',     icon: 'palette' },
      { id: 'custom', label: 'Custom',     icon: 'eyedropper' },
    ];
    if (cfg.supportsGradient) {
      modes.push({ id: 'gradient', label: 'Gradiente', icon: 'rainbow' });
    }
    modes.push({ id: '', label: 'Nenhuma', icon: 'x-circle' });

    // Pills de modo — nome compartilhado: forma um único radio group.
    const pills = el('div', { class: 'editor-control__color-modes btn-group btn-group-sm w-100' });
    const groupName = nextUid();
    for (const m of modes) {
      const id = nextUid();
      const radio = el('input', {
        type: 'radio', class: 'btn-check', name: groupName, id,
        value: m.id, dataset: { mode: m.id },
      });
      const lbl = el('label', { class: 'btn btn-outline-secondary', for: id, title: m.label },
        [icon(m.icon), ' ', m.label]);
      pills.append(radio, lbl);
    }

    // Painéis (somente um visível por vez)
    const panels = el('div', { class: 'editor-control__color-panels mt-2' });

    const classPanel = el('div', { class: 'editor-control__color-panel', dataset: { panel: 'class' } });
    const classSel = el('select', { class: 'form-select form-select-sm', dataset: { input: 'class' } });
    classSel.appendChild(el('option', { value: '' }, '— escolha uma cor —'));
    for (const opt of cfg.classOptions) {
      const o = el('option', { value: opt.value }, opt.label);
      classSel.appendChild(o);
    }
    classPanel.appendChild(classSel);

    const customPanel = el('div', { class: 'editor-control__color-panel', dataset: { panel: 'custom' } });
    const customInput = el('input', {
      type: 'color', class: 'form-control form-control-color form-control-sm',
      dataset: { input: 'custom' }, value: '#000000',
    });
    const alphaInput = el('input', {
      type: 'range', class: 'form-range editor-control__color-alpha',
      dataset: { input: 'custom-alpha' },
      min: 0, max: 100, step: 1, value: 100,
      'aria-label': 'Opacidade (%)',
    });
    const alphaLabel = el('span', {
      class: 'editor-control__color-alpha-value',
      dataset: { input: 'custom-alpha-label' },
    }, '100%');
    customPanel.append(
      customInput,
      el('div', { class: 'editor-control__color-alpha-row' }, [
        el('span', { class: 'small text-muted' }, 'Opacidade'),
        alphaInput, alphaLabel,
      ]),
    );
    // Swatches da paleta personalizada (clique aplica o hex no input).
    const palette = this.editor.listPalette?.() ?? [];
    if (palette.length) {
      const swatches = el('div', { class: 'editor-control__color-swatches' });
      for (const c of palette) {
        const sw = el('button', {
          type: 'button',
          class: 'editor-control__color-swatch',
          title: `${c.label} · ${c.value}`,
          'aria-label': c.label,
          style: { background: c.value },
          dataset: { swatch: c.value },
        });
        swatches.appendChild(sw);
      }
      customPanel.append(
        el('div', { class: 'small text-muted mt-2' }, 'Paleta'),
        swatches,
      );
    }

    let gradientPanel = null;
    let gradientSel = null;
    if (cfg.supportsGradient) {
      gradientPanel = el('div', { class: 'editor-control__color-panel', dataset: { panel: 'gradient' } });
      gradientSel = el('select', {
        class: 'form-select form-select-sm', dataset: { input: 'gradient' },
      });
      gradientSel.appendChild(el('option', { value: '' }, '— escolha um gradiente —'));

      // Gradientes do usuário (Tema) primeiro, com optgroup separado.
      const userGradients = this.editor.listGradients?.() ?? [];
      if (userGradients.length) {
        const og = document.createElement('optgroup');
        og.label = 'Personalizados';
        for (const g of userGradients) {
          og.appendChild(el('option', { value: 'user:' + g.id }, g.label));
        }
        gradientSel.appendChild(og);
      }

      const ogBuiltIn = document.createElement('optgroup');
      ogBuiltIn.label = 'Padrão';
      for (const g of GRADIENT_PRESETS) {
        ogBuiltIn.appendChild(el('option', { value: g.id }, g.label));
      }
      gradientSel.appendChild(ogBuiltIn);

      const preview = el('div', { class: 'editor-control__color-preview', dataset: { input: 'gradient-preview' } });
      gradientPanel.append(gradientSel, preview);
    }

    panels.append(classPanel, customPanel);
    if (gradientPanel) panels.append(gradientPanel);

    wrap.append(pills, panels);

    // Estado inicial
    this._setColorValue(wrap, schema, value);
    return wrap;
  }

  _setColorValue(wrap, schema, value) {
    const mode = value?.mode ?? '';
    const v    = value?.value ?? '';
    // Marca o radio do modo
    for (const r of wrap.querySelectorAll('input[type="radio"][data-mode]')) {
      r.checked = r.dataset.mode === mode;
    }
    // Mostra o painel correspondente
    for (const p of wrap.querySelectorAll('[data-panel]')) {
      p.hidden = p.dataset.panel !== mode;
    }
    // Sincroniza valores internos
    const classSel = wrap.querySelector('[data-input="class"]');
    const customIn = wrap.querySelector('[data-input="custom"]');
    const alphaIn  = wrap.querySelector('[data-input="custom-alpha"]');
    const alphaLbl = wrap.querySelector('[data-input="custom-alpha-label"]');
    const gradSel  = wrap.querySelector('[data-input="gradient"]');
    const preview  = wrap.querySelector('[data-input="gradient-preview"]');
    if (mode === 'class')  classSel.value = v;
    else                   classSel.value = '';
    if (mode === 'custom') {
      const parsed = parseColor(v);
      if (parsed) {
        customIn.value = parsed.hex;
        if (alphaIn)  alphaIn.value  = Math.round(parsed.alpha * 100);
        if (alphaLbl) alphaLbl.textContent = Math.round(parsed.alpha * 100) + '%';
      } else {
        customIn.value = '#000000';
        if (alphaIn)  alphaIn.value = 100;
        if (alphaLbl) alphaLbl.textContent = '100%';
      }
    } else {
      customIn.value = '#000000';
      if (alphaIn)  alphaIn.value = 100;
      if (alphaLbl) alphaLbl.textContent = '100%';
    }
    if (gradSel) {
      gradSel.value = mode === 'gradient' ? v : '';
      if (preview) preview.style.background = mode === 'gradient'
        ? (gradientIdToCss(v, this.editor) || v) : '';
    }
  }

  /* ---------- items-list compound ---------- */

  /**
   * Lista visual de items de blocos repetíveis (Tabs, Accordion, Carousel,
   * FormSelect). Cada item vira uma linha com inputs dos `fields` declarados +
   * ações (subir, descer, remover, editar conteúdo no canvas).
   *
   * Aceita valor cru `string` (formato legado "campo|campo\n...") via
   * `schema.parse`, normalizando para array de objetos antes de renderizar.
   */
  _buildItemsList(schema, value) {
    const wrap = el('div', { class: 'editor-control__items-list' });
    const rowsWrap = el('div', { class: 'editor-control__items-list-rows' });
    const addBtn = el('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-primary w-100 d-inline-flex align-items-center justify-content-center gap-1 editor-control__items-list-add',
    }, [icon('plus-lg'), ' ' + (schema.addLabel || 'Adicionar item')]);

    wrap.append(rowsWrap, addBtn);

    const items = this._normalizeItems(schema, value);
    this._renderItemsListRows(rowsWrap, schema, items);

    return wrap;
  }

  _normalizeItems(schema, value) {
    if (typeof schema.parse === 'function') return schema.parse(value);
    if (Array.isArray(value)) return value.map((x) => ({ ...x }));
    return [];
  }

  _renderItemsListRows(rowsWrap, schema, items) {
    clear(rowsWrap);
    for (let idx = 0; idx < items.length; idx++) {
      rowsWrap.appendChild(this._buildItemsListRow(schema, items[idx], idx, items.length));
    }
    if (items.length === 0) {
      rowsWrap.appendChild(el('div', { class: 'editor-control__items-list-empty text-muted small' },
        'Nenhum item ainda. Clique em "Adicionar" para criar o primeiro.'));
    }
  }

  _buildItemsListRow(schema, item, idx, total) {
    const row = el('div', {
      class: 'editor-control__items-list-row',
      dataset: { idx: String(idx) },
    });

    const labelText = typeof schema.itemLabel === 'function'
      ? schema.itemLabel(item, idx)
      : `#${idx + 1}`;
    const label = el('span', { class: 'editor-control__items-list-row-label' }, labelText);

    const actions = el('div', {
      class: 'editor-control__items-list-row-actions btn-group btn-group-sm',
    });

    if (schema.contentField) {
      const contentBtn = el('button', {
        type: 'button',
        class: 'btn btn-outline-primary',
        dataset: { action: 'content' },
        title: 'Editar conteúdo no canvas',
      }, [icon('pencil-square')]);
      actions.appendChild(contentBtn);
    }
    // Botão "Editor avançado…" — abre o ContentEditor modal para o item.
    // Habilitado em items-list com `modalEditor: true` (Tabs/Accordion/Carousel).
    if (schema.modalEditor) {
      const modalBtn = el('button', {
        type: 'button',
        class: 'btn btn-outline-primary',
        dataset: { action: 'modal-edit' },
        title: 'Abrir editor avançado…',
      }, [icon('layout-text-window-reverse')]);
      actions.appendChild(modalBtn);
    }

    const upBtn = el('button', {
      type: 'button',
      class: 'btn btn-outline-secondary',
      dataset: { action: 'up' },
      title: 'Mover para cima',
    }, [icon('arrow-up')]);
    if (idx === 0) upBtn.disabled = true;

    const downBtn = el('button', {
      type: 'button',
      class: 'btn btn-outline-secondary',
      dataset: { action: 'down' },
      title: 'Mover para baixo',
    }, [icon('arrow-down')]);
    if (idx >= total - 1) downBtn.disabled = true;

    const removeBtn = el('button', {
      type: 'button',
      class: 'btn btn-outline-danger',
      dataset: { action: 'remove' },
      title: 'Remover',
    }, [icon('trash')]);

    actions.append(upBtn, downBtn, removeBtn);

    const head = el('div', { class: 'editor-control__items-list-row-head' }, [label, actions]);

    const fields = el('div', { class: 'editor-control__items-list-row-fields' });
    for (const f of (schema.fields ?? [])) {
      const fieldType = f.type || 'text';
      let input;
      if (fieldType === 'textarea') {
        input = el('textarea', {
          class: 'form-control form-control-sm',
          rows: f.rows || 2,
          placeholder: f.placeholder ?? (f.label ?? ''),
          dataset: { field: f.key },
        });
        input.value = item?.[f.key] ?? '';
      } else if (fieldType === 'select') {
        input = el('select', {
          class: 'form-select form-select-sm',
          dataset: { field: f.key },
        });
        for (const opt of (f.options ?? [])) {
          const o = el('option', { value: opt.value }, opt.label ?? opt.value);
          if (String(item?.[f.key] ?? '') === String(opt.value)) o.selected = true;
          input.appendChild(o);
        }
      } else {
        input = el('input', {
          type: fieldType,
          class: 'form-control form-control-sm',
          placeholder: f.placeholder ?? (f.label ?? ''),
          dataset: { field: f.key },
          value: item?.[f.key] ?? '',
        });
      }
      if (f.label) {
        const labelEl = el('label', { class: 'editor-control__items-list-row-field-label small text-muted' }, f.label);
        fields.append(labelEl, input);
      } else {
        fields.appendChild(input);
      }
    }

    row.append(head, fields);
    return row;
  }

  /**
   * Inicia edição inline do conteúdo de um item no canvas. Localiza o
   * elemento via `schema.contentSelector` (default: `[data-item-idx="{idx}"]`),
   * ativa a aba/painel se necessário, e dispara `editor.startInlineEdit` com
   * read/write que mutam o slot correto do array.
   */
  _editItemContent(node, schema, idx) {
    const blockEl = this.editor.renderer?.nodeElements.get(node.id);
    if (!blockEl) return;
    const selectorTpl = schema.contentSelector || '[data-item-idx="{idx}"]';
    const selector = selectorTpl.replace('{idx}', String(idx));
    const itemEl = blockEl.querySelector(selector);
    if (!itemEl) return;

    this.editor.selectBlock(node.id);

    // Se o painel/aba não está ativo (collapse fechado / tab inativa), clica
    // no título correspondente para abrir antes de focar.
    const titleEl = blockEl.querySelector(`[data-item-title-idx="${idx}"]`);
    if (titleEl) {
      const isVisible = itemEl.classList.contains('show')
        || itemEl.classList.contains('active');
      if (!isVisible) titleEl.click();
    }

    const opts = schema.contentInlineOpts || {};
    const contentField = schema.contentField;
    const bindKey = schema.bind.key;
    const parseList = (v) => this._normalizeItems(schema, v);

    this.editor.startInlineEdit(node.id, {
      element: itemEl,
      read: (n) => {
        const items = parseList(n.props[bindKey]);
        return items[idx]?.[contentField] ?? '';
      },
      write: (n, value) => {
        const items = parseList(n.props[bindKey]);
        if (!items[idx]) return null;
        items[idx] = { ...items[idx], [contentField]: value };
        return { props: { [bindKey]: items } };
      },
      html: opts.html === true,
      multiline: opts.multiline !== false,
      sanitizeProfile: opts.sanitizeProfile,
    });
  }

  /**
   * Abre o ContentEditor (mini-Editor modal) para edição rica do conteúdo
   * de um item de items-list. Detecta automaticamente o campo correto
   * (`contentField` em Tabs/Accordion, `html` em Carousel).
   */
  _openModalEditor(node, schema, idx) {
    const bindKey = schema.bind.key;
    const parseList = (v) => this._normalizeItems(schema, v);
    const contentField = schema.contentField || 'html';
    const items = parseList(node.props[bindKey]);
    const item = items[idx];
    if (!item) return;
    const isCarouselSlide = node.type === 'carousel' && bindKey === 'slides';
    const titleLabel = item.title ?? (isCarouselSlide ? `Slide ${idx + 1}` : `${idx + 1}`);
    const slideMode = isCarouselSlide ? {
      src: item.src ?? '', alt: item.alt ?? '',
      bgSize: item.bgSize, bgPosition: item.bgPosition,
      bgRepeat: item.bgRepeat, minHeight: item.minHeight,
    } : undefined;

    this.editor.ui.contentEditor?.open({
      title: `Editar ${titleLabel}`,
      html: item[contentField] ?? '',
      slideMode,
      onSave: (html, meta) => {
        const fresh = parseList(this.editor.getNode(node.id)?.props[bindKey]);
        if (!fresh[idx]) return;
        fresh[idx] = { ...fresh[idx], [contentField]: html, ...(meta ? meta : {}) };
        this.editor.updateBlock(node.id, { props: { [bindKey]: fresh } });
      },
    });
  }

  /* ---------- typography compound ---------- */

  _buildTypographyCompound(schema, value) {
    const wrap = el('div', { class: 'editor-control__typography' });

    const familySel = el('select', {
      class: 'form-select form-select-sm', dataset: { input: 'family' },
      title: 'Família',
    });
    for (const o of FONT_FAMILY_OPTIONS) {
      familySel.appendChild(el('option', { value: o.value }, o.label));
    }
    const userFonts = this.editor.listFonts?.() ?? [];
    if (userFonts.length) {
      const og = document.createElement('optgroup');
      og.label = 'Personalizadas';
      for (const f of userFonts) {
        og.appendChild(el('option', { value: 'user:' + f.id }, f.label));
      }
      familySel.appendChild(og);
    }

    const sizeSel = el('select', {
      class: 'form-select form-select-sm', dataset: { input: 'size' },
      title: 'Tamanho',
    });
    for (const o of FONT_SIZE_OPTIONS) {
      sizeSel.appendChild(el('option', { value: o.value }, o.label));
    }

    const weightSel = el('select', {
      class: 'form-select form-select-sm', dataset: { input: 'weight' },
      title: 'Peso',
    });
    for (const o of FONT_WEIGHT_OPTIONS) {
      weightSel.appendChild(el('option', { value: o.value }, o.label));
    }

    const italicId = nextUid();
    const italicChk = el('input', {
      type: 'checkbox', class: 'btn-check', id: italicId,
      dataset: { input: 'italic' },
    });
    const italicLbl = el('label', {
      class: 'btn btn-sm btn-outline-secondary editor-control__typography-italic',
      for: italicId, title: 'Itálico',
    }, [icon('type-italic')]);

    wrap.append(
      el('div', { class: 'editor-control__typography-row' }, [
        el('span', { class: 'small text-muted' }, 'Família'),
        familySel,
      ]),
      el('div', { class: 'editor-control__typography-row' }, [
        el('span', { class: 'small text-muted' }, 'Tamanho'),
        sizeSel,
      ]),
      el('div', { class: 'editor-control__typography-row' }, [
        el('span', { class: 'small text-muted' }, 'Peso'),
        weightSel,
        italicChk, italicLbl,
      ]),
    );

    this._setTypographyValue(wrap, schema, value);
    return wrap;
  }

  _setTypographyValue(wrap, schema, value) {
    const v = value ?? {};
    const family = wrap.querySelector('[data-input="family"]');
    const size   = wrap.querySelector('[data-input="size"]');
    const weight = wrap.querySelector('[data-input="weight"]');
    const italic = wrap.querySelector('[data-input="italic"]');
    if (family) family.value = v.family ?? '';
    if (size)   size.value   = v.size ?? '';
    if (weight) weight.value = v.weight ?? '';
    if (italic) italic.checked = !!v.italic;
  }

  _readTypographyValue(wrap) {
    return {
      family: wrap.querySelector('[data-input="family"]')?.value || '',
      size:   wrap.querySelector('[data-input="size"]')?.value   || '',
      weight: wrap.querySelector('[data-input="weight"]')?.value || '',
      italic: wrap.querySelector('[data-input="italic"]')?.checked === true,
    };
  }

  _readColorValue(wrap) {
    const checked = wrap.querySelector('input[type="radio"][data-mode]:checked');
    const mode = checked?.dataset.mode ?? '';
    if (mode === 'class')    return { mode, value: wrap.querySelector('[data-input="class"]').value };
    if (mode === 'custom') {
      const hex   = wrap.querySelector('[data-input="custom"]').value || '#000000';
      const alpha = Number(wrap.querySelector('[data-input="custom-alpha"]')?.value ?? 100) / 100;
      return { mode, value: serializeColor({ hex, alpha }) };
    }
    if (mode === 'gradient') return { mode, value: wrap.querySelector('[data-input="gradient"]').value };
    return { mode: '', value: '' };
  }

  /* ---------- inner input + valor ---------- */

  _innerInput(wrap, schema) {
    switch (schema.type) {
      case 'toggle':      return wrap.querySelector?.('input[type="checkbox"]') ?? null;
      case 'range':       return wrap.querySelector?.('input[type="range"]') ?? null;
      case 'radio-group':
      case 'spacing':
      case 'color':
      case 'typography':
      case 'items-list':  return null;
      default:            return wrap;
    }
  }

  _readValue(wrap, schema) {
    switch (schema.type) {
      case 'toggle':
        return wrap.querySelector('input[type="checkbox"]').checked;
      case 'range':
        return Number(wrap.querySelector('input[type="range"]').value);
      case 'number': {
        const v = wrap.value;
        if (v === '') return null;
        const n = Number(v);
        return Number.isNaN(n) ? null : n;
      }
      case 'radio-group': {
        const checked = wrap.querySelector('input[type="radio"]:checked');
        return checked ? checked.value : '';
      }
      case 'spacing': {
        const r = {};
        for (const sel of wrap.querySelectorAll('select[data-side]')) {
          r[sel.dataset.side] = sel.value;
        }
        return r;
      }
      case 'color':
        return this._readColorValue(wrap);
      case 'typography':
        return this._readTypographyValue(wrap);
      case 'items-list':
        // Não usado no fluxo padrão — items-list escreve direto via handlers
        // delegados (input event no rowsWrap), não via _readValue.
        return null;
      case 'select':
        return wrap.value;
      default:
        return wrap.value;
    }
  }

  _setValue(wrap, schema, value) {
    switch (schema.type) {
      case 'toggle':
        wrap.querySelector('input[type="checkbox"]').checked = !!value;
        break;
      case 'range': {
        const r = wrap.querySelector('input[type="range"]');
        r.value = value ?? schema.min ?? 0;
        const lbl = wrap.querySelector('.editor-control__range-value');
        if (lbl) lbl.textContent = r.value;
        break;
      }
      case 'radio-group': {
        for (const radio of wrap.querySelectorAll('input[type="radio"]')) {
          radio.checked = String(radio.value) === String(value ?? '');
        }
        break;
      }
      case 'select':
        wrap.value = String(value ?? '');
        break;
      case 'spacing':
        for (const sel of wrap.querySelectorAll('select[data-side]')) {
          sel.value = value?.[sel.dataset.side] ?? '';
        }
        break;
      case 'color':
        this._setColorValue(wrap, schema, value);
        break;
      case 'typography':
        this._setTypographyValue(wrap, schema, value);
        break;
      case 'items-list':
        this._setItemsListValue(wrap, schema, value);
        break;
      default:
        wrap.value = value ?? '';
    }
  }

  /**
   * Atualiza a lista visual sem destruir mais DOM do que o necessário. Se há
   * algum input focado dentro da lista (usuário digitando), faz update
   * cirúrgico — não reconstrói para preservar o caret. Caso contrário,
   * reconstrói completamente: assim botões `disabled` (↑/↓ nos extremos) e
   * labels seguem coerentes após reorder/add/remove.
   */
  _setItemsListValue(wrap, schema, value) {
    const rowsWrap = wrap.querySelector('.editor-control__items-list-rows');
    if (!rowsWrap) return;
    const items = this._normalizeItems(schema, value);

    // Só preserva DOM se há um INPUT/TEXTAREA focado (usuário digitando).
    // Foco em botões (ação up/down/remove) tolera reconstrução, que é o que
    // mantém `disabled` dos extremos coerente após reorder.
    const focusedInput = rowsWrap.querySelector('input:focus, textarea:focus');
    if (!focusedInput) {
      this._renderItemsListRows(rowsWrap, schema, items);
      return;
    }

    const currentRows = rowsWrap.querySelectorAll('.editor-control__items-list-row');
    if (currentRows.length !== items.length) {
      // Quantidade mudou (raro com foco preservado) — reconstrói.
      this._renderItemsListRows(rowsWrap, schema, items);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const row = currentRows[i];
      for (const f of (schema.fields ?? [])) {
        const input = row.querySelector(`[data-field="${f.key}"]`);
        if (!input) continue;
        if (this._isFocused(input)) continue;
        const v = items[i]?.[f.key] ?? '';
        if (input.value !== v) input.value = v;
      }
    }
  }

  _wireWriteListener(wrap, schema, node) {
    const handle = () => this._write(schema.bind, node, this._readValue(wrap, schema), schema);

    switch (schema.type) {
      case 'text':
      case 'textarea':
        wrap.addEventListener('input', handle);
        if (schema.sanitizeOnBlur) {
          wrap.addEventListener('blur', () => {
            // Sanitiza o conteúdo atual e força o textarea/input a refletir
            // o resultado. Útil em HtmlEmbed: usuário cola <script>, vê
            // ao perder o foco que foi removido pelo DOMPurify.
            const clean = this.editor.sanitizer.isReady()
              ? this.editor.sanitizer.html(wrap.value ?? '')
              : (wrap.value ?? '');
            if (clean !== wrap.value) {
              wrap.value = clean;
              this._write(schema.bind, node, clean, schema);
            }
          });
        }
        break;
      case 'number':
      case 'select':
        wrap.addEventListener('change', handle);
        break;
      case 'toggle':
        wrap.querySelector('input[type="checkbox"]').addEventListener('change', handle);
        break;
      case 'radio-group':
        for (const r of wrap.querySelectorAll('input[type="radio"]')) {
          r.addEventListener('change', handle);
        }
        break;
      case 'range': {
        const r = wrap.querySelector('input[type="range"]');
        const lbl = wrap.querySelector('.editor-control__range-value');
        r.addEventListener('input', () => { if (lbl) lbl.textContent = r.value; });
        r.addEventListener('change', handle);
        break;
      }
      case 'spacing':
        for (const sel of wrap.querySelectorAll('select[data-side]')) {
          sel.addEventListener('change', handle);
        }
        break;
      case 'typography': {
        for (const sel of wrap.querySelectorAll('select[data-input]')) {
          sel.addEventListener('change', handle);
        }
        const italic = wrap.querySelector('input[data-input="italic"]');
        if (italic) italic.addEventListener('change', handle);
        break;
      }
      case 'color': {
        // Pills de modo: alterna painel visível e re-emite o valor.
        for (const r of wrap.querySelectorAll('input[type="radio"][data-mode]')) {
          r.addEventListener('change', () => {
            for (const p of wrap.querySelectorAll('[data-panel]')) {
              p.hidden = p.dataset.panel !== r.dataset.mode;
            }
            handle();
          });
        }
        // Sub-controles
        for (const sel of wrap.querySelectorAll('select[data-input]')) {
          sel.addEventListener('change', () => {
            // Atualiza preview do gradiente, se for o caso.
            const preview = wrap.querySelector('[data-input="gradient-preview"]');
            if (sel.dataset.input === 'gradient' && preview) {
              preview.style.background = gradientIdToCss(sel.value, this.editor) || '';
            }
            handle();
          });
        }
        const customIn = wrap.querySelector('input[type="color"][data-input="custom"]');
        if (customIn) {
          customIn.addEventListener('input', handle);
          customIn.addEventListener('change', handle);
        }
        const alphaIn  = wrap.querySelector('input[data-input="custom-alpha"]');
        const alphaLbl = wrap.querySelector('[data-input="custom-alpha-label"]');
        if (alphaIn) {
          alphaIn.addEventListener('input', () => {
            if (alphaLbl) alphaLbl.textContent = alphaIn.value + '%';
            handle();
          });
        }
        // Swatches da paleta — click aplica hex no input + dispara write.
        for (const sw of wrap.querySelectorAll('.editor-control__color-swatch')) {
          sw.addEventListener('click', (e) => {
            e.preventDefault();
            const value = sw.dataset.swatch || '';
            const parsed = parseColor(value);
            if (parsed && customIn) {
              customIn.value = parsed.hex;
              if (alphaIn) {
                alphaIn.value = Math.round(parsed.alpha * 100);
                if (alphaLbl) alphaLbl.textContent = alphaIn.value + '%';
              }
              handle();
            }
          });
        }
        break;
      }
      case 'items-list': {
        const rowsWrap = wrap.querySelector('.editor-control__items-list-rows');
        const addBtn   = wrap.querySelector('.editor-control__items-list-add');
        const bindKey  = schema.bind.key;

        const getItems = () => {
          const fresh = this.editor.getNode(node.id);
          if (!fresh) return [];
          return this._normalizeItems(schema, fresh.props[bindKey]);
        };

        const writeItems = (items, opts = {}) => {
          this.editor.updateBlock(node.id, { props: { [bindKey]: items } }, opts);
        };

        // Field inputs — delegação (rows são reconstruídas em add/remove)
        const onFieldInput = (e) => {
          const input = e.target.closest('[data-field]');
          if (!input) return;
          const row = input.closest('.editor-control__items-list-row');
          if (!row) return;
          const idx = Number(row.dataset.idx);
          const fieldKey = input.dataset.field;
          const items = getItems();
          if (!items[idx]) return;
          items[idx] = { ...items[idx], [fieldKey]: input.value };
          writeItems(items, {
            coalesceKey: `items:${node.id}:${bindKey}:${idx}:${fieldKey}`,
          });
        };
        rowsWrap.addEventListener('input', onFieldInput);
        rowsWrap.addEventListener('change', onFieldInput);

        // Botões de ação (subir/descer/remover/conteúdo)
        rowsWrap.addEventListener('click', (e) => {
          const btn = e.target.closest('button[data-action]');
          if (!btn) return;
          e.preventDefault();
          const row = btn.closest('.editor-control__items-list-row');
          if (!row) return;
          const idx = Number(row.dataset.idx);
          const action = btn.dataset.action;
          const items = getItems();
          if (idx < 0 || idx >= items.length) return;

          if (action === 'remove') {
            items.splice(idx, 1);
            writeItems(items);
          } else if (action === 'up' && idx > 0) {
            [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
            writeItems(items);
          } else if (action === 'down' && idx < items.length - 1) {
            [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
            writeItems(items);
          } else if (action === 'content') {
            this._editItemContent(node, schema, idx);
          } else if (action === 'modal-edit') {
            this._openModalEditor(node, schema, idx);
          }
        });

        addBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const items = getItems();
          const newItem = schema.defaultItem ? { ...schema.defaultItem } : {};
          items.push(newItem);
          writeItems(items);
          // Após o sync reconstruir as rows, foca o primeiro input do novo
          // item — sinaliza visualmente onde digitar.
          queueMicrotask(() => {
            const newRow = rowsWrap.querySelector(
              `[data-idx="${items.length - 1}"]`);
            const firstInput = newRow?.querySelector('input, textarea');
            if (firstInput) firstInput.focus();
          });
        });
        break;
      }
      case 'file': {
        const input = wrap.querySelector('input[type="file"]');
        input.addEventListener('change', () => this._handleFileUpload(input, schema, node));
        const libBtn = wrap.querySelector('.editor-control__file-lib');
        libBtn?.addEventListener('click', () => {
          this.editor.ui?.assetLibrary?.open({
            accept: schema.accept ?? '',
            onPick: (url) => this._write(schema.bind, node, url, schema),
          });
        });
        break;
      }
      case 'action': {
        wrap.addEventListener('click', () => {
          if (typeof schema.onClick !== 'function') return;
          // (node, ctx) — ctx.editor permite ações que disparam fluxos
          // do editor (ex.: abrir edit-mode de componente).
          const patch = schema.onClick(node, { editor: this.editor });
          if (patch) this.editor.updateBlock(node.id, patch);
        });
        break;
      }
    }
  }

  /**
   * Upload disparado pelo controle 'file'. Delega à AssetLibrary, que cuida do
   * uploadUrl (POST multipart + X-CSRFToken) ou do fallback data URL — e
   * registra o resultado para reuso no grid da biblioteca. Em falha de rede,
   * cai para data URL aqui mesmo.
   */
  async _handleFileUpload(input, schema, node) {
    const file = input.files?.[0];
    if (!file) return;
    const lib = this.editor.ui?.assetLibrary;

    try {
      const entry = await lib.uploadFile(file);
      this._write(schema.bind, node, entry.url, schema);
    } catch (err) {
      console.error('[ControlFactory] upload falhou:', err);
      this.editor.notify?.toast(
        `Upload falhou: ${err.message}. Usando data URL como fallback.`,
        'warning');
      this._readAsDataUrl(file, schema, node);
    }
    input.value = ''; // libera para nova seleção do mesmo arquivo
  }

  _readAsDataUrl(file, schema, node) {
    const reader = new FileReader();
    reader.onload = () => {
      this._write(schema.bind, node, reader.result, schema);
      this.editor.ui?.assetLibrary?.register(reader.result, { name: file.name });
    };
    reader.onerror = () => console.error('[ControlFactory] leitura falhou:', reader.error);
    reader.readAsDataURL(file);
  }
}
