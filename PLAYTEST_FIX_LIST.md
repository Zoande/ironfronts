# Ironfronts Playtest Fix List

Date: 2026-09-14  
Scope: login, menus, campaign setup, map, armies, economy/resources, production/construction, technology, diplomacy, combat, AI response, persistence, responsive layout, performance, copy, and debug access.

This began as a prioritized backlog from the live browser playtest. On 2026-09-14 it was re-audited against the current `main` code after the economy/resource, pacing, building-level and technology updates. Items marked **Verified** were reproduced directly in a browser; **Code-audited** means the current implementation/tests were traced but still needs a fresh browser playtest; **Requirement** means requested behavior or a product decision.

## 2026-09-14 current-game re-audit

### Changes already implemented on `fix/playtest-tech-debug-20260914`

- [x] **Expose Technology in the normal command dock.** The Technology panel and server command already existed, but the dock only enabled Diplomacy, making research effectively unreachable in normal play. Technology is now enabled and linked to the real `research` panel.
- [x] **Correct stale resource help text.** Stone, metal and oil are no longer described as extraction-only. The current economy produces them through province/resource-building output with engineer boosts.
- [x] **Make World Inspector access discoverable without making it insecure.** Eligible QA users get a `World Inspector` command-dock button plus a `System → World Inspector` entry. The old Ctrl+D then E shortcut remains useful after unlock.
- [x] **Put the debug password on the server, not in this public repository.** Enabling QA controls now requires `IRONFRONTS_DEBUG_PASSWORD`; the password is never shipped in source or a browser bundle.
- [x] **Restore account-specific debug authorization.** Only the authenticated `DimaTest1` account (case-insensitive username match) receives a signed debug entitlement. Deployment gate + entitlement + password are all required before the server exposes debug state or accepts cheat/debug commands.
- [x] **Preserve Technology prerequisites when loading pre-Technology saves.** If an old save has no technology ledger, migration now infers floors from already-owned military/resource building tiers and leveled units. Existing Missile Sites imply the current Hybrid VIII prerequisite. Modern saves with an explicit technology ledger are left unchanged.

### Economy / resource model to re-playtest

- [ ] **Verify the new opening stockpile in a fresh selectable country — Code-audited.** Current starting values are `4200 funds / 500 manpower / 500 food / 650 stone / 450 metal / 220 oil`. The old playtest values in this document are obsolete.
- [ ] **Verify national opening income normalization — Code-audited.** The generator normalizes playable countries into relatively tight opening bands instead of letting population/geography create extreme `+74k/h` style differences. Compare at least five very different countries and confirm the HUD matches one simulated hour of stockpile movement.
- [ ] **Verify physical-resource production breakdown — Code-audited.** Fields/quarries/mines/oil pumps add passive output by level (`2, 5, 10, 17, 26, 38, 53, 72 /h`), and assigned engineers add a capped technology-scaled boost. Check the province breakdown, national total, ownership/occupation 50% modifier, and actual stockpile delta against each other.
- [ ] **Verify upkeep/shortage numbers.** The top-bar detail now exposes Production, Upkeep, Net, Coverage, Reserve horizon and shortage Pressure. Test zero-upkeep, sustainable upkeep and severe shortage cases, and confirm penalties match the catalog curves rather than only the displayed percentage.
- [ ] **Check resource-building potential gates.** Rural resource buildings can only reach the level supported by local potential. Make sure the UI says e.g. `Potential supports Level N` before the player spends anything and never offers an impossible next tier.
- [ ] **Check occupied-province economics.** Occupied territory currently produces at half output. Verify ownership transitions, reconnection/reload, and recapture do not leave the wrong modifier cached.

### Production / construction timing to re-playtest

