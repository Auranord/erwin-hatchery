# Security and Compliance

This is not legal advice. It is a product and engineering guardrail.

## Safe concept boundary

Allowed:

- Channel Points redeem mystery eggs.
- Mystery eggs randomly become stream-only pets or cracked egg resources.
- Pets/resources/upgrades/cosmetics exist only in Erwin Hatchery.
- Battle results give leaderboard points only.
- Subs grant fixed Gutschein resources.
- Bits may trigger fixed, clearly described effects/boosts.

Not allowed:

- No Bits/subs for random eggs.
- No giveaways or prize entries from the game.
- No betting or wagering.
- No marketplace or trading.
- No cash-out, money, gift cards, merch, keys, or real prizes.
- Avoid gambling language.

Preferred wording:

- Mystery Ei
- hatch
- incubator
- pet egg
- cracked eggs
- stream event
- leaderboard points

Avoid:

- lootbox
- gamble
- bet
- wager
- cash out
- prize ticket

## Twitch/Germany risk guardrails

Keep the system away from gambling-like mechanics:

- no paid random chance
- no real-world prize pool
- no transferable items
- no staking/wagering
- no exchange into money or goods
- random rewards only from free/earned Channel Points
- paid support events only fixed and transparent

## Privacy baseline

Store only what is needed:

- Twitch user ID/login/display name/avatar
- game inventory/progress
- subscription status cache if needed
- economy ledger
- timestamps

Do not store:

- OAuth/access/refresh tokens in reports
- cookies
- auth headers
- secrets
- private messages
- unnecessary chat logs
- addresses/payment info

Users must be able to delete account/progress.

## Auth and roles

- Twitch OAuth for player login.
- Validate OAuth state.
- Use secure HTTP-only session cookies.
- Never expose Twitch tokens to frontend.
- Role checks happen server-side.
- Configured broadcaster Twitch ID gets initial owner role.

## External event security

For Twitch EventSub or erwin-gateway webhooks:

- verify signature before processing
- verify against exact raw body bytes
- reject stale timestamps when applicable
- persist event/delivery ID before side effects
- dedupe event ID and Twitch redemption ID
- return success for safe duplicates
- do not process unknown reward IDs

## Gateway security

- `ERWIN_GATEWAY_APP_API_KEY` is a bearer secret for `/api/v1/*`.
- `ERWIN_GATEWAY_WEBHOOK_SIGNING_SECRET` is only for webhook HMAC verification.
- Gateway signatures use:
  - `X-Erwin-Gateway-Delivery-Id`
  - `X-Erwin-Gateway-Timestamp`
  - exact raw body
- Never log gateway API keys, webhook secrets, signatures, raw auth headers, cookies, or tokens.

## Economy security

All economy changes must:

1. validate user/action permissions
2. run in a DB transaction
3. write ledger entries
4. update inventory/state
5. emit events only after commit

Frontend must never set:

- egg contents
- pet species
- pet stats
- resource balances
- leaderboard score
- battle winners
- incubation completion
- Twitch/sub/Bits state

## Admin actions

Admin actions must be role-protected and logged.

Include:

- actor user ID
- target user ID if applicable
- action type
- delta/before/after payload
- timestamp
- revert link where practical

## Anti-exploit checklist

- unique Twitch redemption IDs
- unique gateway delivery/event IDs
- idempotent processors
- server-side rolls only
- hidden outcomes never sent before reveal
- authenticated action rate limits
- overlay route token
- strict CORS
- DB backups
- no secrets in logs
