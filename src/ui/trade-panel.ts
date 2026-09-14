import { createIcon, type IconName } from './icons';
import { MARKET_BUY_PRICE, MARKET_SELL_SPREAD, type MarketResource } from '../game/trade';
import type { ResourceLine } from './ui-state';

export type { MarketResource };

export interface TradePanelActions {
  close(): void;
  buy(resource: MarketResource, amount: number): void;
  sell(resource: MarketResource, amount: number): void;
}

export interface TradePanelHandle {
  readonly element: HTMLElement;
  render(open: boolean, resources: readonly ResourceLine[], busy: boolean, feedback: string | null): void;
}

const MARKET_ROWS: readonly { readonly resource: MarketResource; readonly icon: IconName }[] = [
  { resource: 'manpower', icon: 'manpower' }, { resource: 'food', icon: 'food' },
  { resource: 'stone', icon: 'node-stone' }, { resource: 'metal', icon: 'metal' }, { resource: 'oil', icon: 'oil' },
];

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function resourceValue(resources: readonly ResourceLine[], id: string): number {
  return resources.find((line) => line.id === id)?.value ?? 0;
}

export function createTradePanel(actions: TradePanelActions): TradePanelHandle {
  const panel = node('section', 'ifg-trade');
  panel.id = 'ifg-trade-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'ifg-trade-heading');

  const header = node('div', 'ifg-trade__header');
  const titleBlock = node('div', 'ifg-trade__title');
  titleBlock.append(createIcon('trade', 'ifg-trade__title-icon'));
  const titleCopy = node('div');
  const heading = node('h2', undefined, 'Market');
  heading.id = 'ifg-trade-heading';
  titleCopy.append(heading, node('p', undefined, 'Buy and sell resources for funds'));
  titleBlock.append(titleCopy);
  const close = node('button', 'ifg-trade__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close market');
  close.append(createIcon('close'));
  close.addEventListener('click', actions.close);
  header.append(titleBlock, close);

  const body = node('div', 'ifg-trade__body');
  const feedbackNode = node('p', 'ifg-trade__feedback');
  feedbackNode.setAttribute('role', 'status');
  panel.append(header, body, feedbackNode);

  const amounts = new Map<MarketResource, number>(MARKET_ROWS.map((row) => [row.resource, 100]));

  const render = (open: boolean, resources: readonly ResourceLine[], busy: boolean, feedback: string | null): void => {
    panel.hidden = !open;
    panel.classList.toggle('is-open', open);
    feedbackNode.textContent = feedback ?? '';
    feedbackNode.hidden = !feedback;
    if (!open) return;

    const funds = resourceValue(resources, 'money');
    const rows: HTMLElement[] = [];
    for (const { resource, icon } of MARKET_ROWS) {
      const stock = resourceValue(resources, resource);
      const price = MARKET_BUY_PRICE[resource];
      const amount = amounts.get(resource) ?? 100;

      const row = node('div', 'ifg-trade__row');
      const identity = node('span', 'ifg-trade__row-identity');
      identity.append(createIcon(icon, 'ifg-trade__row-icon'), node('b', undefined, Math.floor(stock).toLocaleString()));
      row.append(identity);

      const amountInput = node('input', 'ifg-trade__row-amount');
      amountInput.type = 'number';
      amountInput.min = '1';
      amountInput.max = '5000';
      amountInput.step = '1';
      amountInput.value = String(amount);
      amountInput.setAttribute('aria-label', `${resource} amount`);
      amountInput.addEventListener('input', () => {
        const next = Math.round(Number(amountInput.value));
        if (Number.isFinite(next) && next > 0) amounts.set(resource, next);
      });
      row.append(amountInput);

      const buyCost = amount * price;
      const sellProceeds = amount * price * MARKET_SELL_SPREAD;
      const buyButton = node('button', 'ifg-trade__action is-buy', `Buy · ${Math.round(buyCost).toLocaleString()}`);
      buyButton.type = 'button';
      buyButton.disabled = busy || buyCost > funds;
      buyButton.prepend(createIcon('funds', 'ifg-trade__action-icon'));
      buyButton.addEventListener('click', () => actions.buy(resource, amounts.get(resource) ?? 100));

      const sellButton = node('button', 'ifg-trade__action is-sell', `Sell · ${Math.round(sellProceeds).toLocaleString()}`);
      sellButton.type = 'button';
      sellButton.disabled = busy || amount > stock;
      sellButton.prepend(createIcon('funds', 'ifg-trade__action-icon'));
      sellButton.addEventListener('click', () => actions.sell(resource, amounts.get(resource) ?? 100));

      row.append(buyButton, sellButton);
      rows.push(row);
    }

    const fundsRow = node('p', 'ifg-trade__funds');
    fundsRow.append(createIcon('funds', 'ifg-trade__funds-icon'), node('b', undefined, Math.floor(funds).toLocaleString()));
    body.replaceChildren(fundsRow, ...rows);
  };

  return { element: panel, render };
}
