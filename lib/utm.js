// UTM parameters on an email's links, so web analytics count the visits it brings. Links that already carry utm_
// parameters keep theirs, and links with merge tags in them stay as written: a URL parser would encode the braces.
export const MAX_UTM_LENGTH = 100;

export function cleanUtm(utm = {}) {
	const text = (value) =>
		String(value ?? "")
			.trim()
			.slice(0, MAX_UTM_LENGTH);
	return { enabled: Boolean(utm.enabled), source: text(utm.source), medium: text(utm.medium), campaign: text(utm.campaign) };
}

function withUtm(href, { source, medium, campaign }) {
	if (href.includes("{{")) return href;
	let url;
	try {
		url = new URL(href.replaceAll("&amp;", "&"));
	} catch {
		return href;
	}
	if (![...url.searchParams.keys()].some((key) => key.toLowerCase().startsWith("utm_"))) {
		if (source) url.searchParams.set("utm_source", source);
		if (medium) url.searchParams.set("utm_medium", medium);
		if (campaign) url.searchParams.set("utm_campaign", campaign);
	}
	return url.href.replaceAll("&", "&amp;");
}

export function addUtm(html, utm) {
	if (!utm?.enabled || !(utm.source || utm.medium || utm.campaign)) return html;
	return html.replace(/(<a\b[^>]*?\shref=)(["'])(https?:\/\/[^"']+)\2/gi, (_, start, quote, href) => `${start}${quote}${withUtm(href, utm)}${quote}`);
}

// The link without its utm_ parameters, as a link trigger compares it.
export function withoutUtm(href) {
	try {
		const url = new URL(href);
		for (const key of [...url.searchParams.keys()]) if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
		return url.href;
	} catch {
		return href;
	}
}
