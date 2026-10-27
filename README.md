# Trip Planner Agent

A chat-based trip planning agent built on the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/). It remembers your preferences (destination, days, budget, interests) and, on request, runs a durable Workflow that builds a day-by-day itinerary.

## Architecture

```
Browser (React, src/client.tsx)
   │  WebSocket: chat messages + live agent state
   ▼
Worker (src/server.ts)  ── routeAgentRequest ──►  TripPlannerAgent (Durable Object, SQLite)
                                                    │  ├─ state: preferences + itinerary status
                                                    │  ├─ SQL: chat history + saved itineraries
                                                    │  ├─ LLM: Workers AI via AI SDK streamText + tools
                                                    │  └─ runWorkflow("ITINERARY_WORKFLOW")
                                                    ▼
                                         ItineraryWorkflow (src/workflow.ts)
                                           fetch-weather → draft-itinerary → validate-budget → save-itinerary
                                           progress reported back to the agent → pushed to the UI via state
```

| Requirement | Implementation |
|---|---|
| LLM | Workers AI (`MODEL` in `src/workflow.ts`) through `createAI` from `agents/models/ai-sdk` |
| Workflow / coordination | `TripPlannerAgent` handles chat and tool calls; `ItineraryWorkflow` runs the long multi-step job with per-step retries |
| User input | Chat UI using `useAgent` and `useAgentChat` |
| Memory / state | `setState` for preferences and workflow status (synced to all clients); SQLite for history and saved itineraries |

### Files

| File | Purpose |
|---|---|
| `src/server.ts` | Worker entry and `TripPlannerAgent`: system prompt, tools (`savePreference`, `getWeather`, `startItinerary`), workflow callbacks |
| `src/workflow.ts` | `ItineraryWorkflow` and the `MODEL` constant |
| `src/weather.ts` | Forecast lookup via Open-Meteo (no API key) |
| `src/shared.ts` | Types shared by server and client |
| `src/client.tsx`, `src/styles.css` | Chat UI, preferences sidebar, itinerary progress |
| `wrangler.jsonc` | Bindings: `AI`, the Durable Object, the Workflow, SQLite migration |

### Request flow

1. The user message arrives over WebSocket and `onChatMessage` streams a model response.
2. When the user states preferences, the model calls `savePreference`, which updates agent state. The sidebar updates immediately.
3. When the user agrees to an itinerary, the model calls `startItinerary`, which starts the workflow.
4. The workflow reports progress; `onWorkflowProgress` / `onWorkflowComplete` write it into agent state and the UI re-renders.

## Run locally

Prerequisites: Node 22+, a Cloudflare account with a [workers.dev subdomain](https://dash.cloudflare.com/?to=/:account/workers) registered.

```sh
npm install
npx wrangler login
npm run dev
```

Open http://localhost:5173 (Vite prints the actual URL). The `AI` binding always calls the real Workers AI, so local development uses your account and may incur usage charges.

Useful commands:

| Command | Purpose |
|---|---|
| `npm run typecheck` | Type check |
| `npm run cf-typegen` | Regenerate `worker-configuration.d.ts` after editing `wrangler.jsonc` |
| `npm run build` | Build the client and worker |

## Deploy

```sh
npx wrangler login      # or set CLOUDFLARE_API_TOKEN
npm run deploy          # vite build && wrangler deploy
```

This creates the Worker, the `TripPlannerAgent` Durable Object (SQLite-backed) and the `itinerary-workflow` Workflow in one step. The app is served at `https://trip-planner.<your-subdomain>.workers.dev`.

Live deployment: https://trip-planner.arjun-bhandage.workers.dev

Notes:
- Adding a new Durable Object class later needs a new entry in `migrations` in `wrangler.jsonc` (for example tag `v2`).
- Tail production logs with `npx wrangler tail`.
- List deployed versions with `npx wrangler deployments list`.
- Deployed data (chat history, preferences, itineraries) is separate from local dev data.

## Known issues

- `@cf/meta/llama-3.3-70b-instruct-fp8-fast` returned HTTP 500 from Workers AI when combined with streaming and tools, so `MODEL` is set to `@cf/meta/llama-4-scout-17b-16e-instruct`. Change `MODEL` in `src/workflow.ts` to try another model.
- Voice input is not implemented.
