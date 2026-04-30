# Erwin Hatchery

Erwin Hatchery is a Twitch-connected community minigame for **NTKOH**.

Viewers collect and hatch mystery eggs, discover pets, gather egg resources, and send their favorite pets into stream events. The project is designed as a mobile-first web app with Twitch login, Channel Point integration, stream overlays, and an admin-controlled event system.

## Links

- Twitch: [NTKOH on Twitch](https://www.twitch.tv/ntkoh)
- Stable app: [hatchery.auranord.net](https://hatchery.auranord.net)
- Testing app: [test.hatchery.auranord.net](https://test.hatchery.auranord.net)

## Project status

This project is currently in early MVP development.

The first version focuses on:

- Twitch login
- Channel Point reward handling
- mystery egg inventory
- egg identification
- pet hatching
- cracked egg resources
- simple pet collection
- admin-controlled stream events
- leaderboard points
- OBS browser overlays

## Twitch and safety rules

Erwin Hatchery is designed to stay within a conservative interpretation of Twitch rules.

The project follows these boundaries:

- Channel Points may be used for mystery eggs.
- All rewards are stream-only digital items.
- Pets, eggs, resources, upgrades, and cosmetics have no real-world monetary value.
- Items cannot be traded, sold, transferred, cashed out, or redeemed for prizes.
- The game does not award giveaway tickets, money, merch, game keys, or gift cards.
- No betting or wagering is allowed.
- Bits and subscriptions, must only trigger fixed and clearly described perks.
- Bits and subscriptions must not trigger random eggs, random pets, mystery rewards, or prize chances.

## Tech stack

Planned stack:

- TypeScript
- React + Vite
- Fastify API
- PostgreSQL
- Drizzle ORM
- Docker
- GitHub Container Registry
- TrueNAS SCALE deployment
- Traefik reverse proxy
- Twitch OAuth
- Twitch EventSub

## Branches

This repository uses three main branches:

- `dev`: active development
- `testing`: test deployment
- `main`: stable production deployment

Container images are built through GitHub Actions and published to GitHub Container Registry.

## Repository visibility and license

This repository is public for transparency, collaboration, review, and issue tracking.

It is **source-available**, not open source.

You may view the code and submit pull requests, but you may not deploy, redistribute, publish modified versions, or create derivative works without written permission.

See [`LICENSE.md`](./LICENSE.md) and [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Contributing

Contributions are welcome only under the terms in `LICENSE.md` and `CONTRIBUTING.md`.

Before opening a pull request, please read:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`AGENTS.md`](./AGENTS.md)
- [`SECURITY_AND_COMPLIANCE.md`](./SECURITY_AND_COMPLIANCE.md)

By submitting a pull request, you agree that Auranord / NTKOH may use, modify, sublicense, and relicense your contribution as part of Erwin Hatchery or related NTKOH projects.

## Security

Please do not open public issues for security problems.

Security-sensitive reports should be sent privately to the project maintainer.

## Association

Erwin Hatchery is an NTKOH community project.

It is not an official Twitch product and is not endorsed by Twitch.
