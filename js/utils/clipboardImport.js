/**
 * clipboardImport — normaliza o conteúdo da área de transferência (colado de
 * Word, LibreOffice, Google Docs, páginas web ou arquivos .txt/.md) para um
 * HTML "limpo" que o `htmlToBlocks` entende.
 *
 * Saída: apenas elementos de bloco no topo (p, h1..h6, ul, ol, blockquote,
 * pre, hr, img, table) e formatação inline básica (b, i, u, a, br). Classes,
 * estilos, ids e atributos da origem são descartados — eles poluiriam o
 * visual do canvas. A semântica visual mais comum (negrito/itálico/sublinhado
 * declarados via `style`, como faz o Google Docs) é convertida em tags antes.
 */

import { markdownToHtml } from './markdownImport.js';

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'blockquote', 'pre', 'hr', 'table',
]);

/** Elementos que só agrupam conteúdo — são "abertos" e seus filhos achatados. */
const WRAPPER_TAGS = new Set([
  'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav',
  'figure', 'figcaption', 'center', 'body', 'form', 'dl', 'dd', 'dt', 'address',
]);

const DROP_TAGS = new Set([
  'script', 'style', 'meta', 'link', 'title', 'head', 'noscript', 'template',
  'iframe', 'object', 'embed', 'svg', 'canvas', 'button', 'input', 'select',
  'textarea', 'colgroup', 'col',
]);

const INLINE_KEEP = new Set(['b', 'strong', 'i', 'em', 'u', 'a', 'br', 'code', 'sub', 'sup']);

/**
 * @param {{ html?: string, text?: string }} data
 * @returns {string} HTML normalizado ('' se não houver conteúdo)
 */
export function clipboardToHtml({ html = '', text = '' } = {}) {
  if (html && /<[a-z!]/i.test(html)) {
    const out = normalizeExternalHtml(html);
    if (out.trim()) return out;
  }
  if (text && text.trim()) return plainTextToHtml(text);
  return '';
}

/**
 * Texto puro / Markdown → HTML. Num .txt sem linhas em branco, cada linha
 * costuma ser um parágrafo; o Markdown juntaria tudo num só — então separamos
 * linhas "comuns" consecutivas com uma linha em branco antes de converter.
 */
export function plainTextToHtml(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  if (/\n\s*\n/.test(src)) return markdownToHtml(src);
  const lines = src.split('\n');
  const out = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const prev = lines[i - 1];
    if (i > 0 && !inFence && !isStructural(line) && prev !== undefined && !isStructural(prev)) {
      out.push('');
    }
    out.push(line);
  });
  return markdownToHtml(out.join('\n'));
}

