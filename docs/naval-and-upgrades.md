# Fleets, concealment and refits

Battleships, destroyers and submarines are native sea units, built at coastal Ordnance Works. Available level is the lower of Naval Logistics and the facility tier. They launch into navigable water and route around land. They cannot capture provinces or merge with land troops.

| Vessel | Role | Hull at I | Surface damage/h at I | Submarine damage/h at I | Range |
|---|---|---:|---:|---:|---:|
| Battleship | Heavy artillery; beats destroyers, vulnerable to torpedoes | 700 | 225 | 15 | 160 |
| Destroyer | Fast escort, sonar and depth charges | 300 | 87.5 | 250 | 26 |
| Submarine | Concealed anti-surface attacker | 170 | 375 | 100 | 26 |

These are full-strength base rates before supply, stance, health and frontage. Every unit has attack and defence entries against unarmored, light armor, heavy armor, surface ships and submarines. Ordinary coastal exchanges need 26 world units of contact. Artillery and battleships can fire at detected targets within their own weapon range. Ranged weapons do not fire a second time during a close naval exchange.

Submarine and militia camouflage equals troop level. Destroyer and armored-car reveal level equals troop level. A concealed formation is detected only when inside a sufficiently advanced detector's own outer vision radius (including shared allied vision). Territory ownership alone does not reveal it. Concealed troops automatically remain separate from visible troops during production and arrival merging, so submarines and militia do not accidentally lose concealment. Mixed technology levels use the lowest surviving camouflage level. Embarked cargo has no camouflage. Firing reveals a concealed army for one game hour, refreshed while firing; it can conceal again afterwards. Submarines hold fire without an attack order, even when detected; they return fire if attacked. Hidden positions and composition never enter a foreign player's projection.

Land armies at sea retain their cargo but fight as fragile convoy hulls: 10 HP per vessel at Naval Logistics I, rising to 30 at VIII. Their low defensive armament, hulls, speed and vision use transport technology. Sunk ships remove the corresponding cargo. Selecting a convoy shows its convoy portrait, hull statistics and cargo manifest.

Upgrade in the army command strip opens a server-priced review of every eligible troop. The target is its highest researched level. Materials cost the positive difference between old and new production costs, multiplied by surviving count; existing manpower is retained. All troop groups refit in parallel: army duration is half the largest increase in production work, with a minimum of half a game hour. The whole army is immobile until completion. Split before beginning to upgrade only part of it. Timers survive disconnects and restarts. Health percentage and experience are preserved; casualties during refitting never resurrect. A stale quote is rejected if composition or research changed.

The expanded roster uses wire protocol 6. Refresh clients after deployment; campaign save version 4 and both world packages remain compatible.
