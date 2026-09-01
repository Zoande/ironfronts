import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const menu = readFileSync(path.join(root, 'src/menu/menu.ts'), 'utf8');
const css = readFileSync(path.join(root, 'src/menu/menu.css'), 'utf8');
const campaignMap = readFileSync(path.join(root, 'src/menu/campaign-map.ts'), 'utf8');

/**
 * The dossier is a full-viewport briefing. "Begin Operation" opens a dedicated
 * world map where availability and selection are encoded directly on countries.
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

  it('ships a separate map-based nation-selection overlay with an explicit join', () => {
    expect(html).toContain('id="ifm-nation-picker"');
    const start = html.indexOf('id="ifm-nation-picker"');
    const end = html.indexOf('</div>\n    </div>', start);
    const overlay = html.slice(start, end);
    expect(overlay).toContain('id="ifm-country-map"');
    expect(overlay).toContain('ifm__campaign-map-legend');
    expect(overlay).toContain('id="ifm-confirm-nation"');
    expect(overlay).toContain('id="ifm-nation-cancel"');
    expect(overlay).toContain('aria-modal="true"');
    expect(overlay).toContain('role="application"');
    expect(overlay).not.toContain('id="ifm-country-grid"');
  });

  it('keeps the dossier footer and join controls inside the dynamic viewport', () => {
    expect(css).toMatch(/\.ifm__file--dossier\s*\{[^}]*height:\s*min\([^}]*100dvh/s);
    expect(css).toMatch(/\.ifm__file--dossier\s*\{[^}]*max-height:\s*calc\(100dvh/s);
    expect(css).toMatch(/\.ifm__subpage--dossier\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.ifm__registry\s*\{[^}]*height:\s*min\([^}]*100dvh/s);
    expect(css).toMatch(/\.ifm__file-actions\s*\{[^}]*flex:\s*0 0 auto/);
    expect(css).toMatch(/\.ifm__registry-actions\s*\{[^}]*flex:\s*0 0 auto/);
  });

  it('uses the pregenerated country raster and the requested availability palette', () => {
    expect(campaignMap).toContain("const MAP_URL = '/menu/campaign-country-ids.u16'");
    expect(campaignMap).toContain('available: [218, 207, 181, 255]');
    expect(campaignMap).toContain('unavailable: [92, 95, 91, 255]');
    expect(campaignMap).toContain('selected: [81, 124, 68, 255]');
    expect(campaignMap).toContain('playableIds.has(id) ? COLORS.available : COLORS.unavailable');
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

  it('loads the map lazily and only launches from the Join control', () => {
    expect(menu).toMatch(/function openNationPicker\(\)[\s\S]{0,500}mountCampaignMap\(/);
    expect(menu).toMatch(/confirmNation\?\.addEventListener\('click',[\s\S]{0,120}deployFromPicker\(selectedCountryId\)/);
  });

  it('New Campaign is a safe preview once a campaign exists, but Continue still launches', () => {
    // previewOnly === (a country is already assigned). The picker paths
    // (Join + map Enter) go through deployFromPicker, which no-ops in
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

  it('supports keyboard selection and joining from the map', () => {
    expect(campaignMap).toContain("['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']");
    expect(menu).toMatch(/countryMap\?\.addEventListener\('keydown'[\s\S]{0,260}deployFromPicker\(selectedCountryId\)/);
  });

  it('an abandoned launch tears the overlay down with the rest of the menu', () => {
    const start = menu.indexOf('function resetToMainScreen()');
    const body = menu.slice(start, menu.indexOf('\n  }', start));
    expect(body).toContain('closeNationPicker();');
  });
});
