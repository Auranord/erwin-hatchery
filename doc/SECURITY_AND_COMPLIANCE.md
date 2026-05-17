# Security and Compliance - Erwin Hatchery MVP

This is not legal advice. It is a product and engineering guardrail document for building a lower-risk Twitch community game.

## Safe concept boundary

The safe version of Erwin Hatchery is:

- Channel Points create random mystery eggs.
- Eggs, pets, resources, consumables, upgrades, cosmetics, and leaderboard points are stream-only digital fun.
- No item has real-world value.
- Nothing can be cashed out.
- Nothing is tradeable between viewers.
- No giveaway tickets or prize entries are connected to the game.
- No betting or wagering on battles.
- Bits and subs only create fixed, transparent, non-random effects/perks.

## Twitch guardrails

Twitch Channel Points are channel-specific digital content, not money. They must not be sold, traded, transferred, or exchanged for items with value outside Twitch. Twitch also prohibits Channel Point redemption opportunities that constitute gambling.

Design consequence:

- Channel Points may be used for random eggs only if all outcomes are no-value, non-transferable, and stream-only.
- Do not call the mechanic lootboxes, gambling, betting, wagering, or casino-like terms.
- Use language like mystery egg, hatch, incubator, quail hatchery, pet egg.

Bits/subs:

- Bits/subs must not create random eggs or mystery rewards.
- Bits may later trigger fixed effects such as a known hatch speed boost or known overlay animation.
- Subs grant fixed Gutschein resources only; they do not grant random eggs, random pets, or extra incubators.
- Avoid any paid action that determines a random reward.

Giveaways:

- Do not connect this system to giveaways.
- No pet, egg, resource, leaderboard rank, sub, Bits action, or battle placement should grant prize entries.

Battle events:

- Viewers must not be able to bet resources, Bits, Channel Points, or items on battle outcomes.
- Battle rewards should be leaderboard points, titles, cosmetics, or overlay bragging rights only.

## Germany-specific risk guardrails

For Germany, keep the system clearly outside the gambling-like danger zone:

- No paid random chance mechanic.
- No cash prize or item with monetary value.
- No transferable items.
- No real-world prize pool.
- No staking/wagering.
- No exchange back into money, gift cards, merch, keys, subs, or giveaway tickets.

Youth protection/product labeling risk is lower if:

- paid mechanics are not random
- random mechanics use free/earned Channel Points only
- rewards are cosmetic/community-only
- odds are visible or at least documented for internal transparency

## Privacy baseline

Store only what is needed:

- Twitch user ID
- Twitch login
- display name
- avatar URL
- subscription status cache if needed
- game inventory/progress
- economy ledger
- timestamps

Do not store:

- private messages
- unnecessary chat logs
- addresses
- payment information
- sensitive personal details

Users must be able to delete their account/progress.

## Authentication and authorization

- Use Twitch OAuth for player login.
- Validate OAuth `state`.
- Use secure HTTP-only cookies for sessions.
- Never expose Twitch access/refresh tokens to the frontend.
- Role checks must happen server-side.
- The configured broadcaster Twitch ID gets the initial `owner` role.
- Owner can promote other users to admin/mod roles.

## EventSub security

- Validate Twitch EventSub webhook signatures before processing.
- Reject events with invalid signature/timestamp.
- Store the Twitch event ID and enforce uniqueness.
- Return success for duplicate already-processed events without applying effects twice.
- Do not process redemptions for unknown reward IDs.

## Economy security

Server must own the economy.

Never allow the frontend to directly set:

- egg contents
- pet species
- pet instance base stats, generated server-side from species defaults plus hatch variance
- resource balances
- leaderboard score
- battle winners
- incubation completion
- Twitch/sub/Bits state

All economy changes must:

1. validate user/action permissions
2. run inside a DB transaction
3. create ledger entries
4. update relevant inventory/state
5. emit overlay/player update only after successful commit

## Admin actions

Admin actions are powerful and must be logged.

Admin actions should include:

- actor user ID
- target user ID, if applicable
- action type
- before/after or delta JSON
- timestamp
- revert link if reversible

Debug mystery-egg grants from the admin panel must remain role-protected, idempotent by admin `request_id`, and ledgered once per affected player. Single-player debug grants and each per-player row from bulk all-player grants are reversible through the ledger flow; bulk all-player grants are also auditable through a bulk admin action log.

Battle resolution must be revertible in MVP.

## Anti-exploit checklist

