# Ironfronts Playtest Fix List

Date: 2026-09-13  
Scope: login, menus, campaign setup, map, armies, resources, diplomacy, combat, AI response, persistence, responsive layout, performance, copy, and debug access.

This is a prioritized backlog from the live browser playtest. Items marked **Verified** were reproduced directly. Items marked **Requirement** are requested behavior that still needs implementation or an explicit product decision.

## P0 — Blockers and access control

- [ ] **Fix save restoration crash — Verified.** Restarting the game server with an existing campaign save can fail with `Invalid resource node.` in `state-invariants.ts`. A bad or stale resource-node reference should be migrated, repaired, or archived with a recoverable user-facing message. The server must not crash during startup.
- [ ] **Add account-based debug authorization — Requirement.** Only the account with the exact username `DimaTest1` may use debug controls. Username matching should be case-insensitive but the canonical account is `DimaTest1`.
  - The permission must be decided server-side from the authenticated account, not from `?debug`, `?benchmark`, browser state, or `NODE_ENV` alone.
  - `DimaTest1` may receive the debug/QA role in development and approved test environments.
  - Every other account must receive `debugEnabled: false`, must not see the Debug/World Inspector controls, and must not receive a usable debug state handle.
  - The server must reject unauthorized debug messages, including simulation-speed, time-of-day, weather, relation, and full-state inspection operations, even if a client sends them manually.
  - Production builds should keep debug controls disabled unless an explicit, separately protected deployment setting enables them.
  - Add tests for `DimaTest1`, a differently cased `dImAtEsT1` equivalent, a normal account, an unauthenticated client, and a forged client request.
- [ ] **Replace raw validation output on account creation — Verified.** A short password displays technical Zod JSON such as `too_small`, `minimum`, and `path`. Show a short human message beside the field, preserve the form, and keep technical details in logs only.

## P1 — Core gameplay and combat

- [ ] **Rebalance or clarify combat pacing — Verified.** Battles with displayed attack values around `217–342 damage/h` changed by only about 1 HP every 10 seconds at normal speed. Even at 8× speed, a 300 HP defender took several minutes to defeat. Decide whether the problem is damage calculation, simulation-time conversion, tick frequency, or only misleading labels; then make the displayed values predict the observed result.
- [ ] **Explain damage columns and combat math — Verified.** `Damage / h` with `S / L / H` is not self-explanatory, and the near-symmetrical losses make attack and defence values feel disconnected from outcomes. Add tooltips or a combat breakdown showing unit contribution, terrain, stance, casualties, and the time unit being used.
- [ ] **Make AI reactions meaningful — Verified / Requirement.** Poland and Belgium entered a `Defensive line`, but no defender counterattack, retreat, or AI reinforcement was observed. Define and implement the intended AI behavior: defend important provinces, reinforce threatened fronts when possible, counterattack when favorable, retreat when losing and a safe route exists, and react to captured territory.
- [ ] **Clarify unopposed attack behavior — Verified.** An attack on Płock moved a German force into Polish territory, then reported `Holding position`; the province still showed Polish allegiance/foreign ownership and there was no capture, occupation, or “no enemy found” explanation. Make the result explicit: either capture the province, start an occupation state, or reject the attack with a clear reason.
- [ ] **Explain invalid or unreachable targets — Verified.** Clicking an unreachable French target from Hamburg produced no feedback and left the army idle. Show a reason such as `Target is not reachable`, `No valid hostile force`, or `Attack route unavailable`.
- [ ] **Make stance changes visibly effective — Verified.** Clicking `Defend` during an active battle did not visibly change the combat overview, activity, or stats. Either allow stance changes with an immediate result or disable the controls while explaining why.
- [ ] **Improve retreat rules and messaging — Verified.** Active battles commonly show `No safe retreat`, while the Retreat action is disabled. Explain the blocked route and identify the nearest valid retreat province, or provide a deliberate emergency-retreat rule.
- [ ] **Improve stacked-army selection — Verified.** Clicking a battle marker cycles between the enemy army and the province, but it is difficult to inspect the friendly army opposing it. Provide a stack picker or a clear “friendly force / enemy force” toggle.
- [ ] **Show battle completion clearly.** Add a decisive result notification and post-battle state for victory, defeat, retreat, casualties, captured province, and what happens to the war aim.
- [ ] **Test multi-front AI behavior.** When Germany attacked Poland and Belgium, the player could create two fronts and reinforce Belgium. Add automated and manual checks for AI behavior when multiple wars, fronts, and supporting armies exist simultaneously.

## P1 — Persistence and session lifecycle

- [ ] **Make reload/resume state complete — Partially verified.** Reloading returned to the menu and `Continue` restored the country and active wars/battles, which is good. Verify that selected armies, orders, occupation state, production, extraction, diplomacy, combat HP, and notifications all restore consistently or are intentionally reset.
- [ ] **Prevent stale-save/world-version mismatches.** When world data changes, detect stale province/resource references before constructing the runtime. Archive the save with a useful reason and offer a clean continuation path instead of throwing during startup.
- [ ] **Make leaving a campaign intentional.** The system menu says returning to the main menu is not wired up. Either implement it safely with an autosave confirmation or remove/disable the dead-end option until it is available.

## P2 — Economy, numbers, and content clarity

- [ ] **Define realistic resource scales — Verified.** Initial stockpiles such as `90 stone`, `120 metal`, and `70 oil` sit beside very large rates such as `+74,335.1 funds/h` and `+21,297.3 manpower/h`. Decide whether these are abstract balance units or realistic quantities, then label them accordingly and use consistent rounding.
- [ ] **Explain “game hour” and accelerated time.** The HUD, production estimates, combat rates, and debug speed use different-looking time scales. Show a short explanation of normal simulation speed and make all ETA/rate labels use the same authoritative conversion.
- [ ] **Audit all displayed numbers.** Check resource gains, manpower, food, extraction, unit HP, entrenchment, speed, unit costs, production times, damage, defence, battle totals, and war-aim progress for unit consistency, rounding, and overflow.
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

1. Save restore crash and stale-world migration.
2. Server-side DimaTest1-only debug authorization.
3. Combat time/damage math and battle-result feedback.
4. AI counterattack/reinforcement/retreat behavior.
5. Unreachable-target and unopposed-attack feedback.
6. Narrow army/topbar overflow.
7. Economy/unit scale and scenario-content clarity.
8. Performance soak testing, developer reload handling, and final copy/accessibility pass.
