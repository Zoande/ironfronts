import { createIcon, type IconName } from './icons';
import type { GameNotification, NotificationKind } from './ui-state';

const NOTE_ICON: Record<NotificationKind, IconName> = {
  warning: 'note-warning', combat: 'note-combat', completed: 'note-completed',
  diplomacy: 'note-diplomacy', information: 'note-information',
};

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function buildNotification(
  notification: GameNotification,
  dismissNotification: (id: string) => void,
  focusWorld?: (x: number, z: number) => void,
): HTMLElement {
  const item = element('article', 'ifg-notify__item');
  item.dataset.kind = notification.kind;
  const body = element('div', 'ifg-notify__body');
  body.append(element('strong', undefined, notification.title));
  if (notification.body) body.append(element('span', undefined, notification.body));
  const dismiss = element('button', 'ifg-notify__dismiss');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss');
  dismiss.append(createIcon('close'));
  dismiss.addEventListener('click', (event) => { event.stopPropagation(); dismissNotification(notification.id); });
  const kindIcon = notification.kind === 'combat' && notification.focus ? 'note-attacked' : NOTE_ICON[notification.kind];
  item.append(createIcon(kindIcon, 'ifg-notify__icon'), body, dismiss);
  // A located event (an attack on your line) re-centres the camera on click.
  if (notification.focus && focusWorld) {
    const { x, z } = notification.focus;
    item.classList.add('is-locatable');
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    item.title = 'Jump to this battle';
    item.addEventListener('click', () => focusWorld(x, z));
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusWorld(x, z); }
    });
  }
  return item;
}
