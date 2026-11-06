# Cloud Architecture Plan (AWS)

Status: **design**, not implemented. The app is local-only (AsyncStorage) today.

Target platform: **AWS**. This document is the detail behind the "designed,
implementation pending" line in the README. It assumes the data models in
[product-spec.md](product-spec.md) and the current store surface in
`stores/pantryStore.ts`.

Deferred decisions #18 (household ↔ location) and #19 (event-log snapshot /
compaction) in product-spec.md are owned by this plan and are **not**
re-decided here — they remain open with the conditions for revisiting already
recorded there.

---

## 1. Why event-sourced

`dispositionLog` is already an immutable, insert-only event log. The cloud
design generalizes that shape to every state change rather than syncing
mutable rows, for three concrete reasons:

1. **`remainingQuantity` is the conflict hotspot.** Two devices each logging
   "used half the milk" must compose to "used all of it," not "whichever wrote
   last." Consumption is a *relative delta*, so as events they commute and the
   conflict disappears. Row-level sync of an absolute quantity cannot express
   this without a CRDT.
2. **The Food Score and AI layers need the history anyway.** `ConsumptionProfile`
   blending (spec #3), freezer-life baselines (#17), and the waste-rate formula
   all train on exactly this log. Event sourcing yields that corpus for free
   rather than as a second pipeline.
3. **Scoring is a pure function of the log.** `computeFoodScoreForPeriod` and
   every function in `services/streaks.ts` already take the log as input and
   hold no state. They can run unchanged against a server-side projection.

> **Do not use Amplify DataStore.** Its conflict resolution is row-level and
> version-based (auto-merge / optimistic concurrency / custom handler). That is
> precisely the model rejected in point 1 — it would reintroduce last-write-wins
> on `remainingQuantity`. The offline queue described in §4 is hand-rolled for
> this reason.

## 2. Events vs. projections

Events are the source of truth. Everything else is derived and rebuildable by
replay.

### Event taxonomy

Mapped one-to-one from today's store actions, so there is no behavioral
guesswork during migration:

| Store action | Event | Payload shape |
|---|---|---|
| `addItem` | `item_added` | full `GroceryItem` |
| `updateItem` | `item_updated` | `Partial<GroceryItem>` patch |
| `removeItem` | `item_removed` | — |
| `moveItem` | `item_moved` | `{ to: StorageLocation }` |
| `consumeItem` | `item_consumed` | `{ amount: number }` |
| `disposeItem` | `item_disposed` | `{ disposition, wasteMethod?, quantity, originalQuantity }` |
| `recallItem` | `disposal_recalled` | `{ dispositionEventId }` |
| `setBarcodeCategoryOverride` | `barcode_category_overridden` | `{ barcode, category }` |
| `resetPantry` | `household_reset` | — |

Every event carries: client-generated `id` (UUID), `householdId`, `actorId`,
`occurredAt` (client clock), and a server-assigned `seq`.

### Projections (rebuildable)

- **items** ← add/update/move/consume/dispose/remove
- **dispositionEvents** ← `item_disposed`, minus any recalled by
  `disposal_recalled`
- **barcodeCategoryOverrides** ← last `barcode_category_overridden` per barcode

### Two slices that need rethinking

**`recallableItems`** is a 7-day cache holding a *full `GroceryItem` snapshot*
so a mis-tapped "Used all" can be undone. It is not an event and should not
sync as one. Server-side it becomes a projection: `item_disposed` events within
`RECALL_WINDOW_DAYS` where the item state immediately prior to disposal is
reconstructable by replay. The snapshot in local state stays as a client
optimization.

**`streakLog` / `lastStreakCheckpointAt`** are today *derived but persisted* —
not because the data isn't derivable, but because nothing runs at midnight on
the client, so a period-end checkpoint needs a marker recording that it already
fired. **Cloud sync removes that constraint:** a server can compute the streak
for any `(household, period)` deterministically from the event log, the
household timezone, and the tracking start date. Recommendation: drop both
slices server-side and treat streaks as a pure projection, keeping the local
`streakLog` as an offline cache only. This is a genuine simplification the
migration unlocks rather than a port of existing complexity.

### Conflict semantics by event type

| Event | Resolution |
|---|---|
| `item_consumed` | Commutative — deltas sum, order irrelevant |
| `item_added`, `item_disposed` | Append-only, no conflict |
| `item_updated`, `item_moved` | Last-write-wins by server `seq` |
| `item_removed`, `household_reset` | Terminal; later events on a removed item are dropped at projection time |

## 3. AWS service selection

### Recommended: DynamoDB + AppSync + Cognito

| Concern | Service | Why |
|---|---|---|
| Auth | **Cognito User Pools** | Hosted sign-in, JWT with custom claims; `householdId` resolvable per user |
| Event log + projections | **DynamoDB** (single table, on-demand) | Append-only log is DynamoDB's sweet spot; scales to near-zero cost at idle |
| Projection maintenance | **DynamoDB Streams → Lambda** | Exactly the trigger semantics the design wants, without running a server |
| API + realtime | **AppSync** (GraphQL) | Subscriptions give multi-device fanout without operating a WebSocket tier |
| AI proxy | **Lambda Function URL** (response streaming) | See §7 — streaming is a hard requirement |
| Secrets | **Secrets Manager** (or SSM Parameter Store) | Anthropic key never ships to the client |
| Scheduled work | **EventBridge Scheduler → Lambda** | Expiration-alert scan named in the README roadmap |

Chosen primarily because **everything above scales to roughly zero at idle**,
which matters for a pre-launch app with one household.

### Rejected alternative: Aurora Serverless v2 (Postgres)

Aurora would preserve the original Postgres-shaped design verbatim — `bigserial`
for `seq`, triggers for projections, row-level security for tenancy — and so
carries lower design risk. It was not chosen because Serverless v2 has a
non-zero floor (minimum ACU billed continuously), which is poor economics
pre-launch, and it still needs a separate tier for realtime fanout since
Postgres `LISTEN/NOTIFY` has no managed WebSocket in front of it.

Worth revisiting if relational querying for analytics becomes a priority, or if
the DynamoDB access patterns below prove too rigid.

### Single-table sketch

```
PK                      SK                      Attributes
HOUSEHOLD#<hid>         META                    name, timezone, trackingStartDate
HOUSEHOLD#<hid>         COUNTER                 seq            (atomic counter)
HOUSEHOLD#<hid>         EVENT#<seq padded>      id, type, payload, actorId, occurredAt
HOUSEHOLD#<hid>         ITEM#<itemId>           ...GroceryItem      (projection)
HOUSEHOLD#<hid>         DISP#<eventId>          ...DispositionEvent (projection)
HOUSEHOLD#<hid>         BARCODE#<barcode>       category            (projection)
HOUSEHOLD#<hid>         SNAPSHOT#<seq>          projection blob / S3 pointer
USER#<uid>              HOUSEHOLD#<hid>         role           (membership lookup)
```

- **`seq` assignment**: `UpdateItem … ADD seq 1` on the `COUNTER` item returns
  the new value; the event is then written with `EVENT#<seq>` under a condition
  that the key does not already exist. Two writes per event, inside a
  transaction. At this app's write volume (a handful of events per household
  per day) the extra round trip and single-partition counter are immaterial —
  and it keeps the server, not the client clock, as the ordering authority.
