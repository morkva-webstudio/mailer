import { EMAIL_LANGUAGE_IDS, isEmailLanguage } from "./email-language.js";

// The page an email's unsubscribe link opens (app/unsubscribe/page.js), in the newsletter's emails' language: it asks
// first, then says it's done and, while askReason is on, asks why. Its text is the built-in one, per language, until the
// owner changes a line (Settings › Unsubscribe page); a line saved empty or as the built-in one follows the built-in
// text again. {$newsletter} and {$email} are filled with the newsletter's name and the reader's address.
export const UNSUBSCRIBE_PLACEHOLDERS = ["newsletter", "email"];

// Why someone left, in the order the page lists them. other takes a line of their own words.
export const UNSUBSCRIBE_REASONS = ["no_longer", "too_frequent", "inappropriate", "spam", "never_signed_up", "other"];
export const MAX_REASON_TEXT_LENGTH = 500;

// The lines an owner can change, grouped by the step of the page that shows them. limit: its longest length.
export const UNSUBSCRIBE_TEXT_FIELDS = [
	{ key: "title", step: "confirm", label: "Title", limit: 150 },
	{ key: "text", step: "confirm", label: "Text", limit: 500, multiline: true },
	{ key: "note", step: "confirm", label: "Note", limit: 500, multiline: true, hint: "A paragraph under the text. Empty: none." },
	{ key: "yes", step: "confirm", label: "Yes button", limit: 40 },
	{ key: "no", step: "confirm", label: "No button", limit: 40 },
	{ key: "stayTitle", step: "stay", label: "Title", limit: 150 },
	{ key: "stayText", step: "stay", label: "Text", limit: 500, multiline: true },
	{ key: "doneTitle", step: "done", label: "Title", limit: 150 },
	{ key: "doneText", step: "done", label: "Text", limit: 500, multiline: true },
	{ key: "reasonsTitle", step: "done", label: "Question", limit: 150 },
	...UNSUBSCRIBE_REASONS.map((code) => ({ key: `reason_${code}`, step: "done", label: `Reason: ${code.replaceAll("_", " ")}`, limit: 150 })),
	{ key: "otherPlaceholder", step: "done", label: "Other: placeholder", limit: 150 },
	{ key: "submit", step: "done", label: "Send button", limit: 40 },
	{ key: "thanksTitle", step: "thanks", label: "Title", limit: 150 },
	{ key: "thanksText", step: "thanks", label: "Text", limit: 500, multiline: true },
];
export const UNSUBSCRIBE_TEXT_KEYS = UNSUBSCRIBE_TEXT_FIELDS.map(({ key }) => key);

// The page's steps: confirm asks, stay follows No, done follows Yes (with the question), thanks follows an answer.
export const UNSUBSCRIBE_STEPS = [
	{ id: "confirm", label: "Confirm" },
	{ id: "stay", label: "Stayed" },
	{ id: "done", label: "Unsubscribed" },
	{ id: "thanks", label: "Thanks" },
];

const DEFAULT_TEXTS = {
	en: {
		title: "Are you sure you want to unsubscribe?",
		text: "You're subscribed to {$newsletter} with {$email}.",
		note: "",
		yes: "Yes",
		no: "No",
		stayTitle: "You're still subscribed",
		stayText: "Glad you're staying. {$newsletter} keeps coming to {$email}.",
		doneTitle: "You're unsubscribed",
		doneText: "You won't receive emails from {$newsletter} anymore.",
		reasonsTitle: "Could you tell us why?",
		reason_no_longer: "I no longer want to receive these emails",
		reason_too_frequent: "The emails are too frequent",
		reason_inappropriate: "The emails are inappropriate",
		reason_spam: "The emails are spam and should be reported",
		reason_never_signed_up: "I never signed up for this mailing list",
		reason_other: "Other",
		otherPlaceholder: "Tell us more (optional)",
		submit: "Send",
		thanksTitle: "Thank you",
		thanksText: "Your answer helps us write better emails.",
	},
	uk: {
		title: "Точно хочете відписатися?",
		text: "Ви підписані на {$newsletter} з адресою {$email}.",
		note: "",
		yes: "Так",
		no: "Ні",
		stayTitle: "Ви й далі з нами",
		stayText: "Раді, що ви залишаєтесь. Листи {$newsletter} і надалі надходитимуть на {$email}.",
		doneTitle: "Ви відписалися",
		doneText: "Ви більше не отримуватимете листів від {$newsletter}.",
		reasonsTitle: "Підкажете чому?",
		reason_no_longer: "Більше не хочу отримувати ці листи",
		reason_too_frequent: "Листи приходять занадто часто",
		reason_inappropriate: "Листи мені не підходять",
		reason_spam: "Це спам, і про нього варто повідомити",
		reason_never_signed_up: "Я не підписувався на цю розсилку",
		reason_other: "Інше",
		otherPlaceholder: "Розкажіть більше (необов'язково)",
		submit: "Надіслати",
		thanksTitle: "Дякуємо",
		thanksText: "Ваша відповідь допоможе нам писати кращі листи.",
	},
};

