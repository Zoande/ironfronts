import { createFlag } from './flags';
import { createIcon, type IconName } from './icons';
import type {
  DiplomacyCountryView, DiplomacyProposalView, DiplomacyRelation, DiplomacyView,
  TradeLegView, TradeProposalView, TradeResourceKey,
} from './ui-state';

export interface DiplomacyPanelActions {
  close(): void;
  selectCountry(countryId: number): void;
  sendMessage(countryId: number, body: string): void;
  proposeAlliance(countryId: number): void;
  offerPeace(countryId: number): void;
  declareWar(countryId: number): void;
  endAlliance(countryId: number): void;
  respondProposal(proposalId: string, accept: boolean): void;
  proposeTrade(countryId: number, offer: TradeLegView, request: TradeLegView): void;
  respondTrade(proposalId: string, accept: boolean): void;
}

const TRADE_RESOURCES: readonly { readonly key: TradeResourceKey; readonly icon: IconName }[] = [
  { key: 'funds', icon: 'funds' }, { key: 'manpower', icon: 'manpower' }, { key: 'food', icon: 'food' },
  { key: 'stone', icon: 'node-stone' }, { key: 'metal', icon: 'metal' }, { key: 'oil', icon: 'oil' },
];

function tradeResourceIcon(resource: TradeResourceKey): IconName {
  return TRADE_RESOURCES.find((entry) => entry.key === resource)?.icon ?? 'funds';
}

export interface DiplomacyPanelHandle {
  readonly element: HTMLElement;
  render(open: boolean, view: DiplomacyView): void;
}

export function diplomacyRelationLabel(relation: DiplomacyRelation): string {
  if (relation === 'allied') return 'Allied';
  if (relation === 'war') return 'At war';
  return 'Neutral';
}

