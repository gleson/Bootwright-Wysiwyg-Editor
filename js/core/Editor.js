import { EventBus } from './EventBus.js';
import { State } from './State.js';
import { HistoryManager } from './HistoryManager.js';
import { Selection } from './Selection.js';
import { Sanitizer } from './Sanitizer.js';
import { Renderer } from './Renderer.js';
import { CollabManager } from './CollabManager.js';
import {
  AddNodeCommand,
  RemoveNodeCommand,
  UpdateNodeCommand,
  MoveNodeCommand,
  BatchCommand,
} from './commands.js';
import { generateId } from '../utils/id.js';
import { t } from '../i18n/index.js';
import { htmlToBlocks } from '../utils/htmlImport.js';
import { formatHTML } from '../utils/htmlFormat.js';
import { safeCss } from '../utils/url.js';
import { generateThemeCss } from '../utils/bootstrapTheme.js';
import { markdownToHtml } from '../utils/markdownImport.js';
import { clipboardToHtml } from '../utils/clipboardImport.js';
import { BlockRegistry } from '../blocks/BlockRegistry.js';
import { builtInBlocks } from '../blocks/built-in/index.js';
import { BUILT_IN_TEMPLATES, getBuiltInTemplate } from '../blocks/built-in/templates.js';
import { createCustomSnippetBlockClass } from '../blocks/CustomSnippet.js';
import { createComponentBlockClass } from '../blocks/Component.js';
import { CustomizationStore } from './CustomizationStore.js';
import { Topbar } from '../ui/Topbar.js';
import { SidebarLeft } from '../ui/SidebarLeft.js';
import { SidebarRight } from '../ui/SidebarRight.js';
import { Canvas } from '../ui/Canvas.js';
import { BlockToolbar } from '../ui/BlockToolbar.js';
import { DragManager } from '../ui/DragManager.js';
import { ExportDialog } from '../ui/ExportDialog.js';
import { RestoreBanner } from '../ui/RestoreBanner.js';
import { ContextMenu } from '../ui/ContextMenu.js';
import { CustomizationDialog } from '../ui/CustomizationDialog.js';
import { Notify } from '../ui/Notify.js';
import { AssetLibrary } from '../ui/AssetLibrary.js';
import { SeoDialog } from '../ui/SeoDialog.js';
import { RichTextToolbar } from '../ui/RichTextToolbar.js';
import { TemplateEditBanner } from '../ui/TemplateEditBanner.js';
import { CommandPalette } from '../ui/CommandPalette.js';
import { SlashMenu } from '../ui/SlashMenu.js';
import { MarkdownShortcuts } from '../ui/MarkdownShortcuts.js';
import { InlineMarkdown } from '../ui/InlineMarkdown.js';
import { FindReplace } from '../ui/FindReplace.js';
import { ImportDialog } from '../ui/ImportDialog.js';
import { HtmlSourceDialog } from '../ui/HtmlSourceDialog.js';
import { A11yAudit } from '../ui/A11yAudit.js';
import { IconPicker } from '../ui/IconPicker.js';
import { ImageEditor } from '../ui/ImageEditor.js';
import { ImageResizeHandles } from '../ui/ImageResizeHandles.js';
import { CollabIndicator } from '../ui/CollabIndicator.js';
import { ContentEditor } from '../ui/ContentEditor.js';
import { CompactEditor } from '../ui/CompactEditor.js';
import { PaneEditButton } from '../ui/PaneEditButton.js';
import { ScrollAnimator } from '../ui/ScrollAnimator.js';
import { ParallaxAnimator } from '../ui/ParallaxAnimator.js';
import { Comments } from '../ui/Comments.js';
import { setLocale, registerLocale as i18nRegisterLocale } from '../i18n/index.js';

/** Versão do bundle — bata com package.json e CHANGELOG.md. */
export const VERSION = '1.1.0';

/** Versão do schema da árvore JSON salva no localStorage / banco. */
export const SCHEMA_VERSION = 1;

/**
 * LCS sobre duas sequências de chaves (igualdade por `===`). Devolve um Map
 * `novoÍndice → velhoÍndice` representando o emparelhamento crescente máximo —
 * cada índice de cada lado aparece no máximo uma vez. Usado pela reconciliação
 * do modo HTML (ver Editor._reconcileReplaceHtml) para casar blocos inalterados
 * por posição + igualdade textual.
 */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = new Map();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.set(j, i); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Conjunto de tipos de bloco com sintaxe Django no HTML exportado. */
const DJANGO_ONLY_BLOCK_TYPES = new Set([
  'django-var', 'repeater',
  'form', 'form-input', 'form-textarea', 'form-select', 'form-checkbox', 'form-submit',
]);

/**
 * Normaliza qualquer um dos formatos aceitos para initialJSON em uma árvore
 * usável (objeto) ou null se equivale a "vazio". Aceita:
 *   - null, undefined            → null
 *   - "", "   ", "null"          → null
 *   - "{}", {}, []               → null
 *   - "\"\"", '""'               → null (string vazia escapada)
 *   - "<json-string>"            → JSON.parse + revalidação
 *   - { type, children, ... }    → devolve direto
 *   - [ {…}, {…} ]               → tratado como lista de nós de topo
 */
function normalizeInitialContent(raw) {
  if (raw == null) return null;
  let v = raw;
  // Aceita até 2 níveis de stringificação (caso comum: form hidden com
  // o JSON re-codificado pelo framework).
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    const trimmed = v.trim();
    if (!trimmed || trimmed === 'null' || trimmed === '""') return null;
    try { v = JSON.parse(trimmed); }
    catch (err) {
      console.warn('[Editor] initialContent ignorado: JSON inválido —', err.message);
      return null;
    }
  }
  if (v == null || typeof v !== 'object') return null;
  // Array de nós de topo (host que persistiu só `root.children`).
  if (Array.isArray(v)) return v.length ? { type: 'root', children: v } : null;
  if (Object.keys(v).length === 0) return null;
  return v;
}

/**
 * Normaliza a forma da árvore aceita por `loadJSON`. O contrato oficial é
 * `{ type: 'root', children: [...] }`, mas integrações costumam persistir
 * variações — e um throw aqui deixa o editor montado e o canvas vazio, o pior
 * resultado possível para quem só quer reabrir o que salvou. Aceita:
 *   - { type: 'root', ... }          → devolve como está
 *   - [ {…}, {…} ]                   → lista de nós de topo
 *   - { children: [...] }            → falta só o `type`
 *   - { id, type: 'paragraph', … }   → nó único solto (sem container/raiz)
 * Devolve null quando não há nada aproveitável.
 */
function normalizeTreeData(raw) {
  if (raw == null) return null;
  let v = raw;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed || trimmed === 'null' || trimmed === '""') return null;
    try { v = JSON.parse(trimmed); }
    catch (err) {
      throw new Error(`[Editor] loadJSON: JSON inválido — ${err.message}`);
    }
  }
  if (typeof v !== 'object') return null;

  if (Array.isArray(v)) {
    return { type: 'root', props: {}, classes: [], attrs: {}, children: v };
  }
  if (v.type === 'root') return v;
  // `type` presente e diferente de 'root' identifica um NÓ (que também tem
  // `children`), não uma raiz — por isso vem antes do teste de children.
  if (typeof v.type === 'string' && v.type) {
    return { type: 'root', props: {}, classes: [], attrs: {}, children: [v] };
  }
  if (Array.isArray(v.children)) {
    // Objeto raiz sem `type` mas com filhos: preserva props/classes/attrs de
    // página (SEO, comentários) e só corrige o type.
    return { ...v, type: 'root' };
  }
  return null;
}

/**
 * Editor — fachada pública e orquestrador dos subsistemas.
 *
 * Responsabilidades:
 *   - Construir EventBus, State, HistoryManager, Selection.
 *   - Expor API pública que toda integração (Django, dev console, UI) usa.
 *   - Cuidar de invariantes entre subsistemas (ex.: deselecionar nó removido).
 *
 * O Renderer e a UI ainda não estão presentes — entram nas Fases 2/3.
 */
/** Forma e valores padrão dos metadados SEO da página (root.props.seo). */
const DEFAULT_SEO = {
  title: '',
  description: '',
  canonical: '',
  ogImage: '',
  ogType: 'website',
  robots: 'index, follow',
};

export class Editor {
  constructor(config = {}) {
    if (!config.rootElement || !(config.rootElement instanceof HTMLElement)) {
      throw new Error('[Editor] rootElement é obrigatório e deve ser um HTMLElement.');
    }

    // initialContent unificado tem precedência sobre initialJSON quando ambos
    // foram passados (e o formato foi declarado explicitamente).
    let resolvedInitial = config.initialJSON;
    if (config.initialContent && typeof config.initialContent === 'object') {
      const { format, source } = config.initialContent;
      if (format === 'json') {
        resolvedInitial = source;
      } else {
        // html/markdown ficam pendentes — aplicados após init() via importContent.
        resolvedInitial = null;
        this._pendingInitialContent = config.initialContent;
      }
    }

    // CSRF: aceita config.csrf {header,token,cookie} (novo) ou config.csrfToken
    // (legado, header X-CSRFToken implícito). Resolve cookie em runtime.
    const csrf = this._resolveCsrfConfig(config);

    this.config = {
      rootElement: config.rootElement,
      targetField: config.targetField ?? null,
      initialJSON: normalizeInitialContent(resolvedInitial),
      // Transport — endpoints e ponto de extensão para fetch.
      saveUrl:     config.saveUrl     ?? config.transport?.save?.url   ?? null,
      uploadUrl:   config.uploadUrl   ?? config.transport?.upload?.url ?? null,
      assetsUrl:   config.assetsUrl   ?? config.transport?.assets?.url ?? null,
      transport:   config.transport   ?? null,
      fetch:       typeof config.fetch === 'function' ? config.fetch : null,
      csrf,
      // Compat: csrfToken espelha csrf.token (preserva código antigo do host).
      csrfToken:   csrf.token,
      onSave:      config.onSave      ?? null,
      autoSave:        config.autoSave        ?? true,
      autoSaveKey:     config.autoSaveKey     ?? null,
      autoSaveDebounce:config.autoSaveDebounce ?? 2000,
      autoSaveStrict:  config.autoSaveStrict  ?? true,
      // Sanitização — permite ao host customizar perfis e habilitar SVG.
      sanitizer:   config.sanitizer ?? {},
      allowSvg:    config.allowSvg ?? false,
      // Plugins / desativação de blocos por nome de tipo.
      disableDjangoBlocks: config.disableDjangoBlocks ?? false,
      excludeBlocks:       Array.isArray(config.excludeBlocks) ? config.excludeBlocks : [],
      // Edição colaborativa (opt-in). Sem collabUrl, o editor é offline-only.
      collabUrl:       config.collabUrl       ?? null,
      collabName:      config.collabName      ?? null,
    };

    // autoSaveKey é obrigatório quando autoSave está ligado: chaves genéricas
    // colidem entre páginas (rascunho do Post #1 restaurado no Post #2).
    if (this.config.autoSave && !this.config.autoSaveKey) {
      if (this.config.autoSaveStrict) {
        console.warn(
          '[Editor] autoSave desativado: autoSaveKey é obrigatório (use um valor único por registro, ex.: `editor:autosave:post-42`). ' +
          'Passe `autoSaveStrict: false` para aceitar uma chave genérica padrão.'
        );
        this.config.autoSave = false;
      } else {
        this.config.autoSaveKey = 'editor:autosave';
      }
    }
    this.root = this.config.rootElement;
    this._autoSaveTimer = null;
    this._dirty = false;

    this.bus = new EventBus();
    this.state = new State(this.bus);
    this.history = new HistoryManager(this.bus);
    this.selection = new Selection(this.bus);
    this.sanitizer = new Sanitizer({
      allowSvg: this.config.allowSvg,
      ...this.config.sanitizer,
    });
    this.notify = new Notify();
    this.registry = new BlockRegistry();
    const excluded = new Set(this.config.excludeBlocks);
    if (this.config.disableDjangoBlocks) {
      for (const t of DJANGO_ONLY_BLOCK_TYPES) excluded.add(t);
    }
    for (const B of builtInBlocks) {
      if (excluded.has(B.type)) continue;
      this.registry.register(B);
    }
    this.customizations = new CustomizationStore(this.bus);
    this._customSnippetTypes = new Set();
    this._registerCustomSnippets();
    this._componentTypes = new Set();
    this._registerComponents();
    this.renderer = null; // criado em init() depois do shell montado
    // Edição colaborativa: instanciada só se collabUrl foi configurado.
    this.collab = this.config.collabUrl ? new CollabManager(this) : null;

    this.activeBreakpoint = ''; // '' (xs/padrão) | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
    this.inlineEdit = null;     // { id, target, originalText, el, cleanup }
    this.tableCellSelection = null; // { tableId, anchor:{r,c}, focus:{r,c} } — transiente
    this._clipboard = null;     // template para colar (sem id; createNode regera ids)
    this.editingTemplateId = null; // id do template em edição (modo "carregar p/ editar")
    this.editingComponentId = null; // id do componente em edição (modo similar)

    this.ready = false;
  }

