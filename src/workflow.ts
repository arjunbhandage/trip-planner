import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { TripPlannerAgent } from "./server";
import type { ItineraryParams } from "./shared";
import { fetchForecast } from "./weather";

export const MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

export class ItineraryWorkflow extends AgentWorkflow<TripPlannerAgent, ItineraryParams> {
	async run(event: AgentWorkflowEvent<ItineraryParams>, step: AgentWorkflowStep) {
		const { preferences } = event.payload;
		const days = preferences.days;
		if (!days) throw new Error("Trip length missing from preferences");

		await this.reportProgress({ step: "Checking the weather", percent: 0.1 });
		const weather = await step.do("fetch-weather", { retries: { limit: 2, delay: "2 seconds" } }, async () =>
			preferences.destination ? fetchForecast(preferences.destination, days) : null
		);

		await this.reportProgress({ step: "Drafting itinerary", percent: 0.4 });
		const draft = await step.do("draft-itinerary", { retries: { limit: 2, delay: "5 seconds" } }, async () => {
			const res = (await this.env.AI.run(MODEL, {
				messages: [
					{
						role: "system",
						content: "You are an expert travel planner. Produce a concise day-by-day itinerary in markdown with estimated costs per day in USD."
					},
					{
						role: "user",
						content: `Preferences: ${JSON.stringify(preferences)}\nWeather forecast: ${JSON.stringify(weather)}\nPlan ${days} days.`
					}
				],
				max_tokens: 1500
			})) as { response?: string };
			return res.response ?? "";
		});

		await this.reportProgress({ step: "Checking budget", percent: 0.7 });
		const finalText = await step.do("validate-budget", async () => {
			if (!preferences.budgetUsd) return draft;
			const res = (await this.env.AI.run(MODEL, {
				messages: [
					{
						role: "system",
						content: `Revise this itinerary so the total cost stays under $${preferences.budgetUsd}. If it already fits, return it unchanged. Return only the itinerary.`
					},
					{ role: "user", content: draft }
				],
				max_tokens: 1500
			})) as { response?: string };
			return res.response || draft;
		});

		await this.reportProgress({ step: "Saving", percent: 0.9 });
		await step.do("save-itinerary", async () => {
			await this.agent.saveItinerary(finalText);
		});

		await step.reportComplete({ text: finalText });
		return { text: finalText };
	}
}
