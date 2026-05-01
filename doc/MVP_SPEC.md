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

Last reevaluated: **2026-05-01**.

- ✅ Milestones 0-3 are completed (repo/workspace foundation, backend baseline, Twitch OAuth auth flow, and idempotent EventSub Channel Point redemption ingestion with startup subscription auto-sync).
- 🟨 Milestone 4 is partially completed (authenticated player shell and inventory visibility exist; the full player actions loop egg -> identify -> incubate -> hatch -> select pet is still pending).
- ⏳ Milestone 5 is not started (incubation progression engine and hatch resolution flow are still pending).
- 🟨 Milestone 6 is partially completed (admin route protection, user search/detail, role mutation, admin logs, ledger view, test mystery egg grant + revert are implemented; freeze/reset/delete progress and full role lifecycle controls are still pending).
- ⏳ Milestones 7-10 are not started.

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

The player selects an unhatched egg and places it in an incubator slot.

### 4. Pet egg hatches

When incubation finishes, the pet is revealed.

The generated pet has:

- pet type
- base stats from pet type
- slight per-pet stat variance
- unique pet instance ID
- owner
- creation/hatch metadata

## Initial incubators

- Normal viewer: 1 incubator.
- Subscriber: +1 temporary subscriber incubator while subbed.

If a user loses the sub perk while an egg is already in the subscriber incubator, that egg should finish. After it finishes, the subscriber incubator is removed or becomes unavailable until the user is subbed again.

Later upgrades can add more incubators for non-subs.

## Stream acceleration

Incubation should continue over real time.

While the stream is live, incubation is faster. The system should support modifiers based on:

- stream live/offline state
- current viewer count
- future chat activity multiplier
- future event multipliers

MVP implementation may start with simple rules:

```text
Offline: 1.0x
Live: 2.0x
Live viewer multiplier: +0.01x per current viewer, capped at a configurable max
```

Example with 25 viewers and cap 3.0x:

```text
2.0x + 0.25x = 2.25x
```

The exact formula should be config-driven.

## MVP pets

MVP has 4 regular pets and 1 rare pet.

Suggested initial pet types:

| Pet type | Rarity | Role | HP | Attack | Defense | Speed |
|---|---:|---|---:|---:|---:|---:|
| Waldwachtel | Regular | Balanced | 100 | 10 | 8 | 12 |
| Glitzer-Spatz | Regular | Fast | 80 | 8 | 5 | 18 |
| Moorente | Regular | Tank | 120 | 7 | 12 | 7 |
| Turmeule | Regular | Striker | 90 | 14 | 7 | 10 |
| Goldener Erwin | Rare | Rare all-rounder | 110 | 13 | 10 | 13 |

Each hatched pet should get slight stat variance, for example ±10%, calculated server-side at hatch time.

## Egg loot table MVP

The system must support multiple egg types later. MVP initializes three mystery egg types: `common_mystery_egg`, `uncommon_mystery_egg`, and `rare_mystery_egg`.

Suggested granular loot table:

| Outcome | Probability | Result |
|---|---:|---|
| Resource small | 28% | 10 cracked eggs |
| Resource medium | 22% | 20 cracked eggs |
| Resource large | 12% | 35 cracked eggs |
| Resource huge | 6% | 60 cracked eggs |
| Pet | 8% | Waldwachtel unhatched egg |
| Pet | 8% | Glitzer-Spatz unhatched egg |
| Pet | 7% | Moorente unhatched egg |
| Pet | 7% | Turmeule unhatched egg |
| Rare pet | 2% | Goldener Erwin unhatched egg |

Total: 100%.

The content is determined when the player identifies/opens the mystery egg, not when the Channel Point redemption is processed.

## Resources and consumables

Initial resource:

- Cracked eggs

MVP cracked egg uses:

1. Buy consumables.
2. Buy hatchery upgrades.

Suggested MVP consumables:

| Consumable | Effect |
|---|---|
| Ei-Lupe | Reveals whether a mystery egg contains a pet before identifying it |
| Kraftfutter | Small permanent or temporary stat change to a selected pet, if implemented in MVP |
| Wärmekissen | Reduces remaining incubation time for one selected egg |

If time is limited, implement only `Wärmekissen` first and keep the data model ready for more.

Suggested MVP upgrades:

| Upgrade | Effect |
|---|---|
| Incubator Level 2 | Shortens incubation time by a small percentage |
| Incubator Level 3 | Larger incubation speed bonus |
| Incubator Level 4 | Larger incubation speed bonus |

## Bits and subs

Subs:

- Fixed transparent perk: +1 extra incubator while subbed.
- Current egg in that incubator finishes even if the sub ends.

Bits:

- Included in the event ingestion/data model from the start.
- MVP may expose fixed Bits effects only if implementation is simple and compliant.
- Bits must not buy random eggs or random pet outcomes.
- Bits may later trigger fixed, clearly described boosts such as a fixed hatch speed boost or fixed stream visual effect.

## Battle/event system

The event should not be hardcoded as “end of stream.” It is an admin-started game event that can be run any time.

MVP battle flow:

1. Player selects one pet as their event pet at any time.
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

Target resolution: 1920x1080.

MVP overlay routes:

```text
/overlay/alerts
/overlay/battle
```

### Alerts overlay

Shows who hatched what during stream with a visual representation of the pet.

Events to support:

- egg received
- egg identified
- pet egg started incubating
- pet hatched
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
