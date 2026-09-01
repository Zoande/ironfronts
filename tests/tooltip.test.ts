import { describe, expect, it } from 'vitest';
import { renderTooltipHtml } from '../src/ui/tooltip';

describe('rich tooltip content', () => {
  it('always renders a title', () => {
    expect(renderTooltipHtml({ title: 'Move' })).toContain('ifg-tip__title');
    expect(renderTooltipHtml({ title: 'Move' })).toContain('>Move<');
  });

  it('renders the description, shortcut, cost, eta and status rows when present', () => {
    const html = renderTooltipHtml({
      title: 'Barracks',
      description: 'Train infantry and support units.',
      shortcut: 'B',
      cost: '120 manpower',
      eta: '~3:20',
      status: 'Queued',
    });
    expect(html).toContain('Train infantry and support units.');
    expect(html).toContain('<kbd>B</kbd>');
    expect(html).toContain('120 manpower');
    expect(html).toContain('~3:20');
    expect(html).toContain('Queued');
    expect(html).not.toContain('is-blocked');
  });

  it('replaces the description with the disabled reason and marks it blocked', () => {
    const html = renderTooltipHtml({
      title: 'Attack',
      description: 'Advance to contact.',
      disabledReason: 'No visible hostile target in range.',
    });
    expect(html).toContain('is-blocked');
    expect(html).toContain('No visible hostile target in range.');
    expect(html).not.toContain('Advance to contact.');
  });

  it('escapes markup coming from dynamic names', () => {
    const html = renderTooltipHtml({ title: '<img src=x>', description: 'a & b' });
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).toContain('a &amp; b');
  });
});
