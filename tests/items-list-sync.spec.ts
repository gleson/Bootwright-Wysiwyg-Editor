import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

/**
 * A lista de itens do painel direito (Abas, Acordeão, Carrossel) acompanha o
 * nó depois das ações dela mesma. O foco fica no botão clicado — que está
 * DENTRO do controle — e o sync do painel pulava controles focados: a aba
 * nova aparecia no canvas e não no painel.
 */

const rows = (page: Page) => page.locator('.editor-control__items-list-row');
const titles = (page: Page) =>
  rows(page).locator('[data-field="title"]').evaluateAll(
    (inputs) => inputs.map((i) => (i as HTMLInputElement).value));

async function addTabs(page: Page) {
  const id = await page.evaluate(() => {
    const ed: any = (window as any).__editor;
    const id = ed.addBlock(ed.rootId, 'tabs');
    ed.selectBlock(id);
    return id;
  });
  await expect(rows(page)).toHaveCount(3);
  return id;
}

test.describe('Lista de itens do painel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
    await page.evaluate(() => (window as any).__editor.loadJSON([]));
  });

  test('Adicionar aba aparece no canvas E no painel, com foco no título novo', async ({ page }) => {
    const id = await addTabs(page);
    await page.click('.editor-control__items-list-add');
    await expect(page.locator(`[data-block-id="${id}"] [role="tab"]`)).toHaveCount(4);
    await expect(rows(page)).toHaveCount(4);
    expect(await titles(page)).toEqual(['Aba 1', 'Aba 2', 'Aba 3', 'Nova aba']);
    await expect(rows(page).nth(3).locator('[data-field="title"]')).toBeFocused();

    // Digitar no título novo segue funcionando (e não é reconstruído no meio).
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Latim');
    await expect(page.locator(`[data-block-id="${id}"] [role="tab"]`).nth(3)).toHaveText('Latim');
    await expect(rows(page).nth(3).locator('[data-field="title"]')).toBeFocused();
  });

  test('remover e reordenar pela lista atualizam o painel', async ({ page }) => {
    await addTabs(page);
    await rows(page).nth(0).locator('button[data-action="down"]').click();
    expect(await titles(page)).toEqual(['Aba 2', 'Aba 1', 'Aba 3']);
    await rows(page).nth(2).locator('button[data-action="remove"]').click();
    await expect(rows(page)).toHaveCount(2);
    expect(await titles(page)).toEqual(['Aba 2', 'Aba 1']);
  });
});
