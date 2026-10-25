import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuth, getAuthCallContext } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import { getAppUrl, isEmailAllowed } from "@/lib/config";
import { isExpiredOAuthQuery, pickSignedOAuthQuery, readOAuthQueryField } from "@/lib/oauth-rules";
import { normalizeEmail, toSafeNextPath } from "@/lib/validation";

export const dynamic = "force-dynamic";

// A server behind a gateway of its own (a PIN hub) signs people in there instead of with emailed codes: the hub sends
// them here with a ticket it signed with HUB_BRIDGE_SECRET, good for a minute and once. The session comes from a code
// made here and never sent, so the allowlist and the first sign-in's account work as with any code. Without the
// secret this route doesn't exist. An app connecting with OAuth (Claude) sends people to sign-in with its signed
// request, which the hub passes on in the ticket (oauth): signing in then goes on to the consent page, as a code would.
const TICKET_TTL_MS = 60 * 1000;
const usedNonces = new Map();

function readTicket(ticket, secret) {
	const [payload, signature] = String(ticket ?? "").split(".");
	if (!payload || !signature) return null;
	const expected = createHmac("sha256", secret).update(payload).digest();
	const given = Buffer.from(signature, "base64url");
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
	try {
		return JSON.parse(Buffer.from(payload, "base64url").toString());
	} catch {
		return null;
	}
}

function spendNonce(nonce, now) {
	for (const [key, expiresAt] of usedNonces) if (expiresAt < now) usedNonces.delete(key);
	if (typeof nonce !== "string" || nonce.length < 16 || usedNonces.has(nonce)) return false;
	usedNonces.set(nonce, now + TICKET_TTL_MS);
	return true;
}

// Signed, fresh, not used before, and for someone the allowlist lets in.
function checkTicket(value, secret) {
	const now = Date.now();
	const ticket = readTicket(value, secret);
	const email = normalizeEmail(ticket?.email);
	const isFresh = Number.isFinite(ticket?.exp) && ticket.exp > now && ticket.exp <= now + TICKET_TTL_MS;
	if (email && isFresh && spendNonce(ticket.nonce, now) && isEmailAllowed(email)) return { email, next: ticket.next, oauthQuery: readOAuthQueryField(pickSignedOAuthQuery(ticket.oauth ?? "")) };
	console.warn(`[hub-login] Refused a ticket${email ? ` for ${email}` : ""}`);
	return null;
}

// A path in the app, or where Better Auth sends an OAuth sign-in on (its pages have the base path already).
function redirectTo(path, { hasBasePath = false } = {}) {
	const response = NextResponse.redirect(new URL(hasBasePath ? path : withBasePath(path), getAppUrl()), 303);
	response.headers.set("Cache-Control", "no-store");
	return response;
}

export async function GET(request) {
	const secret = process.env.HUB_BRIDGE_SECRET;
	if (!secret || secret.length < 32) return new NextResponse("Not found", { status: 404 });

	const ticket = checkTicket(new URL(request.url).searchParams.get("ticket"), secret);
	if (!ticket) return new NextResponse("This sign-in link is invalid or expired.", { status: 403, headers: { "Cache-Control": "no-store" } });
	const { email, oauthQuery } = ticket;

	const auth = await getAuth();
	const signIn = async (oauth_query) => {
		const otp = await auth.api.createVerificationOTP({ body: { email, type: "sign-in" } });
		// Signing in on to an app's consent needs the request, as on the sign-in page.
		const context = oauth_query ? await getAuthCallContext("/sign-in/email-otp") : { headers: request.headers };
		return auth.api.signInEmailOTP({ body: { email, otp, ...(oauth_query && { oauth_query }) }, ...context, returnHeaders: true });
	};
	let signedIn;
	try {
		signedIn = await signIn(oauthQuery);
	} catch (error) {
		// A request over 10 minutes old: signed in all the same, the app has to connect again.
		if (!oauthQuery || !isExpiredOAuthQuery(error)) throw error;
		signedIn = await signIn(null);
	}
	const { headers } = signedIn;
	const oauthNext = oauthQuery ? signedIn.response?.url : null;
	const response = oauthNext ? redirectTo(oauthNext, { hasBasePath: true }) : redirectTo(toSafeNextPath(ticket.next));
	for (const cookie of headers.getSetCookie()) response.headers.append("Set-Cookie", cookie);
	console.info(`[hub-login] Signed in ${email}`);
	return response;
}