function isStructural(line) {
  return /^\s*([-*+]|\d+\.)\s+/.test(line) || /^>\s?/.test(line) || /^\s*```/.test(line);
}

/* ------------------------------------------------------------------ */

export function normalizeExternalHtml(html) {
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  const body = doc.body;

  removeComments(body);
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag) || tag.includes(':')) {
      // `o:p` e afins (Word) são só marcação vazia; conteúdo útil é texto.
      if (tag.includes(':') && el.textContent.trim()) unwrap(el);
      else el.remove();
    }
  }

  convertWordLists(doc, body);
  convertStyledInline(doc, body);
  flattenNestedLists(doc, body);

  const blocks = [];
  let para = null;
  const flushPara = () => {
    if (para && (para.textContent.trim() || para.querySelector('img'))) blocks.push(para);
    para = null;
  };
  const pushInline = (node) => {
    if (!para) para = doc.createElement('p');
    para.appendChild(node);
  };

  const walk = (parent) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim() || para) pushInline(node);
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = node.tagName.toLowerCase();

      if (tag === 'img') {
        flushPara();
        const img = cleanImage(doc, node);
        if (img) blocks.push(img);
        continue;
      }
      if (tag === 'br' && node.nextSibling?.nodeName === 'BR') {
        // <br><br> separa parágrafos (comum em e-mails e páginas antigas).
        node.nextSibling.remove();
        flushPara();
        continue;
      }
      if (BLOCK_TAGS.has(tag)) {
        flushPara();
        // <p> com <img> dentro: separa as imagens em blocos próprios.
        if (tag === 'p' || /^h[1-6]$/.test(tag)) {
          const imgs = Array.from(node.querySelectorAll('img'));
          imgs.forEach((im) => im.remove());
          if (node.textContent.trim()) blocks.push(node);
          for (const im of imgs) {
            const clean = cleanImage(doc, im);
            if (clean) blocks.push(clean);
          }
        } else {
          blocks.push(node);
        }
        continue;
      }
      if (WRAPPER_TAGS.has(tag) || hasBlockDescendant(node)) {
        flushPara();
        walk(node);
        flushPara();
        continue;
      }
      pushInline(node);
    }
  };
  walk(body);
  flushPara();

  return blocks.map((el) => cleanBlock(doc, el)).filter(Boolean).join('\n');
}

function removeComments(root) {
  const it = root.ownerDocument.createNodeIterator(root, NodeFilter.SHOW_COMMENT);
  const list = [];
  let n;
  while ((n = it.nextNode())) list.push(n);
  list.forEach((c) => c.remove());
}

function unwrap(el) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}

function hasBlockDescendant(el) {
  return !!el.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, hr, table, div, img');
}

/**
 * Word (desktop) exporta listas como `<p class="MsoListParagraph…">` com o
 * marcador dentro de `<span style="mso-list:Ignore">`. Agrupa parágrafos
 * consecutivos assim em <ul>/<ol>.
 */
function convertWordLists(doc, body) {
  const isWordItem = (el) => el?.nodeType === 1 && el.tagName === 'P' && (
    /MsoList/i.test(el.className) || /mso-list\s*:/i.test(el.getAttribute('style') || ''));
  for (const p of Array.from(body.querySelectorAll('p'))) {
    if (!p.isConnected || !isWordItem(p)) continue;
    const marker = p.querySelector('[style*="mso-list"]');
    const markerText = (marker?.textContent || '').trim();
    const ordered = /^(\d+|[a-z]|[ivxlc]+)[.)]/i.test(markerText);
    const list = doc.createElement(ordered ? 'ol' : 'ul');
    p.parentNode.insertBefore(list, p);
    let cur = p;
    while (isWordItem(cur)) {
      const next = nextElement(cur);
      cur.querySelectorAll('[style*="mso-list"]').forEach((m) => {
        if (/mso-list\s*:\s*ignore/i.test(m.getAttribute('style') || '')) m.remove();
      });
      const li = doc.createElement('li');
      while (cur.firstChild) li.appendChild(cur.firstChild);
      li.innerHTML = li.innerHTML.replace(/^(\s|&nbsp;)+/, '');
      list.appendChild(li);
      cur.remove();
      cur = next;
    }
  }
}

function nextElement(el) {
  let n = el.nextSibling;
  while (n && n.nodeType === Node.TEXT_NODE && !n.textContent.trim()) n = n.nextSibling;
  return n;
}

/**
 * Converte formatação declarada em `style` (Google Docs, LibreOffice) em
 * tags semânticas e descarta wrappers "neutros" — ex.: o
 * `<b style="font-weight:normal" id="docs-internal-guid-…">` do Google Docs.
 */
function convertStyledInline(doc, body) {
  const els = Array.from(body.querySelectorAll('span, b, strong, i, em, font, u, s'));
  for (const el of els) {
    const style = (el.getAttribute('style') || '').toLowerCase();
    const tag = el.tagName.toLowerCase();
    const weight = /font-weight\s*:\s*([a-z0-9]+)/.exec(style)?.[1];
    const fontStyle = /font-style\s*:\s*([a-z]+)/.exec(style)?.[1];
    const deco = /text-decoration(?:-line)?\s*:\s*([^;]+)/.exec(style)?.[1] || '';

    const isBoldTag = tag === 'b' || tag === 'strong';
    const isItalicTag = tag === 'i' || tag === 'em';
    let bold = isBoldTag;
    if (weight) bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
    let italic = isItalicTag;
    if (fontStyle) italic = fontStyle === 'italic' || fontStyle === 'oblique';
    const underline = tag === 'u' || /underline/.test(deco);

    let inner = doc.createDocumentFragment();
    while (el.firstChild) inner.appendChild(el.firstChild);
    // Wrapper com blocos dentro (ex.: o <b> do Google Docs) não vira inline.
    const hasBlocks = Array.from(inner.childNodes).some((n) => n.nodeType === 1 && hasBlockOrSelf(n));
    if (!hasBlocks) {
      for (const [on, t] of [[underline, 'u'], [italic, 'i'], [bold, 'b']]) {
        if (!on) continue;
        const w = doc.createElement(t);
        w.appendChild(inner);
        inner = doc.createDocumentFragment();
        inner.appendChild(w);
      }
    }
    el.replaceWith(inner);
  }
}

function hasBlockOrSelf(el) {
  const tag = el.tagName.toLowerCase();
  return BLOCK_TAGS.has(tag) || WRAPPER_TAGS.has(tag) || hasBlockDescendant(el);
}

/** Listas aninhadas viram itens planos (o bloco Lista tem um nível só). */
function flattenNestedLists(doc, body) {
  for (const list of Array.from(body.querySelectorAll('ul, ol'))) {
    if (!list.isConnected || list.parentElement?.closest('ul, ol')) continue;
    const items = [];
    const collect = (l) => {
      for (const li of Array.from(l.children)) {
        if (li.tagName !== 'LI') continue;
        const nested = Array.from(li.querySelectorAll(':scope > ul, :scope > ol'));
        nested.forEach((n) => n.remove());
        const text = li.textContent.replace(/\s+/g, ' ').trim();
        if (text) {
          const item = doc.createElement('li');
          item.textContent = text;
          items.push(item);
        }
        nested.forEach(collect);
      }
    };
    collect(list);
    list.replaceChildren(...items);
  }
}

function cleanImage(doc, el) {
  const src = el.getAttribute('src') || '';
  // file:// (Word local), blob: e afins não sobrevivem fora da sessão.
  if (!/^(https?:|data:image\/)/i.test(src)) return null;
  const img = doc.createElement('img');
  img.setAttribute('src', src);
  const alt = el.getAttribute('alt');
  if (alt) img.setAttribute('alt', alt);
  return img;
}

/** Remove atributos e tags não suportados de um bloco, devolvendo outerHTML. */
function cleanBlock(doc, el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return el.outerHTML;
  if (tag === 'hr') return '<hr>';
  if (tag === 'pre') {
    const pre = doc.createElement('pre');
    pre.textContent = el.textContent.replace(/\n$/, '');
    return pre.textContent.trim() ? pre.outerHTML : null;
  }
  if (tag === 'table') return cleanTable(doc, el);

  stripTree(el);
  for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
  if (!el.textContent.trim()) return null;
  // Remove <br> soltos nas bordas (comuns em conteúdo colado).
  el.innerHTML = el.innerHTML
    .replace(/^(\s|&nbsp;|<br\s*\/?>)+/i, '')
    .replace(/(\s|&nbsp;|<br\s*\/?>)+$/i, '');
  return el.outerHTML;
}

function stripTree(root) {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!el.isConnected) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'li' || INLINE_KEEP.has(tag)) {
      const href = tag === 'a' ? el.getAttribute('href') : null;
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      if (href && !/^\s*javascript:/i.test(href)) el.setAttribute('href', href);
      if (tag === 'a' && !el.getAttribute('href')) unwrap(el);
      else if (tag !== 'br' && tag !== 'li' && !el.textContent.trim()) unwrap(el);
    } else {
      unwrap(el);
    }
  }
}

function cleanTable(doc, table) {
  const rows = Array.from(table.querySelectorAll('tr'))
    .filter((tr) => tr.closest('table') === table);
  if (!rows.length) return null;
  const out = doc.createElement('table');
  const hasHead = !!rows[0].querySelector('th') || rows[0].parentElement?.tagName === 'THEAD';
  for (const [i, tr] of rows.entries()) {
    const row = doc.createElement('tr');
    for (const cell of Array.from(tr.children)) {
      if (!/^T[DH]$/.test(cell.tagName)) continue;
      const c = doc.createElement(i === 0 && hasHead ? 'th' : 'td');
      c.textContent = cell.textContent.replace(/\s+/g, ' ').trim();
      row.appendChild(c);
    }
    if (row.children.length) out.appendChild(row);
  }
  return out.children.length ? out.outerHTML : null;
}
