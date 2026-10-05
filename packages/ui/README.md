# @up/ui

Design tokens (CSS custom properties) and central UI components (Button, InfoTile, HeroCard, BottomNavigation …).

Rules:

- The **only** place where color HEX values live is `tokens`.
- Components use semantic tokens only and can be overridden per tenant through CSS variables.
- No domain types, no data access. Data comes in through props.

Status: empty, built in **Phase 1**.
