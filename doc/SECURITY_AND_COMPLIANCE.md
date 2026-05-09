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
- pet type
- pet stats
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
- Capacity applies only to slotted inventories: unhatched eggs, pets, and consumable/item stacks. Incubators are fixed egg drop targets, not rearrangeable inventory slots.
- Each user has per-kind grid dimensions with columns, base rows, bonus rows, derived capacity, and upgrade references for later row expansion.
- Standard grid dimensions are 8 columns × 3 base rows for unhatched eggs, 4 columns × 4 base rows for pets, and 8 columns × 3 base rows for items.
- Incubators are shown directly above the unhatched egg grid as fixed drop targets without empty placeholder slots. Starting incubation requires the chosen unhatched egg and the chosen incubator.
- Event-Pet selection uses a fixed drop target above the pet inventory. Selection only marks an owned pet as selected for events and must not create an extra pet inventory slot or remove the pet from capacity checks.
- Starting incubation validates ownership and availability, frees the unhatched egg inventory slot, occupies the incubator, creates a running incubation job, and writes a ledger row.
- Finishing incubation first requires free pet inventory space. If the pet inventory is full, the job stays running, the egg stays incubating, no pet is created, and the incubator remains occupied.
- Identifying a mystery egg into an unhatched egg requires free unhatched egg inventory space before consuming the counted mystery egg. If full, the counted mystery egg remains unchanged.
- Identifying a mystery egg into egg resources does not need slotted inventory space.
- Consumables/items are represented as slotted stacks with server-side move, merge, and swap validation. Automatic sorting is intentionally out of scope.
- Every placement mutation is server-authoritative, transactional, and recorded in `economy_ledger`.
