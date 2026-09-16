import { createIcon, type IconName } from './icons';
import type { GameNotification, NotificationKind } from './ui-state';

export interface NotificationCenterActions {
  close(): void;
  focusWorld?(x: number, z: number): void;
}

export interface NotificationCenterHandle {
  readonly element: HTMLElement;
  render(open: boolean, history: readonly GameNotification[], lastReadAt: number): void;
}

const NOTE_ICON: Record<NotificationKind, IconName> = {
  warning: 'note-warning', combat: 'note-combat', completed: 'note-completed',
  diplomacy: 'note-diplomacy', information: 'note-information',
};

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function relativeTime(at: number, now: number): string {
  const deltaSec = Math.max(0, Math.round((now - at) / 1000));
  if (deltaSec < 60) return 'Just now';
  const deltaMin = Math.round(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHour = Math.round(deltaMin / 60);
  if (deltaHour < 24) return `${deltaHour}h ago`;
  return `${Math.round(deltaHour / 24)}d ago`;
}

export function createNotificationCenter(actions: NotificationCenterActions): NotificationCenterHandle {
  const panel = node('section', 'ifg-notecenter');
  panel.id = 'ifg-notecenter-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'ifg-notecenter-heading');

  const header = node('div', 'ifg-notecenter__header');
  const titleBlock = node('div', 'ifg-notecenter__title');
  titleBlock.append(createIcon('events', 'ifg-notecenter__title-icon'));
  const titleCopy = node('div');
  const heading = node('h2', undefined, 'Notifications');
  heading.id = 'ifg-notecenter-heading';
  titleCopy.append(heading, node('p', undefined, 'Everything that has happened this operation'));
  titleBlock.append(titleCopy);
  const close = node('button', 'ifg-notecenter__close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close notifications');
  close.append(createIcon('close'));
  close.addEventListener('click', actions.close);
  header.append(titleBlock, close);

  const body = node('div', 'ifg-notecenter__body');
  panel.append(header, body);

  const render = (open: boolean, history: readonly GameNotification[], lastReadAt: number): void => {
    panel.hidden = !open;
    panel.classList.toggle('is-open', open);
    if (!open) return;

    if (history.length === 0) {
      body.replaceChildren(node('p', 'ifg-notecenter__empty', 'No events yet — the line is quiet.'));
      return;
    }

    const now = Date.now();
    const items = [...history].reverse().map((entry) => {
      const item = node('article', 'ifg-notecenter__item');
      item.dataset.kind = entry.kind;
      if (entry.at > lastReadAt) item.classList.add('is-unread');
      const kindIcon = entry.kind === 'combat' && entry.focus ? 'note-attacked' : NOTE_ICON[entry.kind];
      item.append(createIcon(kindIcon, 'ifg-notecenter__icon'));
      const copy = node('div', 'ifg-notecenter__copy');
      copy.append(node('strong', undefined, entry.title));
      if (entry.body) copy.append(node('span', undefined, entry.body));
      item.append(copy);
      item.append(node('time', 'ifg-notecenter__time', relativeTime(entry.at, now)));
      if (entry.focus && actions.focusWorld) {
        const { x, z } = entry.focus;
        const focusWorld = actions.focusWorld;
        item.classList.add('is-locatable');
        item.setAttribute('role', 'button');
        item.tabIndex = 0;
        item.title = 'Jump to this location';
        item.addEventListener('click', () => focusWorld(x, z));
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusWorld(x, z); }
        });
      }
      return item;
    });
    body.replaceChildren(...items);
  };

  return { element: panel, render };
}