- [ ] **Verify queue ETA against actual completion time at 1× and debug fast-forward — Code-audited.** Production ETA is derived from remaining work ÷ facility work rate ÷ the authoritative simulation speed. Start a unit, record the displayed ETA, and compare it to completion within normal rounding tolerance.
- [ ] **Balance-test advanced-unit production times.** Facility throughput rises with level (`1×, 1.3×, 1.65×, 2.05×, 2.5×, 3.1×, 3.8×, 4.7×`), but advanced-unit work rises much faster. Representative matched-level times at 1× are roughly: Level-I medium tank `1.25 h`; Level-IV `4.9 h`; Level-VI `12.9 h`; Level-VIII `38.3 h`. Level-VIII infantry is still about `15.3 h`. Decide whether this persistent-game pacing is intended.
- [ ] **Balance-test high-level construction times.** Building Levels VI–VIII are generated from the Level-V recipe using `1.45×`, `1.7×`, then `2×` growth. A typical Level-VIII upgrade is around `208–218 h` of construction work. Confirm this is intentional and clearly communicated before the resource spend.
- [ ] **Test queued-order semantics.** Costs are paid when queued; only the head order advances. Check multiple units/buildings in one province, ETA handoff after the head finishes, reload mid-queue, rally-point behavior on completion, and insufficient-resource feedback.
- [ ] **Clarify real time vs game time in all production/research surfaces.** At normal 1×, one simulation/game hour currently advances in one real hour. Debug speed multiplies this. Every `/h`, ETA and research duration should use language that cannot be misread as a turn-based or accelerated default clock.

### Technology system audit

- [ ] **Fresh browser playtest of Technology end-to-end — Code-audited, UI entry fixed on this branch.** The authoritative path exists: UI → `research` command → server `startResearch` → `stepTechnology` → projected progress → completion notification. Verify it manually after merge.
- [ ] **Verify all five branches actually gate/improve the intended content.**
  - **Infantry:** advanced infantry levels.
  - **Resources:** engineer levels plus higher resource-building tiers.
  - **Training:** higher military-building tiers, which increase facility throughput and gate higher unit levels.
  - **Hybrid:** armored cars, artillery and the strategic/nuclear path; Missile Site Level I additionally requires Hybrid VIII.
  - **Armored:** light and medium tank levels.
- [ ] **Verify one-project-at-a-time behavior and persistence.** Starting a second branch while one is active must fail cleanly; active branch, target level and progress must survive save/reload and reconnect without resetting or double-advancing. Also browser-test one pre-Technology save to confirm inferred migration floors match its existing buildings/units.
- [ ] **Balance-test research duration.** Level II→VIII projects take `6, 10, 16, 24, 32, 40, 48 h` respectively: `176 h` to take one branch I→VIII and `880 h` (~36.7 days at normal 1×) to max all five sequentially. Decide whether free research with these durations is the intended strategic tradeoff.
- [ ] **Decide whether research needs cancel/switch behavior.** There is intentionally only one active project now, but the player has no cancellation/change path. If that is deliberate, explain it before confirmation; otherwise add a safe cancel/switch rule.
- [ ] **Verify AI technology choices.** AI automatically starts research. Confirm it does not get stuck at a branch cap, chooses branches appropriate to what it can build, and does not receive impossible unit/building advantages.
- [ ] **Verify technology + Phase interaction.** Military construction is gated by both national Phase and Training technology; Missile Sites also require Phase III and Hybrid VIII. The authoritative time fallbacks are currently Phase II at `72 h` (~3 days) and Phase III at `168 h` (~7 days). Make locked reasons explicit and confirm those fallback timings are the intended balance.
- [ ] **Verify offline catch-up.** The current server replays elapsed downtime at normal 1×. Confirm research, production, construction, economy, movement and combat advance exactly once after restart and that the UI does not show a stale pre-restart ETA.



## P0 — Blockers and access control

