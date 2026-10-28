import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import type { TripPlannerAgent } from "./server";
import type { TripState } from "./shared";
import "./styles.css";

function App() {
	const [state, setState] = useState<TripState | null>(null);
	const [input, setInput] = useState("");
	const agent = useAgent<TripPlannerAgent, TripState>({
		agent: "TripPlannerAgent",
		onStateUpdate: setState
	});
	const { messages, sendMessage, clearHistory, status, error } = useAgentChat({ agent });

	const prefs = state?.preferences;
	const itinerary = state?.itinerary;

	return (
		<div className="layout">
			<main className="chat">
				<header>
					<h1>Trip Planner</h1>
					<button
						onClick={() => {
							clearHistory();
							agent.stub.resetTrip();
						}}
					>
						Clear chat
					</button>
				</header>
				<div className="messages">
					{messages.map((m) => (
						<div key={m.id} className={`msg ${m.role}`}>
							{m.parts.map((p, i) => (p.type === "text" ? <p key={i}>{p.text}</p> : null))}
						</div>
					))}
					{error && <p className="error">{error.message}</p>}
				</div>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (!input.trim()) return;
						sendMessage({ text: input });
						setInput("");
					}}
				>
					<input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Where do you want to go?"
						disabled={status === "streaming"}
					/>
					<button type="submit" disabled={status === "streaming"}>
						Send
					</button>
				</form>
			</main>
			<aside>
				<h2>Your preferences</h2>
				<dl>
					<dt>Destination</dt>
					<dd>{prefs?.destination ?? "—"}</dd>
					<dt>Start date</dt>
					<dd>{prefs?.startDate ?? "—"}</dd>
					<dt>Days</dt>
					<dd>{prefs?.days ?? "—"}</dd>
					<dt>Budget</dt>
					<dd>{prefs?.budgetUsd ? `$${prefs.budgetUsd}` : "—"}</dd>
					<dt>Interests</dt>
					<dd>{prefs?.interests.length ? prefs.interests.join(", ") : "—"}</dd>
				</dl>
				{itinerary && itinerary.status !== "idle" && (
					<section>
						<h2>Itinerary</h2>
						{itinerary.status === "running" && (
							<>
								<progress value={itinerary.percent ?? 0} max={1} />
								<p>{itinerary.step}</p>
							</>
						)}
						{itinerary.status === "error" && <p className="error">{itinerary.error}</p>}
						{itinerary.status === "complete" && (
							<div className="markdown">
								<Markdown>{itinerary.text}</Markdown>
							</div>
						)}
					</section>
				)}
			</aside>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(<App />);
