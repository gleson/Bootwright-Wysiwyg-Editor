import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';

/**
 * Colagem de conteúdo formatado externo (Word, Google Docs, web, .txt/.md):
 * o conteúdo vira blocos do editor em vez de texto puro num bloco só.
 */

/** Dispara um evento `paste` real (com clipboardData) no alvo. */
async function paste(page: Page, selector: string | null, data: { html?: string; text?: string }) {
  await page.evaluate(({ selector, data }) => {
    const dt = new DataTransfer();
    if (data.html) dt.setData('text/html', data.html);
    if (data.text) dt.setData('text/plain', data.text);
    const target = selector ? document.querySelector(selector)! : document.body;
    target.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }));
  }, { selector, data });
}

const topLevel = (page: Page) => page.evaluate(() => {
  const ed: any = (window as any).__editor;
  return ed.getRoot().children.map((c: any) => ({ type: c.type, props: c.props, classes: c.classes, attrs: c.attrs }));
});

test.describe('Colar conteúdo formatado', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean((window as any).__editor?.ready));
    await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      ed.loadJSON([]);
      ed.deselectBlock();
    });
  });

  test('HTML do Google Docs vira título, parágrafos com negrito/link, lista e tabela', async ({ page }) => {
    const html = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">
      <h1 dir="ltr" style="line-height:1.38"><span style="font-size:20pt;font-family:Arial">Meu Título</span></h1>
      <p dir="ltr" style="margin-top:0pt"><span style="font-weight:700">Negrito</span><span style="font-weight:400"> e </span><span style="font-style:italic">itálico</span> com <a href="https://exemplo.com" style="text-decoration:none"><span style="color:#1155cc">link</span></a>.</p>
      <ul style="margin:0"><li dir="ltr"><p dir="ltr"><span>Item A</span></p></li><li><p><span>Item B</span></p></li></ul>
      <div dir="ltr"><table style="border:none"><tbody><tr><td><p>Nome</p></td><td><p>Idade</p></td></tr><tr><td>Ana</td><td>30</td></tr></tbody></table></div>
    </b>`;
    await paste(page, null, { html, text: 'Meu Título ...' });

    const blocks = await topLevel(page);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'table']);
    expect(blocks[0].props).toMatchObject({ level: 1, text: 'Meu Título' });
    expect(blocks[1].props.text).toContain('<b>Negrito</b>');
    expect(blocks[1].props.text).toContain('<i>itálico</i>');
    expect(blocks[1].props.text).toContain('<a href="https://exemplo.com">link</a>');
    expect(blocks[1].props.text).not.toContain('style=');
    expect(blocks[2].props.items).toBe('Item A\nItem B');
    expect(blocks[3].props.cells).toEqual([['Nome', 'Idade'], ['Ana', '30']]);
    // Nada de classes/estilos da origem.
    for (const b of blocks) expect(b.attrs.style).toBeUndefined();
    await expect(page.locator('.editor-canvas h1')).toHaveText('Meu Título');
    await expect(page.locator('.editor-canvas p b')).toHaveText('Negrito');
  });

  test('lista do Word (MsoListParagraph) vira bloco Lista ordenada', async ({ page }) => {
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>
      <p class="MsoNormal">Intro<o:p></o:p></p>
      <p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>Primeiro<o:p></o:p></p>
      <p class="MsoListParagraphCxSpLast" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span>&nbsp;&nbsp;</span></span>Segundo<o:p></o:p></p>
    </body></html>`;
    await paste(page, null, { html, text: 'Intro\n1. Primeiro\n2. Segundo' });
    const blocks = await topLevel(page);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
    expect(blocks[1].props).toMatchObject({ ordered: true, items: 'Primeiro\nSegundo' });
  });

  test('texto Markdown vira título, parágrafo com negrito/link e lista', async ({ page }) => {
    const text = '# Capítulo\n\nTexto **forte** e [site](https://a.com).\n\n- um\n- dois';
    await paste(page, null, { text });
    const blocks = await topLevel(page);
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list']);
    expect(blocks[1].props.text).toContain('<b>forte</b>');
    expect(blocks[1].props.text).toContain('href="https://a.com"');
  });

  test('.txt sem linhas em branco: cada linha vira um parágrafo', async ({ page }) => {
    await paste(page, null, { text: 'Linha um\nLinha dois\nLinha três' });
    const blocks = await topLevel(page);
    expect(blocks.map((b) => b.props.text)).toEqual(['Linha um', 'Linha dois', 'Linha três']);
  });

  test('colagem entra após o bloco selecionado e é desfeita num Ctrl+Z só', async ({ page }) => {
    await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      const a = ed.addBlock(ed.rootId, 'paragraph', { text: 'A' });
      ed.addBlock(ed.rootId, 'paragraph', { text: 'Z' });
      ed.selectBlock(a);
    });
    await paste(page, null, { html: '<h2>T</h2><p>P</p>' });
    expect((await topLevel(page)).map((b) => b.props.text)).toEqual(['A', 'T', 'P', 'Z']);
    await page.evaluate(() => (window as any).__editor.undo());
    expect((await topLevel(page)).map((b) => b.props.text)).toEqual(['A', 'Z']);
  });

  test('editando um parágrafo: colar vários blocos divide o parágrafo no cursor', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'paragraph', { text: 'AntesDepois' });
    });
    const sel = `[data-block-id="${id}"]`;
    await page.locator(sel).dblclick();
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const r = document.createRange();
      r.setStart(el.firstChild!, 5); r.collapse(true);
      const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r);
    }, sel);
    await paste(page, sel, { html: '<h2>Título</h2><p>Meio <b>forte</b></p>' });
    const blocks = await topLevel(page);
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph']);
    expect(blocks.map((b) => b.props.text)).toEqual(['Antes', 'Título', 'Meio <b>forte</b>', 'Depois']);
  });

  test('editando um parágrafo vazio: o parágrafo é substituído pelos blocos colados', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'paragraph', { text: '' });
    });
    const sel = `[data-block-id="${id}"]`;
    await page.evaluate((id) => (window as any).__editor.startInlineEdit(id, 'text', { html: true }), id);
    await paste(page, sel, { text: '# A\n\nB' });
    expect((await topLevel(page)).map((b) => b.type)).toEqual(['heading', 'paragraph']);
  });

  test('editando: colar um trecho de uma linha entra inline mantendo o negrito', async ({ page }) => {
    const id = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      return ed.addBlock(ed.rootId, 'paragraph', { text: 'Olá ' });
    });
    const sel = `[data-block-id="${id}"]`;
    await page.locator(sel).dblclick();
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)!;
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const s = document.getSelection()!; s.removeAllRanges(); s.addRange(r);
    }, sel);
    await paste(page, sel, { html: '<span style="font-weight:bold">mundo</span>', text: 'mundo' });
    await page.evaluate(() => (window as any).__editor.commitInlineEdit());
    const blocks = await topLevel(page);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].props.text).toBe('Olá <b>mundo</b>');
  });

  test('conteúdo hostil colado é filtrado (script, onerror, javascript:)', async ({ page }) => {
    await page.evaluate(() => { (window as any).__pwned = false; });
    await paste(page, null, {
      html: '<p>ok <a href="javascript:window.__pwned=true">x</a><img src="x" onerror="window.__pwned=true"></p><script>window.__pwned=true</script>',
    });
    const blocks = await topLevel(page);
    const json = JSON.stringify(blocks);
    expect(json).not.toContain('javascript:');
    expect(json).not.toContain('onerror');
    expect(json).not.toContain('<script');
    expect(await page.evaluate(() => (window as any).__pwned)).toBe(false);
  });

  test('bloco copiado no editor ainda é colado como bloco (marcador no clipboard)', async ({ page }) => {
    const token = await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      const id = ed.addBlock(ed.rootId, 'button', {});
      ed.copyBlock(id);
      ed.selectBlock(id);
      return ed._clipboardToken;
    });
    await paste(page, null, { html: `<meta name="wysiwyg-block" content="${token}"><a>Botão</a>`, text: 'Botão' });
    expect((await topLevel(page)).map((b) => b.type)).toEqual(['button', 'button']);
  });

  test('após copiar um bloco, conteúdo externo copiado depois tem prioridade', async ({ page }) => {
    await page.evaluate(() => {
      const ed: any = (window as any).__editor;
      const id = ed.addBlock(ed.rootId, 'button', {});
      ed.copyBlock(id);
      ed.deselectBlock();
    });
    await paste(page, null, { html: '<h3>Externo</h3>' });
    expect((await topLevel(page)).map((b) => b.type)).toEqual(['button', 'heading']);
  });
});