- [ ] **Finish stale-save recovery UX — previously Verified crash, now Code-audited as hardened.** The current server catches restore/invariant failures, archives the incompatible save and starts a fresh runtime instead of crashing. Re-test the original `Invalid resource node` case and add a player-facing explanation that the old save was archived rather than silently presenting a fresh campaign.
- [x] **Account + password gated debug authorization — Implemented on this branch; browser/deployment verification still required.** Only `DimaTest1` (case-insensitive) receives the signed entitlement. `IRONFRONTS_DEBUG_CONTROLS_ENABLED=true` and a non-empty server-side `IRONFRONTS_DEBUG_PASSWORD` are also required. Ordinary/unauthenticated clients cannot unlock or send debug mutations.
  - [ ] Deploy to QA with a strong environment password and verify the command-dock/System-menu unlock, wrong-password response, reconnect behavior, Ctrl+D→E shortcut after unlock, and every cheat/time/weather action.
  - [ ] Confirm production keeps `IRONFRONTS_DEBUG_CONTROLS_ENABLED=false` unless explicitly running an approved QA deployment.
- [x] **Replace raw validation output on account creation — Code-audited as fixed.** Auth now maps credential validation failures to short field-specific messages instead of returning raw Zod JSON. Recheck visually during the next login pass.

## P1 — Core gameplay and combat

- [ ] **Rebalance or clarify combat pacing — Verified.** Battles with displayed attack values around `217–342 damage/h` changed by only about 1 HP every 10 seconds at normal speed. Even at 8× speed, a 300 HP defender took several minutes to defeat. Decide whether the problem is damage calculation, simulation-time conversion, tick frequency, or only misleading labels; then make the displayed values predict the observed result.
- [ ] **Explain damage columns and combat math — Verified.** `Damage / h` with `S / L / H` is not self-explanatory, and the near-symmetrical losses make attack and defence values feel disconnected from outcomes. Add tooltips or a combat breakdown showing unit contribution, terrain, stance, organization, casualties, and the time unit being used.
- [ ] **Make AI reactions meaningful — Verified / Requirement.** Poland and Belgium entered a `Defensive line`, but no defender counterattack, retreat, or AI reinforcement was observed. Define and implement the intended AI behavior: defend important provinces, reinforce threatened fronts when possible, counterattack when favorable, retreat when losing and a safe route exists, and react to captured territory.
- [ ] **Clarify unopposed attack behavior — Verified.** An attack on Płock moved a German force into Polish territory, then reported `Holding position`; the province still showed Polish allegiance/foreign ownership and there was no capture, occupation, or “no enemy found” explanation. Make the result explicit: either capture the province, start an occupation state, or reject the attack with a clear reason.
- [ ] **Explain invalid or unreachable targets — Verified.** Clicking an unreachable French target from Hamburg produced no feedback and left the army idle. Show a reason such as `Target is not reachable`, `No valid hostile force`, or `Attack route unavailable`.
- [ ] **Make stance changes visibly effective — Verified.** Clicking `Defend` during an active battle did not visibly change the combat overview, activity, or stats. Either allow stance changes with an immediate result or disable the controls while explaining why.
- [ ] **Improve retreat rules and messaging — Verified.** Active battles commonly show `No safe retreat`, while the Retreat action is disabled. Explain the blocked route and identify the nearest valid retreat province, or provide a deliberate emergency-retreat rule.
- [ ] **Improve stacked-army selection — Verified.** Clicking a battle marker cycles between the enemy army and the province, but it is difficult to inspect the friendly army opposing it. Provide a stack picker or a clear “friendly force / enemy force” toggle.
- [ ] **Show battle completion clearly.** Add a decisive result notification and post-battle state for victory, defeat, retreat, casualties, captured province, remaining organization, and what happens to the war aim.
- [ ] **Test multi-front AI behavior.** When Germany attacked Poland and Belgium, the player could create two fronts and reinforce Belgium. Add automated and manual checks for AI behavior when multiple wars, fronts, and supporting armies exist simultaneously.

## P1 — Persistence and session lifecycle