// Not editable: a broken link and a failed try.
const FIXED_TEXTS = {
	en: {
		invalidTitle: "This link doesn't work",
		invalidText: "Open the unsubscribe link from the email again, or reply to the email to ask to be removed.",
		errorTitle: "Something went wrong",
		errorText: "You're still subscribed to {$newsletter}. Try again in a minute.",
		thisNewsletter: "this newsletter",
	},
	uk: {
		invalidTitle: "Посилання не працює",
		invalidText: "Відкрийте посилання для відписки з листа ще раз або дайте відповідь на лист і попросіть вас видалити.",
		errorTitle: "Щось пішло не так",
		errorText: "Ви досі підписані на {$newsletter}. Спробуйте ще раз за хвилину.",
		thisNewsletter: "цю розсилку",
	},
};

export function getDefaultUnsubscribeTexts(language) {
	return DEFAULT_TEXTS[isEmailLanguage(language) ? language : "en"];
}

const LIMITS = Object.fromEntries(UNSUBSCRIBE_TEXT_FIELDS.map(({ key, limit }) => [key, limit]));

// What's stored for one language: only the lines that differ from the built-in text, trimmed.
function toOverrides(texts, language) {
	const defaults = getDefaultUnsubscribeTexts(language);
	const overrides = {};
	for (const key of UNSUBSCRIBE_TEXT_KEYS) {
		const value = typeof texts?.[key] === "string" ? texts[key].trim() : "";
		if (value && value !== defaults[key]) overrides[key] = value;
	}
	return overrides;
}

// The picture above the page's card: an https:// link or a path on this server, like the newsletter's image.
export const UNSUBSCRIBE_IMAGE_PATTERN = /^(https:\/\/[^\s"'<>]{4,490}|\/[\w\-./]{1,200})$/;

// The stored shape, from the newsletter's document or a change: askReason on unless turned off, no picture unless set.
export function toUnsubscribePageSettings(unsubscribePage) {
	return {
		askReason: unsubscribePage?.askReason !== false,
		imageUrl: typeof unsubscribePage?.imageUrl === "string" ? unsubscribePage.imageUrl.trim() : "",
		texts: Object.fromEntries(EMAIL_LANGUAGE_IDS.map((language) => [language, toOverrides(unsubscribePage?.texts?.[language], language)])),
	};
}

// A change on top of the saved settings: a language it leaves out keeps its lines, a line it leaves out stays.
export function mergeUnsubscribePage(current, changes) {
	if (!changes) return toUnsubscribePageSettings(current);
	const saved = toUnsubscribePageSettings(current);
	return toUnsubscribePageSettings({
		askReason: changes.askReason ?? saved.askReason,
		imageUrl: changes.imageUrl ?? saved.imageUrl,
		texts: Object.fromEntries(
			EMAIL_LANGUAGE_IDS.map((language) => [language, { ...saved.texts[language], ...changes.texts?.[language] }])
		),
	});
}

export function getUnsubscribePageProblem(unsubscribePage) {
	if (unsubscribePage?.imageUrl && !UNSUBSCRIBE_IMAGE_PATTERN.test(unsubscribePage.imageUrl)) {
		return "The unsubscribe page's picture must be an https:// link or a path like /images/name.webp";
	}
	for (const language of EMAIL_LANGUAGE_IDS) {
		for (const [key, value] of Object.entries(unsubscribePage?.texts?.[language] ?? {})) {
			if (value.length > LIMITS[key]) return `Keep the unsubscribe page's lines under ${LIMITS[key]} characters`;
		}
	}
	return null;
}

// Every line the page shows in a language: the owner's, else the built-in one.
export function getUnsubscribeTexts(unsubscribePage, language) {
	const id = isEmailLanguage(language) ? language : "en";
	const { texts } = toUnsubscribePageSettings(unsubscribePage);
	return { ...getDefaultUnsubscribeTexts(id), ...FIXED_TEXTS[id], ...texts[id] };
}

// A line cut at its placeholders, for the page to set the values apart: [{ text }, { value, placeholder }].
export function fillUnsubscribeText(line, values) {
	const parts = [];
	let last = 0;
	for (const match of String(line ?? "").matchAll(/\{\$(newsletter|email)\}/g)) {
		if (match.index > last) parts.push({ text: line.slice(last, match.index) });
		const value = values?.[match[1]];
		if (value) parts.push({ value, placeholder: match[1] });
		last = match.index + match[0].length;
	}
	if (last < String(line ?? "").length) parts.push({ text: line.slice(last) });
	return parts;
}

// An answer from the page: a known reason, with words only for other.
export function readUnsubscribeReason(code, text) {
	if (!UNSUBSCRIBE_REASONS.includes(code)) return null;
	const words = code === "other" ? String(text ?? "").trim().slice(0, MAX_REASON_TEXT_LENGTH) : "";
	return { code, ...(words && { text: words }) };
}
