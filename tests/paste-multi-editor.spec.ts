import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

/**
 * Vários editores na mesma página (ex.: um formulário com um editor por
 * campo). Cada editor registra o próprio listener de `paste` no `document`;
 * o Ctrl+V precisa chegar só ao editor em uso, e não ao primeiro da página.
 */

/** Monta um 2º editor com o mesmo shell da página demo (lido do HTML cru). */
async function mountSecondEditor(page: Page) {
  await page.evaluate(async () => {
    const raw = await (await fetch(location.href)).text();
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const shell = doc.getElementById('editor-root')!;
    shell.id = 'editor-root-2';
    shell.style.height = '400px';
    document.body.appendChild(document.adoptNode(shell));
    const Editor = (window as any).__editor.constructor;
    const ed2 = new Editor({ rootElement: document.getElementById('editor-root-2') }).init();
    (window as any).__editor2 = ed2;
    for (const ed of [(window as any).__editor, ed2]) { ed.loadJSON([]); ed.deselectBlock(); }
  });
}

async function paste(page: Page, selector: string | null, text: string) {
  await page.evaluate(({ selector, text }) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const target = selector ? document.querySelector(selector)! : document.body;
    target.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }));
  }, { selector, text });
}

/** Quantas vezes o texto aparece em cada editor: [editor 1, editor 2]. */
const hits = (page: Page, text: string) => page.evaluate((text) => {
  const eds = [(window as any).__editor, (window as any).__editor2];
  return eds.map((ed) => JSON.stringify(ed.exportJSON()).split(text).length - 1);
}, text);

test.describe('Colar com vários editores na página', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
    await mountSecondEditor(page);
  });

  test('bloco selecionado no 2º editor: o conteúdo vai para ele', async ({ page }) => {
    await page.evaluate(() => {
      const ed2 = (window as any).__editor2;
      ed2.selectBlock(ed2.addBlock(ed2.rootId, 'paragraph', { text: 'alvo' }));
    });
    await page.locator('#editor-root-2 [data-region="canvas"]').click({ position: { x: 5, y: 5 } });
    await page.evaluate(() => {
      const ed2 = (window as any).__editor2;
      const alvo = ed2.getRoot().children[0].id;
      ed2.selectBlock(alvo);
    });
    await paste(page, null, 'Colado no segundo');
    expect(await hits(page, 'Colado no segundo')).toEqual([0, 1]);
  });

  test('colar dentro do canvas de um editor fica nele', async ({ page }) => {
    await paste(page, '#editor-root-2 [data-region="canvas"]', 'Dentro do segundo');
    expect(await hits(page, 'Dentro do segundo')).toEqual([0, 1]);
    await paste(page, '#editor-root [data-region="canvas"]', 'Dentro do primeiro');
    expect(await hits(page, 'Dentro do primeiro')).toEqual([1, 0]);
  });

  test('fora de todos, sem interação prévia: nenhum editor adivinha', async ({ page }) => {
    await paste(page, null, 'Sem dono');
    expect(await hits(page, 'Sem dono')).toEqual([0, 0]);
  });

  test('fora de todos: vale o último editor clicado', async ({ page }) => {
    await page.locator('#editor-root [data-region="canvas"]').click({ position: { x: 5, y: 5 } });
    await page.locator('#editor-root-2 [data-region="canvas"]').click({ position: { x: 5, y: 5 } });
    await paste(page, null, 'Último usado');
    expect(await hits(page, 'Último usado')).toEqual([0, 1]);
  });
});
