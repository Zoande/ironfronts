/**
 * Shared rich-tooltip system for the strategy HUD.
 *
 * One lazily-created panel, reused for every hoverable control (commands,
 * facilities, resources, unit portraits, map modes). Not a replacement for the
 * bespoke province `#tooltip` in main.ts — that one is map-anchored and paints
 * resource chips; this one is control-anchored and structured.
 *
 * Contract: `bindTooltip(el, content)` where `content` is a `TooltipContent`
 * or a getter returning one (or `null` to suppress). Shows ~170ms after
 * pointer-enter / focus, hides immediately on leave / blur / Escape / scroll.
 * Positioned above the anchor, flipped below when there is no room, and always
 * clamped inside the viewport.
 */

export interface TooltipContent {
  /** Bold heading — the control's name. Required. */
  readonly title: string;
  /** One or two short sentences on what the control does. */
  readonly description?: string;
  /** Keyboard shortcut, shown as its own row (e.g. "A"). */
  readonly shortcut?: string;
  /**
   * Why the control is currently unavailable. When set the tooltip is styled
   * as a blocked action and the description line is replaced by this.
   */
  readonly disabledReason?: string;
  /** Resource / time cost line (already formatted, e.g. "120 manpower"). */
  readonly cost?: string;
  /** Estimated duration line (already formatted, e.g. "~3:20"). */
  readonly eta?: string;
  /** Current-state line (e.g. "Queued", "Active"). */
  readonly status?: string;
}

const SHOW_DELAY_MS = 170;
const GAP = 10;

type ContentSource = TooltipContent | (() => TooltipContent | null);

let panel: HTMLElement | null = null;
let showTimer: number | undefined;
let activeAnchor: HTMLElement | null = null;

function ensurePanel(): HTMLElement {
  if (panel) return panel;
  const el = document.createElement('div');
  el.className = 'ifg-tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  document.body.appendChild(el);
  panel = el;
  return el;
}

/** Escape user-facing strings — content can come from country/unit names. */
function esc(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  ));
}

export function renderTooltipHtml(content: TooltipContent): string {
  const rows: string[] = [`<strong class="ifg-tip__title">${esc(content.title)}</strong>`];
  const detail = content.disabledReason ?? content.description;
  if (detail) {
    const cls = content.disabledReason ? 'ifg-tip__detail is-blocked' : 'ifg-tip__detail';
    rows.push(`<span class="${cls}">${esc(detail)}</span>`);
  }
  const meta: string[] = [];
  if (content.cost) meta.push(`<span class="ifg-tip__meta"><i>Cost</i>${esc(content.cost)}</span>`);
  if (content.eta) meta.push(`<span class="ifg-tip__meta"><i>Time</i>${esc(content.eta)}</span>`);
  if (content.status) meta.push(`<span class="ifg-tip__meta"><i>Status</i>${esc(content.status)}</span>`);
  if (meta.length) rows.push(`<span class="ifg-tip__metas">${meta.join('')}</span>`);
  if (content.shortcut) {
    rows.push(`<span class="ifg-tip__key"><i>Key</i><kbd>${esc(content.shortcut)}</kbd></span>`);
  }
  return rows.join('');
}

function place(anchor: HTMLElement): void {
  const el = ensurePanel();
  const a = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let top = a.top - h - GAP;
  el.dataset.flip = 'up';
  if (top < GAP) {
    top = a.bottom + GAP;
    el.dataset.flip = 'down';
  }
  top = Math.min(Math.max(GAP, top), vh - h - GAP);

  let left = a.left + a.width / 2 - w / 2;
  left = Math.min(Math.max(GAP, left), vw - w - GAP);

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function hide(): void {
  window.clearTimeout(showTimer);
  showTimer = undefined;
  activeAnchor = null;
  if (panel) panel.hidden = true;
}

function show(anchor: HTMLElement, source: ContentSource): void {
  const content = typeof source === 'function' ? source() : source;
  if (!content) return;
  const el = ensurePanel();
  el.className = `ifg-tip${content.disabledReason ? ' is-blocked' : ''}`;
  el.innerHTML = renderTooltipHtml(content);
  el.hidden = false;
  activeAnchor = anchor;
  place(anchor);
}

/**
 * Attach the shared tooltip to a control. Returns a disposer that removes the
 * listeners and hides the panel if this anchor owns it.
 */
export function bindTooltip(anchor: HTMLElement, source: ContentSource): () => void {
  const open = (): void => {
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(anchor, source), SHOW_DELAY_MS);
  };
  const close = (): void => {
    if (activeAnchor === anchor || showTimer !== undefined) hide();
  };
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') hide(); };

  anchor.addEventListener('pointerenter', open);
  anchor.addEventListener('pointerleave', close);
  anchor.addEventListener('focus', open);
  anchor.addEventListener('blur', close);
  anchor.addEventListener('keydown', onKey);

  return () => {
    anchor.removeEventListener('pointerenter', open);
    anchor.removeEventListener('pointerleave', close);
    anchor.removeEventListener('focus', open);
    anchor.removeEventListener('blur', close);
    anchor.removeEventListener('keydown', onKey);
    if (activeAnchor === anchor) hide();
  };
}

// Dismiss on any scroll or press elsewhere so the panel never lingers over a
// stale anchor. Guarded for non-DOM (unit test) import.
if (typeof window !== 'undefined') {
  window.addEventListener('scroll', hide, true);
  window.addEventListener('pointerdown', hide, true);
}
