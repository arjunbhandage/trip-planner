export type Preferences = {
	destination?: string;
	startDate?: string;
	days?: number;
	budgetUsd?: number;
	interests: string[];
};

export type ItineraryStatus = {
	status: "idle" | "running" | "complete" | "error";
	step?: string;
	percent?: number;
	text?: string;
	error?: string;
};

export type TripState = {
	preferences: Preferences;
	itinerary: ItineraryStatus;
};

export type ItineraryParams = {
	preferences: Preferences;
};
