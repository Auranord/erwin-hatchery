# MVP Spec - Erwin Hatchery

## Product vision

A fantasy pet battler built around Erwin, the NTKOH quail mascot. Viewers use Twitch Channel Points, called eggs, to collect mystery eggs, hatch pets, and participate in stream events. The vibe should be cozy, chaotic, fantasy, and community-focused.

## Language

- UI: mostly German.
- Pet names, item names, and flavor text may mix German and English if it feels fun.
- Code and internal docs: English.

## Twitch reward

Initial custom Channel Point reward:

```text
Name: 1x Mystery Ei
Cost: 500
Effect: Adds one Basic Mystery Egg to the viewer's Erwin Hatchery account.
```

The reward is created manually in Twitch for the MVP. The Twitch reward ID is configured through `.env`.

## Current MVP implementation status

Last reevaluated: **2026-05-11**.

- ✅ Milestones 0-3 are completed (repo/workspace foundation, backend baseline, Twitch OAuth auth flow, and idempotent EventSub Channel Point redemption ingestion with startup subscription auto-sync).
- ✅ Milestone 4 is completed (authenticated player shell, live slotted inventory visibility, mystery egg identify, incubate -> hatch flow, pet selection, server-authoritative inventory moves, and public leaderboard are implemented).
- ✅ Milestone 5 is completed (timestamp-based incubation flow, stream-online validation, stream-state integration, and hatch resolution are implemented).
- 🟨 Milestone 6 is partially completed (admin route protection, user search/detail, role mutation, admin logs, ledger view, test mystery egg grants + ledger revert are implemented; freeze/reset/delete progress and full role lifecycle controls are still pending).
- ✅ Milestone 7 is completed (admin battle start flow with random winners, leaderboard awards, participant/result persistence, pet deselection, and dedicated battle revert flow are implemented).
- ✅ Milestone 8 is completed (secret-protected overlay routes `/overlay/alerts` + `/overlay/battle`, SSE integration, hatch alerts, battle winners, and leaderboard snapshot display are implemented).
- 🟨 Milestone 9 is partially completed (subscription EventSub auto-sync/ingestion, subscriber status cache, subscription gift ingestion, and fixed Gutschein resource grants are implemented; Bits ingestion/effects are still pending).
- 🟨 Milestone 10 is partially completed (production Docker image, GHCR branch tagging, TrueNAS example with Postgres/init/health checks, production env validation, secure production cookies, and frontend fallback routing are implemented; rate limiting, explicit CORS middleware, and backup scripts/restore notes are still pending).

## Player states

A Twitch user can exist in three practical states:

1. **Provisional player**
   - Created from Channel Point redemption before first login.
   - Can receive eggs.
   - Cannot interact with inventory until login.

2. **Authenticated player**
   - Logged in with Twitch.
   - Can manage eggs, incubators, pets, selected battle pet, and account deletion.

3. **Deleted/anonymized player**
   - User requested deletion.
   - Personal data removed/anonymized.
   - Economy objects can be deleted or anonymized based on implementation policy.

## Core inventories

Each player needs separate inventories for:

- Mystery eggs (integer balance per egg type, not individual rows)
- Unhatched eggs
- Hatched pets
- Cosmetic hats
- Consumables
- Resources, starting with cracked eggs

## Egg lifecycle

### 1. Mystery egg created

A Twitch Channel Point redemption increments the player's mystery egg balance for that egg type by +1.

The exact outcome is rolled when the player identifies/opens an egg, in a server transaction with ledger rows.

### 2. Egg identified

The player identifies a mystery egg in the web UI.

Outcome A: egg cracks into resources.

- Player receives cracked eggs.
- Mystery egg is consumed.

Outcome B: egg contains a pet.

- Pet species remains hidden.
- Mystery egg is consumed.
- An unhatched egg is added to the pet egg inventory.

### 3. Pet egg incubated

The player selects or drags an unhatched egg and places it onto an available incubator drop target.

### 4. Pet egg hatches

When incubation finishes, the pet is revealed.

