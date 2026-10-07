---
name: mpfrontend-integrate-realtime
description: Integrate an approved realtime event contract with MP Frontend ticket admission, bounded browser recovery and authority revision checks. Use only when topic/event ownership and snapshot semantics are already defined.
---

# Integrate an approved realtime stream

Requires the reviewed MP Frontend CLI `0.1.0-dev.18` cohort and `@mpfrontend/realtime-core`. Read the
consumer instructions plus the approved event/topic schema, ordering/idempotency rules, admission
policy and snapshot endpoint. Stop rather than inventing event names, replay guarantees or recovery
semantics.

Issue short-lived one-use admission tickets server-side. Never place service tokens, broker credentials
or durable session material in the browser. Configure `useRealtime` with bounded resources, the current
authority revision, required `onSnapshot` recovery and a generic `onUnavailable` state. Treat realtime
messages as invalidations or declared events; after gaps, reconnects or uncertainty, recover from the
authoritative snapshot before publishing state.

Bound reconnect delay, jitter, attempt/rate budgets and cancellation. Coalesce duplicate invalidations,
discard messages and snapshots from stale sockets/subjects/tenants/role revisions, and preserve safe
unsaved drafts during recovery. Do not claim durable replay, exactly-once delivery or production HA
unless the approved server contract and deployment evidence provide it.

Test ticket admission and replay refusal, reconnect/backoff, quota `429`, snapshot failure/hang,
duplicate/coalesced events, revocation, identity/tenant change, stale socket delivery and successful
recovery. Include a failing control for the admission floor or stale-authority property. Verify the
actual browser state through an interruption.

Report commands/counts, observed recovery evidence and remaining infrastructure gates. Do not create
broker topics, alter production quotas, deploy or publish through this skill.
