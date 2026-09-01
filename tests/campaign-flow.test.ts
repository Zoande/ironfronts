import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const menu = readFileSync(path.join(root, 'src/menu/menu.ts'), 'utf8');
const css = readFileSync(path.join(root, 'src/menu/menu.css'), 'utf8');

/**
 * P2: the operation dossier and the nation list used to share one cramped page.
 * The dossier is now a full-viewport briefing with no country list, and
 * "Begin Operation" opens a dedicated Mobilization Registry overlay that owns
 * nation selection and the only launch trigger.
 */
describe('campaign flow — dossier then nation overlay', () => {
  it('keeps the country list out of the operation dossier', () => {
    const start = html.indexOf('id="ifm-campaign"');
    const end = html.indexOf('</section>', start);
    const dossier = html.slice(start, end);
    expect(dossier).not.toContain('ifm__deploy');
    expect(dossier).not.toContain('id="ifm-country-grid"');
    expect(dossier).not.toContain('id="ifm-start-operation"');
    expect(dossier).toContain('id="ifm-begin-operation"');
    // Briefing essentials still present.
    expect(dossier).toContain('id="ifm-briefing-theater"');
    expect(dossier).toContain('id="ifm-briefing-risk"');
    expect(dossier).toContain('Operation Information');
  });

  it('ships a separate nation-selection overlay with an explicit confirm', () => {
    expect(html).toContain('id="ifm-nation-picker"');
    const start = html.indexOf('id="ifm-nation-picker"');
    const end = html.indexOf('</div>\n    </div>', start);
    const overlay = html.slice(start, end);
    expect(overlay).toContain('id="ifm-country-grid"');
    expect(overlay).toContain('id="ifm-confirm-nation"');
    expect(overlay).toContain('id="ifm-nation-cancel"');
    expect(overlay).toContain('aria-modal="true"');
    expect(overlay).toContain('role="listbox"');
  });

  it('the dossier fits the viewport and the overlay never scrolls the body', () => {
    // A height cap on the dossier file + hidden subpage overflow = no body scroll.
    expect(css).toMatch(/\.ifm__file--dossier\s*\{[^}]*height:\s*min\([^}]*\)/);
    expect(css).toMatch(/\.ifm__subpage--dossier\s*\{[^}]*overflow:\s*hidden/);
    // The roster is the only thing that scrolls, and it contains its own wheel.
    expect(css).toMatch(/\.ifm__roster\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.ifm__roster\s*\{[^}]*overscroll-behavior:\s*contain/);
  });

  it('styles a real scrollbar rather than hiding scroll (wheel + keys must work)', () => {
    expect(css).toContain('.ifm__roster::-webkit-scrollbar');
    expect(css).toMatch(/\.ifm__roster\s*\{[^}]*scrollbar-width:\s*thin/);
  });

  it('avoids glassmorphism on the overlay', () => {
    const start = css.indexOf('.ifm__overlay {');
    const block = css.slice(start, start + 400);
    expect(block).not.toContain('backdrop-filter');
    expect(block).not.toContain('blur(');
  });

  it('Begin Operation opens the overlay; Cancel/Escape return to the dossier', () => {
    expect(menu).toContain('function openNationPicker()');
    expect(menu).toContain('function closeNationPicker()');
    expect(menu).toMatch(/beginOperation\?\.addEventListener\('click', \(\) => openNationPicker\(\)\)/);
    expect(menu).toMatch(/nationCancel\?\.addEventListener\('click', \(\) => closeNationPicker\(\)\)/);
    // Escape backs out of the overlay before it closes the dossier.
    const esc = menu.slice(menu.indexOf("if (event.key !== 'Escape')"), menu.indexOf("if (event.key !== 'Escape')") + 260);
    expect(esc).toContain('if (pickerOpen) { closeNationPicker(); return; }');
  });

  it('renders the roster lazily and only launches on Confirm', () => {
    // No eager render at mount any more (lighter lobby).
    expect(menu).not.toContain('renderCountryGrid(null)');
    expect(menu).toMatch(/function openNationPicker\(\)[\s\S]{0,160}renderRoster\(/);
    expect(menu).toMatch(/confirmNation\?\.addEventListener\('click',[\s\S]{0,120}deployFromPicker\(selectedCountryId\)/);
  });

  it('New Campaign is a safe preview once a campaign exists, but Continue still launches', () => {
    // previewOnly === (a country is already assigned). The picker paths
    // (Confirm + roster Enter) go through deployFromPicker, which no-ops in
    // preview mode; Continue calls deploy() directly and is never gated.
    expect(menu).toContain('const previewOnly = assignedCountry !== null');
    expect(menu).toContain('async function deployFromPicker(');
    const picker = menu.slice(menu.indexOf('async function deployFromPicker('), menu.indexOf('async function deployFromPicker(') + 500);
    expect(picker).toMatch(/if \(previewOnly\)[\s\S]+return;[\s\S]+\}\s*\n\s*await deploy\(countryId\)/);
    // Continue's listener calls the unguarded deploy, not deployFromPicker.
    expect(menu).toContain("continueButton.addEventListener('click', () => void deploy(assignedCountry.id))");
    // New Campaign card is no longer hard-disabled when assigned.
    expect(menu).toContain('newCampaign.disabled = false');
  });

  it('supports grid keyboard navigation in the roster', () => {
    expect(menu).toContain('function onRosterKeydown(');
    expect(menu).toContain('function rosterColumns(');
    // Up/Down move a visual row (column count), not a single cell.
    expect(menu).toMatch(/ArrowDown:\s*columns,\s*ArrowUp:\s*-columns/);
  });

  it('an abandoned launch tears the overlay down with the rest of the menu', () => {
    const start = menu.indexOf('function resetToMainScreen()');
    const body = menu.slice(start, menu.indexOf('\n  }', start));
    expect(body).toContain('closeNationPicker();');
  });
});