The generated pet has:

- pet species
- permanent base stats derived from species defaults plus hatch variance
- exactly one rarity, class, element, and individual ability assigned to the owned pet instance from the species database row; the initial ability is copied from the species default and can be changed later by training
- unique pet instance ID
- owner
- creation timestamp, which is the hatch time for normal hatches

## Initial incubator

- Every player starts with exactly one standard incubator.
- There are no admin-granted incubators and no subscriber incubators in the MVP.
- The incubator is modeled as a fixed incubator area with queue slots. Two queue slots are enabled at launch; additional slots are future upgrades and must stay disabled until explicitly enabled.

## Stream-gated incubation

Incubators accept queued eggs while the stream is online or offline, but countdown progress is accumulated only while the stream is online. If an egg is waiting in the queue and no other egg is running, the backend starts incubation automatically as soon as the stream is live.

The system should still keep room for future modifiers while the stream is live:

- current viewer count
- future chat activity multiplier
- future event multipliers

MVP implementation starts with simple live-only rules:

```text
Offline: eggs can be queued, but no countdown progress is added
Live: the first queued egg starts automatically and uses live/viewer multiplier settings
Live + high chat activity: optional future multiplier
```

## MVP pets

MVP has a 30-species Beta pet pool seeded behind one egg type, `beta_egg` (`Beta Ei`). Erwin is not a pet.

Definitions:

- `pet_species` defines species templates, default stats, fixed rarity/class/element assignments, and the shared MVP baseline ability `beta_instinct`.
- `pets` stores owned pet instances with their own permanent base stats, individual ability, level, experience, and favorite flag.
- A hatched pet starts from species defaults plus server-side hatch variance, copies the species rarity/class/element assignments and default ability into the `pets` row, starts at level 0 with 0 experience, and is not a favorite by default. Later training or fusion systems may permanently change the owned pet's progression, base stats, or ability without changing the species template. Future fusion selection must exclude favorite pets as materials unless the favorite flag is removed first.
- The seeded MVP pool does not include traits. The trait tables remain schema-only for future training/content systems.
- Seeded default stats are fixed by rarity: Common 10 in each non-HP stat, Uncommon 12, Rare 14, Epic 16, Legendary 18, with HP equal to that value times 10.
- Each seeded pet has exactly one class and one element. Fire, water, air, and earth are normal elements; light is reserved for the legendary pet.
- Each pet may equip one cosmetic hat. Hats are cosmetic only and must not affect combat stats.
- Gems are equipment-set items rather than direct pet equipment. The seed data includes themed gem equipment in three tiers with explicit `config.statBonuses`: +1/+2/+3 for ATK, DEF, SPD, GAIN, and POW, plus +10/+20/+30 HP. Seeded gem future shop metadata uses cracked-egg `resource_price`/`stock` pairs of 250/10 for tier 1, 750/5 for tier 2, and 1500/2 for tier 3, with `is_shop_purchasable = true` for all seeded gems. Final event stat aggregation can consume these config values later; paid random gem rewards are not part of the MVP.

Seeded class roles:

| Class | Enemy stat debuffed |
| --- | --- |
| Protector | ATK |
| Sunderer | DEF |
| Saboteur | SPD |
| Drainer | GAIN |
| Nullifier | POW |

Seeded pet rarity weight totals within the `beta_egg` pet subset:

| Rarity | Total weight | Chance |
| --- | ---: | ---: |
| Common | 840 | 70.00% |
| Uncommon | 240 | 20.00% |
| Rare | 84 | 7.00% |
| Epic | 33 | 2.75% |
| Legendary | 3 | 0.25% |

## Egg loot table MVP

The system must support more egg types later. MVP initializes one active egg type: `beta_egg` (`Beta Ei`). Its loot table has integer pet weights totaling 1200 and three `cracked_eggs` resource outcomes weighted 800 each, for a total table weight of 3600. This makes pet outcomes about one third of identified Beta eggs and egg resource outcomes about two thirds.

