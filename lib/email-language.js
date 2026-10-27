// The words an email adds around its content: its footer, the Read online link and its lang attribute. A newsletter
// picks its language; NEXT_PUBLIC_DEFAULT_EMAIL_LANGUAGE sets the one a newsletter has before it picks, on the server and
// in the browser's previews alike.
const LANGUAGES = {
	en: {
		label: "English",
		receiving: (name) => `You're receiving this because you subscribed to ${name}.`,
		thisNewsletter: "this newsletter",
		unsubscribe: "Unsubscribe",
		readOnline: "Read online",
	},
	uk: {
		label: "Українська",
		receiving: (name) => `Ви отримали цей лист, бо підписалися на ${name}.`,
		thisNewsletter: "цю розсилку",
		unsubscribe: "Відписатися",
		readOnline: "Читати онлайн",
	},
};

export const EMAIL_LANGUAGE_IDS = Object.keys(LANGUAGES);
export const EMAIL_LANGUAGE_OPTIONS = EMAIL_LANGUAGE_IDS.map((id) => ({ id, label: LANGUAGES[id].label }));

export function getDefaultEmailLanguage() {
	const id = process.env.NEXT_PUBLIC_DEFAULT_EMAIL_LANGUAGE;
	return Object.hasOwn(LANGUAGES, id ?? "") ? id : "en";
}

export function isEmailLanguage(id) {
	return Object.hasOwn(LANGUAGES, id ?? "");
}

// A newsletter's language, or the default for one that never picked.
export function getNewsletterLanguage(newsletter) {
	return isEmailLanguage(newsletter?.language) ? newsletter.language : getDefaultEmailLanguage();
}

export function getEmailStrings(id) {
	return { id: isEmailLanguage(id) ? id : "en", ...(LANGUAGES[id] ?? LANGUAGES.en) };
}
