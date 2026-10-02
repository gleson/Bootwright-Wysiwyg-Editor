/**
 * htmlImport — converte uma string HTML em um array de descritores de bloco
 * prontos para a árvore do editor.
 *
 * Cada descritor tem o formato `{ type, props, classes?, attrs?, children? }` —
 * pode ser passado direto para o State.createNode / AddNodeCommand. Quando o
 * elemento de origem traz `class`/`style`/`id`/`data-*`/`aria-*`, esses valores
 * são extraídos para `classes`/`attrs` e **vencem** os defaults do schema na
 * hora de inserir (ver Editor._buildImportNode) — é o que permite o round-trip
 * "editar HTML → reimportar" preservar o que o usuário escreveu. Quando o
 * elemento não traz nada, `classes`/`attrs` ficam ausentes e o schema preenche.
 *
 * Mapeamento (v1):
 *   h1..h6     → heading { level, text }
 *   p          → paragraph { text }  (sanitizado com RICH_TEXT_PROFILE)
 *   blockquote → blockquote { text, source }  (extrai <footer>/<cite>)
 *   ul / ol    → list { ordered, items (separados por \n) }
 *   hr         → divider
 *   img        → image { src, alt }
 *   video      → video { src, poster, controls, loop, autoplay, muted, playsinline }
 *   section, div, article, main, header, footer, aside, nav
 *              → section { children: [...] }  (containers recursivos)
 *   demais     → html { html: outerHTML }  (fallback: HtmlEmbed sanitiza)
 */

import { RICH_TEXT_PROFILE } from '../blocks/built-in/Paragraph.js';

const CONTAINER_TAGS = new Set([
  'section', 'div', 'article', 'main', 'header', 'footer', 'aside', 'nav',
]);

/**
 * Atributos de nível de bloco que preservamos ao importar (whitelist). `class`
 * vira `classes`; o resto entra em `attrs`. Atributos de evento (`on*`) e
 * qualquer coisa fora desta lista são descartados — `attrs` é aplicado pelo
 * Renderer via setAttribute sem sanitização, então mantemos o conjunto seguro.
 * `style` é o caso principal (CSS inline editado à mão no modo HTML).
 */
const PRESERVED_ATTRS = new Set([
  'style', 'id', 'title', 'role', 'lang', 'dir', 'tabindex',
]);

/** Extrai `{ classes?, attrs? }` de um elemento, omitindo chaves vazias. */
function extractCommon(el) {
  const out = {};
  const classes = Array.from(el.classList);
  if (classes.length) out.classes = classes;

  const attrs = {};
  for (const { name, value } of el.attributes) {
    const lname = name.toLowerCase();
    if (PRESERVED_ATTRS.has(lname) || lname.startsWith('data-') || lname.startsWith('aria-')) {
      attrs[lname] = value;
    }
  }
  if (Object.keys(attrs).length) out.attrs = attrs;
  return out;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.richBlocks] — mapeia `<table>` → bloco Tabela e
 *   `<pre>` → bloco Código (em vez do fallback HtmlEmbed). Usado na colagem
 *   de conteúdo externo, onde não há round-trip a preservar.
 */
export function htmlToBlocks(html, sanitizer, opts = {}) {
  if (!html || !html.trim()) return [];
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  // Se o HTML não tem <html>/<body>, o DOMParser ainda devolve um doc;
  // pegamos o que estiver em body. Se tudo veio como texto solto, body.children
  // pode estar vazio mas body.textContent terá conteúdo — viramos um parágrafo.
  const body = doc.body;
  const blocks = [];
  for (const el of body.children) {
    const out = mapElement(el, sanitizer, opts);
    if (out) blocks.push(...(Array.isArray(out) ? out : [out]));
  }
  if (!blocks.length && body.textContent.trim()) {
    blocks.push({ type: 'paragraph', props: { text: body.textContent.trim() } });
  }
  return blocks;
}