- **Sort-key ordering** means "fetch events since `seq`" is one `Query` with a
  `>` condition — the exact read the sync path needs.
- **Tenancy**: every item is under `HOUSEHOLD#<hid>`. AppSync resolvers derive
  `hid` from the Cognito JWT and never from client input. IAM leading-key
  conditions provide defense in depth if anything ever talks to DynamoDB
  directly.

### Why not ULIDs instead of a counter

Client-generated ULIDs sort lexicographically by time and would remove the
counter write entirely — but they order by *client* clock, and `item_updated` /
`item_moved` resolve last-write-wins, which needs a server-authoritative order.
Skewed device clocks would silently decide which edit wins. The counter is the
cheaper correctness guarantee.

## 4. Write path (offline-first)

The app must stay fully usable with no network; that is the normal case for a
kitchen, not an edge case.

1. A store action applies optimistically to local state and appends to a
   durable local **outbox**.
2. The outbox drains to AppSync on connectivity, in `occurredAt` order.
3. The resolver assigns `seq`, writes the event, and returns it.
4. **Idempotency**: the event's client-generated `id` makes a retried or
   duplicated send a conditional-write failure rather than a double apply. This
   is what makes blind retry safe.
5. The AppSync subscription fires for the household's other devices, which
   apply the event to their local projection.
6. DynamoDB Streams invokes the projection Lambda, which updates the
   server-side `ITEM#` / `DISP#` / `BARCODE#` records.

No distributed transaction is needed: local state is a projection of
(confirmed events + pending outbox), and reconciles to the server's view
whenever the outbox empties.

**Projections are eventually consistent** (Streams are asynchronous). This is
already tolerable because clients apply events to their own local projection
immediately and never wait on the server copy — but server-computed values
must not be read back as authoritative immediately after a write.

## 5. Read path

Fresh install or new device replays the household's event log and rebuilds
projections locally — one `Query` on `HOUSEHOLD#<hid>` with `SK > EVENT#0`.

Deferred decision **#19** covers snapshotting so this does not degrade as the
log grows; direction already recorded there is to materialize a projection
snapshot every ~10K events and load `(latest snapshot + events since)`. The
`SNAPSHOT#<seq>` key above reserves the slot for it.

Steady state is subscription-driven incremental application, not polling.

## 6. Timezone is part of the data model

Day boundaries are not a presentation concern here — they decide streak
lengths and therefore Food Score values. A single `dayNumber` in
`services/streaks.ts` resolves local calendar days today; three independent
copies of that logic each had the same UTC-flooring bug before consolidation,
which inflated streaks and silently moved a correct 100 score to 90.