- [ ] **Make reload/resume state complete — Partially verified.** Reloading returned to the menu and `Continue` restored the country and active wars/battles, which is good. Verify that selected armies, orders, occupation state, production, extraction, diplomacy, combat HP, and notifications all restore consistently or are intentionally reset.
- [ ] **Prevent stale-save/world-version mismatches.** When world data changes, detect stale province/resource references before constructing the runtime. Archive the save with a useful reason and offer a clean continuation path instead of throwing during startup.
- [ ] **Reverify leaving a campaign — implementation has changed.** Return to Main Menu is now wired through confirmation + teardown while server autosave continues. Browser-test it during combat/production/research and confirm reconnect/Continue restores the authoritative operation without duplicate listeners or lost commands.

## P2 — Economy, numbers, and content clarity

- [ ] **Revalidate resource scale after the economy overhaul.** The old `90 stone / 120 metal / 70 oil` and `+74k funds/h` examples are obsolete. Use the 2026-09-14 opening-stockpile/output checks above to decide whether the new abstract units feel understandable and balanced.
- [ ] **Explain “game hour” and accelerated time.** The HUD, production estimates, combat rates, and debug speed use different-looking time scales. Show a short explanation of normal simulation speed and make all ETA/rate labels use the same authoritative conversion.
- [ ] **Audit all displayed numbers.** Check resource gains, manpower, food, extraction, unit HP, organization, entrenchment, speed, unit costs, production times, damage, defence, battle totals, and war-aim progress for unit consistency, rounding, and overflow.
- [ ] **Clarify `S / L / H`.** Spell out what the damage-profile columns mean instead of relying on initials.
- [ ] **Clean up campaign roster semantics — Verified.** The country picker mixes sovereign states, historical regions, colonies, provinces, and modern-looking administrative names. It also repeats generic `5 CITIES` data for many entries. Decide whether these are nations, playable regions, or scenario entities and explain the roster rules.
- [ ] **Use meaningful city and facility data.** Replace repeated placeholder-like city counts with scenario-appropriate names, counts, and production capacity, or label the values as prototype abstractions.
- [ ] **Review historical/scenario consistency.** The September 1939 framing is undermined by entries such as Alberta, Texas, British Odisha, Siberia, and Upper Volta appearing alongside countries. Either embrace an alternate-history world and explain it or constrain the roster to the scenario’s intended entities.

## P2 — UI, responsive layout, and interaction feedback

- [ ] **Fix narrow army-panel overflow — Verified.** At roughly 640px wide, combat/stat cells clip and concatenate values such as `Attack 23012769`; the panel has a wider internal scroll area hidden inside a narrow container. Reflow the table, shorten labels, or allow a deliberate readable horizontal scroll.
- [ ] **Fix narrow top-resource overflow — Verified.** Resource chips and map-mode labels are clipped at narrow widths even though the page itself does not expose a useful horizontal scrollbar. Provide a compact layout, wrapping, or a controlled scroll strip with visible affordance.
- [ ] **Audit all breakpoints.** Test 320, 375, 640, 806, 1024, and 1280px widths with menu, country picker, settings, diplomacy, province, army, combat, notifications, and system menu open.
- [ ] **Make map-mode differences legible — Verified.** Strategic, Political, Diplomacy, and Terrain modes change state, but the visual differences were subtle. Increase contrast/legend clarity and show the active mode’s purpose.
- [ ] **Improve marker discoverability.** Unknown, friendly, enemy, occupied, and battle markers are visually similar at map scale. Add a consistent legend and hover/selection treatment.
- [ ] **Explain disabled controls.** Disabled Economy/Objectives, Save, Return to Main Menu, and no-safe-retreat states should expose a short reason through visible text or a tooltip, not only visual dimming.
- [ ] **Review panel scroll behavior.** Diplomacy’s long list is acceptable, but ensure scrollbars match the visual skin, have enough contrast, and do not trap keyboard focus. Province/build/production panels need the same review.
- [ ] **Keep icon sizing consistent.** Desktop resource icons were consistent and the flag size appeared intentionally different. Recheck compact/mobile layouts so icons do not shrink below their click/recognition size.
- [ ] **Test keyboard and focus flow.** Verify tab order, Escape behavior, modal focus, screen-reader names, and recovery after closing diplomacy, split, war confirmation, and system dialogs.

