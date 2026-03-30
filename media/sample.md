# Project Aurora — Phase 2 Review

The migration to event-driven processing is complete. All three ingestion pipelines now publish to the shared message bus, and downstream consumers have been validated in staging.

## Status summary

| Stream | Throughput | Latency (p95) | Status |
|--------|-----------|---------------|--------|
| Telemetry | 12,400 msg/s | 38 ms | Live |
| Transactions | 8,200 msg/s | 52 ms | Live |
| Notifications | 3,100 msg/s | 15 ms | Canary |

## What changed

The previous architecture polled a shared database every 30 seconds. This introduced two problems:

1. **Stale reads** — consumers could be up to 30 seconds behind the source of truth, which caused reconciliation failures during peak windows.
2. **Contention** — six services polling the same tables created lock pressure that degraded write throughput by ~20%.

> "We spent more time tuning poll intervals than building features."
> — post-mortem, January 2026

### New approach

Each pipeline now emits events at the point of commit. Consumers subscribe to the topics they need and process messages within milliseconds of publication.

```python
async def handle_event(event: IngestEvent) -> None:
    validated = schema.validate(event.payload)
    await store.upsert(validated)
    metrics.record("event.processed", tags={"stream": event.source})
```

## Remaining work

- [ ] Cut over notifications stream from canary to full traffic
- [ ] Decommission legacy polling cron jobs
- [x] Update runbooks for on-call
- [x] Add circuit breaker to transaction consumer

---

*Last updated 28 March 2026. Next review scheduled for 11 April.*
