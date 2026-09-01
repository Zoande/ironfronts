# ChatGPT generated icon pack for Claude

These images were generated for Ironfronts and committed under `material/` as a staging pack for Claude to integrate into the actual game UI.

## `approved-icons/`

Preferred transparent, icon-style assets:

- `infantry.webp`
- `armored-car.webp`
- `tank.webp`
- `artillery.webp`
- `barracks.webp`
- `tank-plant.webp`
- `fortress.webp`
- `command-attack.webp`
- `command-defend.webp`
- `command-retreat.webp`

These are intended to replace placeholder / borrowed-reference-looking unit, building, and command imagery. They are deliberately cut out on transparent backgrounds and designed to remain readable at small UI sizes.

## Claude integration notes

1. Prefer these icons for production cards, building cards, and command buttons.
2. Do not reintroduce Call of War prototype/reference art into shipping assets.
3. Preserve existing gameplay behavior while replacing the art.
4. For roster items with no final icon yet (for example engineer/light tank/medium tank), create a matching transparent icon rather than using copyrighted prototype art.
5. Repository copies are 128x128 WebP assets, suitable for small UI icon use while keeping `main` lean.
