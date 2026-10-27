export async function fetchForecast(city: string, days: number) {
	const geo = (await (
		await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`)
	).json()) as { results?: { latitude: number; longitude: number; name: string; country: string }[] };
	const place = geo.results?.[0];
	if (!place) return { city, error: "Location not found" };

	const forecast = (await (
		await fetch(
			`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
				`&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=${Math.min(days, 16)}&timezone=auto`
		)
	).json()) as { daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] } };

	return {
		city: `${place.name}, ${place.country}`,
		days: forecast.daily.time.map((date, i) => ({
			date,
			maxC: forecast.daily.temperature_2m_max[i],
			minC: forecast.daily.temperature_2m_min[i],
			rainChance: forecast.daily.precipitation_probability_max[i]
		}))
	};
}