  init() {
    this._validateExternalDeps();
    this._wireInternalEvents();
    this._mountUI();
    this._injectCustomCSS();
    this._injectFontLinks();

    this._injectThemeCSS();

    if (this.config.initialJSON) {
      try {
        this.loadJSON(this.config.initialJSON);
      } catch (err) {
        console.error('[Editor] Falha ao carregar initialJSON:', err);
      }
    } else if (this._pendingInitialContent) {
      try {
        const { format, source, mode = 'replace' } = this._pendingInitialContent;
        this.importContent({ format, source, mode });
      } catch (err) {
        console.error('[Editor] Falha ao importar initialContent:', err);
      }
    }

    if (this.config.autoSave) this._wireAutoSave();

    // Conecta a colaboração só depois que o shell/Renderer estão prontos —
    // o primeiro snapshot recebido dispara um loadJSON.
    if (this.collab) this.collab.connect();

    this.root.dataset.editorReady = 'true';
    this.ready = true;

    // Registro oficial — integrações externas (calculadoras, validators)
    // podem ler `WysiwygEditor.instances` sem precisar de hack global.
    Editor.instances.set(this._instanceId(), this);

    this._dispatchDom('editor:ready', { editor: this });

    // Repassa state:changed como evento DOM (decoupling de integrações
    // externas que não querem importar a classe).
    this.bus.on('state:changed', () => this._dispatchDom('editor:change', { editor: this }));

    console.info(`[Editor] v${VERSION} carregado.`);
    return this;
  }

  /**
   * Verifica dependências externas usadas via `globalThis`. Hoje só DOMPurify
   * é obrigatório (Sanitizer já avisa, mas aqui falhamos cedo e visivelmente
   * — evita o caso "editor parece OK mas Tabs/Carousel sem comportamento").
   * Bootstrap JS é opcional e só causa warning.
   */
  _validateExternalDeps() {
    if (!globalThis.DOMPurify) {
      const msg =
        '[Editor] DOMPurify não encontrado em globalThis. ' +
        'Carregue DOMPurify ANTES de instanciar o Editor (ex.: ' +
        '`<script src=".../purify.min.js"></script>` antes do bundle), ' +
        'ou substitua o Sanitizer via `new Editor({ sanitizer: {...} })`.';
      console.error(msg);
      throw new Error(msg);
    }
    if (!globalThis.bootstrap?.Carousel) {
      console.warn(
        '[Editor] Bootstrap JS (window.bootstrap) não detectado. ' +
        'Blocos interativos como Carousel/Tabs/Accordion renderizam mas ' +
        'não terão comportamento. Carregue `bootstrap.bundle.min.js`.'
      );
    }
  }

  /** Id estável da instância (id do elemento ou contador interno). */
  _instanceId() {
    if (this._id) return this._id;
    this._id = this.root.id || `wysiwyg-${++Editor._counter}`;
    return this._id;
  }

  _dispatchDom(name, detail) {
    try {
      this.root.dispatchEvent(new CustomEvent(name, {
        detail: { editor: this, ...detail }, bubbles: true,
      }));
    } catch { /* ambiente sem CustomEvent — ignora */ }
  }

  /* ---------- Transport / CSRF helpers ---------- */

  /**
   * Resolve config CSRF aceitando 3 formas:
   *   - config.csrf = { header, token, cookie } (recomendado, framework-agnóstico)
   *   - config.csrf = "<token>" (atalho — header default X-CSRFToken)
   *   - config.csrfToken = "<token>" (legado Django)
   * Quando `cookie` é informado, lê o valor do `document.cookie` em runtime.
   */
  _resolveCsrfConfig(config) {
    let header = 'X-CSRFToken';
    let token = null;
    let cookie = null;
    if (typeof config.csrf === 'string') {
      token = config.csrf;
    } else if (config.csrf && typeof config.csrf === 'object') {
      header = config.csrf.header || header;
      token  = config.csrf.token ?? null;
      cookie = config.csrf.cookie ?? null;
    }
    if (token == null && config.csrfToken != null) token = config.csrfToken;
    if (token == null && cookie && typeof document !== 'undefined') {
      const m = document.cookie.match(new RegExp('(?:^|; )' + cookie.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '=([^;]*)'));
      if (m) token = decodeURIComponent(m[1]);
    }
    return { header, token, cookie };
  }

  /** Cabeçalhos com CSRF aplicáveis em um POST/PUT/DELETE same-origin. */
  csrfHeaders() {
    const { header, token } = this.config.csrf;
    if (!token) return {};
    return { [header]: token };
  }

  /**
   * fetch wrapper — usa `config.fetch` se fornecido (permite axios/ky). Sempre
   * envia same-origin por padrão.
   */
  fetch(input, init = {}) {
    const f = this.config.fetch ?? globalThis.fetch;
    if (!f) throw new Error('[Editor] fetch global não disponível e nenhum custom fetch configurado.');
    return f(input, { credentials: 'same-origin', ...init });
  }

  /** Resolve `{ url, method, headers, field, parser }` para upload/assets/save. */
  transportFor(channel) {
    const t = this.config.transport?.[channel] || {};
    return {
      url: t.url ?? this.config[`${channel}Url`] ?? null,
      method: t.method ?? (channel === 'assets' ? 'GET' : 'POST'),
      headers: t.headers ?? {},
      field: t.field ?? 'file',
      parser: typeof t.parser === 'function' ? t.parser : null,
    };
  }

  _mountUI() {
    this.notify.mount();
    this.ui = {
      // ExportDialog é instanciado primeiro (sem mount) — Topbar referencia.
      exportDialog: new ExportDialog(this),
      importDialog: new ImportDialog(this),
      htmlSourceDialog: new HtmlSourceDialog(this),
      a11yAudit: new A11yAudit(this),
      iconPicker: new IconPicker(this),
      // ImageEditor — modal de edição da imagem (alinhamento/transform/ajustes/
      // crop/foco). Sem mount, aberto via `editor.ui.imageEditor.open(nodeId)`.
      imageEditor: new ImageEditor(this),
      // AssetLibrary não tem mount() — usada sob demanda pelos controles 'file'.
      assetLibrary: new AssetLibrary(this),
      // ContentEditor (modal com mini-Editor) — sem mount, aberto sob demanda
      // pelos blocos compostos (Tabs/Accordion/Carousel) para edição rica do
      // conteúdo do painel/slide ativo.
      contentEditor: new ContentEditor(this),
      // CompactEditor — editor rápido full-screen com barra no topo, sem
      // sidebars. Ideal para espaços apertados. Abrível via botão da topbar
      // ou via API: editor.ui.compactEditor.open({ html, onSave }).
      compactEditor: new CompactEditor(this),
      // SeoDialog idem — aberto pelo botão da Topbar.
      seoDialog: new SeoDialog(this),

      topbar:       new Topbar(this),
      sidebarLeft:  new SidebarLeft(this),
      sidebarRight: new SidebarRight(this),
      canvas:       new Canvas(this),
    };
    this.ui.topbar.mount();
    this.ui.sidebarLeft.mount();
    this.ui.sidebarRight.mount();
    this.ui.canvas.mount();

    this.renderer = new Renderer(this);
    this.renderer.mount();

    // Pré-visualização das animações on-scroll no canvas (data-animate).
    // Depois do Renderer: re-escaneia o canvas a cada render.
    this.ui.scrollAnimator = new ScrollAnimator(this);
    this.ui.scrollAnimator.mount();

    // Parallax + scroll-link (timeline). Mesmo padrão de re-scan por rAF.
    this.ui.parallaxAnimator = new ParallaxAnimator(this);
    this.ui.parallaxAnimator.mount();

    // BlockToolbar precisa do Renderer (lê nodeElements para posicionar).
    this.ui.blockToolbar = new BlockToolbar(this);
    this.ui.blockToolbar.mount();

    // Alças de resize que aparecem nos cantos das imagens selecionadas.
    this.ui.imageResizeHandles = new ImageResizeHandles(this);
    this.ui.imageResizeHandles.mount();

    // Botão flutuante "Editar conteúdo…" que aparece sobre o painel/slide
    // ativo de Tabs/Accordion/Carousel quando o bloco está selecionado.
    this.ui.paneEditButton = new PaneEditButton(this);
    this.ui.paneEditButton.mount();

    this.ui.dragManager = new DragManager(this);
    this.ui.dragManager.mount();

    this.ui.contextMenu = new ContextMenu(this);
    this.ui.contextMenu.mount();

    // RestoreBanner: mostra-se só se há autosave salvo e sem initialJSON.
    this.ui.restoreBanner = new RestoreBanner(this);
    this.ui.restoreBanner.mount();

    this.ui.customizationDialog = new CustomizationDialog(this);
    this.ui.customizationDialog.mount();

    this.ui.richTextToolbar = new RichTextToolbar(this);
    this.ui.richTextToolbar.mount();

    this.ui.templateEditBanner = new TemplateEditBanner(this);
    this.ui.templateEditBanner.mount();

    this.ui.commandPalette = new CommandPalette(this);
    this.ui.commandPalette.mount();

    // Slash menu (`/` no conteúdo) — inserção rápida durante a edição inline.
    this.ui.slashMenu = new SlashMenu(this);
    this.ui.slashMenu.mount();

    // Markdown shortcuts (# / ## / - / 1. / > ) — convertem o bloco em edição.
    this.ui.markdownShortcuts = new MarkdownShortcuts(this);
    this.ui.markdownShortcuts.mount();

    // Markdown inline (**bold**, _italic_, [link](url)) — só em rich-text.
    this.ui.inlineMarkdown = new InlineMarkdown(this);
    this.ui.inlineMarkdown.mount();

    // Find & Replace (Ctrl+F) — busca/substituição em todas as props string.
    this.ui.findReplace = new FindReplace(this);
    this.ui.findReplace.mount();

    // Comentários de revisão presos a blocos (marcadores no canvas + popover).
    this.ui.comments = new Comments(this);
    this.ui.comments.mount();

    // Indicador de presença/colaboração — só quando a colaboração está ativa.
    if (this.collab) {
      this.ui.collabIndicator = new CollabIndicator(this);
      this.ui.collabIndicator.mount();
    }
  }