Per-pet weights are 70 for each Common pet, 30 for each Uncommon pet, 14 for each Rare pet, 11 for each Epic pet, and 3 for the Legendary pet. Resource outcomes grant 50, 100, or 200 `cracked_eggs`; each amount has equal weight. The backend validates seed pet totals before writing the pool.

The content is determined when the player identifies/opens the mystery egg, not when the Channel Point redemption is processed.

## Resources and consumables

Initial resource:

- Cracked eggs

MVP cracked egg uses:

1. Buy consumables.
2. Buy hatchery upgrades.

Suggested MVP consumables:

| Consumable  | Effect                                                                            |
| ----------- | --------------------------------------------------------------------------------- |
| Ei-Lupe     | Reveals whether a mystery egg contains a pet before identifying it                |
| Kraftfutter | Small permanent or temporary stat change to a selected pet, if implemented in MVP |
| Wärmekissen | Reduces remaining incubation time for one selected egg                            |

Seeded consumable content now includes 30 sweets-themed pet stat tradeoffs covering every ordered pair among HP, ATK, DEF, SPD, GAIN, and POW: each sweet grants +1 to one stat and -1 to a different stat. Their German display names hint at the tradeoff through flavor text rather than using the stat names directly. Each seeded sweet carries future shop metadata of `resource_price = 100` cracked eggs, `stock = 25`, and `is_shop_purchasable = true`.

If time is limited, implement only `Wärmekissen` first and keep the data model ready for more.

Suggested MVP upgrades:

| Upgrade           | Effect                                         |
| ----------------- | ---------------------------------------------- |
| Incubator Level 2 | Shortens incubation time by a small percentage |
| Incubator Level 3 | Larger incubation speed bonus                  |
| Incubator Level 4 | Larger incubation speed bonus                  |
| Inventory row    | Adds one row to a slotted inventory; costs 500 Aufgebrochene Eier for the first row on each inventory and doubles after every upgrade |
| Equipment set slot | Adds one slot to every current equipment set and all future sets; costs 500 Aufgebrochene Eier for the first slot upgrade and doubles after every upgrade |
| Additional equipment set | Adds one extra equipment set using the current global set slot count; costs 500 Aufgebrochene Eier for the first additional set and doubles after every set purchase |

## Bits and subs

Subs:

- Fixed transparent perk: subscribers receive the special egg resource `voucher` (German UI label: **Gutschein**) once per subscription event.
- For gifted subscriptions, the gifted player receives a Gutschein through the recipient subscribe event and the gifter receives one Gutschein per gifted subscription through the gift event. Anonymous gifts can only grant the recipient side because there is no gifter identity to credit.
- Subscriptions no longer grant incubators.

Bits:

- Included in the event ingestion/data model from the start.
- MVP may expose fixed Bits effects only if implementation is simple and compliant.
- Bits must not buy random eggs or random pet outcomes.
- Bits may later trigger fixed, clearly described boosts such as a fixed hatch speed boost or fixed stream visual effect.

## Battle/event system

The event should not be hardcoded as “end of stream.” It is an admin-started game event that can be run any time. Existing MVP battle placement can remain random. Do not implement boss-event combat logic in code yet; the RPG rules below are documentation-only for a later pass.

MVP battle flow:

1. Player selects one pet as their event pet by dropping or tap-targeting a pet into the fixed Event-Pet slot above the pet inventory. The pet remains in the pet inventory and is highlighted there.
2. Admin opens admin UI and starts a battle event.
3. Backend collects all currently selected pets.
4. If fewer than 3 selected pets exist, still run with available participants or show a clear admin warning.
5. MVP randomly selects 1st, 2nd, and 3rd place from selected pets.
6. Awards leaderboard points:
   - 1st: 3 points
   - 2nd: 2 points
   - 3rd: 1 point
7. Battle overlay displays winners with pet visuals.
8. Event is written as a game event and ledger entries.
9. Selected pets from the event are deselected after the event.
10. Admin can revert the event, removing the awarded leaderboard points.

Future battle versions can use pet stats, consumables, cosmetic hats, training, or animation stages, but hats must remain cosmetic and must not alter combat stats.