function mapElement(el, sanitizer, opts = {}) {
  const tag = el.tagName.toLowerCase();

  if (opts.richBlocks && tag === 'pre') {
    return { type: 'code', props: { code: el.textContent, language: 'plain' } };
  }

  if (opts.richBlocks && tag === 'table') {
    const cells = Array.from(el.querySelectorAll('tr'))
      .map((tr) => Array.from(tr.querySelectorAll(':scope > th, :scope > td'))
        .map((c) => c.textContent.trim()))
      .filter((r) => r.length);
    if (!cells.length) return null;
    const cols = Math.max(...cells.map((r) => r.length));
    cells.forEach((r) => { while (r.length < cols) r.push(''); });
    return { type: 'table', props: {
      rows: cells.length, cols, cells, merges: [],
      hasHeader: !!el.querySelector('tr:first-child > th'),
    } };
  }

  if (/^h[1-6]$/.test(tag)) {
    const text = el.textContent.trim();
    if (!text) return null;
    return { type: 'heading', props: { level: Number(tag[1]), text }, ...extractCommon(el) };
  }

  if (tag === 'p') {
    const text = cleanInline(el, sanitizer);
    if (!text.trim()) return null;
    return { type: 'paragraph', props: { text }, ...extractCommon(el) };
  }

  if (tag === 'blockquote') {
    const clone = el.cloneNode(true);
    const footer = clone.querySelector('footer, cite');
    const source = footer ? footer.textContent.trim() : '';
    if (footer) footer.remove();
    const text = clone.textContent.trim();
    if (!text && !source) return null;
    return { type: 'blockquote', props: { text, source }, ...extractCommon(el) };
  }

  if (tag === 'ul' || tag === 'ol') {
    const items = Array.from(el.querySelectorAll(':scope > li'))
      .map((li) => li.textContent.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (!items.length) return null;
    return { type: 'list', props: { ordered: tag === 'ol', items: items.join('\n') }, ...extractCommon(el) };
  }

  if (tag === 'hr') return { type: 'divider', props: {}, ...extractCommon(el) };

  if (tag === 'img') {
    const src = el.getAttribute('src') || '';
    if (!src) return null;
    return { type: 'image', props: { src, alt: el.getAttribute('alt') || '' }, ...extractCommon(el) };
  }

  if (tag === 'video') {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    if (!src) return null;
    return { type: 'video', props: {
      src,
      poster: el.getAttribute('poster') || '',
      controls: el.hasAttribute('controls'),
      loop: el.hasAttribute('loop'),
      autoplay: el.hasAttribute('autoplay'),
      muted: el.hasAttribute('muted'),
      playsinline: el.hasAttribute('playsinline'),
    }, ...extractCommon(el) };
  }

  if (tag === 'iframe') {
    // YouTube/Vimeo embeds — o bloco Video reconhece pela URL.
    const src = el.getAttribute('src') || '';
    if (/youtube\.com|youtu\.be|vimeo\.com/.test(src)) {
      return { type: 'video', props: { src } };
    }
    // Outro iframe — preserva como HTML cru (HtmlEmbed sanitiza).
    return { type: 'html', props: { html: el.outerHTML } };
  }

  if (CONTAINER_TAGS.has(tag)) {
    const childBlocks = [];
    for (const c of el.children) {
      const out = mapElement(c, sanitizer, opts);
      if (out) childBlocks.push(...(Array.isArray(out) ? out : [out]));
    }
    if (childBlocks.length) {
      return { type: 'section', children: childBlocks, ...extractCommon(el) };
    }
    // Container sem filhos-elemento mas com texto → parágrafo simples.
    if (el.textContent.trim()) {
      return { type: 'paragraph', props: { text: cleanInline(el, sanitizer) }, ...extractCommon(el) };
    }
    return null;
  }

  // Fallback — preserva o HTML cru (HtmlEmbed sanitiza no render).
  return { type: 'html', props: { html: el.outerHTML } };
}

/** innerHTML sanitizado com o perfil rich-text usado pelo Paragraph. */
function cleanInline(el, sanitizer) {
  let raw = el.innerHTML || '';
  if (sanitizer?.isReady && sanitizer.isReady()) {
    raw = sanitizer.html(raw, RICH_TEXT_PROFILE);
  }
  return raw.trim();
}
