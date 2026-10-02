import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

/**
 * Clique simples num bloco de texto entra em edição com o cursor no ponto
 * clicado; setas movem o cursor; o bloco Lista é editável no canvas.
 */

const props = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).__editor.getNode(id).props, id);

/** Coordenadas (viewport) logo após o N-ésimo caractere do texto do elemento. */
async function pointAfterChar(page: Page, selector: string, n: number) {
  return page.evaluate(({ selector, n }) => {
    const el = document.querySelector(selector)!;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let left = n;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const len = node.textContent!.length;
      if (left <= len) {
        const r = document.createRange();
        r.setStart(node, Math.max(0, left - 1)); r.setEnd(node, left);
        const rect = r.getBoundingClientRect();
        return { x: rect.right - 1, y: rect.top + rect.height / 2 };
      }
      left -= len;
    }
    throw new Error('offset fora do texto');
  }, { selector, n });
}

test.describe('Clique para editar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
    await page.evaluate(() => (window as any).__editor.loadJSON([]));
  });

  test('clique simples no parágrafo põe o cursor no ponto clicado e permite digitar', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'paragraph', { text: 'Hello world' });
    });
    const sel = `[data-block-id="${id}"]`;
    const pt = await pointAfterChar(page, sel, 5); // depois de "Hello"
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator(sel)).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.type(',');
    await page.locator('.editor-canvas').click({ position: { x: 5, y: 5 } });
    expect((await props(page, id)).text).toBe('Hello, world');
  });

  test('setas movem o cursor durante a edição', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'heading', { text: 'abcdef' });
    });
    const sel = `[data-block-id="${id}"]`;
    const pt = await pointAfterChar(page, sel, 6);
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.type('X');
    await page.keyboard.press('Enter'); // título: Enter confirma
    expect((await props(page, id)).text).toBe('abcdXef');
  });

  test('lista: clique num item edita, Backspace apaga e Enter cria item novo', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'list', { items: 'Maçã\nPera' });
    });
    const sel = `[data-block-id="${id}"]`;
    const pt = await pointAfterChar(page, sel, 4); // fim de "Maçã"
    await page.mouse.click(pt.x, pt.y);
    await expect(page.locator(sel)).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('as');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Uva');
    await page.locator('.editor-canvas').click({ position: { x: 5, y: 5 } });
    expect((await props(page, id)).items).toBe('Maças\nPera\nUva');
    await expect(page.locator(`${sel} > li`)).toHaveText(['Maças', 'Pera', 'Uva']);
  });

  test('lista: Esc desfaz a edição e restaura os itens', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'list', { items: 'A\nB' });
    });
    const sel = `[data-block-id="${id}"]`;
    const pt = await pointAfterChar(page, sel, 1);
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.type('zzz');
    await page.keyboard.press('Escape');
    await expect(page.locator(`${sel} > li`)).toHaveText(['A', 'B']);
    expect((await props(page, id)).items).toBe('A\nB');
  });

  test('citação: clique edita só o texto, sem misturar a fonte', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'blockquote', { text: 'Frase', source: 'Autor' });
    });
    const sel = `[data-block-id="${id}"] p`;
    const pt = await pointAfterChar(page, sel, 5);
    await page.mouse.click(pt.x, pt.y);
    await page.keyboard.type('!');
    await page.locator('.editor-canvas').click({ position: { x: 5, y: 5 } });
    expect(await props(page, id)).toMatchObject({ text: 'Frase!', source: 'Autor' });
  });

  test('duplo-clique em bloco já em edição seleciona a palavra (sem reiniciar)', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'paragraph', { text: 'um dois tres' });
    });
    const sel = `[data-block-id="${id}"]`;
    const pt = await pointAfterChar(page, sel, 5); // dentro de "dois"
    await page.mouse.dblclick(pt.x, pt.y);
    await page.keyboard.type('2');
    await page.locator('.editor-canvas').click({ position: { x: 5, y: 5 } });
    expect((await props(page, id)).text).toBe('um 2 tres');
  });

  test('Shift+clique continua só fazendo multi-seleção (sem editar)', async ({ page }) => {
    const [a, b] = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return [
        ed.addBlock(ed.rootId, 'paragraph', { text: 'A' }),
        ed.addBlock(ed.rootId, 'paragraph', { text: 'B' }),
      ];
    });
    await page.locator(`[data-block-id="${a}"]`).click();
    await page.locator('.editor-canvas').click({ position: { x: 5, y: 5 } });
    await page.locator(`[data-block-id="${a}"]`).click({ modifiers: ['Shift'] });
    await page.locator(`[data-block-id="${b}"]`).click({ modifiers: ['Shift'] });
    expect(await page.evaluate(() => (window as any).__editor.getSelectedIds().length)).toBe(2);
    await expect(page.locator('[data-editing="true"]')).toHaveCount(0);
  });
});
