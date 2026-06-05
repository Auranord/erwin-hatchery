# Product MVP

## Product vision

Erwin Hatchery is a cozy, chaotic fantasy pet battler around Erwin, the NTKOH quail mascot. Viewers use Twitch Channel Points to collect **Beta Ei** mystery eggs, hatch pets, and participate in stream events.

## Core loop

1. Viewer redeems the Hatchery-synced Channel Point reward `[Erwin Hatchery] Beta Ei`.
2. Hatchery creates one counted mystery egg for the Twitch user.
3. Viewer logs in with Twitch. A provisional redemption user links to the authenticated player.
4. New players receive one server-ledgered `starter_egg`.
5. Player identifies mystery eggs.
6. An identified mystery egg becomes either:
   - cracked egg resources, or
   - an unhatched pet egg.
7. Player queues unhatched eggs in incubator slots.
8. Incubation progresses only while the stream is live.
9. Completed eggs hatch into owned pets with server-generated permanent stats.
10. Player selects one pet for the next admin-started stream event.
11. Admin starts a battle/event. MVP battle can remain random 1st/2nd/3rd among selected pets.
12. Winners get leaderboard points 3/2/1. Events are persisted and reversible where practical.

## Language

- Player/admin UI: mostly German.
- Pet/item flavor can mix German and English if it fits.
- Code, API names, comments, and internal docs: English.

## Twitch reward

MVP Channel Point reward:

```text
Name: [Erwin Hatchery] Beta Ei
Default cost: 1000
Effect: Adds one Beta Ei to the viewer's Erwin Hatchery account.
```

Hatchery syncs rewards from `egg_types` through `erwin-gateway`. Active MVP egg type is `beta_egg`; inactive first-login egg type is `starter_egg`.

## Egg rules

- Mystery eggs are counted balances per user and egg type.
- Channel Point redemptions increment the mystery egg balance.
- Mystery egg contents are rolled when the player identifies/opens the egg, not at redemption time.
- Identifying into an unhatched egg requires free unhatched-egg inventory space.
- Identifying into cracked egg resources does not require slotted inventory space.

## Beta egg loot table

`beta_egg` uses integer weights totaling 3600:

- Pet outcomes total 1200, about one third.
- `cracked_eggs` resource outcomes total 2400, about two thirds.
- Resource outcomes: 50, 100, 200 cracked eggs, equal weight.
- Pet rarity distribution within pet outcomes:
  - Common 70%
  - Uncommon 20%
  - Rare 7%
  - Epic 2.75%
  - Legendary 0.25%

`starter_egg` uses only Uncommon pets and no resource outcomes.

## Pets

- `pet_species` stores templates/defaults.
- `pets` stores owned instances.
- Hatch generation copies rarity/class/element/default ability from species to pet.
- Hatch generation applies permanent stat variance server-side.
- Pets start level 0, experience 0, favorite false.
- Rarity is display/economy/recycle metadata only. It is not a stat multiplier.
- Cosmetic hats never affect stats, AP gain, ability effects, or battle stack logic.

## Inventories

- Counted balances:
  - mystery eggs
  - resources such as `cracked_eggs` and `voucher`
- Slotted inventories:
  - unhatched eggs
  - pets
  - consumables
  - equipment
  - incubator queue slots
- Hat unlocks are catalog/progression rows, not slotted items.

## Incubation

- Every player has one default incubator queue slot.
- Players can buy more queue slots with cracked eggs.
- Queueing an egg frees its unhatched-egg inventory slot and occupies an incubator queue slot.
- If stream is live and no egg is running, the next queued egg starts automatically.
- Progress is accumulated from timestamps only while the stream is live.
- Completed jobs can wait to be claimed while the next queued job starts.

## Shops and training

- Basic weekly shop sells fixed equipment/consumables for cracked eggs.
- Subscriber shop sells fixed pet+hat pairs for voucher.
- Duplicate pet training is server-authoritative, consumes valid same-species materials, writes ledger, and updates concrete stat deltas.
