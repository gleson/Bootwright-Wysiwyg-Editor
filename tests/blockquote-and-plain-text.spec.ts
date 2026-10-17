import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

/**
 * Blocos de texto puro com várias linhas (Citação, Alerta) guardam a quebra
 * como "\n". O Enter do navegador cria <br>/<div> no contenteditable e o
 * `textContent` descartava os dois: a quebra sumia ao sair da edição.
 */

const props = (page: Page, id: string) =>
  page.evaluate((id) => (window as any).__editor.getNode(id).props, id);

async function editAtEnd(page: Page, sel: string) {
  await page.locator(sel).click();
  await expect(page.locator(sel)).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('End');
}

const leave = (page: Page) =>
  page.locator('.editor-canvas').click({ position: { x: 5, y: 5 } });

test.describe('Quebra de linha em bloco de texto puro', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
    await page.evaluate(() => (window as any).__editor.loadJSON([]));
  });

  test('Enter na citação grava a quebra', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'blockquote', { text: 'Primeira', source: 'Autor' });
    });
    const sel = `[data-block-id="${id}"] p`;
    await editAtEnd(page, sel);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Segunda');
    await leave(page);
    expect((await props(page, id)).text).toBe('Primeira\nSegunda');

    // Reabre e quebra de novo: a quebra anterior (já como "\n") é mantida.
    await editAtEnd(page, sel);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Terceira');
    await leave(page);
    expect((await props(page, id)).text).toBe('Primeira\nSegunda\n\nTerceira');
    expect(await page.evaluate(() => (window as any).__editor.exportHTML()))
      .toContain('Segunda');
  });

  test('Shift+Enter no alerta grava a quebra', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'alert', { text: 'Linha um' });
    });
    const sel = `[data-block-id="${id}"] p.mb-0`;
    await editAtEnd(page, sel);
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('Linha dois');
    await leave(page);
    expect((await props(page, id)).text).toBe('Linha um\nLinha dois');
  });

  test('Enter no fim sem texto depois não deixa quebra sobrando', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'blockquote', { text: 'Só isto', source: '' });
    });
    const sel = `[data-block-id="${id}"] p`;
    await editAtEnd(page, sel);
    await page.keyboard.type('!');
    await leave(page);
    expect((await props(page, id)).text).toBe('Só isto!');
  });
});

test.describe('Autor da citação no canvas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
    await page.evaluate(() => (window as any).__editor.loadJSON([]));
  });

  test('clicar no autor edita a fonte sem mexer no texto', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'blockquote', { text: 'Citação', source: 'Inácio' });
    });
    const footer = `[data-block-id="${id}"] footer`;
    await page.locator(footer).click();
    await expect(page.locator(footer)).toHaveAttribute('contenteditable', 'true');
    await page.keyboard.press('End');
    await page.keyboard.type(' de Antioquia');
    await leave(page);
    const p = await props(page, id);
    expect(p.source).toBe('Inácio de Antioquia');
    expect(p.text).toBe('Citação');

    // Enter no autor encerra a edição (linha única), não quebra a linha.
    await page.locator(footer).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator(footer)).not.toHaveAttribute('contenteditable', 'true');
    expect((await props(page, id)).source).toBe('Inácio de Antioquia');
  });

  test('clicar no texto continua editando a citação', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'blockquote', { text: 'Citação', source: 'Autor' });
    });
    const p = `[data-block-id="${id}"] p`;
    await editAtEnd(page, p);
    await page.keyboard.type('!');
    await leave(page);
    expect((await props(page, id))).toMatchObject({ text: 'Citação!', source: 'Autor' });
  });
});
