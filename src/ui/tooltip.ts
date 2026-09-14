/** Shared accessible popover tree used by every HUD control. */
export interface TooltipBranch {
  readonly label: string;
  readonly value?: string;
  readonly content?: TooltipContent;
}
export interface TooltipContent {
  readonly title: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly disabledReason?: string;
  readonly cost?: string;
  readonly eta?: string;
  readonly status?: string;
  readonly children?: readonly TooltipBranch[];
}

const SHOW_DELAY_MS = 170;
const CLOSE_DELAY_MS = 120;
const HOLD_MS = 420;
const GAP = 10;
type ContentSource = TooltipContent | (() => TooltipContent | null);
interface OpenPanel { element: HTMLElement; anchor: HTMLElement; depth: number; holdTimer?: number }

let panels: OpenPanel[] = [];
let showTimer: number | undefined;
let closeTimer: number | undefined;
let activeAnchor: HTMLElement | null = null;

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (char) => char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : '&quot;');
}

export function renderTooltipHtml(content: TooltipContent): string {
  const rows: string[] = [`<strong class="ifg-tip__title">${esc(content.title)}</strong>`];
  const detail = content.disabledReason ?? content.description;
  if (detail) rows.push(`<span class="ifg-tip__detail${content.disabledReason ? ' is-blocked' : ''}">${esc(detail)}</span>`);
  const meta: string[] = [];
  if (content.cost) meta.push(`<span class="ifg-tip__meta"><i>Cost</i>${esc(content.cost)}</span>`);
  if (content.eta) meta.push(`<span class="ifg-tip__meta"><i>Time</i>${esc(content.eta)}</span>`);
  if (content.status) meta.push(`<span class="ifg-tip__meta"><i>Status</i>${esc(content.status)}</span>`);
  if (meta.length) rows.push(`<span class="ifg-tip__metas">${meta.join('')}</span>`);
  if (content.shortcut) rows.push(`<span class="ifg-tip__key"><i>Key</i><kbd>${esc(content.shortcut)}</kbd></span>`);
  return rows.join('');
}

function cancelClose(): void { window.clearTimeout(closeTimer); closeTimer = undefined; }
function closeFrom(depth: number): void {
  for (const item of panels.splice(depth)) {
    window.clearTimeout(item.holdTimer);
    item.element.remove();
  }
  if (!panels.length) activeAnchor = null;
}
function hide(): void {
  window.clearTimeout(showTimer); showTimer = undefined; cancelClose(); closeFrom(0);
}
function scheduleClose(depth = 0): void {
  cancelClose();
  closeTimer = window.setTimeout(() => {
    const panel = panels[depth];
    if (panel && (panel.anchor.matches(':hover') || panel.element.matches(':hover'))) {
      scheduleClose(depth);
      return;
    }
    closeFrom(depth);
  }, CLOSE_DELAY_MS);
}

function place(element: HTMLElement, anchor: HTMLElement, depth: number): void {
  const rect = anchor.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;
  let left: number;
  let top: number;
  if (depth === 0) {
    left = rect.left + rect.width / 2 - width / 2;
    top = rect.top - height - GAP;
    if (top < GAP) top = rect.bottom + GAP;
  } else {
    left = rect.right + GAP;
    if (left + width > viewportWidth - GAP) left = rect.left - width - GAP;
    top = rect.top;
  }
  element.style.left = `${Math.round(Math.max(GAP, Math.min(left, viewportWidth - width - GAP)))}px`;
  element.style.top = `${Math.round(Math.max(GAP, Math.min(top, viewportHeight - height - GAP)))}px`;
}

function openPanel(anchor: HTMLElement, content: TooltipContent, depth: number): void {
  closeFrom(depth);
  const element = document.createElement('div');
  element.className = `ifg-tip${content.disabledReason ? ' is-blocked' : ''}`;
  element.setAttribute('role', content.children?.length ? 'dialog' : 'tooltip');
  element.dataset.depth = String(depth);
  const hold = document.createElement('i');
  hold.className = 'ifg-tip__hold';
  hold.setAttribute('aria-hidden', 'true');
  element.append(hold);
  element.innerHTML = renderTooltipHtml(content);
  element.prepend(hold);
  if (content.children?.length) {
    const list = document.createElement('span');
    list.className = 'ifg-tip__branches';
    for (const branch of content.children) {
      const row = document.createElement(branch.content ? 'button' : 'span');
      row.className = `ifg-tip__branch${branch.content ? ' has-child' : ''}`;
      row.innerHTML = `<i>${esc(branch.label)}</i><b>${esc(branch.value ?? '')}</b>${branch.content ? '<em>›</em>' : ''}`;
      if (branch.content) {
        const enter = (): void => { cancelClose(); openPanel(row as HTMLElement, branch.content!, depth + 1); };
        row.addEventListener('pointerenter', enter);
        row.addEventListener('focus', enter);
        row.addEventListener('click', enter);
        row.addEventListener('keydown', (event) => {
          const key = (event as KeyboardEvent).key;
          if (key === 'ArrowRight' || key === 'Enter') { event.preventDefault(); enter(); }
        });
      }
      list.append(row);
    }
    element.append(list);
  }
  element.addEventListener('pointerenter', cancelClose);
  element.addEventListener('pointerleave', () => scheduleClose(depth));
  document.body.append(element);
  const panel: OpenPanel = { element, anchor, depth };
  panel.holdTimer = window.setTimeout(() => element.classList.add('is-held'), HOLD_MS);
  panels.push(panel);
  place(element, anchor, depth);
}

function show(anchor: HTMLElement, source: ContentSource): void {
  const content = typeof source === 'function' ? source() : source;
  if (!content) return;
  activeAnchor = anchor;
  openPanel(anchor, content, 0);
}

export function bindTooltip(anchor: HTMLElement, source: ContentSource): () => void {
  const open = (): void => {
    cancelClose(); window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(anchor, source), SHOW_DELAY_MS);
  };
  const close = (): void => { window.clearTimeout(showTimer); scheduleClose(0); };
  const click = (event: Event): void => {
    if (activeAnchor === anchor) hide();
    else { event.stopPropagation(); window.clearTimeout(showTimer); show(anchor, source); }
  };
  anchor.addEventListener('pointerenter', open); anchor.addEventListener('pointerleave', close);
  anchor.addEventListener('focus', open); anchor.addEventListener('blur', close); anchor.addEventListener('click', click);
  return () => {
    anchor.removeEventListener('pointerenter', open); anchor.removeEventListener('pointerleave', close);
    anchor.removeEventListener('focus', open); anchor.removeEventListener('blur', close); anchor.removeEventListener('click', click);
    if (activeAnchor === anchor) hide();
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !panels.length) return;
    event.preventDefault(); closeFrom(Math.max(0, panels.length - 1));
  });
  window.addEventListener('pointerdown', (event) => {
    const target = event.target as Node;
    if (activeAnchor?.contains(target) || panels.some((item) => item.element.contains(target))) return;
    hide();
  }, true);
  window.addEventListener('scroll', () => { for (const item of panels) place(item.element, item.anchor, item.depth); }, true);
  window.addEventListener('resize', () => { for (const item of panels) place(item.element, item.anchor, item.depth); });
}