## P2 — Performance, stability, and developer workflow

- [ ] **Investigate intermittent severe frame-rate readings.** Stable playtest readings were about 59–60 FPS with roughly 16.7ms frames, low CPU, and moderate GPU use. A previous automated reading showed about 1 FPS with 800ms frames, which was not reproduced; determine whether background-tab throttling, diagnostics, or the renderer can cause this.
- [ ] **Keep debug speed options consistent.** The UI exposed `16×`, while the documented server clamp was `8×`. Align the button list, protocol limit, server clamp, labels, tests, and documentation.
- [ ] **Prevent dev-server hot-reload from destroying a live operation.** Source changes/rebuilds previously returned the browser to the menu during a session. Preserve the operation state and show a reconnect/reload message when a development reload is unavoidable.
- [ ] **Add crash/error telemetry for QA.** Capture server startup restore failures, rejected orders, WebSocket disconnects, renderer initialization failures, and save failures with actionable context.
- [ ] **Run a long-session soak test.** Leave the map, economy, extraction, production, multiple fronts, and notifications running for at least one simulated day at normal speed and at the supported debug speed. Watch memory, FPS, socket health, save size, and event duplication.

## P3 — Copy, polish, and “good enough” checks

- [ ] **Keep loading/error states human-readable.** Loading screens are attractive, but every timeout and WebGPU failure should explain what happened and offer a recovery path.
- [ ] **Review notification lifecycle.** War, contact, reinforcement, extraction, order rejection, capture, and combat-result notifications should have consistent severity, duration, deduplication, and history behavior.
- [ ] **Remove accidental prototype language before release.** Review `PROTOTYPE`, `V0.1.0`, “not wired up,” “not available yet,” and development-only wording for the intended audience. Keep it only where it is deliberate.
- [ ] **Run a copy pass for AI/system voice.** Gameplay text did not show accidental AI filler, lorem ipsum, or unexplained em dashes during the playtest. Keep that standard across future events, errors, loading quotes, and diplomacy messages.
- [ ] **Add a clear first-time onboarding path.** The login and menu are visually strong, but a new player should understand country eligibility, permanent assignment, initial orders, war declarations, and how resources are spent without needing the debug panel.
- [ ] **Add confirmation and undo expectations to risky orders.** War declarations are confirmed well; movement, attack, split, extraction, production, and stance changes need consistent previews and a clear way to stop or correct mistakes.

## Verified strengths to preserve

- [x] Login, main menu, country picker, settings, diplomacy drawer, and notifications have a coherent dossier/WW2 visual language.
- [x] Desktop map rendering is detailed and attractive; no browser console errors appeared during the fresh multi-front session.
- [x] War confirmation and war-aim copy are clear.
- [x] Friendly reinforcement is visible and understandable once it happens.
- [x] Reload followed by `Continue` restored the live German campaign and active combat state.
- [x] Desktop icon sizing was broadly consistent; the country flag is intentionally larger.

## Recommended fix order

1. Merge/verify Technology dock access and secure World Inspector unlock.
2. Fresh economy/resource/production/technology browser playtest using the 2026-09-14 checks above.
3. Decide advanced-unit, construction and research time balance before more content depends on those curves.
4. Combat time/damage math and battle-result feedback.
5. AI counterattack/reinforcement/retreat behavior, including technology choices.
6. Unopposed-attack/capture edge cases and stacked-army selection.
7. Narrow army/topbar/technology panel responsiveness.
8. Save/archive recovery UX and full reload/offline-catch-up verification.
9. Road hierarchy/map readability pass.
10. Long-session performance soak, telemetry, copy and accessibility.
