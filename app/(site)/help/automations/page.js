import ArticleHelp from "@/components/ArticleHelp";
import LinkApp from "@/components/LinkApp";
import { MAX_DELAY, MAX_STEPS } from "@/lib/automation-steps";
import { getHelpPageMetadata } from "@/lib/help";

export const metadata = getHelpPageMetadata("automations");

export default function AutomationsHelpPage() {
	return (
		<ArticleHelp slug="automations">
			<p>
				An automation sends emails and changes contacts by itself: a trigger lets a contact in, and the contact goes through its
				steps, one after the other. Each newsletter has its own, on the <LinkApp href="/automations">Automations page</LinkApp>.
			</p>

			<h2 id="create">Creating one</h2>
			<p>
				New automation, then Start from scratch, and give it a name. It opens in the editor: pick a trigger in the Add step panel on
				the left, then add steps with the + between them, or drag them from the panel. Click a step to set it up on the right, and Save.
				Everything else is saved as you go. An automation has up to {MAX_STEPS} steps.
			</p>

			<h2 id="triggers">Triggers</h2>
			<ul>
				<li>
					<strong>Joins tag(s):</strong> a contact gets one of the tags, from the dashboard, the API or another automation. Contacts with an
					excluded tag never go in, and you can have contacts leave once they lose the tags.
				</li>
				<li>
					<strong>Clicks a link:</strong> a click on that link, or any link starting with it, in any email of the newsletter.
				</li>
				<li>
					<strong>Updates field:</strong> one of your contact fields changes, on the dashboard or through the API. Imports don&apos;t count.
				</li>
				<li>
					<strong>Event anniversary:</strong> every year on the day of a date field, or some days before or after it, at the time you pick in
					your account&apos;s timezone.
				</li>
				<li>
					<strong>Exact date:</strong> once, at that time, every active contact, or those with some tags.
				</li>
			</ul>
			<p>Triggers marked Soon, like forms, segments and e-commerce, aren&apos;t available yet.</p>

			<h2 id="steps">Steps</h2>
			<ul>
				<li>
					<strong>Delay:</strong> waits up to {MAX_DELAY.minutes} minutes, {MAX_DELAY.hours} hours, {MAX_DELAY.days} days or{" "}
					{MAX_DELAY.weeks} weeks.
				</li>
				<li>
					<strong>Condition:</strong> the same conditions as segments. Contacts who meet them go down Yes, the others down No, and each branch
					ends on its own.
				</li>
				<li>
					<strong>Send email:</strong> an email written in the campaign editor, from the newsletter&apos;s sender, with opens and clicks
					tracked. It never goes to the website or the campaigns list. UTM tags add utm_source, utm_medium and utm_campaign to its links
					for web analytics, leaving links that have their own. Its footer is in the newsletter&apos;s language unless it picks another.
				</li>
				<li>
					<strong>Copy, move or remove tags</strong>, <strong>update a field</strong> and <strong>unsubscribe</strong> change the contact.
					Move adds the tags and takes the trigger&apos;s tags off.
				</li>
				<li>
					<strong>Webhook:</strong> sends the contact as JSON to an https address, signed with the secret the step shows.
				</li>
				<li>
					<strong>Internal notification:</strong> emails you the contact&apos;s address and your note.
				</li>
			</ul>

			<h2 id="running">Starting, pausing and changing it</h2>
			<p>
				Activate starts it once every step is set up: the Activity hub lists what&apos;s missing. Only contacts who are active get in, and
				each goes through once unless Settings lets them in again. Unsubscribed and bounced contacts leave at their next step.
			</p>
			<p>
				Pausing holds everyone where they are, and they go on when you activate it again. You can change a running automation: contacts
				waiting at a step go on from it, so a step someone waits at can&apos;t be deleted.
			</p>
			<p>
				Add subscribers, in the Activity hub, lets in the active contacts with a tag or in a segment at once. Test sends you every email of
				the automation as a test, without running anything else.
			</p>

			<h2 id="activity">Activity and stats</h2>
			<p>
				The Activity hub counts the contacts who started, are in progress, completed it, were canceled or failed, and its emails&apos;
				opens, clicks, unsubscribes and bounces. View workflow activity lists each contact with the step they&apos;re at and what each step
				did, and each email&apos;s numbers.
			</p>
		</ArticleHelp>
	);
}