Server-side projections must agree with the client exactly, so the day
boundary has to come from one authoritative value: `timezone` on the
`HOUSEHOLD#<hid> / META` record, set explicitly by the user rather than
inferred from the device. That is the same field the deferred user-profile work
(name, household name, timezone) needs, and it should land **before** any
server-side scoring.

## 7. AI calls move behind a proxy

Unrelated to sync, but a hard prerequisite for shipping: the Anthropic key is
read from `expo-constants` in `services/anthropicApiKey.ts` and is therefore
baked into the bundle and extractable by anyone with the app.

Target: a **Lambda Function URL with response streaming enabled**, holding the
key in Secrets Manager. The app calls the function URL instead of
`api.anthropic.com`.

> **Do not put this behind API Gateway.** REST and HTTP APIs buffer the
> response body and cap it, which breaks server-sent events. Both
> `services/sseStream.ts` and `services/pantryChatApp.ts` depend on incremental
> SSE delivery for live token streaming — buffering would turn every reply into
> a single delayed blob. Lambda Function URLs with `RESPONSE_STREAM` invoke
> mode pass the stream through; a Lambda behind an ALB is the other workable
> option.

**Scope carefully — only the model call moves.** `pantryChatExecutor.ts` runs
its tool loop directly against the Zustand store and must stay client-side; the
proxy forwards Anthropic request/response and nothing more. Moving the agent
loop server-side would require the server to hold pantry state, which is a far
larger change and not required to fix the key exposure.

The proxy is also the natural place for per-household rate limiting and cost
attribution, neither of which is possible today.

## 8. Migrating existing local data

Existing installs hold real history (AsyncStorage, store `version: 1`). First
login must not discard it.

1. On first authenticated launch, synthesize events from local state —
   `item_added` per current item, `item_disposed` per `dispositionLog` entry —
   preserving original timestamps in `occurredAt`.
2. Push through the normal outbox. Idempotency keys make a partial import
   safely resumable.
3. Mark the local store as imported so this runs exactly once.

**Known prerequisite:** the store is still `version: 1` with no `migrate`
function, even though `originalQuantity` (required) plus the `streakLog` and
`lastStreakCheckpointAt` slices were added after that version was set. Old
persisted `dispositionLog` entries therefore lack `originalQuantity`; they are
currently skipped by `computeFoodScoreForPeriod` rather than crashing, which is
tolerable only because Food Score tracking starts 2026-11-01. A real `migrate`
should land before the import path is written, so imported events have a known
shape.

## 9. Open questions

| # | Question | Notes |
|---|---|---|
| 1 | `recallItem` semantics | Today it **deletes** the disposition event from the log. Event sourcing forbids deletion — it must become a compensating `disposal_recalled` event, with projections filtering recalled disposals. Behavior is equivalent; the log stops being falsifiable. Needs a deliberate change to the local store too. |
| 2 | Where does Food Score run? | Pure functions today, so: client-only (simplest, no server scoring), server-only (consistent across devices, needs §6 first), or both (duplicate logic, drift risk). Unresolved. |
| 3 | `streakLog` as projection or event? | §2 recommends projection. If checkpoints ever need to be auditable (e.g. disputes over a lost streak), events win instead. |
| 4 | Multi-location households | product-spec.md #18 — open. |
| 5 | Snapshot cadence / GC | product-spec.md #19 — direction locked, details open. |
| 6 | Household invite / join flow | No user model exists at all today. Cognito + the `USER#<uid>` membership record are assumed throughout, but the flow for inviting a partner into an existing household is undesigned. |
| 7 | AppSync vs. plain API Gateway + Lambda | AppSync is chosen for subscriptions. If realtime turns out to be unnecessary (single-device households), a plain HTTP API plus pull-on-foreground is simpler and cheaper. |

## 10. Suggested sequence

Ordered by what unblocks what, not by size:

1. **Store `migrate` function** (§8) — prerequisite for a well-defined import.
2. **User/household profile incl. timezone** (§6) — prerequisite for any
   server-side scoring; also fixes the hardcoded display name.
3. **AI proxy** (§7) — independent of sync, and the only item on this list that
   is a security issue rather than a feature.
4. **Cognito + household/membership records** (§3) — prerequisite for
   everything below.
5. **Event table + projection Lambda** (§2–3).
6. **Outbox + AppSync subscriptions** (§4–5).
7. **Local-data import** (§8).
8. Revisit #18 / #19 once real multi-device usage exists.

## 11. Related: store distribution

Covered separately in
[release-and-distribution.md](release-and-distribution.md): store accounts,
EAS build pipeline, versioning, and the privacy disclosures that camera use and
receipt-image upload trigger.

Two dependencies run in the other direction, from that document back into this
one:

- The AI proxy (§7) should land **before** the first store build, so no
  released binary ever carries an extractable Anthropic key.
- Apple requires in-app account deletion once accounts exist, which the Cognito
  work in §10 step 4 introduces. With an event-sourced backend, "delete my
  account" needs a decision about what happens to a shared household's event
  log when one member leaves — see that document's open question #6.
