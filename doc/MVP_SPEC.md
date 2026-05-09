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

Last reevaluated: **2026-05-09**.

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

- Pet type remains hidden.
- Mystery egg is consumed.
- An unhatched egg is added to the pet egg inventory.

### 3. Pet egg incubated

The player selects or drags an unhatched egg and places it onto an available incubator drop target.

### 4. Pet egg hatches

When incubation finishes, the pet is revealed.

The generated pet has:

- pet type
- base stats from pet type
- slight per-pet stat variance
- unique pet instance ID
- owner
- creation/hatch metadata

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

MVP has 4 regular pets and 1 rare pet.

Suggested initial pet types:

| Pet type       |  Rarity | Role             |  HP | Attack | Defense | Speed |
| -------------- | ------: | ---------------- | --: | -----: | ------: | ----: |
| Waldwachtel    | Regular | Balanced         | 100 |     10 |       8 |    12 |
| Glitzer-Spatz  | Regular | Fast             |  80 |      8 |       5 |    18 |
| Moorente       | Regular | Tank             | 120 |      7 |      12 |     7 |
| Turmeule       | Regular | Striker          |  90 |     14 |       7 |    10 |
| Goldener Erwin |    Rare | Rare all-rounder | 110 |     13 |      10 |    13 |

Each hatched pet should get slight stat variance, for example ±10%, calculated server-side at hatch time.

## Egg loot table MVP

The system must support multiple egg types later. MVP initializes three mystery egg types: `common_mystery_egg`, `uncommon_mystery_egg`, and `rare_mystery_egg`.

Suggested granular loot table:

| Outcome         | Probability | Result                       |
| --------------- | ----------: | ---------------------------- |
| Resource small  |         28% | 10 cracked eggs              |
| Resource medium |         22% | 20 cracked eggs              |
| Resource large  |         12% | 35 cracked eggs              |
| Resource huge   |          6% | 60 cracked eggs              |
| Pet             |          8% | Waldwachtel unhatched egg    |
| Pet             |          8% | Glitzer-Spatz unhatched egg  |
| Pet             |          7% | Moorente unhatched egg       |
| Pet             |          7% | Turmeule unhatched egg       |
| Rare pet        |          2% | Goldener Erwin unhatched egg |

Total: 100%.

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

If time is limited, implement only `Wärmekissen` first and keep the data model ready for more.

Suggested MVP upgrades:

| Upgrade           | Effect                                         |
| ----------------- | ---------------------------------------------- |
| Incubator Level 2 | Shortens incubation time by a small percentage |
| Incubator Level 3 | Larger incubation speed bonus                  |
| Incubator Level 4 | Larger incubation speed bonus                  |

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

The event should not be hardcoded as “end of stream.” It is an admin-started game event that can be run any time.

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

Future battle versions can use pet stats, items, training, or animation stages.

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
- Capacity applies only to slotted inventories: unhatched eggs, pets, and consumable/item stacks. Incubators are fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion.
- Standard grid dimensions are 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and 8 columns × 3 base rows for items.
- The standard incubator is shown directly above the unhatched egg grid as a fixed drop target/queue area. Queueing incubation requires the chosen unhatched egg and an available standard incubator queue slot.
- The Event-Pet selector is shown directly above the pet inventory as a fixed drop target with stat labels. Selecting a pet does not move it out of the pet inventory; the original inventory slot stays occupied and is highlighted.
- Queueing incubation validates ownership and queue-slot availability, frees the unhatched egg inventory slot, occupies the incubator queue slot, creates a queued or running incubation job, and writes a ledger row. Running jobs accumulate countdown progress only while the stream is live.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the job stays running, the egg stays incubating, no pet is created, and the incubator remains occupied.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space. Scrapping a pet deletes the pet after explicit confirmation, grants `cracked_eggs` based on rarity, and writes a ledger row.
- Consumables/items are represented as slotted stacks with server-side move, merge, and swap validation. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.
