# Campaign pacing and opening-economy audit

The campaign target is 14–21 real days at normal speed. Gameplay time remains
1:1 with real time; debug speed is a QA tool, not a balance multiplier.

The reliability pass first fixed browser-only order queues, missing queued-route
arrows, discarded exact road endpoints, and a restore validator that rejected
legitimate Level VI–VIII resource buildings.

## Opening development

An audit of the compiled world found that 68 of 102 selectable countries had no
rural province eligible for even Level I Fields; 79 had no eligible Oil Pump site.
The previous guarantee could put passive output in an urban province or leave its
resource potential below every construction threshold. A 21-day unmodified Finland
run exhausted its opening food around day 4 and oil around day 19 without expansion.

Every selectable country now has a deterministic rural source supporting Fields
through Level III and Quarry, Mine and Oil Pump through at least Level II. Natural
sites above these floors are preserved. The guarantee raises source potential; it
does not build anything, grant research, change upkeep, refill stockpiles, or issue
units. Players still pay for development, and richer sites remain strategic goals.

Existing saves receive the same repair using original province ownership. Capturing
a source cannot cause a new replacement to appear in the original owner's remaining
land on reload. Army counts, seats, ownership, cash, research and built tiers persist.
The change is idempotent and does not alter the compiled world identity.

The complete compiled-world regression checks the actual construction quotes for
every physical resource in every selectable country, rather than merely checking
that some passive national income exists.

## Pacing retained

Current phase fallbacks are day 3 and day 7. A full branch of research requires 176
hours before costs and prerequisites, with two paid research slots; specializing
before completing every branch remains intentional. Combat timing has separate
integration tests for a roughly 1.5-hour equal infantry duel, larger battles and
numerical stability. No unit, combat, movement, research or production rates were
changed by the opening-source correction.

## Measured managed opening

A full-world Finland campaign was advanced for 21 days using ordinary paid commands:
resource research through Level III, Fields through Level III, and one Level I Oil
Pump. No developer grants, free construction, free units, or conquest were used.
Food never fell below 135.00 and oil never fell below 218.00. At day 21 the campaign
held 2276.25 food and 968.00 oil, with net rates of +5 food/hour and +1.5 oil/hour.
This validates a viable home-economy opening; it is not a claim that every wartime
strategy or multiplayer matchup is balanced.

Both compiled maps were audited: 102 selectable world countries and 22 selectable
European countries have buildable rural sources for all four physical resources.
