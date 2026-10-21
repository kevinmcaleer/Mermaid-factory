# Wardley map (beta)

```mermaid
wardley-beta
title Example
anchor User [0.95, 0.5]
component Website [0.7, 0.6]
component Hosting [0.3, 0.8]
User->Website
Website->Hosting
```

Positions are `[visibility, evolution]` between 0 and 1. Link components with `A->B`.
Other keywords: `evolve`, `pipeline`, `note`, `annotation`, `build`, `buy`, `outsource`, `inertia`, `market`.
