import { AIChatAgent } from "@cloudflare/ai-chat";
import { callable, routeAgentRequest } from "agents";
import { createAI } from "agents/models/ai-sdk";
import { convertToModelMessages, pruneMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { TripState } from "./shared";
import { fetchForecast } from "./weather";
import { MODEL } from "./workflow";

export { ItineraryWorkflow } from "./workflow";

const SYSTEM_PROMPT = `You are a friendly trip planning assistant.
Whenever the user mentions a destination, dates, trip length, budget or interests, record them with savePreference, including when they change a value you saved earlier. Trip length is stored in days: convert nights to days by adding one.
If the user starts planning a different destination, save the new destination and its trip length again before building an itinerary.
Once you know at least a destination and trip length, offer to build a full itinerary and call startItinerary when they agree.
Use getWeather for quick weather questions. Keep replies short.`;

export class TripPlannerAgent extends AIChatAgent<Env, TripState> {
	initialState: TripState = {
		preferences: { interests: [] },
		itinerary: { status: "idle" }
	};

	onStart() {
		this.sql`CREATE TABLE IF NOT EXISTS itineraries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			destination TEXT,
			body TEXT NOT NULL,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`;
	}

	async onChatMessage() {
		const ai = createAI({ binding: this.env.AI });
		const result = streamText({
			model: ai(MODEL),
			system: `${SYSTEM_PROMPT}\n\nKnown preferences: ${JSON.stringify(this.state.preferences)}`,
			messages: pruneMessages({
				messages: await convertToModelMessages(this.messages),
				toolCalls: "before-last-2-messages"
			}),
			tools: {
				savePreference: tool({
					description: "Save a trip preference the user stated",
					inputSchema: z.object({
						destination: z.string().optional(),
						startDate: z.string().optional().describe("ISO date"),
						days: z
							.number()
							.int()
							.positive()
							.optional()
							.describe("Trip length in days. If the user gives nights, send nights + 1 (6 nights = 7 days). Always send this when the user changes the length"),
						budgetUsd: z.number().positive().optional(),
						addInterests: z.array(z.string()).optional()
					}),
					execute: async ({ addInterests, ...fields }) => {
						const prev = this.state.preferences;
						const interests = [...new Set([...prev.interests, ...(addInterests ?? [])])];
						const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
						this.setState({ ...this.state, preferences: { ...prev, ...defined, interests } });
						return { saved: true };
					}
				}),
				getWeather: tool({
					description: "Get a daily forecast for a city",
					inputSchema: z.object({ city: z.string(), days: z.number().int().min(1).max(16).default(3) }),
					execute: async ({ city, days }) => fetchForecast(city, days)
				}),
				startItinerary: tool({
					description: "Start the background workflow that builds a full itinerary from saved preferences",
					inputSchema: z.object({}),
					execute: async () => {
						const { destination, days } = this.state.preferences;
						if (!destination) return { started: false, reason: "Destination is missing" };
						if (!days) return { started: false, reason: "Trip length is missing. Ask the user how many days or nights, then call savePreference" };
						this.setState({ ...this.state, itinerary: { status: "running", step: "Starting", percent: 0 } });
						const instanceId = await this.runWorkflow("ITINERARY_WORKFLOW", { preferences: this.state.preferences });
						return { started: true, instanceId };
					}
				})
			},
			stopWhen: stepCountIs(5),
			abortSignal: AbortSignal.timeout(45_000),
			onError: ({ error }) => console.error("chat model error", error)
		});
		return result.toUIMessageStreamResponse({
			onError: (error) => (error instanceof Error ? error.message : String(error))
		});
	}

	@callable()
	resetTrip() {
		this.setState(this.initialState);
	}

	async saveItinerary(body: string) {
		this.sql`INSERT INTO itineraries (destination, body) VALUES (${this.state.preferences.destination ?? null}, ${body})`;
	}

	async onWorkflowProgress(_workflowName: string, _instanceId: string, progress: unknown) {
		const { step, percent } = progress as { step?: string; percent?: number };
		this.setState({ ...this.state, itinerary: { status: "running", step, percent } });
	}

	async onWorkflowComplete(_workflowName: string, _instanceId: string, result?: unknown) {
		const { text } = (result ?? {}) as { text?: string };
		this.setState({ ...this.state, itinerary: { status: "complete", percent: 1, text } });
	}

	async onWorkflowError(_workflowName: string, _instanceId: string, error: string) {
		this.setState({ ...this.state, itinerary: { status: "error", error } });
	}
}

export default {
	async fetch(request: Request, env: Env) {
		return (await routeAgentRequest(request, env)) || new Response("Not found", { status: 404 });
	}
} satisfies ExportedHandler<Env>;
