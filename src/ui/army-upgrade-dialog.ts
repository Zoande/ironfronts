import type { ArmyUpgradeQuote } from '../../packages/protocol/src/index';
import { createUnitPortrait } from './unit-portraits';

/** Review a server-priced refit; the server revalidates the quote on confirmation. */
export function confirmArmyUpgrade(quote: ArmyUpgradeQuote, label: (id: string) => string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ifg-command-dialog ifg-upgrade-dialog';
    const title = document.createElement('h2');
    title.textContent = 'Upgrade army';
    const explanation = document.createElement('p');
    explanation.textContent = `Refit every eligible troop to its highest researched level. The whole army stays immobile for ${quote.totalHours.toFixed(1)} game hours. Split troops into a separate army first to upgrade only those troops.`;
    const list = document.createElement('ul');
    list.className = 'ifg-upgrade-dialog__troops';
    for (const entry of quote.entries) {
      const row = document.createElement('li');
      row.append(createUnitPortrait(entry.targetTypeId, label(entry.targetTypeId)), document.createTextNode(`${entry.count} × ${label(entry.typeId)} → ${label(entry.targetTypeId)}`));
      list.append(row);
    }
    const total = document.createElement('p');
    total.className = 'ifg-upgrade-dialog__total';
    total.textContent = 'Total cost: ' + (Object.entries(quote.cost).map(([resource, amount]) => `${amount} ${resource}`).join(' · ') || 'Free');
    const actions = document.createElement('div');
    actions.className = 'ifg-command-dialog__actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = 'Begin upgrade'; confirm.className = 'is-primary'; confirm.disabled = !quote.canStart;
    const finish = (accepted: boolean): void => { dialog.close(); dialog.remove(); resolve(accepted); };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    actions.append(cancel, confirm);
    dialog.append(title, explanation, list, total);
    if (quote.reason) { const reason = document.createElement('p'); reason.textContent = quote.reason; dialog.append(reason); }
    dialog.append(actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}