- Unique Twitch redemption IDs.
- Idempotent processors.
- Server-side rolls only.
- Unhatched egg outcomes never sent to client before reveal.
- Rate limits for authenticated actions.
- Overlay route token or signed route secret.
- Admin API protected by role checks.
- Strict CORS allowed origins.
- Database backups.
- No secret values in logs.


## Pet RPG fairness guardrails

- Rarity must not be used as a hidden stat multiplier. It may define rank, display/economy metadata, combine progression, and recycle value only.
- Cosmetic hats must not affect combat stats, AP gain, ability effects, or boss-event stack values.
- Gems are out of scope for this pass and must not be exposed as paid or random combat equipment.
- Future boss-event AP, current HP, attacks made, effective stats, class stacks, and element stacks are runtime event state, not permanent pet state.

## References for implementation research

Use official/current Twitch docs when implementing:

- Twitch EventSub subscription types and webhook handling
- Twitch OAuth docs
- Twitch Channel Points Acceptable Use Policy
- Twitch Extensions monetization / Bits-in-Extensions docs if Bits are ever used inside an Extension

### Milestone 3 controls implemented

- EventSub HMAC verification is enforced before request processing.
- Channel Point webhook notifications are idempotent by Twitch event ID and redemption ID.
- Economy mutations for eligible redemptions run inside a transaction and always create a ledger event.

## Slotted RPG Inventory MVP Update

- Unidentified mystery eggs remain unlimited counted balances in `mystery_egg_inventory`; they are not slotted and Twitch Channel Point grants cannot fail because of inventory capacity.
- Egg resources such as `cracked_eggs` remain unlimited counted balances in `resources`; resource grants are not capacity checked.
- Capacity applies to slotted inventories and the incubator queue: unhatched eggs, pets, consumables, equipment, and incubator queue slots. Hats are one-time cosmetic unlocks, not capacity-limited items. Incubators remain fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion, including incubator queue rows.
- Standard grid dimensions are 1 column × 1 base row for incubator queue slots, 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and separate 8 columns × 3 base row grids for consumables and equipment. The hat view is a fixed tiled catalog showing locked and unlocked hats.
- Incubators are shown directly above the unhatched egg grid as fixed drop targets backed by a row-upgradeable queue. Starting incubation requires the chosen unhatched egg and an available queue slot.
- Event-Pet selection uses a fixed drop target above the pet inventory. Selection only marks an owned pet as selected for events and must not create an extra pet inventory slot or remove the pet from capacity checks.
- Starting incubation validates ownership and availability, frees the unhatched egg inventory slot, occupies the incubator, creates a queued or running incubation job, and writes a ledger row.
- Queue sync records a ledgered completion when a running job reaches its required progress, leaving the result claimable while allowing the next queued job to start.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the completed egg stays redeemable, no pet is created, and later queued jobs are not blocked by the unclaimed result.
- Identifying a mystery egg into an unhatched egg serializes the user's inventory mutation, requires free unhatched egg inventory space before consuming the counted mystery egg, and leaves the counted mystery egg unchanged when full.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables and equipment are represented as separate nonstackable slotted inventories with server-side move, swap, and discard validation. Cosmetic hats are immutable per-user unlock rows and cannot be duplicated, moved, or discarded. Unhatched eggs, consumables, and equipment expose a fixed `Verwerfen` slot that permanently deletes the item after confirmation and grants no resources. Pet inventory deliberately has no rewardless `Verwerfen` slot; pets can only be removed through the `Verwerten` slot that grants cracked eggs based on rarity recycle metadata. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.

## Twitch OAuth, EventSub, and paid reward compliance

Broadcaster setup OAuth must be performed by `TWITCH_BROADCASTER_ID`; mismatched accounts are rejected. Required scopes are `channel:read:subscriptions`, `channel:read:redemptions`, `channel:manage:redemptions`, and `bits:read`. Tokens continue to use `twitch_user_tokens`; access tokens, refresh tokens, webhook secrets, and raw authorization headers must never be logged.

EventSub webhook signatures are validated before processing. Revocations are handled explicitly: authorization-related revocations set `requires_reauth=true`, while delivery-related failures mark EventSub unhealthy and expose repair/resync controls. Twitch has retry/downtime limits and no full historical EventSub replay, so the backfill flow is documented as best effort.

Bits and subscriptions are paid Twitch interactions and therefore only grant fixed transparent Gutscheine (`voucher`). They never grant random eggs or other paid random rewards.

- Duplicate pet training is server-authoritative and transactional. The browser may request target/material IDs only; the backend validates ownership, species, active/hatched state, favorite/lock protection, battle selection, unresolved battle participation, and consumed state before updating pets and writing the immutable ledger row.
