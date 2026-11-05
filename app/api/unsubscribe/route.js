import { NextResponse } from "next/server";
import { connectDb } from "@/lib/db";
import { getClientIp, isRateLimited } from "@/lib/rate-limit";
import { moveContact } from "@/lib/status-changes";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { readUnsubscribeReason } from "@/lib/unsubscribe-page";
import Contact from "@/models/Contact";
import Campaign from "@/models/Campaign";
import Message from "@/models/Message";
import { withBasePath } from "@/lib/base-path";
import { getAppUrl } from "@/lib/config";

const NO_STORE = { "Cache-Control": "no-store" };
// Bounced and complained contacts stay as they are: those statuses also block sending.
const SUBSCRIBED_STATUSES = ["active", "dormant"];
const RECENT_CAMPAIGNS = 5;
// Gmail and Yahoo send one-click requests from shared mail servers, so keep this generous.
const RATE_LIMIT = { name: "unsubscribe", limit: 60, window: "1 m" };

// Links don't carry the campaign, so the unsubscribe counts for the latest campaign sent to them.
async function creditLatestCampaign({ accountId, contactId, newsletterId }) {
	const campaigns = await Campaign.find({ accountId, newsletterId, startedAt: { $ne: null } })
		.sort({ startedAt: -1 })
		.limit(RECENT_CAMPAIGNS)
		.select({ _id: 1 })
		.lean();
	for (const { _id } of campaigns) {
		const wasSent = await Message.exists({
			accountId,
			kind: "campaign",
			campaignId: _id,
			contactId,
			sentAt: { $ne: null },
		});
		if (!wasSent) continue;
		await Campaign.updateOne({ accountId, _id }, { $inc: { "stats.unsubscribed": 1 } });
		return;
	}
}

// The token is signed, so the contact it names is found whatever the account. Unsubscribing always works,
// even for an account that canceled. via: link for the page in the email, mail-app for its unsubscribe button.
async function unsubscribe({ contactId, newsletterId }, via) {
	await connectDb();
	const at = new Date();
	const previous = await moveContact(
		{ _id: contactId, newsletterId },
		{
			from: SUBSCRIBED_STATUSES,
			to: "unsubscribed",
			via,
			at,
			// A reason given after an earlier unsubscribe isn't this one's.
			update: { $set: { unsubscribedAt: at }, $unset: { unsubscribeReason: 1 } },
			options: { crossAccount: true, projection: { _id: 1, accountId: 1 } },
		}
	);
	if (!previous) return;

	console.log(`[unsubscribe] Contact ${contactId} unsubscribed from newsletter ${newsletterId}`);
	await creditLatestCampaign({ accountId: previous.accountId, contactId, newsletterId }).catch((error) =>
		console.error("[unsubscribe] Could not credit the campaign:", error.message)
	);
}

// The page's question after unsubscribing: kept only while they're unsubscribed, the last answer wins.
async function saveReason({ contactId, newsletterId }, reason) {
	await connectDb();
	await Contact.updateOne(
		{ _id: contactId, newsletterId, status: "unsubscribed" },
		{ $set: { unsubscribeReason: { ...reason, at: new Date() } } }
	).setOptions({ crossAccount: true });
}

function redirectToPage(request, params) {
	const url = new URL(withBasePath("/unsubscribe"), getAppUrl());
	for (const [key, value] of Object.entries(params)) {
		if (value) url.searchParams.set(key, value);
	}
	const response = NextResponse.redirect(url, 303);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

// Some mail apps open the List-Unsubscribe URL in a browser: never change anything on GET.
export function GET(request) {
	return redirectToPage(request, { token: new URL(request.url).searchParams.get("token") });
}

// RFC 8058 one-click endpoint. The page's forms post here too: source=page to unsubscribe, source=reason with why.
export async function POST(request) {
	const token = new URL(request.url).searchParams.get("token");
	const form = await request.formData().catch(() => null);
	const source = form?.get("source");
	const isPageForm = source === "page" || source === "reason";

	function respond(status, pageStatus) {
		if (!isPageForm) return new NextResponse(null, { status, headers: NO_STORE });
		return redirectToPage(request, {
			token: pageStatus === "invalid" ? null : token,
			status: pageStatus,
		});
	}

	if (await isRateLimited({ ...RATE_LIMIT, key: getClientIp(request.headers) })) return respond(429, "error");

	const reference = verifyUnsubscribeToken(token);
	if (!reference) return respond(400, "invalid");

	if (source === "reason") {
		const reason = readUnsubscribeReason(String(form.get("reason") ?? ""), form.get("text"));
		if (!reason) return respond(400, "done");
		try {
			await saveReason(reference, reason);
			return respond(200, "thanks");
		} catch (error) {
			console.error("[unsubscribe] Could not save the reason:", error);
			return respond(500, "thanks");
		}
	}

	try {
		await unsubscribe(reference, isPageForm ? "link" : "mail-app");
		return respond(200, "done");
	} catch (error) {
		console.error("[unsubscribe] Failed:", error);
		return respond(500, "error");
	}
}