export function diplomacyContactBlock(country: DiplomacyCountryView): string | null {
  if (!country.alive) return 'This country has been defeated. Its diplomatic channel is closed.';
  if (country.controller !== 'player') {
    return 'No player commands this country. Messages and treaties require another player.';
  }
  return null;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function actionButton(
  label: string, icon: IconName, className = '', disabled = false,
): HTMLButtonElement {
  const button = node('button', `ifg-dip__action${className ? ` ${className}` : ''}`);
  button.type = 'button';
  button.disabled = disabled;
  button.append(createIcon(icon, 'ifg-dip__action-icon'), node('span', undefined, label));
  return button;
}

function proposalLabel(proposal: DiplomacyProposalView): string {
  return proposal.kind === 'alliance' ? 'Alliance proposal' : 'Peace offer';
}

function tradeLegChip(leg: TradeLegView): HTMLElement {
  const chip = node('span', 'ifg-dip__trade-leg');
  chip.append(createIcon(tradeResourceIcon(leg.resource), 'ifg-dip__trade-leg-icon'), node('b', undefined, String(leg.amount)));
  return chip;
}

function tradeProposalCard(
  proposal: TradeProposalView, viewerCountryId: number | null, actions: DiplomacyPanelActions, busy: boolean,
  entering: boolean,
): HTMLElement {
  const outgoing = proposal.fromCountryId === viewerCountryId;
  const card = node('section', `ifg-dip__proposal ifg-dip__proposal--trade${entering ? ' is-entering' : ''}`);
  const row = node('div', 'ifg-dip__trade-row');
  row.append(
    tradeLegChip(outgoing ? proposal.offer : proposal.request),
    createIcon('trade', 'ifg-dip__trade-arrow'),
    tradeLegChip(outgoing ? proposal.request : proposal.offer),
  );
  card.append(node('p', 'ifg-dip__proposal-kind', outgoing ? 'Your trade offer' : 'Trade offer'), row);
  if (outgoing) {
    card.append(node('p', 'ifg-dip__pending', 'Awaiting reply.'));
  } else {
    const responses = node('div', 'ifg-dip__proposal-actions');
    const accept = actionButton('Accept', 'note-completed', 'is-primary', busy);
    const decline = actionButton('Decline', 'close', '', busy);
    accept.addEventListener('click', () => actions.respondTrade(proposal.id, true));
    decline.addEventListener('click', () => actions.respondTrade(proposal.id, false));
    responses.append(accept, decline);
    card.append(responses);
  }
  return card;
}

function tradeResourceSelect(selected: TradeResourceKey): HTMLSelectElement {
  const select = node('select', 'ifg-dip__trade-select');
  for (const { key } of TRADE_RESOURCES) {
    const option = node('option', undefined, key[0].toUpperCase() + key.slice(1));
    option.value = key;
    option.selected = key === selected;
    select.append(option);
  }
  return select;
}

function tradeOfferForm(
  countryId: number,
  draft: { offerResource: TradeResourceKey; offerAmount: number; requestResource: TradeResourceKey; requestAmount: number },
  actions: DiplomacyPanelActions,
  busy: boolean,
): HTMLElement {
  const form = node('form', 'ifg-dip__trade-form');
  const heading = node('p', 'ifg-dip__section-label', 'Propose a trade');

  let offerIcon = createIcon(tradeResourceIcon(draft.offerResource), 'ifg-dip__trade-form-icon');
  const offerSelect = tradeResourceSelect(draft.offerResource);
  const offerAmount = node('input', 'ifg-dip__trade-amount');
  offerAmount.type = 'number';
  offerAmount.min = '1';
  offerAmount.max = '100000';
  offerAmount.step = '1';
  offerAmount.value = String(draft.offerAmount);
  offerAmount.setAttribute('aria-label', 'You give — amount');
  offerSelect.setAttribute('aria-label', 'You give — resource');
  offerSelect.addEventListener('change', () => {
    const next = createIcon(tradeResourceIcon(offerSelect.value as TradeResourceKey), 'ifg-dip__trade-form-icon');
    next.classList.add('is-swapping');
    offerIcon.replaceWith(next);
    offerIcon = next;
  });

  const arrow = createIcon('trade', 'ifg-dip__trade-arrow');

  let requestIcon = createIcon(tradeResourceIcon(draft.requestResource), 'ifg-dip__trade-form-icon');
  const requestSelect = tradeResourceSelect(draft.requestResource);
  const requestAmount = node('input', 'ifg-dip__trade-amount');
  requestAmount.type = 'number';
  requestAmount.min = '0';
  requestAmount.max = '100000';
  requestAmount.step = '1';
  requestAmount.value = String(draft.requestAmount);
  requestAmount.setAttribute('aria-label', 'You get — amount');
  requestSelect.setAttribute('aria-label', 'You get — resource');
  requestSelect.addEventListener('change', () => {
    const next = createIcon(tradeResourceIcon(requestSelect.value as TradeResourceKey), 'ifg-dip__trade-form-icon');
    next.classList.add('is-swapping');
    requestIcon.replaceWith(next);
    requestIcon = next;
  });

  const give = node('span', 'ifg-dip__trade-field');
  give.append(offerIcon, offerSelect, offerAmount);
  const get = node('span', 'ifg-dip__trade-field');
  get.append(requestIcon, requestSelect, requestAmount);

  const row = node('div', 'ifg-dip__trade-row');
  row.append(give, arrow, get);

  const send = actionButton('Offer trade', 'trade', 'is-primary', busy);
  send.type = 'submit';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const offer: TradeLegView = { resource: offerSelect.value as TradeResourceKey, amount: Math.round(Number(offerAmount.value)) };
    const request: TradeLegView = { resource: requestSelect.value as TradeResourceKey, amount: Math.round(Number(requestAmount.value)) };
    if (!Number.isFinite(offer.amount) || offer.amount < 1) return;
    if (!Number.isFinite(request.amount) || request.amount < 0) return;
    draft.offerResource = offer.resource;
    draft.offerAmount = offer.amount;
    draft.requestResource = request.resource;
    draft.requestAmount = request.amount;
    actions.proposeTrade(countryId, offer, request);
  });

  form.append(heading, row, send);
  return form;
}

