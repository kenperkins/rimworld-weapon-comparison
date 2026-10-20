# RimWorld Weapon Compare

Side-by-side comparison of vanilla + DLC weapons: DPS, accuracy, armor penetration, expected damage vs. armor at a given range, and melee attack breakdowns.

Zero dependencies — Node ≥ 20 only.

```sh
npm run extract   # parse the installed game's XML defs into data/gamedata.json
npm start         # http://localhost:3000
npm test
```

`extract` auto-detects the Steam install on macOS/Linux/Windows; otherwise pass the game's `Data` directory: `npm run extract -- /path/to/RimWorld/Data` (or set `RIMWORLD_DATA`). It picks up whichever DLCs are installed.

## How the numbers are computed

All base stats come from the game's Defs, with `ParentName` inheritance resolved the same way the game does (`Inherit="False"`, list appending, `IsNull`). Quality factors, pawn accuracy curves and material multipliers are read from the StatDefs/stuff defs rather than hardcoded.

- **Ranged DPS** = damage × burst ÷ (warmup + (burst − 1) × burst gap + cooldown).
- **Hit chance** = weapon accuracy (interpolated between 3/12/25/40 cells) × shooter accuracy^distance, min 2.01%. No cover, weather, lighting or target size. Explosives are treated as always hitting.
- **Armor** uses the single-layer roll: effective armor = max(0, armor − AP); deflect if roll < eff/2, halve if roll < eff.
- **Melee** uses the game's verb selection: attacks within 95% of the best score share 75% of swings, those 25–95% share the rest, weaker ones are never used. DPS = weighted damage ÷ weighted cooldown.
- **Assumption:** an explicit tool `armorPenetration` (only the spear has one) scales with quality/material like damage.
- Pawn stats assume a healthy adult with no traits, implants, or gear.

State lives in the URL hash, so comparisons can be bookmarked or shared.

## Running it in a container

```sh
docker run -p 3000:3000 ghcr.io/kenperkins/rimworld-weapon-comparison
```

- `PORT` (default `3000`); `GET /healthz` returns `ok` for probes.
- Runs as UID 1000 and writes nothing, so a read-only root filesystem works.
- There's no save folder in the container, so save import uses the browser file picker; the save is parsed client-side and never uploaded.

Every push to `main` publishes `main-<UTC timestamp>-<sha>` (sortable, for image automation), `sha-<sha>` and `latest`.

## Game data

CI can't run `extract` (no game install), so `data/gamedata.json` is committed: after a RimWorld update, run `npm run extract` locally and commit the result. It contains stats and names only. Item descriptions go to `data/descriptions.json`, which is gitignored and shown when present, so they appear when you run from a local extract but not in the published image.

RimWorld and its data belong to Ludeon Studios; this is an unofficial fan tool.

## Unique weapons (Odyssey)

- **From your save:** the "Unique weapons from your save" panel lists every unique weapon in a `.rws` save (name, quality, traits, who's holding it) and loads one into either slot. The server finds them by scanning for unique `<def>`s and parsing only those elements, so a 20 MB save takes ~15 ms. Save folder is auto-detected; override with `RIMWORLD_SAVES`.
- **By hand:** pick a "unique" base and add up to 3 traits. Only traits valid for that weapon are offered, and traits sharing an exclusion tag (e.g. two ammo types) can't be combined.
- Trait stats apply in the game's order: (base + offsets) × factors, then quality. Effects outside the DPS model (abilities, tox/incendiary/EMP rounds, weather immunity) are listed as notes under the traits.
