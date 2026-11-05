import { CircleAlert, Heart, Inbox, Link2Off, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";
import { UNSUBSCRIBE_REASONS, fillUnsubscribeText } from "@/lib/unsubscribe-page";
import { cn } from "@/lib/utils";

// The unsubscribe page's card (lib/unsubscribe-page.js) at one of its steps, for readers (app/unsubscribe/page.js) and
// as the settings preview shows it. token: the reader's, for the forms; without one, a preview whose buttons do nothing.
// values: { newsletter, email } for the placeholders. askReason: done asks why, unless they already answered.
export default function CardUnsubscribe({ step, texts, values, imageUrl, askReason, token = null, className }) {
	const isPreview = !token;
	const action = token ? withBasePath(`/api/unsubscribe?token=${encodeURIComponent(token)}`) : undefined;
	const { icon: Icon, title, text } = STEPS[step] ?? STEPS.invalid;
	const showImage = Boolean(imageUrl) && step === "confirm";

	return (
		<div className={cn("w-full max-w-md overflow-hidden rounded-xl bg-card text-center shadow-border", className)}>
			{showImage && (
				// eslint-disable-next-line @next/next/no-img-element -- any https:// picture the owner set, not one Next can optimize
				<img src={imageUrl} alt="" referrerPolicy="no-referrer" className="block max-h-72 w-full object-cover" />
			)}
			<div className="p-6 sm:p-8">
				{!showImage && (
					<div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
						<Icon className="size-5" aria-hidden="true" />
					</div>
				)}
				<h1 className={cn("text-lg font-theme-heading text-balance", !showImage && "mt-4")}>
					<Filled line={texts[title]} values={values} />
				</h1>
				<p className="mt-1.5 text-sm leading-relaxed text-pretty text-muted-foreground">
					<Filled line={texts[text]} values={values} />
				</p>
				{step === "confirm" && texts.note && (
					<p className="mt-3 text-sm leading-relaxed text-pretty whitespace-pre-line text-muted-foreground">
						<Filled line={texts.note} values={values} />
					</p>
				)}

				{step === "confirm" && (
					<form method="post" action={action} className="mt-6 grid grid-cols-2 gap-3">
						<input type="hidden" name="source" value="page" />
						<Button type={isPreview ? "button" : "submit"} variant="secondary" size="lg" className="w-full">
							{texts.yes}
						</Button>
						{isPreview ? (
							<Button type="button" size="lg" className="w-full">
								{texts.no}
							</Button>
						) : (
							<Button asChild size="lg" className="w-full">
								<a href={withBasePath(`/unsubscribe?token=${encodeURIComponent(token)}&status=stay`)}>{texts.no}</a>
							</Button>
						)}
					</form>
				)}

				{step === "error" && token && (
					<form method="post" action={action} className="mt-6">
						<input type="hidden" name="source" value="page" />
						<Button type="submit" size="lg" className="w-full">
							{texts.yes}
						</Button>
					</form>
				)}

				{step === "done" && askReason && <FormReason texts={texts} action={action} isPreview={isPreview} />}
			</div>
		</div>
	);
}

// The reasons as a list to pick one from; Other opens a line for their own words, without JavaScript.
function FormReason({ texts, action, isPreview }) {
	return (
		<form method="post" action={action} className="group mt-6 border-t border-border/60 pt-5 text-left">
			<input type="hidden" name="source" value="reason" />
			<p className="text-sm font-medium">{texts.reasonsTitle}</p>
			<div className="mt-3 flex flex-col gap-1">
				{UNSUBSCRIBE_REASONS.map((code) => (
					<label key={code} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60">
						<input type="radio" name="reason" value={code} required className="mt-0.5 size-4 shrink-0 accent-primary" />
						<span>{texts[`reason_${code}`]}</span>
					</label>
				))}
			</div>
			<textarea
				name="text"
				rows={2}
				maxLength={500}
				placeholder={texts.otherPlaceholder}
				className="mt-2 hidden w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 group-has-[input[value=other]:checked]:block"
			/>
			<Button type={isPreview ? "button" : "submit"} size="lg" className="mt-4 w-full">
				{texts.submit}
			</Button>
		</form>
	);
}

function Filled({ line, values }) {
	return fillUnsubscribeText(line, values).map((part, index) =>
		part.value ? (
			<strong key={index} className="font-semibold text-foreground">
				{part.value}
			</strong>
		) : (
			<span key={index}>{part.text}</span>
		)
	);
}

const STEPS = {
	confirm: { icon: Inbox, title: "title", text: "text" },
	stay: { icon: Heart, title: "stayTitle", text: "stayText" },
	done: { icon: MailCheck, title: "doneTitle", text: "doneText" },
	thanks: { icon: Heart, title: "thanksTitle", text: "thanksText" },
	invalid: { icon: Link2Off, title: "invalidTitle", text: "invalidText" },
	error: { icon: CircleAlert, title: "errorTitle", text: "errorText" },
};
