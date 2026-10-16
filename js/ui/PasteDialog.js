import { el, icon } from '../utils/dom.js';
import { t } from '../i18n/index.js';
import { clipboardToHtml } from '../utils/clipboardImport.js';

/**
 * PasteDialog — caixa "toque e segure → Colar" para quando a área de
 * transferência não pode ser lida direto (navegador sem `clipboard.read`,
 * permissão negada).
 *
 * Existe por causa do celular: o canvas não é editável, então tocar e
 * segurar nele não oferece "Colar"; e colar dentro de um parágrafo pelo
 * teclado (área de transferência do Gboard, por exemplo) entrega só texto.
 * A caixa é um contenteditable comum — o menu nativo de colar aparece, e o
 * HTML (títulos, listas, negrito) chega inteiro. O que for colado é
 * normalizado na hora, então a caixa já mostra como vai ficar.
 */
export class PasteDialog {
  constructor(editor) {
    this.editor = editor;
  }

  show({ targetId = this.editor.getSelectedId() } = {}) {
    const ed = this.editor;
    const dialog = el('dialog', { class: 'editor-import-dialog editor-paste-dialog' });

    const box = el('div', {
      class: 'form-control editor-paste-dialog__box',
      contenteditable: 'true',
      role: 'textbox',
      'aria-multiline': 'true',
      'aria-label': t('paste.boxLabel'),
      'data-placeholder': t('paste.placeholder'),
    });
    const insertBtn = el('button', { type: 'button', class: 'btn btn-primary', disabled: true },
      [icon('clipboard-check'), ' ', t('paste.action')]);
    const cancelBtn = el('button', { type: 'button', class: 'btn btn-outline-secondary' },
      t('common.cancel'));

    const refresh = () => {
      const empty = !box.textContent.trim() && !box.querySelector('img, hr, table');
      box.classList.toggle('is-empty', empty);
      insertBtn.disabled = empty;
    };

    box.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      const html = cd?.getData('text/html') ?? '';
      const text = cd?.getData('text/plain') ?? '';
      const clean = clipboardToHtml({ html, text });
      if (!clean) return; // deixa o navegador colar o que tiver
      e.preventDefault();
      box.innerHTML = ed.sanitizer.isReady() ? ed.sanitizer.html(clean) : clean;
      refresh();
    });
    // Teclados que inserem o texto sem evento `paste` caem aqui: o conteúdo
    // é lido da própria caixa na hora de inserir.
    box.addEventListener('input', refresh);

    cancelBtn.addEventListener('click', () => dialog.close());
    insertBtn.addEventListener('click', () => {
      const { nodes } = ed.clipboardToNodes({ html: box.innerHTML, text: box.innerText });
      if (!nodes.length) {
        ed.notify?.toast?.(t('paste.empty'), 'warning');
        return;
      }
      ed.insertPastedNodes(nodes, targetId);
      ed.notify?.toast?.(t('paste.done', { n: nodes.length }), 'success');
      dialog.close();
    });

    dialog.append(
      el('div', { class: 'editor-import-dialog__header' }, [
        el('h5', { class: 'mb-0' }, [icon('clipboard'), ' ', t('paste.title')]),
      ]),
      el('p', { class: 'small text-muted mb-2' }, t('paste.hint')),
      box,
      el('div', { class: 'd-flex gap-2 justify-content-end mt-2' }, [cancelBtn, insertBtn]),
    );

    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    dialog.showModal();
    refresh();
    box.focus();
    return dialog;
  }
}