/** A non-modal field-communications drawer. The game map remains operable around it. */
export function createDiplomacyPanel(actions: DiplomacyPanelActions): DiplomacyPanelHandle {
  const panel = node('section', 'ifg-dip');
  panel.id = 'ifg-diplomacy-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'ifg-diplomacy-heading');

  const header = node('div', 'ifg-dip__header');
  const titleBlock = node('div', 'ifg-dip__title');
  titleBlock.append(createIcon('diplomacy', 'ifg-dip__title-icon'));
  const titleCopy = node('div');
  const heading = node('h2', undefined, 'Diplomatic cables');
  heading.id = 'ifg-diplomacy-heading';
  titleCopy.append(heading, node('p', undefined, 'Foreign office / secure circuit'));
  titleBlock.append(titleCopy);
  const close = node('button', 'ifg-dip__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close diplomacy');
  close.append(createIcon('close'));
  close.addEventListener('click', actions.close);
  header.append(titleBlock, close);

  const body = node('div', 'ifg-dip__body');
  panel.append(header, body);

  const drafts = new Map<number, string>();
  const tradeDrafts = new Map<number, { offerResource: TradeResourceKey; offerAmount: number; requestResource: TradeResourceKey; requestAmount: number }>();
  const tradeDraft = (countryId: number) => {
    let draft = tradeDrafts.get(countryId);
    if (!draft) {
      draft = { offerResource: 'metal', offerAmount: 100, requestResource: 'oil', requestAmount: 100 };
      tradeDrafts.set(countryId, draft);
    }
    return draft;
  };
  let rosterFilter = '';
  let renderedView: DiplomacyView | null = null;
  let wasOpen = false;

  // Closing plays a short exit animation instead of vanishing on the spot —
  // matches DIP_CLOSE_MS in game-ui.css's .ifg-dip.is-closing keyframe.
  const DIP_CLOSE_MS = 170;
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let closeTimer: number | null = null;

  // Tracks continuity across renders so entrance motion only plays for genuinely
  // new content (a cable that just arrived, a proposal that just landed) — never
  // replayed for the whole list on every unrelated re-render.
  let lastSelectedCountryId: number | null = null;
  let lastMessageCount = 0;
  const seenProposalIds = new Set<string>();
  const seenTradeProposalIds = new Set<string>();

  const render = (open: boolean, view: DiplomacyView): void => {
    if (open === wasOpen && view === renderedView) return;
    const activeDraft = body.querySelector<HTMLTextAreaElement>('.ifg-dip__composer textarea');
    const previousView = renderedView;
    if (activeDraft && previousView?.selectedCountryId !== null && previousView?.selectedCountryId !== undefined) {
      drafts.set(previousView.selectedCountryId, activeDraft.value);
    }

    const opening = open && !wasOpen;
    const closing = !open && wasOpen;
    wasOpen = open;
    renderedView = view;

    if (closeTimer !== null) { window.clearTimeout(closeTimer); closeTimer = null; }

    if (closing) {
      panel.classList.remove('is-open');
      if (reducedMotion()) {
        panel.hidden = true;
        panel.classList.remove('is-closing');
      } else {
        panel.classList.add('is-closing');
        closeTimer = window.setTimeout(() => {
          panel.hidden = true;
          panel.classList.remove('is-closing');
          closeTimer = null;
        }, DIP_CLOSE_MS);
      }
      return;
    }

    panel.classList.remove('is-closing');
    panel.hidden = !open;
    panel.classList.toggle('is-open', open);
    if (!open) return;

    const roster = node('nav', 'ifg-dip__roster');
    roster.setAttribute('aria-label', 'Foreign countries');
    const rosterHeading = node('p', 'ifg-dip__section-label', 'Country ledger');
    roster.append(rosterHeading);

    // Standing at a glance, then the roster with the relationships that matter
    // (allies, then wars) floated to the top — the 0 A.D. stance board read.
    const RELATION_ORDER: Record<DiplomacyRelation, number> = { allied: 0, war: 1, neutral: 2 };
    const sorted = [...view.countries].sort((a, b) =>
      RELATION_ORDER[a.relation] - RELATION_ORDER[b.relation] || a.name.localeCompare(b.name));
    const tally = { allied: 0, war: 0, neutral: 0 };
    for (const entry of view.countries) tally[entry.relation] += 1;
    const summary = node('div', 'ifg-dip__summary');
    const stat = (relation: DiplomacyRelation, count: number): HTMLElement => {
      const chip = node('span', 'ifg-dip__summary-stat');
      chip.dataset.relation = relation;
      chip.append(node('b', undefined, String(count)), node('span', undefined, diplomacyRelationLabel(relation)));
      return chip;
    };
    summary.append(stat('allied', tally.allied), stat('war', tally.war), stat('neutral', tally.neutral));
    roster.append(summary);

    // The world roster runs to hundreds of countries; a name filter keeps it
    // usable. Filtering is DOM-only so a keystroke never re-runs render().
    const list = node('div', 'ifg-dip__country-list');
    const applyFilter = (): void => {
      const needle = rosterFilter.trim().toLowerCase();
      for (const row of list.querySelectorAll<HTMLElement>('.ifg-dip__country')) {
        const name = row.querySelector('strong')?.textContent?.toLowerCase() ?? '';
        row.hidden = needle.length > 0 && !name.includes(needle);
      }
    };
    if (view.countries.length > 12) {
      const filterInput = node('input', 'ifg-dip__filter');
      filterInput.type = 'search';
      filterInput.placeholder = 'Filter countries…';
      filterInput.value = rosterFilter;
      filterInput.setAttribute('aria-label', 'Filter foreign countries by name');
      filterInput.addEventListener('input', () => {
        rosterFilter = filterInput.value;
        applyFilter();
      });
      roster.append(filterInput);
    }

    if (view.countries.length === 0) {
      list.append(node('p', 'ifg-dip__empty', 'No foreign countries are listed.'));
    }
    for (const country of sorted) {
      const button = node('button', 'ifg-dip__country');
      button.type = 'button';
      button.dataset.relation = country.relation;
      button.classList.toggle('is-selected', country.id === view.selectedCountryId);
      button.setAttribute('aria-pressed', String(country.id === view.selectedCountryId));
      button.setAttribute('aria-label', `${country.name}, ${diplomacyRelationLabel(country.relation)}`);
      button.addEventListener('click', () => actions.selectCountry(country.id));
      const signal = node('i', 'ifg-dip__signal');
      signal.setAttribute('aria-hidden', 'true');
      const identity = node('span', 'ifg-dip__country-identity');
      identity.append(createFlag(country.name, country.color), node('strong', undefined, country.name));
      const meta = node('span', 'ifg-dip__country-meta');
      meta.append(node('span', 'ifg-dip__relation', diplomacyRelationLabel(country.relation)));
      const attention = (country.incomingProposalCount ?? 0) + (country.unreadCount ?? 0);
      if (attention > 0) {
        meta.append(node('b', 'ifg-dip__attention', String(attention)));
      }
      button.append(signal, identity, meta);
      list.append(button);
    }
    roster.append(list);
    applyFilter();

    const country = view.countries.find((entry) => entry.id === view.selectedCountryId) ?? null;
    // Only crossfade the cable pane when the selection itself changed — not on
    // every incidental refresh (a busy-flag toggle, a tick-driven state patch)
    // while looking at the same country, which would read as flicker.
    const switchedCountry = (country?.id ?? null) !== lastSelectedCountryId;
    lastSelectedCountryId = country?.id ?? null;
    const cable = node('section', `ifg-dip__cable${switchedCountry ? ' is-entering' : ''}`);
    if (!country) {
      const empty = node('div', 'ifg-dip__empty-cable');
      empty.append(createIcon('diplomacy'), node('h3', undefined, 'Select a country'),
        node('p', undefined, 'Open a foreign cable to review relations and send a message.'));
      cable.append(empty);
    } else {
      const cableHead = node('header', 'ifg-dip__cable-head');
      const identity = node('div', 'ifg-dip__cable-identity');
      identity.append(createFlag(country.name, country.color, 'command'));
      const identityCopy = node('div');
      identityCopy.append(node('h3', undefined, country.name));
      const controller = country.controller === 'player'
        ? (country.controllerUsername ? `Player command — ${country.controllerUsername}` : 'Player command')
        : country.controller === 'ai' ? 'Military administration' : 'Unclaimed command';
      identityCopy.append(node('p', undefined, controller));
      identity.append(identityCopy);
      const status = node('strong', 'ifg-dip__status', diplomacyRelationLabel(country.relation));
      status.dataset.relation = country.relation;
      cableHead.append(identity, status);

      const messages = node('div', 'ifg-dip__messages');
      messages.setAttribute('role', 'log');
      messages.setAttribute('aria-label', `Messages with ${country.name}`);
      if (view.messages.length === 0) {
        messages.append(node('p', 'ifg-dip__empty', 'No cables exchanged on this circuit.'));
      } else {
        // A cable that just arrived (or was just sent) slides in; the rest of
        // the log, re-rendered every tick regardless, stays put.
        const newSince = switchedCountry ? Infinity : lastMessageCount;
        view.messages.forEach((message, index) => {
          const outgoing = message.fromCountryId === view.viewerCountryId;
          const entering = index >= newSince;
          const item = node('article', `ifg-dip__message ${outgoing ? 'is-outgoing' : 'is-incoming'}${entering ? ' is-entering' : ''}`);
          const sender = outgoing ? 'Your office'
            : country.controllerUsername ? `${country.name} (${country.controllerUsername})` : country.name;
          item.append(
            node('small', undefined, `${sender} / tick ${message.sentAtTick.toLocaleString()}`),
            node('p', undefined, message.body),
          );
          messages.append(item);
        });
      }
      lastMessageCount = view.messages.length;

      const pendingIncoming = view.proposals.filter((proposal) =>
        proposal.status === 'pending' && proposal.toCountryId === view.viewerCountryId);
      const pendingOutgoing = view.proposals.find((proposal) =>
        proposal.status === 'pending' && proposal.fromCountryId === view.viewerCountryId);
      const blocked = diplomacyContactBlock(country);
      const busy = view.busy !== null;

      const controls = node('div', 'ifg-dip__controls');
      for (const proposal of pendingIncoming) {
        const entering = !seenProposalIds.has(proposal.id);
        seenProposalIds.add(proposal.id);
        const sheet = node('section', `ifg-dip__proposal${entering ? ' is-entering' : ''}`);
        sheet.append(
          node('p', 'ifg-dip__proposal-kind', proposalLabel(proposal)),
          node('h4', undefined, proposal.kind === 'alliance' ? 'Join forces?' : 'End hostilities?'),
          node('p', undefined, proposal.kind === 'alliance'
            ? `${country.name} asks your government to enter a formal alliance.`
            : `${country.name} offers a negotiated return to peace.`),
        );
        const responses = node('div', 'ifg-dip__proposal-actions');
        const accept = actionButton('Accept', 'note-completed', 'is-primary', busy);
        const decline = actionButton('Decline', 'close', '', busy);
        accept.addEventListener('click', () => actions.respondProposal(proposal.id, true));
        decline.addEventListener('click', () => actions.respondProposal(proposal.id, false));
        responses.append(accept, decline);
        sheet.append(responses);
        controls.append(sheet);
      }

      const relationshipActions = node('div', 'ifg-dip__relationship-actions');
      if (!pendingOutgoing) {
        if (country.relation === 'neutral') {
          const alliance = actionButton('Propose alliance', 'diplomacy', 'is-primary', busy || Boolean(blocked));
          alliance.addEventListener('click', () => actions.proposeAlliance(country.id));
          const war = actionButton('Declare war', 'stat-attack', 'is-hostile', busy || Boolean(blocked));
          war.addEventListener('click', () => actions.declareWar(country.id));
          relationshipActions.append(alliance, war);
        } else if (country.relation === 'war') {
          const peace = actionButton('Offer peace', 'diplomacy', 'is-primary', busy || Boolean(blocked));
          peace.addEventListener('click', () => actions.offerPeace(country.id));
          relationshipActions.append(peace);
        } else {
          const end = actionButton('End alliance', 'close', 'is-hostile', busy || Boolean(blocked));
          end.addEventListener('click', () => actions.endAlliance(country.id));
          relationshipActions.append(end);
        }
      } else {
        relationshipActions.append(node('p', 'ifg-dip__pending',
          `${proposalLabel(pendingOutgoing)} awaiting reply.`));
      }
      controls.append(relationshipActions);

      if (country.relation === 'allied') {
        const pendingTrades = view.tradeProposals.filter((proposal) => proposal.status === 'pending');
        for (const proposal of pendingTrades) {
          const entering = !seenTradeProposalIds.has(proposal.id);
          seenTradeProposalIds.add(proposal.id);
          controls.append(tradeProposalCard(proposal, view.viewerCountryId, actions, busy, entering));
        }
        if (!blocked) controls.append(tradeOfferForm(country.id, tradeDraft(country.id), actions, busy));
      }

      if (blocked) controls.append(node('p', 'ifg-dip__blocked', blocked));
      if (view.feedback) {
        const feedback = node('p', 'ifg-dip__feedback', view.feedback);
        feedback.setAttribute('role', 'status');
        controls.append(feedback);
      }

      const form = node('form', 'ifg-dip__composer');
      const label = node('label', undefined, `Message ${country.name}`);
      label.htmlFor = `ifg-dip-message-${country.id}`;
      const text = node('textarea');
      text.id = label.htmlFor;
      text.name = 'message';
      text.rows = 2;
      text.maxLength = 500;
      text.placeholder = blocked ? 'Diplomatic channel unavailable' : 'Write a secure cable...';
      text.disabled = Boolean(blocked) || busy;
      text.value = drafts.get(country.id) ?? '';
      const send = actionButton('Send cable', 'diplomacy', 'is-primary', Boolean(blocked) || busy);
      send.type = 'submit';
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const message = text.value.trim();
        if (!message || text.disabled) return;
        drafts.set(country.id, '');
        text.value = '';
        actions.sendMessage(country.id, message);
      });
      form.append(label, text, send);

      controls.append(form);
      cable.append(cableHead, messages, controls);
    }

    body.replaceChildren(roster, cable);
    const log = body.querySelector<HTMLElement>('.ifg-dip__messages');
    if (log) log.scrollTop = log.scrollHeight;
    if (opening) close.focus({ preventScroll: true });
  };

  return { element: panel, render };
}
