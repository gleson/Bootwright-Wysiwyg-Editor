import { test, expect, devices, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

/**
 * Celular: as sidebars viram gavetas FECHADAS ao carregar (antes ocupavam
 * 600 px numa tela de ~400 e cobriam o canvas), e o botão "Colar" leva
 * conteúdo formatado para o canvas — que, não sendo editável, não oferece
 * o menu nativo de colar ao toque.
 */
const { defaultBrowserType: _ignored, ...pixel } = devices['Pixel 7'];
test.use({ ...pixel });

const HTML = '<h2>Título A</h2><p>Texto <b>forte</b></p><h3>Sub B</h3><ul><li>um</li><li>dois</li></ul>';

const shell = (page: Page) => page.locator('.editor-shell').first();
const types = (page: Page) => page.evaluate(() =>
  (window as any).__editor.getRoot().children.map((c: any) => c.type));

async function boot(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
  await page.evaluate(() => {
    const ed: any = (window as any).__editor;
    ed.loadJSON([]);
    ed.deselectBlock();
  });
}

test.describe('Editor no celular', () => {
  test.beforeEach(async ({ page }) => boot(page));

  test('carrega com as gavetas fechadas e sem rolagem horizontal', async ({ page }) => {
    await expect(shell(page)).toHaveClass(/editor-shell--mobile/);
    await expect(shell(page)).not.toHaveClass(/--(left|right)-open/);
    await expect(page.locator('.editor-sidebar--left')).toBeHidden();
    await expect(page.locator('.editor-sidebar--right')).toBeHidden();
    const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    expect(sw).toBeLessThanOrEqual(w);
  });

  test('gaveta de blocos abre pelo topo e fecha depois de inserir', async ({ page }) => {
    await page.locator('.editor-topbar [data-drawer-toggle="left"]').tap();
    await expect(shell(page)).toHaveClass(/editor-shell--left-open/);
    await expect(page.locator('.editor-sidebar--left')).toBeVisible();

    await page.locator('.editor-blocks-list__item', { hasText: 'Parágrafo' }).first().tap();
    await expect(shell(page)).not.toHaveClass(/editor-shell--left-open/);
    expect(await types(page)).toEqual(['paragraph']);
  });

  test('propriedades abrem pela barra do bloco e fecham no véu', async ({ page }) => {
    await page.evaluate(() => (window as any).__editor
      .importContent({ format: 'html', source: '<p>Um parágrafo</p>', mode: 'replace' }));
    await page.locator('.editor-canvas p').first().tap();

    const bar = page.locator('.editor-block-toolbar');
    await expect(bar).toBeVisible();
    const box = (await bar.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);

    await bar.locator('.editor-block-toolbar__btn--mobile-only').tap();
    await expect(shell(page)).toHaveClass(/editor-shell--right-open/);
    await page.locator('.editor-drawer-scrim').tap({ position: { x: 20, y: 300 } });
    await expect(shell(page)).not.toHaveClass(/editor-shell--right-open/);
  });

  test('botão Colar lê a área de transferência com formatação', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async (h) => navigator.clipboard.write([new ClipboardItem({
      'text/html': new Blob([h], { type: 'text/html' }),
      'text/plain': new Blob(['Título A'], { type: 'text/plain' }),
    })]), HTML);

    await page.locator('.editor-canvas__placeholder-actions button').first().tap();
    await expect.poll(() => types(page)).toEqual(['heading', 'paragraph', 'heading', 'list']);
  });

  test('sem acesso à área de transferência, a caixa de colar preserva os títulos', async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    await page.locator('.editor-topbar button[aria-label^="Colar"]').tap();
    const dialog = page.locator('dialog.editor-paste-dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.btn-primary')).toBeDisabled();

    await page.evaluate((h) => {
      const dt = new DataTransfer();
      dt.setData('text/html', h);
      document.querySelector('.editor-paste-dialog__box')!.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, HTML);
    await expect(dialog.locator('.editor-paste-dialog__box h2')).toHaveText('Título A');

    await dialog.locator('.btn-primary').tap();
    await expect(dialog).toHaveCount(0);
    expect(await types(page)).toEqual(['heading', 'paragraph', 'heading', 'list']);
  });

  test('colar substitui o parágrafo vazio selecionado', async ({ page }) => {
    await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      ed.importContent({ format: 'html', source: '<p>Antes</p><p>x</p>', mode: 'replace' });
      const [, empty] = ed.getRoot().children;
      ed.updateBlock(empty.id, { props: { text: '' } });
      ed.selectBlock(empty.id);
      const { nodes } = ed.clipboardToNodes({ html: '<h2>Novo</h2><p>corpo</p>' });
      ed.insertPastedNodes(nodes);
    });
    expect(await types(page)).toEqual(['paragraph', 'heading', 'paragraph']);
  });
});
