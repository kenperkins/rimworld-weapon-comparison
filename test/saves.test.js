import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findUniqueWeapons } from '../scripts/saves.js';

const SAVE = `<savegame><game><maps><li><things>
  <thing Class="ThingWithComps">
    <def>Gun_Revolver_Unique</def>
    <id>Gun_Revolver_Unique42</id>
    <health>80</health>
    <quality>Masterwork</quality>
    <traits><li>QuickReload</li><li>CustomGrip</li></traits>
    <name>Old Faithful</name>
  </thing>
  <thing Class="Pawn">
    <def>Human</def>
    <name Class="NameTriple"><first>Ada</first><nick>Ace</nick><last>Byron</last></name>
    <equipment><equipment><innerList>
      <li>
        <def>Gun_LMG_Unique</def>
        <id>Gun_LMG_Unique7</id>
        <verbTracker><verbs><li Class="Verb_Shoot"><loadID>x</loadID></li></verbs></verbTracker>
        <quality>Good</quality>
        <traits><li>ExtendedMagazine</li></traits>
        <name>Brrt</name>
      </li>
    </innerList></equipment></equipment>
  </thing>
  <tale><def>Gun_LMG_Unique</def></tale>
</things></li></maps></game></savegame>`;

test('finds unique weapons with quality, traits, and holder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rwsave-'));
  const file = path.join(dir, 'test.rws');
  fs.writeFileSync(file, SAVE);
  const found = await findUniqueWeapons(file, new Set(['Gun_Revolver_Unique', 'Gun_LMG_Unique']));
  fs.rmSync(dir, { recursive: true });

  assert.equal(found.length, 2);
  const [rev, lmg] = found;
  assert.deepEqual(
    { name: rev.name, quality: rev.quality, traits: rev.traits, location: rev.location, hitPoints: rev.hitPoints },
    { name: 'Old Faithful', quality: 'Masterwork', traits: ['QuickReload', 'CustomGrip'], location: 'on map', hitPoints: 80 },
  );
  assert.deepEqual(
    { name: lmg.name, quality: lmg.quality, traits: lmg.traits, location: lmg.location, holder: lmg.holder },
    { name: 'Brrt', quality: 'Good', traits: ['ExtendedMagazine'], location: 'equipped', holder: 'Ace' },
  );
});