  _wireInternalEvents() {
    this.bus.on('state:changed', (evt) => {
      if (evt.type === 'remove' && this.selection.has(evt.id)) {
        this.selection.drop(evt.id);
      }
      if (evt.type === 'remove') {
        // Bloco (e descendentes) saiu da árvore — descarta comentários órfãos.
        this._pruneComments();
      }
      if (evt.type === 'replace') {
        this.selection.clear();
        this.history.clear();
        this.tableCellSelection = null;
      }
    });

    // Seleção de células some quando a tabela deixa de estar selecionada.
    this.bus.on('selection:changed', () => {
      const sel = this.tableCellSelection;
      if (sel && !this.selection.has(sel.tableId)) this.clearTableCellSelection();
    });

    this.bus.on('css:changed', () => this._injectCustomCSS());
    this.bus.on('theme:changed', () => this._injectThemeCSS());
    this.bus.on('fonts:changed', () => this._injectFontLinks());
    this.bus.on('customizations:imported', () => this._injectFontLinks());
    this.bus.on('customblocks:changed', () => this._registerCustomSnippets());
    this.bus.on('components:changed',  () => this._registerComponents());
  }

  /* ---------- CSS personalizado ---------- */

  _injectCustomCSS() {
    if (typeof document === 'undefined') return;
    let tag = document.getElementById('editor-custom-css');
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'editor-custom-css';
      document.head.appendChild(tag);
    }
    tag.textContent = this.customizations.getCSS();
  }

  setCustomCSS(css)        { this.customizations.setCSS(css); }
  getCustomCSS()           { return this.customizations.getCSS(); }
  getCustomClassNames()    { return this.customizations.extractClassNames(); }

  /* ---------- Tema de cores do Bootstrap ---------- */

  /**
   * Injeta o `<style id="editor-theme-css">` com os overrides de cor do
   * Bootstrap. Fica ANTES do CSS personalizado no `<head>` para que o usuário
   * ainda possa sobrescrever o tema via CSS livre.
   */
  _injectThemeCSS() {
    if (typeof document === 'undefined') return;
    let tag = document.getElementById('editor-theme-css');
    const css = generateThemeCss(this.customizations.getTheme());
    if (!css) { if (tag) tag.textContent = ''; return; }
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'editor-theme-css';
      const customTag = document.getElementById('editor-custom-css');
      if (customTag) document.head.insertBefore(tag, customTag);
      else document.head.appendChild(tag);
    }
    tag.textContent = css;
  }

  getTheme()                  { return this.customizations.getTheme(); }
  setThemeColor(name, value)  { return this.customizations.setThemeColor(name, value); }
  setTheme(map)               { return this.customizations.setTheme(map); }
  resetTheme()                { return this.customizations.resetTheme(); }

  /**
   * CSS standalone do tema de cores, pronto para salvar como arquivo e incluir
   * DEPOIS do Bootstrap no site do usuário. Vazio se não há cores alteradas.
   */
  exportThemeCSS()            { return generateThemeCss(this.customizations.getTheme()); }

  /* ---------- Web fonts (Google Fonts) ---------- */

  /**
   * Reconcilia `<link rel="stylesheet" data-editor-font-link>` no document.head
   * com a lista atual de URLs derivadas das fontes registradas. Permite que a
   * fonte apareça imediatamente no canvas (preview ao vivo).
   */
  _injectFontLinks() {
    if (typeof document === 'undefined') return;
    const urls = this.customizations.listFontUrls();
    const existing = new Map();
    for (const link of document.head.querySelectorAll('link[data-editor-font-link]')) {
      existing.set(link.getAttribute('href') || '', link);
    }
    // Remove órfãos
    const wanted = new Set(urls);
    for (const [href, link] of existing) {
      if (!wanted.has(href)) link.remove();
    }
    // Adiciona faltantes (preserva preconnects criados na 1ª chamada)
    const needsPreconnect = urls.length > 0 && !document.head.querySelector('link[data-editor-font-link="preconnect"]');
    if (needsPreconnect) {
      const pre1 = document.createElement('link');
      pre1.rel = 'preconnect';
      pre1.href = 'https://fonts.googleapis.com';
      pre1.setAttribute('data-editor-font-link', 'preconnect');
      document.head.appendChild(pre1);
      const pre2 = document.createElement('link');
      pre2.rel = 'preconnect';
      pre2.href = 'https://fonts.gstatic.com';
      pre2.crossOrigin = '';
      pre2.setAttribute('data-editor-font-link', 'preconnect');
      document.head.appendChild(pre2);
    }
    for (const href of urls) {
      if (existing.has(href)) continue;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-editor-font-link', 'stylesheet');
      document.head.appendChild(link);
    }
    // Remove preconnect se não há mais nenhuma URL.
    if (urls.length === 0) {
      for (const pre of document.head.querySelectorAll('link[data-editor-font-link="preconnect"]')) {
        pre.remove();
      }
    }
  }

  /**
   * Retorna as tags `<link>` necessárias para carregar todas as web fonts
   * registradas, prontas para colar no `<head>` de um template Django. Vazio
   * quando nenhuma fonte tem `googleUrl`.
   */
  exportFontLinks() {
    const urls = this.customizations.listFontUrls();
    if (urls.length === 0) return '';
    const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const lines = [
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    ];
    for (const u of urls) lines.push(`<link rel="stylesheet" href="${escAttr(u)}">`);
    return lines.join('\n');
  }

  /* ---------- Custom blocks (snippets) ---------- */

  _registerCustomSnippets() {
    // Remove tipos antigos não presentes na lista atual.
    const current = new Set(this.customizations.listBlocks().map((b) => b.type));
    for (const type of [...this._customSnippetTypes]) {
      if (!current.has(type)) {
        this.registry.unregister(type);
        this._customSnippetTypes.delete(type);
      }
    }
    // Registra/atualiza presentes.
    for (const meta of this.customizations.listBlocks()) {
      const Klass = createCustomSnippetBlockClass(meta);
      this.registry.register(Klass);
      this._customSnippetTypes.add(meta.type);
    }
  }

  addCustomBlock(meta)            { return this.customizations.addBlock(meta); }
  updateCustomBlock(id, patch)    { return this.customizations.updateBlock(id, patch); }
  removeCustomBlock(id)           { return this.customizations.removeBlock(id); }
  listCustomBlocks()              { return this.customizations.listBlocks(); }

  /* ---------- Componentes (master sincronizado) ---------- */

  _registerComponents() {
    // Remove tipos antigos não presentes na lista atual.
    const current = new Set(this.customizations.listComponents().map((c) => c.type));
    for (const type of [...this._componentTypes]) {
      if (!current.has(type)) {
        this.registry.unregister(type);
        this._componentTypes.delete(type);
      }
    }
    // Registra/atualiza presentes.
    for (const meta of this.customizations.listComponents()) {
      const Klass = createComponentBlockClass(meta);
      this.registry.register(Klass);
      this._componentTypes.add(meta.type);
    }
    // Notifica o Renderer pra re-render: tipos podem ter sumido OU a árvore
    // do master mudou. Forçamos um replace event que faz full re-render.
    if (this.state) {
      this.bus.emit('state:changed', { type: 'replace', id: State.ROOT_ID });
    }
  }

  /**
   * Cria um componente a partir de uma subárvore (clona, strip de IDs).
   * Retorna meta do componente criado.
   */
  addComponent(meta)            { return this.customizations.addComponent(meta); }
  updateComponent(id, patch)    { return this.customizations.updateComponent(id, patch); }
  removeComponent(id)           { return this.customizations.removeComponent(id); }
  listComponents()              { return this.customizations.listComponents(); }
  getComponent(id)              { return this.customizations.getComponent(id); }

  /**
   * Salva um nó da árvore como componente reutilizável e o substitui in-place
   * por uma instância do recém-criado. O fluxo equivale a:
   *   1. Clonar nó+descendentes
   *   2. Adicionar como componente
   *   3. Trocar o nó original por uma instância do componente
   */
  saveAsComponent(nodeId, name, icon = 'box-seam') {
    const node = this.getNode(nodeId);
    if (!node) return null;
    const tree = JSON.parse(JSON.stringify(node));
    const meta = this.addComponent({ name, icon, tree });
    if (!meta) return null;
    // Substitui o original por uma instância
    const parent = this.getParentOf(nodeId);
    if (!parent) return meta;
    const idx = parent.children.findIndex((c) => c.id === nodeId);
    this.removeBlock(nodeId);
    this.insertComponent(meta.id, parent.id, idx);
    return meta;
  }

  /** Insere uma instância de componente. */
  insertComponent(componentId, parentId, index) {
    const meta = this.customizations.getComponent(componentId);
    if (!meta) return null;
    const data = {
      type: meta.type,
      props: {},
      classes: ['editor-component-instance'],
      attrs: {},
    };
    return this.history.execute(
      new AddNodeCommand(this.state, parentId ?? this.rootId, data, index)
    );
  }

  /**
   * Substitui uma instância pela cópia profunda do master (com IDs novos).
   * Após detach a árvore vira normal e perde o vínculo com o master.
   */
  detachComponentInstance(instanceId) {
    const node = this.getNode(instanceId);
    if (!node) return false;
    const meta = node.type.startsWith('component:')
      ? this.customizations.listComponents().find((c) => c.type === node.type)
      : null;
    if (!meta?.tree) return false;
    const parent = this.getParentOf(instanceId);
    if (!parent) return false;
    const idx = parent.children.findIndex((c) => c.id === instanceId);
    // Clone master sem IDs (createNode regera).
    const clone = JSON.parse(JSON.stringify(meta.tree));
    this.removeBlock(instanceId);
    return this.history.execute(
      new AddNodeCommand(this.state, parent.id, clone, idx)
    );
  }

  /**
   * Modo de edição de componente — análogo a templates. Carrega a master
   * no canvas, marca `editingComponentId`, banner aparece em cima.
   */
  loadComponentForEdit(componentId) {
    const meta = this.customizations.getComponent(componentId);
    if (!meta) return false;
    // Substitui canvas pela master tree.
    const data = {
      type: 'root',
      props: {}, classes: [], attrs: {},
      children: [JSON.parse(JSON.stringify(meta.tree))],
    };
    this.loadJSON(data);
    this.editingComponentId = componentId;
    this.bus.emit('component-edit:started', { id: componentId, name: meta.name });
    return true;
  }

  commitComponentEdit() {
    if (!this.editingComponentId) return false;
    const id = this.editingComponentId;
    const root = this.getRoot();
    if (!root.children?.length) return false;
    // Pega o primeiro filho como master. Se houver mais que 1, ignora os
    // demais (a UI alerta antes de commit).
    const tree = JSON.parse(JSON.stringify(root.children[0]));
    this.customizations.updateComponent(id, { tree });
    this.editingComponentId = null;
    this.bus.emit('component-edit:ended', { id, committed: true });
    return true;
  }

  cancelComponentEdit() {
    if (!this.editingComponentId) return false;
    const id = this.editingComponentId;
    this.editingComponentId = null;
    this.bus.emit('component-edit:ended', { id, committed: false });
    return true;
  }

  /**
   * Propaga o HTML atualizado do snippet para todas as instâncias já
   * inseridas no canvas (sai do fork-on-insert por opt-in).
   *
   * @param {string} customBlockId — id do snippet em customizations.
   * @returns {number} quantas instâncias foram atualizadas.
   */
  propagateCustomBlockUpdate(customBlockId) {
    const meta = this.customizations.getBlock(customBlockId);
    if (!meta) return 0;
    const html = meta.html;
    let count = 0;
    const walk = (node) => {
      if (node.type === meta.type) {
        // updateBlock passa pelo histórico (undo possível); cada instância
        // vira um Command próprio. Acceptable trade-off para ergonomia.
        this.updateBlock(node.id, { props: { html } });
        count++;
      }
      for (const c of node.children ?? []) walk(c);
    };
    for (const c of this.getRoot().children) walk(c);
    return count;
  }

  /* ---------- Templates ---------- */

  /**
   * Salva o nó (e descendentes) como template reutilizável (template de bloco).
   * Strip de IDs é feito pelo store; ao inserir, createNode regera tudo.
   */
  saveAsTemplate(nodeId, name, icon = 'bookmark') {
    const node = this.getNode(nodeId);
    if (!node) return null;
    const tree = JSON.parse(JSON.stringify(node));
    return this.customizations.addTemplate({ name, icon, tree });
  }

  /**
   * Salva a página inteira (todos os filhos top-level do root) como template
   * de página. Ao inserir, todos os nós são adicionados em sequência.
   * Retorna null se a página estiver vazia.
   */
  savePageAsTemplate(name, icon = 'file-earmark-richtext') {
    const root = this.getRoot();
    if (!root.children?.length) return null;
    const nodes = root.children.map((c) => JSON.parse(JSON.stringify(c)));
    return this.customizations.addTemplate({ name, icon, nodes });
  }

  /**
   * Insere um template como filho do nó alvo (ou root se nenhum).
   * - Template de bloco: 1 AddNodeCommand → retorna o id criado.
   * - Template de página: N AddNodeCommands em sequência (cada nó top-level)
   *   → retorna array de ids criados.
   */
  insertTemplate(templateId, parentId, index) {
    const tpl = this.getTemplate(templateId);
    if (!tpl) return null;
    const target = parentId ?? this.rootId;

    if (tpl.kind === 'page' || Array.isArray(tpl.nodes)) {
      const ids = [];
      let i = index;
      for (const node of tpl.nodes ?? []) {
        const id = this.history.execute(
          new AddNodeCommand(this.state, target, node, i)
        );
        if (id) {
          ids.push(id);
          if (typeof i === 'number') i += 1;
        }
      }
      return ids;
    }

    return this.history.execute(
      new AddNodeCommand(this.state, target, tpl.tree, index)
    );
  }

  /**
   * Importa conteúdo (HTML ou Markdown) e insere na página.
   *
   * @param {object} opts
   * @param {'html'|'markdown'} opts.format
   * @param {string} opts.source — conteúdo cru a importar
   * @param {'replace'|'append'} [opts.mode='append'] — substituir tudo ou
   *   anexar ao final do root.
   * @returns {{ count: number, ids: string[] }}
   */
  /**
   * @deprecated Use `importContent({ format: 'html', source: html, mode })`.
   * Mantido como atalho para integrações antigas (CKEditor → editor novo).
   */
  importHTML(html, mode = 'append') {
    console.warn(
      '[Editor] importHTML() está deprecated. ' +
      'Use importContent({ format: "html", source, mode }).'
    );
    return this.importContent({ format: 'html', source: html, mode });
  }

  importContent({ format, source, mode = 'append', diff = false }) {
    let html = source;
    if (format === 'markdown') html = markdownToHtml(source);

    // Reconciliação (modo HTML "editar e aplicar"): em replace, casa os blocos
    // inalterados com os nós atuais por posição + igualdade textual, em vez de
    // reconstruir tudo (que rebaixaria blocos compostos ao fallback `html`).
    if (mode === 'replace' && diff) {
      return this._reconcileReplaceHtml(html);
    }

    const descriptors = htmlToBlocks(html, this.sanitizer);
    if (!descriptors.length) return { count: 0, ids: [] };

    // Constrói cada subtree completa para inserir como UM AddNodeCommand
    // (preserva schema defaults de classes/attrs por tipo).
    const nodes = descriptors.map((d) => this._buildImportNode(d)).filter(Boolean);
    if (!nodes.length) return { count: 0, ids: [] };

    if (mode === 'replace') {
      this.loadJSON({
        type: 'root', props: {}, classes: [], attrs: {}, children: nodes,
      });
      return { count: nodes.length, ids: this.getRoot().children.map((c) => c.id) };
    }

    // append: insere um por um no fim do root.
    const ids = [];
    for (const data of nodes) {
      const id = this.history.execute(new AddNodeCommand(this.state, this.rootId, data));
      if (id) ids.push(id);
    }
    return { count: ids.length, ids };
  }

  /**
   * Constrói um nó (com children recursivos) mesclando o schema do BlockClass.
   * Usado pelo importer — preserva classes/attrs default por tipo.
   */
  _buildImportNode(desc) {
    if (!desc?.type) return null;
    const BlockClass = this.registry.get(desc.type);
    if (!BlockClass) return null;
    const schema = BlockClass.schema ?? {};
    return {
      type: desc.type,
      props:   { ...(schema.props ?? {}),   ...(desc.props ?? {}) },
      classes: desc.classes ?? [...(schema.classes ?? [])],
      attrs:   { ...(schema.attrs ?? {}),   ...(desc.attrs ?? {}) },
      children: (desc.children ?? [])
        .map((c) => this._buildImportNode(c))
        .filter(Boolean),
    };
  }

  /**
   * Reconciliação HTML→árvore para o modo "editar HTML" (replace com diff).
   *
   * Em vez de reconstruir tudo — o que rebaixaria blocos compostos (Tabs,
   * Acordeão, Carousel) ao fallback `html` e perderia seus ids/props —,
   * comparamos os elementos de topo do HTML editado contra o HTML exportado
   * dos nós atuais, por POSIÇÃO + IGUALDADE TEXTUAL (LCS sobre a forma
   * canônica produzida por formatHTML). Blocos inalterados reaproveitam o nó
   * original (mesmo id, subtree e fidelidade); blocos novos ou alterados são
   * reimportados pelo importer lossless (htmlToBlocks + _buildImportNode).
   */
  _reconcileReplaceHtml(html) {
    const oldNodes = this.getRoot().children;
    const oldKeys = oldNodes.map((n) => this._nodeCanonicalHtml(n));

    const doc = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
    const newEls = Array.from(doc.body.children);
    const newKeys = newEls.map((el) => formatHTML(el.outerHTML));

    const matches = lcsPairs(oldKeys, newKeys); // novoÍndice → velhoÍndice

    const children = [];
    newEls.forEach((el, j) => {
      if (matches.has(j)) {
        // Inalterado — reaproveita o nó original (preserva id/estrutura).
        children.push(JSON.parse(JSON.stringify(oldNodes[matches.get(j)])));
        return;
      }
      // Novo/alterado — reimporta via importer lossless.
      const descriptors = htmlToBlocks(el.outerHTML, this.sanitizer);
      for (const d of descriptors) {
        const node = this._buildImportNode(d);
        if (node) children.push(node);
      }
    });

    this.loadJSON({
      type: 'root', props: this.getRoot().props, classes: [], attrs: {}, children,
    });
    return { count: children.length, ids: this.getRoot().children.map((c) => c.id) };
  }

  /** Forma canônica (formatHTML) do HTML limpo exportado de um nó de topo. */
  _nodeCanonicalHtml(node) {
    const el = this._nodeToHtml(node);
    this._stripEditorAttrs(el);
    return formatHTML(el.outerHTML);
  }

  /**
   * Substitui a página atual pelo conteúdo de um template de página.
   * Usado pelo botão "Substituir página" — limpa o root e insere os nós.
   */
  replacePageWithTemplate(templateId) {
    const tpl = this.getTemplate(templateId);
    if (!tpl) return null;
    const nodes = tpl.kind === 'page'
      ? (tpl.nodes ?? [])
      : tpl.tree ? [tpl.tree] : [];
    if (!nodes.length) return null;
    const data = {
      type: 'root',
      props: {},
      classes: [],
      attrs: {},
      children: nodes,
    };
    this.loadJSON(data);
    return true;
  }

  removeTemplate(id) {
    if (getBuiltInTemplate(id)) return false;
    return this.customizations.removeTemplate(id);
  }
  updateTemplate(id, patch) {
    if (getBuiltInTemplate(id)) return null;
    return this.customizations.updateTemplate(id, patch);
  }
  listTemplates() {
    return [...BUILT_IN_TEMPLATES, ...this.customizations.listTemplates()];
  }
  getTemplate(id) {
    return getBuiltInTemplate(id) ?? this.customizations.getTemplate(id);
  }

  /**
   * Modo de edição de template: carrega o template no canvas e marca o id em
   * `editingTemplateId`. O usuário edita normalmente; ao terminar, chama
   * `commitTemplateEdit()` para persistir o root atual no template, OU
   * `cancelTemplateEdit()` para sair do modo (canvas mantém o conteúdo).
   *
   * Eventos:
   *   - template-edit:started → { id, name }
   *   - template-edit:ended   → { id, committed: bool }
   */
  loadTemplateForEdit(templateId) {
    const tpl = this.customizations.getTemplate(templateId);
    if (!tpl) return false;
    if (!this.replacePageWithTemplate(templateId)) return false;
    this.editingTemplateId = templateId;
    this.bus.emit('template-edit:started', { id: templateId, name: tpl.name });
    return true;
  }

  commitTemplateEdit() {
    if (!this.editingTemplateId) return false;
    const id = this.editingTemplateId;
    const tpl = this.customizations.getTemplate(id);
    if (!tpl) return false;
    const root = this.getRoot();
    const nodes = root.children.map((c) => JSON.parse(JSON.stringify(c)));
    // Preserva o tipo do template original: page sempre vira page; block só
    // continua block se a árvore atual tiver exatamente 1 filho.
    if (tpl.kind === 'block' && nodes.length === 1) {
      this.customizations.updateTemplate(id, { tree: nodes[0] });
    } else {
      this.customizations.updateTemplate(id, { nodes });
    }
    this.editingTemplateId = null;
    this.bus.emit('template-edit:ended', { id, committed: true });
    return true;
  }

  cancelTemplateEdit() {
    if (!this.editingTemplateId) return false;
    const id = this.editingTemplateId;
    this.editingTemplateId = null;
    this.bus.emit('template-edit:ended', { id, committed: false });
    return true;
  }

  /* ---------- Tema (paleta / gradientes / fontes) ---------- */

  addPaletteColor(meta)         { return this.customizations.addPaletteColor(meta); }
  updatePaletteColor(id, patch) { return this.customizations.updatePaletteColor(id, patch); }
  removePaletteColor(id)        { return this.customizations.removePaletteColor(id); }
  listPalette()                 { return this.customizations.listPalette(); }

  addGradient(meta)         { return this.customizations.addGradient(meta); }
  updateGradient(id, patch) { return this.customizations.updateGradient(id, patch); }
  removeGradient(id)        { return this.customizations.removeGradient(id); }
  listGradients()           { return this.customizations.listGradients(); }

  addFont(meta)         { return this.customizations.addFont(meta); }
  updateFont(id, patch) { return this.customizations.updateFont(id, patch); }
  removeFont(id)        { return this.customizations.removeFont(id); }
  listFonts()           { return this.customizations.listFonts(); }

  /* ---------- Export / Import customizações ---------- */

  exportCustomizations()       { return this.customizations.exportAll(); }
  importCustomizations(payload, opts) { return this.customizations.importAll(payload, opts); }

  /* ---------- API pública: leitura ---------- */

  get rootId() { return State.ROOT_ID; }

  getNode(id)      { return this.state.getNode(id); }
  getParentOf(id)  { return this.state.getParent(id); }
  getRoot()        { return this.state.getRoot(); }

  /* ---------- API pública: mutação (passa pelo histórico) ---------- */

  /**
   * Cria um bloco do tipo informado, aplicando o schema padrão registrado
   * (props, classes e attrs) e mesclando overrides do usuário.
   */
  addBlock(parentId, type, props = {}, index) {
    const BlockClass = this.registry.get(type);
    if (!BlockClass) {
      console.warn(`[Editor] addBlock: tipo "${type}" não registrado.`);
      return null;
    }
    const schema = BlockClass.schema ?? {};
    const data = {
      type,
      props:   { ...(schema.props ?? {}),   ...props },
      classes: [...(schema.classes ?? [])],
      attrs:   { ...(schema.attrs ?? {}) },
    };
    return this.history.execute(new AddNodeCommand(this.state, parentId, data, index));
  }

  removeBlock(id) {
    if (this.isLocked(id)) { this._lockedToast(); return; }
    this.history.execute(new RemoveNodeCommand(this.state, id));
  }

  /* ---------- Block locking ---------- */

  /** Retorna true se o bloco está travado (somente leitura). */
  isLocked(id) {
    const n = this.getNode(id);
    return !!n?.attrs?.['data-locked'];
  }

  /** Alterna o estado de travado do bloco. */
  toggleLock(id) {
    const n = this.getNode(id);
    if (!n) return;
    const next = this.isLocked(id) ? undefined : '1';
    this.updateBlock(id, { attrs: { 'data-locked': next } });
  }

  _lockedToast() {
    this.notify?.toast?.(t('lock.toast'), 'warning');
  }

  /**
   * Atualiza um bloco. `opts.coalesceKey` permite coalescer comandos
   * consecutivos (ex.: digitação no input do painel).
   */
  updateBlock(id, patch, opts = {}) {
    this.history.execute(new UpdateNodeCommand(this.state, id, patch), opts);
  }

  moveBlock(id, newParentId, index) {
    if (this.isLocked(id)) { this._lockedToast(); return; }
    this.history.execute(new MoveNodeCommand(this.state, id, newParentId, index));
  }

  /** Duplica um bloco (cópia profunda; IDs novos) logo abaixo do original. */
  duplicateBlock(id) {
    const node = this.getNode(id);
    if (!node) return null;
    const parent = this.getParentOf(id);
    if (!parent) return null;
    const idx = parent.children.findIndex((c) => c.id === id);
    const clone = this._cloneForDuplicate(node);
    const newId = this.history.execute(
      new AddNodeCommand(this.state, parent.id, clone, idx + 1)
    );
    this.selectBlock(newId);
    return newId;
  }

  _cloneForDuplicate(node) {
    return {
      type: node.type,
      props: { ...node.props },
      classes: [...node.classes],
      attrs: { ...node.attrs },
      children: node.children.map((c) => this._cloneForDuplicate(c)),
    };
  }

  /* ---------- Clipboard interno (Ctrl+C / Ctrl+V) ---------- */

  copyBlock(id) {
    const node = this.getNode(id);
    if (!node) return false;
    this._clipboard = this._cloneForDuplicate(node);
    this._clipboardToken = generateId();
    this._writeSystemClipboard(node, this._clipboardToken);
    this.bus.emit('clipboard:changed', { type: node.type });
    return true;
  }

  /**
   * Espelha o bloco copiado na área de transferência do sistema (HTML + texto)
   * com um marcador. No Ctrl+V, se o marcador ainda estiver lá, colamos o
   * bloco interno (fidelidade total); se não, o usuário copiou outra coisa
   * depois — e colamos esse conteúdo externo.
   */
  _writeSystemClipboard(node, token) {
    let html = '';
    try {
      const el = this._nodeToHtml(node);
      this._stripEditorAttrs(el);
      html = el.outerHTML;
    } catch { /* bloco sem export — só o marcador */ }
    const onCopy = (e) => {
      e.preventDefault();
      e.clipboardData?.setData('text/html',
        `<meta name="wysiwyg-block" content="${token}">${html}`);
      e.clipboardData?.setData('text/plain', this._htmlToText(html));
    };
    document.addEventListener('copy', onCopy, { capture: true, once: true });
    try { document.execCommand('copy'); } catch { /* sem gesto do usuário */ }
    document.removeEventListener('copy', onCopy, { capture: true });
  }

  _htmlToText(html) {
    const d = new DOMParser().parseFromString(html || '', 'text/html');
    return (d.body.innerText ?? d.body.textContent ?? '').trim();
  }

  /**
   * Converte o conteúdo da área de transferência (HTML do Word/Docs/web,
   * Markdown ou texto puro) em nós prontos para inserir.
   * @returns {{ html: string, nodes: object[] }}
   */
  clipboardToNodes({ html = '', text = '' } = {}) {
    const clean = clipboardToHtml({ html, text });
    if (!clean) return { html: '', nodes: [] };
    const nodes = htmlToBlocks(clean, this.sanitizer, { richBlocks: true })
      .map((d) => this._buildImportNode(d))
      .filter(Boolean);
    return { html: clean, nodes };
  }

  /**
   * Insere `nodes` logo após `targetId` (mesmo pai) ou no fim da página, num
   * único passo de histórico. Com `replaceTarget`, o alvo é removido.
   * Seleciona o último bloco inserido.
   */
  insertNodesAt(targetId, nodes, { replaceTarget = false, extraCmds = [] } = {}) {
    if (!nodes.length) return [];
    let parentId = this.rootId;
    let index = this.getRoot().children.length;
    if (targetId) {
      const parent = this.getParentOf(targetId);
      if (parent) {
        parentId = parent.id;
        index = parent.children.findIndex((c) => c.id === targetId) + 1;
      }
    }
    const cmds = [...extraCmds];
    nodes.forEach((data, i) => {
      cmds.push(new AddNodeCommand(this.state, parentId, data, index + i));
    });
    if (replaceTarget && targetId) cmds.push(new RemoveNodeCommand(this.state, targetId));
    const results = this.history.execute(
      new BatchCommand(cmds, `Colar ${nodes.length} bloco(s)`));
    const ids = (Array.isArray(results) ? results : [])
      .filter((r) => typeof r === 'string' && this.getNode(r));
    if (ids.length) this.selectBlock(ids[ids.length - 1]);
    return ids;
  }

  /**
   * Ctrl+V fora de edição inline: bloco interno (se o marcador ainda está na
   * área de transferência) ou conteúdo externo convertido em blocos.
   * @returns {boolean} true se tratou o evento
   */
  handleClipboardPaste(cd) {
    const html = cd?.getData('text/html') ?? '';
    const text = cd?.getData('text/plain') ?? '';
    const target = this.getSelectedId();
    const marker = /<meta name="wysiwyg-block" content="([^"]+)"/.exec(html)?.[1];
    if (this._clipboard && (marker === this._clipboardToken || (!html && !text))) {
      this.pasteBlock(target);
      return true;
    }
    const { nodes } = this.clipboardToNodes({ html, text });
    if (!nodes.length) return false;
    this.insertNodesAt(target, nodes);
    return true;
  }

  pasteBlock(targetId) {
    if (!this._clipboard) return null;
    let parentId = this.rootId;
    let index;
    if (targetId) {
      const parent = this.getParentOf(targetId);
      if (parent) {
        parentId = parent.id;
        index = parent.children.findIndex((c) => c.id === targetId) + 1;
      }
    }
    const newId = this.history.execute(
      new AddNodeCommand(this.state, parentId, this._clipboard, index)
    );
    if (newId) this.selectBlock(newId);
    return newId;
  }

  hasClipboard() { return this._clipboard !== null; }

  /**
   * Reseta `node.classes` para o conjunto declarado em
   * `BlockClass.essentialClasses` (ou `schema.classes` por padrão).
   * Isso remove formatações Bootstrap aplicadas pelo usuário (alinhamento,
   * spacing, cores, etc) e mantém apenas o que define o bloco visualmente.
   */
  clearBlockClasses(id) {
    const node = this.getNode(id);
    if (!node) return false;
    const BlockClass = this.registry.get(node.type);
    const essential = BlockClass?.essentialClasses
      ?? BlockClass?.schema?.classes
      ?? [];
    this.updateBlock(id, { classes: [...essential] });
    return true;
  }

  /* ---------- API pública: seleção ---------- */

  selectBlock(id)  { this.selection.select(id); }
  deselectBlock()  { this.selection.clear(); }
  getSelectedId()  { return this.selection.get(); }
  /** Shift+click: adiciona/remove um bloco da seleção. */
  toggleBlockSelection(id) { this.selection.toggle(id); }
  /** Lista completa de blocos selecionados (multi-select). */
  getSelectedIds() { return this.selection.getAll(); }

  /* ---------- Operações em lote (multi-select) ---------- */

  /**
   * Remove vários blocos num único passo de histórico. Filtra ids que são
   * descendentes de outros ids da lista (o ancestral já os remove).
   */
  removeBlocks(ids) {
    let targets = this._topLevelOnly(ids);
    const locked = targets.filter((id) => this.isLocked(id));
    if (locked.length) {
      this._lockedToast();
      targets = targets.filter((id) => !this.isLocked(id));
    }
    if (targets.length === 0) return;
    if (targets.length === 1) { this.removeBlock(targets[0]); return; }
    const cmds = targets.map((id) => new RemoveNodeCommand(this.state, id));
    this.history.execute(new BatchCommand(cmds, `Remover ${targets.length} blocos`));
  }

  /** Duplica vários blocos num único passo de histórico. */
  duplicateBlocks(ids) {
    const targets = this._topLevelOnly(ids);
    if (targets.length === 0) return;
    if (targets.length === 1) { this.duplicateBlock(targets[0]); return; }
    const cmds = [];
    for (const id of targets) {
      const node = this.getNode(id);
      const parent = this.getParentOf(id);
      if (!node || !parent) continue;
      const idx = parent.children.findIndex((c) => c.id === id);
      cmds.push(new AddNodeCommand(
        this.state, parent.id, this._cloneForDuplicate(node), idx + 1));
    }
    if (cmds.length === 0) return;
    const newIds = this.history.execute(
      new BatchCommand(cmds, `Duplicar ${cmds.length} blocos`));
    if (Array.isArray(newIds)) this.selection.set(newIds);
  }

  /**
   * Dado um conjunto de ids, descarta os que são descendentes de outro id
   * da própria lista (evita remover/duplicar duas vezes).
   */
  _topLevelOnly(ids) {
    const set = new Set(ids);
    return ids.filter((id) => {
      let p = this.getParentOf(id);
      while (p) {
        if (set.has(p.id)) return false;
        p = this.getParentOf(p.id);
      }
      return true;
    });
  }

  /* ---------- API pública: histórico ---------- */

  undo()      { return this.history.undo(); }
  redo()      { return this.history.redo(); }
  canUndo()   { return this.history.canUndo(); }
  canRedo()   { return this.history.canRedo(); }

  /* ---------- API pública: persistência ---------- */

  /* ---------- Breakpoint ativo (responsividade) ---------- */

  setBreakpoint(bp) {
    if (this.activeBreakpoint === bp) return;
    this.activeBreakpoint = bp;
    this.bus.emit('breakpoint:changed', { bp });
  }

  /* ---------- Edição inline ---------- */

  /**
   * Ativa contenteditable no elemento DOM do bloco para editar uma prop.
   * Commit no blur ou Enter; cancel no Esc.
   */
  /**
   * @param {string|object} target — propKey (string) OU
   *   { element, read(node), write(node, value)→patch } para edição custom (ex.: célula de tabela).
   */
  startInlineEdit(id, target, opts = {}) {
    if (this.isLocked(id)) { this._lockedToast(); return; }
    if (this.inlineEdit) this.commitInlineEdit();
    const node = this.getNode(id);
    if (!node) return;

    const propKey = typeof target === 'string' ? target : null;
    // Normaliza: string vira target padrão (prop do nó, elemento = root do bloco)
    if (typeof target === 'string') {
      const propKey = target;
      target = {
        element: this.renderer?.nodeElements.get(id),
        read:  (n) => n.props[propKey] ?? '',
        write: (_, v) => ({ props: { [propKey]: v } }),
      };
    }
    const element = target.element;
    if (!element) return;

    // Flags do target customizado têm precedência sobre opts: o target sabe
    // mais sobre como o conteúdo deve ser tratado (ex.: conteúdo de tab é
    // rich-text full mesmo se o bloco-pai não declarou editableHtml).
    const multiline = (target.multiline ?? opts.multiline) === true;
    const useHtml   = (target.html ?? opts.html) === true;
    const sanitizeProfile = target.sanitizeProfile ?? opts.sanitizeProfile;
    const originalValue = useHtml
      ? (target.read(node) || '')
      : target.read(node);

    // Captura a seleção atual ANTES de qualquer mutação no DOM — o
    // duplo-clique do browser já selecionou a palavra-alvo nesse ponto.
    // Guardamos offsets em caracteres do textContent porque a reescrita de
    // innerHTML logo abaixo invalida os nós da Range original.
    const sel = document.getSelection();
    let savedOffsets = null;
    if (sel?.rangeCount) {
      const r = sel.getRangeAt(0);
      if (element.contains(r.startContainer) && element.contains(r.endContainer) && !r.collapsed) {
        savedOffsets = {
          start: this._textOffsetWithin(element, r.startContainer, r.startOffset),
          end:   this._textOffsetWithin(element, r.endContainer,   r.endOffset),
        };
      }
    }

    // Em modo HTML, garante que o conteúdo do elemento espelha props.text:
    // sem isso, o usuário pode estar vendo um render legado (textContent)
    // e perder a formatação ao editar.
    if (useHtml && this.sanitizer.isReady()) {
      const sanitized = this.sanitizer.html(originalValue, sanitizeProfile);
      if (element.innerHTML !== sanitized) element.innerHTML = sanitized;
    }

    element.contentEditable = 'true';
    element.dataset.editing = 'true';
    element.spellcheck = true;

    element.focus();
    const restored = savedOffsets && this._restoreSelectionFromOffsets(
      element, savedOffsets.start, savedOffsets.end
    );
    if (!restored) {
      // Sem seleção significativa: posiciona caret no fim.
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.cancelInlineEdit(); }
      else if (e.key === 'Enter' && !e.shiftKey && !multiline) {
        e.preventDefault(); this.commitInlineEdit();
      }
    };
    const onBlur = () => this.commitInlineEdit();
    const onPaste = (e) => {
      e.preventDefault();
      const cd = e.clipboardData || globalThis.clipboardData;
      const html = cd?.getData('text/html') ?? '';
      const text = cd?.getData('text/plain') ?? '';
      if (!html && !text) return;
      this._pasteIntoInlineEdit({ html, text });
    };
    element.addEventListener('keydown', onKeyDown);
    element.addEventListener('blur', onBlur);
    element.addEventListener('paste', onPaste);

    this.inlineEdit = {
      id, target, originalValue, el: element, useHtml, sanitizeProfile, multiline,
      propKey,
      cleanup: () => {
        element.removeEventListener('keydown', onKeyDown);
        element.removeEventListener('blur', onBlur);
        element.removeEventListener('paste', onPaste);
      },
    };
    this.bus.emit('inline-edit:started', { id, useHtml });
  }

  commitInlineEdit() {
    if (!this.inlineEdit) return;
    const { id, target, originalValue, el, cleanup, useHtml, sanitizeProfile } = this.inlineEdit;
    let newValue = useHtml ? el.innerHTML : el.textContent;
    if (useHtml && this.sanitizer.isReady()) {
      newValue = this.sanitizer.html(newValue, sanitizeProfile);
    }
    cleanup();
    el.contentEditable = 'false';
    delete el.dataset.editing;
    this.inlineEdit = null;
    this.bus.emit('inline-edit:ended', { id });
    if (newValue !== originalValue) {
      const node = this.getNode(id);
      if (node) {
        const patch = target.write(node, newValue);
        if (patch) this.updateBlock(id, patch);
      }
    }
  }

  cancelInlineEdit() {
    if (!this.inlineEdit) return;
    const { el, originalValue, cleanup, useHtml } = this.inlineEdit;
    if (useHtml) el.innerHTML = originalValue;
    else         el.textContent = originalValue;
    cleanup();
    el.contentEditable = 'false';
    delete el.dataset.editing;
    this.inlineEdit = null;
    this.bus.emit('inline-edit:ended', { canceled: true });
  }

  /**
   * Colagem durante a edição inline. Conteúdo com vários blocos (ou um
   * título/lista/tabela) colado num parágrafo/título/citação divide o bloco
   * no cursor e insere os blocos convertidos entre as duas metades. Conteúdo
   * de um parágrafo só entra inline, preservando negrito/itálico/links quando
   * o bloco é rich-text. Demais alvos (código, células) recebem texto puro.
   */
  _pasteIntoInlineEdit({ html, text }) {
    const ie = this.inlineEdit;
    if (!ie) return;
    const { id, el, useHtml, sanitizeProfile, propKey } = ie;
    const s = document.getSelection();
    if (!s?.rangeCount) return;
    const r = s.getRangeAt(0);
    if (!el.contains(r.commonAncestorContainer)) return;
    const node = this.getNode(id);

    const insertFragment = (frag) => {
      const last = frag.lastChild;
      r.deleteContents();
      r.insertNode(frag);
      if (last) r.setStartAfter(last);
      r.collapse(true);
      s.removeAllRanges();
      s.addRange(r);
    };
    const insertPlain = () => {
      const frag = document.createDocumentFragment();
      if (useHtml) {
        // Preserva quebras de linha como <br> no contenteditable.
        text.split(/\r?\n/).forEach((line, i) => {
          if (i > 0) frag.appendChild(document.createElement('br'));
          if (line) frag.appendChild(document.createTextNode(line));
        });
      } else {
        frag.appendChild(document.createTextNode(text));
      }
      insertFragment(frag);
    };
    const insertHtml = (raw) => {
      const tpl = document.createElement('template');
      tpl.innerHTML = this.sanitizer.isReady()
        ? this.sanitizer.html(raw, sanitizeProfile) : raw;
      insertFragment(tpl.content);
    };

    // Código e afins: sempre texto literal.
    const splittable = !!propKey && !!this.getParentOf(id)
      && ['paragraph', 'heading', 'blockquote'].includes(node?.type);
    if (!useHtml && !splittable) { insertPlain(); return; }

    const { html: clean, nodes } = this.clipboardToNodes({ html, text });
    if (!nodes.length) { if (text) insertPlain(); return; }

    const single = nodes.length === 1 && nodes[0].type === 'paragraph';
    if (single || !splittable) {
      if (!useHtml) { insertPlain(); return; }
      insertHtml(single ? nodes[0].props.text : clean);
      return;
    }

    // Divide o bloco no cursor: [antes] + blocos colados + [depois].
    const sliceValue = (range) => {
      const div = document.createElement('div');
      div.appendChild(range.cloneContents());
      if (!useHtml) return div.textContent;
      return this.sanitizer.isReady()
        ? this.sanitizer.html(div.innerHTML, sanitizeProfile) : div.innerHTML;
    };
    const isEmpty = (v) => !String(v)
      .replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/g, ' ').trim();
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(r.startContainer, r.startOffset);
    const after = document.createRange();
    after.selectNodeContents(el);
    after.setStart(r.endContainer, r.endOffset);
    const beforeVal = sliceValue(before);
    const afterVal = sliceValue(after);

    // Encerra a edição sem commit — o lote abaixo grava tudo num passo só.
    ie.cleanup();
    el.contentEditable = 'false';
    delete el.dataset.editing;
    this.inlineEdit = null;
    this.bus.emit('inline-edit:ended', { id });

    const toInsert = [...nodes];
    if (!isEmpty(afterVal)) {
      const tail = this._cloneForDuplicate(node);
      tail.props[propKey] = afterVal;
      toInsert.push(tail);
    }
    const keepHead = !isEmpty(beforeVal);
    const extraCmds = keepHead && beforeVal !== ie.originalValue
      ? [new UpdateNodeCommand(this.state, id, { props: { [propKey]: beforeVal } })]
      : [];
    if (keepHead && !extraCmds.length) {
      // Conteúdo igual ao salvo: restaura o DOM (o cursor pode ter sujado).
      if (useHtml) el.innerHTML = beforeVal; else el.textContent = beforeVal;
    }
    this.insertNodesAt(id, toInsert, { replaceTarget: !keepHead, extraCmds });
  }

  /** Offset em caracteres do textContent de `root` até (node, offset). */
  _textOffsetWithin(root, node, offset) {
    const range = document.createRange();
    range.selectNodeContents(root);
    range.setEnd(node, offset);
    return range.toString().length;
  }

  /** Reconstrói uma Range a partir de offsets de textContent e a aplica. */
  _restoreSelectionFromOffsets(root, startOffset, endOffset) {
    const locate = (target) => {
      let pos = 0;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (pos + len >= target) return { node, offset: target - pos };
        pos += len;
      }
      return null;
    };
    const start = locate(startOffset);
    const end   = locate(endOffset);
    if (!start || !end) return false;
    const range = document.createRange();
    try {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
    } catch {
      return false;
    }
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return !range.collapsed;
  }

  exportJSON() {
    return this.state.serialize();
  }

  /**
   * Substitui o conteúdo da página pela árvore recebida. Tolera as variações
   * de forma descritas em `normalizeTreeData` — inclusive páginas cujos blocos
   * de topo são parágrafos/títulos/rows soltos, sem Section envolvendo.
   */
  loadJSON(data) {
    const tree = normalizeTreeData(data);
    if (!tree) {
      throw new Error('[Editor] loadJSON: conteúdo vazio ou em formato não reconhecido.');
    }
    this.state.replace(tree);
    this._migrateNodes();
    this._dirty = false;
  }

  /**
   * Migração one-shot de nós com schema legado. Chamada após loadJSON.
   * Atualmente: normaliza Carousel slides de `{src, alt, caption}` →
   * `{html, container}`. Roda silenciosamente (sem histórico).
   */
  _migrateNodes() {
    const walk = (node) => {
      if (!node) return;
      const B = this.registry.get(node.type);
      if (B && typeof B.migrateNode === 'function') {
        try {
          const patch = B.migrateNode(node);
          if (patch) Object.assign(node.props, patch.props || {});
        } catch (err) {
          console.warn(`[Editor] migrateNode falhou em ${node.type}:`, err);
        }
      }
      (node.children ?? []).forEach(walk);
    };
    walk(this.state.root);
  }

  /* ---------- Metadados SEO da página ---------- */

  /** Metadados SEO da página, guardados em `root.props.seo`. */
  getSeo() {
    return { ...DEFAULT_SEO, ...(this.getRoot().props.seo ?? {}) };
  }

  /**
   * Mescla `patch` no SEO da página. Não passa pelo histórico (metadado de
   * página, não de bloco) — mas marca dirty e agenda auto-save.
   */
  updateSeo(patch) {
    const root = this.getRoot();
    root.props.seo = { ...this.getSeo(), ...patch };
    this._dirty = true;
    this._scheduleAutoSave();
    this.bus.emit('seo:changed', { seo: root.props.seo });
    return root.props.seo;
  }

  /**
   * Gera o trecho de `<head>` (title + meta tags) a partir do SEO da página.
   * Pensado para colar no `<head>` do template Django. Só emite linhas dos
   * campos preenchidos. Twitter Cards derivam das tags Open Graph.
   */
  exportSeoHead() {
    const seo = this.getSeo();
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const lines = [];
    if (seo.title)       lines.push(`<title>${esc(seo.title)}</title>`);
    if (seo.description) lines.push(`<meta name="description" content="${esc(seo.description)}">`);
    if (seo.canonical)   lines.push(`<link rel="canonical" href="${esc(seo.canonical)}">`);
    if (seo.robots)      lines.push(`<meta name="robots" content="${esc(seo.robots)}">`);

    if (seo.title)       lines.push(`<meta property="og:title" content="${esc(seo.title)}">`);
    if (seo.description) lines.push(`<meta property="og:description" content="${esc(seo.description)}">`);
    if (seo.ogType)      lines.push(`<meta property="og:type" content="${esc(seo.ogType)}">`);
    if (seo.canonical)   lines.push(`<meta property="og:url" content="${esc(seo.canonical)}">`);
    if (seo.ogImage)     lines.push(`<meta property="og:image" content="${esc(seo.ogImage)}">`);

    const twCard = seo.ogImage ? 'summary_large_image' : 'summary';
    if (seo.title || seo.description || seo.ogImage) {
      lines.push(`<meta name="twitter:card" content="${twCard}">`);
    }
    if (seo.title)       lines.push(`<meta name="twitter:title" content="${esc(seo.title)}">`);
    if (seo.description) lines.push(`<meta name="twitter:description" content="${esc(seo.description)}">`);
    if (seo.ogImage)     lines.push(`<meta name="twitter:image" content="${esc(seo.ogImage)}">`);

    return lines.join('\n');
  }

  /* ---------- Comentários em blocos ---------- */

  /**
   * Comentários de revisão presos a blocos. Guardados em `root.props.comments`
   * (`{ [blockId]: Comment[] }`) — persistem no JSON salvo, NÃO vão para o HTML
   * exportado. Comment = `{ id, text, author, createdAt, resolved }`.
   *
   * Não passam pelo histórico (não são undo/redo de conteúdo) — só marcam
   * dirty e agendam auto-save, como o SEO. O autor vem da sessão colaborativa
   * (`collabName`) quando disponível.
   */
  getComments(blockId) {
    return this.getRoot().props.comments?.[blockId] ?? [];
  }

  /** Mapa completo `{ [blockId]: Comment[] }` — usado pela UI de marcadores. */
  getAllComments() {
    return this.getRoot().props.comments ?? {};
  }

  /** Quantidade de comentários de um bloco; `unresolvedOnly` ignora resolvidos. */
  getCommentCount(blockId, { unresolvedOnly = false } = {}) {
    const list = this.getComments(blockId);
    return unresolvedOnly ? list.filter((c) => !c.resolved).length : list.length;
  }

  addComment(blockId, text) {
    const clean = String(text ?? '').trim();
    if (!clean || !this.getNode(blockId)) return null;
    const root = this.getRoot();
    if (!root.props.comments) root.props.comments = {};
    if (!root.props.comments[blockId]) root.props.comments[blockId] = [];
    const comment = {
      id: generateId(),
      text: clean,
      author: this.collab?.name || 'Anônimo',
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    root.props.comments[blockId].push(comment);
    this._commentsChanged(blockId);
    return comment;
  }

  updateComment(blockId, commentId, patch) {
    const comment = this.getRoot().props.comments?.[blockId]
      ?.find((c) => c.id === commentId);
    if (!comment) return false;
    Object.assign(comment, patch);
    this._commentsChanged(blockId);
    return true;
  }

  removeComment(blockId, commentId) {
    const root = this.getRoot();
    const list = root.props.comments?.[blockId];
    if (!list) return false;
    const idx = list.findIndex((c) => c.id === commentId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    if (list.length === 0) delete root.props.comments[blockId];
    this._commentsChanged(blockId);
    return true;
  }

  _commentsChanged(blockId) {
    this._dirty = true;
    this._scheduleAutoSave();
    this.bus.emit('comments:changed', { blockId });
  }

  /** Descarta comentários de blocos que não existem mais na árvore. */
  _pruneComments() {
    const map = this.getRoot().props.comments;
    if (!map) return;
    let changed = false;
    for (const id of Object.keys(map)) {
      if (!this.getNode(id)) { delete map[id]; changed = true; }
    }
    if (changed) this.bus.emit('comments:changed', {});
  }

  /* ---------- Seleção de células de tabela (transiente) ---------- */

  /**
   * Seleção de range de células de uma tabela. `cellStr` = "r,c". Sem `extend`
   * define a âncora; com `extend` (Shift) move o foco. Não vai para a árvore —
   * é estado de UI lido pelas ações Mesclar/Separar do bloco Table.
   */
  selectTableCell(tableId, cellStr, extend = false) {
    const [r, c] = String(cellStr).split(',').map(Number);
    if (Number.isNaN(r) || Number.isNaN(c)) return;
    const sel = this.tableCellSelection;
    if (extend && sel && sel.tableId === tableId) {
      sel.focus = { r, c };
    } else {
      this.tableCellSelection = { tableId, anchor: { r, c }, focus: { r, c } };
    }
    this._paintTableCellSelection();
    this.bus.emit('table-cell-selection:changed', { selection: this.tableCellSelection });
  }

  clearTableCellSelection() {
    if (!this.tableCellSelection) return;
    this.tableCellSelection = null;
    this._paintTableCellSelection();
    this.bus.emit('table-cell-selection:changed', { selection: null });
  }

  /** Pinta `.is-cell-selected` nas células do retângulo selecionado. */
  _paintTableCellSelection() {
    for (const c of this.root.querySelectorAll('[data-cell].is-cell-selected')) {
      c.classList.remove('is-cell-selected');
    }
    const sel = this.tableCellSelection;
    if (!sel) return;
    const tableEl = this.root.querySelector(`[data-block-id="${sel.tableId}"]`);
    if (!tableEl) return;
    const rMin = Math.min(sel.anchor.r, sel.focus.r);
    const rMax = Math.max(sel.anchor.r, sel.focus.r);
    const cMin = Math.min(sel.anchor.c, sel.focus.c);
    const cMax = Math.max(sel.anchor.c, sel.focus.c);
    for (const cell of tableEl.querySelectorAll('[data-cell]')) {
      const [r, c] = cell.dataset.cell.split(',').map(Number);
      if (r >= rMin && r <= rMax && c >= cMin && c <= cMax) {
        cell.classList.add('is-cell-selected');
      }
    }
  }

  /**
   * Gera HTML limpo a partir da árvore. Sem `data-block-*`, sem outlines.
   * `opts.minify` colapsa whitespace entre tags.
   */
  exportHTML(opts = {}) {
    const root = this.getRoot();
    const parts = [];
    for (const child of root.children) {
      const el = this._nodeToHtml(child);
      this._stripEditorAttrs(el);
      parts.push(el.outerHTML);
    }
    let html = parts.join(opts.minify ? '' : '\n');
    if (opts.minify) {
      html = html.replace(/>\s+</g, '><').trim();
    }
    return html;
  }

  /**
   * Exporta um documento HTML completo (standalone) — pronto para abrir num
   * navegador ou hospedar como arquivo `.html`.
   *
   * Inclui no `<head>`: meta tags SEO (`exportSeoHead`), Bootstrap CSS+Icons
   * via CDN (opts.cdnBootstrap=true por padrão) e o CSS personalizado do
   * editor (`getCustomCSS`). No `<body>`, o HTML dos blocos.
   *
   * Não inclui Bootstrap JS — se a página usar componentes interativos
   * (Carousel, Tabs, Accordion), passe `opts.includeBootstrapJs = true`.
   */
  exportStandaloneHTML(opts = {}) {
    const {
      cdnBootstrap = true,
      includeBootstrapJs = false,
      minify = false,
    } = opts;
    const seo = this.getSeo();
    const head = [];
    head.push('<meta charset="UTF-8">');
    head.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    if (seo.title) head.push(`<title>${esc(seo.title)}</title>`);
    const seoHead = this.exportSeoHead();
    if (seoHead) head.push(seoHead);
    if (cdnBootstrap) {
      head.push('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">');
      head.push('<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css">');
    }
    const fontLinks = this.exportFontLinks();
    if (fontLinks) head.push(fontLinks);
    // Tema de cores do Bootstrap — depois do CDN do Bootstrap, antes do CSS livre.
    const themeCss = this.exportThemeCSS();
    if (themeCss) head.push(`<style>\n${themeCss}\n</style>`);
    const customCss = this.getCustomCSS();
    if (customCss) head.push(`<style>\n${customCss}\n</style>`);

    const body = this.exportHTML({ minify });
    const scripts = [];
    if (includeBootstrapJs) {
      scripts.push('<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>');
    }

    const lang = seo.lang || 'pt-BR';
    const doc =
`<!DOCTYPE html>
<html lang="${escAttr(lang)}">
<head>
${head.join('\n')}
</head>
<body>
${body}
${scripts.join('\n')}
</body>
</html>`;
    return minify
      ? doc.replace(/>\s+</g, '><').replace(/\n+/g, '').trim()
      : doc;
  }

  _nodeToHtml(node) {
    const BlockClass = this.registry.get(node.type);
    if (!BlockClass) {
      const fb = document.createElement('div');
      fb.textContent = `[${node.type}]`;
      return fb;
    }
    let element;
    try {
      element = BlockClass.render(node, { sanitizer: this.sanitizer });
    } catch (err) {
      console.error(`[Editor] exportHTML: erro em ${node.type}.render():`, err);
      element = document.createElement('div');
      element.textContent = `[render error: ${node.type}]`;
      return element;
    }
    for (const cls of node.classes) {
      if (cls) element.classList.add(cls);
    }
    for (const [k, v] of Object.entries(node.attrs)) {
      if (v == null) continue;
      if (k === 'style') {
        const prev = element.getAttribute('style') || '';
        const clean = safeCss(v);
        element.setAttribute('style', prev ? `${prev}; ${clean}` : clean);
      } else {
        element.setAttribute(k, String(v));
      }
    }
    if (node.children?.length) {
      const container = BlockClass.getChildrenContainer(element);
      for (const child of node.children) {
        container.appendChild(this._nodeToHtml(child));
      }
    }
    // Hook opcional de exportação — ex.: Repeater embrulha os filhos em {% for %}.
    BlockClass.decorateExport?.(node, element);
    return element;
  }

  /** Remove atributos visuais do editor (data-cell, data-block-*, data-editing). */
  _stripEditorAttrs(rootEl) {
    const ATTRS = ['data-block-id', 'data-block-type', 'data-editing', 'data-cell',
      'data-repeater-label', 'data-editor-warn', 'data-editor-hint', 'data-django-var',
      'data-locked'];
    const all = [rootEl, ...rootEl.querySelectorAll('*')];
    for (const el of all) {
      for (const attr of ATTRS) {
        if (el.hasAttribute?.(attr)) el.removeAttribute(attr);
      }
    }
  }

  /* ---------- Auto-save em localStorage ---------- */

  _wireAutoSave() {
    this.bus.on('state:changed', () => {
      this._dirty = true;
      this._scheduleAutoSave();
    });
    if (typeof window !== 'undefined') {
      // Guarda a referência para remover em destroy() — sem isto o handler fica
      // órfão no window e acumula a cada instância criada/destruída numa SPA.
      this._beforeUnload = (e) => {
        if (!this._dirty) return;
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', this._beforeUnload);
    }
  }

  _scheduleAutoSave() {
    if (typeof localStorage === 'undefined') return;
    if (!this.config.autoSaveKey) return;
    clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      try {
        const payload = {
          editorVersion: VERSION,
          schemaVersion: SCHEMA_VERSION,
          savedAt: new Date().toISOString(),
          data: this.exportJSON(),
        };
        localStorage.setItem(this.config.autoSaveKey, JSON.stringify(payload));
        this.bus.emit('autosave:saved', payload);
      } catch (err) {
        console.error('[Editor] auto-save falhou:', err);
      }
    }, this.config.autoSaveDebounce);
  }

  hasAutoSave() {
    if (!this.config.autoSaveKey) return false;
    try { return localStorage.getItem(this.config.autoSaveKey) !== null; }
    catch { return false; }
  }

  getAutoSaveInfo() {
    if (!this.config.autoSaveKey) return null;
    try {
      const raw = localStorage.getItem(this.config.autoSaveKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  restoreAutoSave() {
    const info = this.getAutoSaveInfo();
    if (!info?.data) return false;
    if (info.schemaVersion && info.schemaVersion !== SCHEMA_VERSION) {
      console.warn(
        `[Editor] auto-save em schema v${info.schemaVersion}, ` +
        `editor atual em v${SCHEMA_VERSION}. Restaurando mesmo assim — ` +
        'considere descartar via clearAutoSave() se o conteúdo aparecer quebrado.'
      );
    }
    try {
      this.loadJSON(info.data);
      return true;
    } catch (err) {
      console.error('[Editor] restore falhou:', err);
      return false;
    }
  }

  clearAutoSave() {
    if (!this.config.autoSaveKey) return;
    try { localStorage.removeItem(this.config.autoSaveKey); }
    catch {}
  }

  /**
   * Salvar — fluxo:
   *   1. Serializa a árvore.
   *   2. Se há targetField, escreve o JSON nele (integra com forms Django).
   *   3. Se há onSave, chama o callback (assíncrono permitido).
   *   4. Senão, se há saveUrl, faz POST com X-CSRFToken.
   *   5. Sempre emite evento 'save' e loga no console.
   */
  save() {
    const json = this.exportJSON();
    const serialized = JSON.stringify(json);
    this._dirty = false;

    if (this.config.targetField) {
      this.config.targetField.value = serialized;
    }

    let promise = null;
    if (typeof this.config.onSave === 'function') {
      try {
        promise = Promise.resolve(this.config.onSave(json));
      } catch (err) {
        promise = Promise.reject(err);
      }
    } else if (this.config.saveUrl) {
      const saveT = this.transportFor('save');
      const headers = { 'Content-Type': 'application/json', ...this.csrfHeaders(), ...saveT.headers };
      promise = this.fetch(this.config.saveUrl, {
        method: saveT.method,
        headers,
        body: serialized,
      });
    }

    this.bus.emit('save', { json });
    this._dispatchDom('editor:save', { json });

    if (promise) {
      promise
        .then(() => {
          console.info('[Editor] save() concluído.');
          this.notify?.toast('Página salva.', 'success');
        })
        .catch((err) => {
          console.error('[Editor] save() falhou:', err);
          this.notify?.toast(`Falha ao salvar: ${err.message}`, 'error');
        });
    } else {
      console.info('[Editor] save() — JSON pronto (sem destino configurado):', json);
      this.notify?.toast('JSON pronto (modo standalone — veja console).', 'info');
    }

    return json;
  }

  /**
   * Remove a instância do registro oficial e desconecta a colaboração.
   * Use ao destruir o editor (SPA route change, modal close).
   */
  destroy() {
    try { this.collab?.disconnect?.(); } catch { /* noop */ }
    clearTimeout(this._autoSaveTimer);
    if (this._beforeUnload && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this._beforeUnload);
      this._beforeUnload = null;
    }
    Editor.instances.delete(this._instanceId());
    this._dispatchDom('editor:destroy', {});
  }
}

/** Registro oficial de instâncias ativas. Útil para integrações externas. */
Editor.instances = new Map();
Editor._counter = 0;

/** Versão do bundle exposta para diagnóstico. */
Editor.version = VERSION;

/** Versão do schema da árvore JSON. */
Editor.schemaVersion = SCHEMA_VERSION;

/**
 * Registra (ou substitui) um catálogo de strings de idioma. Permite a
 * integrações adicionarem es-ES, fr-FR etc. sem fork. Após registrar,
 * chame `Editor.setLocale(code)` para ativar.
 *
 *   Editor.registerLocale('es', { 'topbar.save': 'Guardar', ... });
 *   Editor.setLocale('es');
 */
Editor.registerLocale = (code, strings) => i18nRegisterLocale(code, strings);

/** Troca o idioma ativo entre os locales registrados. */
Editor.setLocale = (code) => setLocale(code);
