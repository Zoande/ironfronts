import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_MAP_HEIGHT, CAMPAIGN_MAP_WIDTH, campaignMapCoordinates,
} from '../src/menu/campaign-map';

describe('campaign map pointer coordinates', () => {
  it('maps the displayed bitmap exactly when its aspect ratio matches', () => {
    const point = campaignMapCoordinates(512, 264.5, {
      left: 0, top: 0, width: 1_024, height: 529,
    });
    expect(point).toEqual([512, 264]);
  });

  it('removes top and bottom letterboxing before resolving edge countries', () => {
    const rect = { left: 100, top: 50, width: 1_024, height: 700 };
    const inset = (rect.height - CAMPAIGN_MAP_HEIGHT) / 2;
    expect(campaignMapCoordinates(rect.left + 1, rect.top + inset + 1, rect)).toEqual([1, 1]);
    expect(campaignMapCoordinates(rect.left + 1, rect.top + 1, rect)).toBeNull();
  });

  it('removes left and right letterboxing before resolving the Americas', () => {
    const rect = { left: 20, top: 30, width: 1_400, height: 529 };
    const displayedWidth = CAMPAIGN_MAP_WIDTH;
    const inset = (rect.width - displayedWidth) / 2;
    expect(campaignMapCoordinates(rect.left + inset + 10, rect.top + 100, rect)).toEqual([10, 100]);
    expect(campaignMapCoordinates(rect.left + 10, rect.top + 100, rect)).toBeNull();
  });
});
