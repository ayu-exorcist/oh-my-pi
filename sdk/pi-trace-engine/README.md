# @ayulab/pi-trace-engine

> AI Engineering trace collection, analysis, and storage engine.
>
> Zero Pi runtime dependencies. Can be used in any Node.js project.

## What's Included

| Module      | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `types`     | Core type definitions for trace, review, pattern, and iteration         |
| `collector` | `TurnCollector` + `SessionCollector` — real-time trace accumulation     |
| `analyzer`  | Failure signal detection (error loop, scope creep, high retry, etc.)    |
| `storage`   | `StorageManager` — file-based persistence for traces, reviews, patterns |

## Usage

```typescript
import {
  SessionCollector,
  analyzeTurn,
  buildSessionSummary,
  StorageManager,
} from "@ayulab/pi-trace-engine";

const collector = new SessionCollector("session-1", "/project");
collector.startTurn("implement auth");
// ... record tool calls ...
const trace = collector.finalize();
```

## License

GPL-3.0