Future boss-event RPG rules:

- Current AP, current HP, attacks made, and effective stats are runtime state on boss-event participant state, not on the pet.
- Boss class stacks and boss element stacks are runtime boss-event state, not pet state.
- `pet_abilities.ap_required` defines the AP needed to automatically trigger an ability.
- Abilities auto-trigger when `current_ap >= ability.ap_required` and `attacks_made >= ability.min_attacks_required`.
- Each attack grants 20 base AP. GAIN modifies AP gained per attack. POW scales ability effects.
- Rarity must not modify AP gain, stat values, ability effects, or stack values.

## Overlays

Target resolution: battle overlays use 1920x1080. The alerts overlay is a compact transparent OBS source sized 600x260.

MVP overlay routes:

```text
/overlay/alerts
/overlay/battle
```

### Alerts overlay

Shows one temporary in-game event message at a time with fade-in/fade-out animation. The backend emits normalized alert payloads so future event types can reuse the same overlay queue.

Events to support:

- egg received
- egg identified
- pet egg started incubating
- pet hatched (implemented)
- rare pet hatched
- consumable used

### Battle overlay

Separate overlay for the battle/event UI and animations.

Shows:

- event start
- participants count
- suspense/animation placeholder
- 1st/2nd/3rd winners
- pet visuals
- points awarded

## Account deletion

Users must be able to delete their account/progress from the authenticated UI.

For MVP, deletion may:

- remove personal data
- delete game inventory
- anonymize or remove leaderboard entries
- preserve non-personal ledger rows only if needed for audit/revert integrity

Implement this in a simple and transparent way.

## Milestone 3 completion notes

- Channel Point redemption webhook processing is idempotent and only grants mystery egg inventory (no hatch outcome resolution yet).
- Mystery egg outcome is resolved on identify/open in the player action flow.
- Webhook replay safety is enforced through EventSub event ID and redemption ID uniqueness.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` and `voucher` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies only to slotted inventories: unhatched eggs, pets, consumables, equipment, and hats. Incubators are fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion.
- Standard grid dimensions are 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables, equipment, and hats.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- The Event-Pet selector is shown directly above the pet inventory as a fixed drop target with stat labels. Selecting a pet does not move it out of the pet inventory; the original inventory slot stays occupied and is highlighted.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the job stays running, the egg stays incubating, no pet is created, and the incubator remains occupied.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space. Scrapping a pet deletes the pet after explicit confirmation, grants `cracked_eggs` from rarity recycle metadata, and writes a ledger row; rarity still never multiplies stats.
- Consumables, equipment, and cosmetic hats are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Equipment also supports server-authoritative equipment sets: every player receives one default 3-slot set, items in a set are removed from the normal equipment grid, and one set can be marked as the battle Event-Set. Players can spend `cracked_eggs` on set upgrades: a slot upgrade adds one slot to every current set and all future sets, while an additional-set purchase creates another set with the current upgraded slot count. Unhatched eggs, consumables, equipment, and hats expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.

## Reward-ingestion milestone rules

First-run setup blocks Twitch-dependent game/admin features until broadcaster OAuth, required-scope verification, EventSub sync, active-subscription backfill, and Bits leaderboard backfill have completed. Normal subscription events grant `+1 voucher` to the subscriber. Resubscription message events also grant `+1 voucher`; this MVP intentionally treats each monthly resub message as a fixed transparent Gutschein grant. Gift-sub events grant `+1 voucher` per gifted subscription to a non-anonymous gifter and `+1 voucher` to each identifiable recipient. Bits events grant Gutscheine only when counted Bits cross `TWITCH_BITS_PER_VOUCHER` thresholds; anonymous Bits are audited but do not grant user vouchers.

All reward ingestion is server-authoritative, idempotent by Twitch EventSub message IDs or stable backfill keys, and every resource mutation writes `resources` plus an immutable `economy_ledger` row in the same transaction. Paid random rewards remain out of scope and prohibited.
