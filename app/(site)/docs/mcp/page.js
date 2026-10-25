import Link from "next/link";
import BlockCode from "@/components/BlockCode";
import HeaderDocs from "@/components/HeaderDocs";
import LinkApp from "@/components/LinkApp";
import { DRAFT_ACTIONS, getConnectionAccess } from "@/lib/actions/define-action";
import { ACTION_GROUPS, ACTIONS } from "@/lib/actions/registry";
import { getAppUrl } from "@/lib/config";
import { getDocsPageMetadata } from "@/lib/docs/llms";
import { getMcpClients, getMcpConnectors, getMcpUrl } from "@/lib/docs/mcp-clients";
import { getSlug } from "@/lib/docs/reference";
import { MCP_SCOPE } from "@/lib/oauth-rules";
import { cn } from "@/lib/utils";

export const metadata = getDocsPageMetadata("/docs/mcp");

const LINK_CLASS = "font-medium text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground";

export default function McpPage() {
	const appUrl = getAppUrl();
	const mcpUrl = getMcpUrl(appUrl);
	const connectors = getMcpConnectors(appUrl);
	const clients = getMcpClients(appUrl);
	const sendTools = ACTIONS.filter((action) => action.destructive && action.openWorld && action.group === "Campaigns");
	const setups = connectors.length + clients.length;
	// Where clients find the resource's metadata (RFC 9728): the MCP URL's path after /.well-known/oauth-protected-resource.
	const { origin, pathname: mcpPath } = new URL(mcpUrl);
	const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource${mcpPath}`;
	const isDrafts = getConnectionAccess() === "drafts";
	// A server behind its own sign-in gateway (a PIN hub, app/api/hub-login) gets its guide in Ukrainian on top.
	const hasHub = Boolean(process.env.HUB_BRIDGE_SECRET);

	return (
		<>
			<HeaderDocs kicker="Guides" title="MCP server">
				ChatGPT, Claude and Grok Bot connect to <code className="font-mono text-[15px] text-foreground">{mcpUrl}</code>: you sign in to
				MailCheap and allow them, no key to copy. Claude Code, Codex and Cursor use a full access key. Each gets one tool per
				endpoint, with the same inputs, checks and errors.
			</HeaderDocs>

			<div className="flex max-w-3xl flex-col gap-10">
				<BlockCode title="Connector URL" code={mcpUrl} className="animate-enter" />

				{hasHub && <ClaudeHubGuide mcpUrl={mcpUrl} isDrafts={isDrafts} isKeysLocal={process.env.MCP_API_KEYS === "local"} />}

				{connectors.map(({ id, name, steps, note }, index) => (
					<section key={id} id={id} style={{ "--stagger": index + 1 }} className="scroll-mt-20 animate-enter">
						<h2 className="mb-3 text-xl font-semibold tracking-tight">{name}</h2>
						<ol className="flex flex-col gap-2.5">
							{steps.map((step, stepIndex) => (
								<li key={step} className="flex gap-3 text-[15px] leading-7 text-pretty text-foreground/80">
									<span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-xs text-muted-foreground tabular-nums">
										{stepIndex + 1}
									</span>
									<span>{step}</span>
								</li>
							))}
						</ol>
						{note && <p className="mt-3 text-sm leading-6 text-pretty text-muted-foreground">{note}</p>}
					</section>
				))}

				{clients.map(({ id, name, file, code, note }, index) => (
					<section key={id} id={id} style={{ "--stagger": connectors.length + index + 1 }} className="scroll-mt-20 animate-enter">
						<h2 className="mb-3 text-xl font-semibold tracking-tight">{name}</h2>
						<BlockCode title={file} code={code} />
						<p className="mt-3 text-sm leading-6 text-pretty text-muted-foreground">{note}</p>
					</section>
				))}

				<section style={{ "--stagger": setups + 1 }} className="rounded-2xl bg-red-500/[0.06] p-5 animate-enter sm:p-6">
					<h2 className="font-semibold tracking-tight">Sends can&apos;t be undone</h2>
					<p className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
						{sendTools.map(({ name }) => name).join(", ")} are marked destructive, and their descriptions ask the assistant to check with
						you first. Most clients ask before running them. send_test_email sends only to the account owner.
					</p>
				</section>

				<section id="connected-apps" style={{ "--stagger": setups + 2 }} className="scroll-mt-20 animate-enter">
					<h2 className="text-xl font-semibold tracking-tight">Connected apps</h2>
					<p className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
						{isDrafts
							? `On this server an app you allow can only read and write campaign drafts (${DRAFT_ACTIONS.join(", ")}, and every read-only tool), in your account only: it can't send, schedule or delete anything. Keys keep their own access. The `
							: "An app you allow gets the same access as a full access key, in your account only. The"}{" "}
						<LinkApp href="/api-keys" className={LINK_CLASS}>
							API keys page
						</LinkApp>{" "}
						lists connected apps with when they were last used. Revoke one there and its tokens stop working right away; it has to ask
						you again to come back.
					</p>
				</section>

				<section style={{ "--stagger": setups + 3 }} className="animate-enter">
					<h2 className="text-xl font-semibold tracking-tight">Tools</h2>
					<p className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
						A signups only key sees add_contact alone. Each tool&apos;s inputs and outputs are in the{" "}
						<Link href="/docs/api" className={LINK_CLASS}>
							API reference
						</Link>
						.
					</p>
					<div className="mt-5 flex flex-col gap-6">
						{ACTION_GROUPS.map((group) => (
							<div key={group}>
								<h3 className="mb-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{group}</h3>
								<ul className="divide-y divide-border/60 rounded-xl shadow-border">
									{ACTIONS.filter((action) => action.group === group).map((action) => (
										<li key={action.name} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
											<Link href={`/docs/api#${getSlug(action)}`} className="font-mono text-[13px] hover:underline">
												{action.name}
											</Link>
											<span className="flex items-center gap-1.5 text-xs">
												<Hint isOn={action.readOnly}>Read-only</Hint>
												<Hint isOn={action.destructive} tone="danger">
													Can&apos;t be undone
												</Hint>
												<Hint isOn={action.idempotent && !action.readOnly}>Safe to repeat</Hint>
											</span>
										</li>
									))}
								</ul>
							</div>
						))}
					</div>
				</section>

				<section style={{ "--stagger": setups + 4 }} className="animate-enter">
					<h2 className="text-xl font-semibold tracking-tight">Protocol</h2>
					<p className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
						The server is stateless: no sessions, every request carries a key or a token. It speaks the 2026-07-28 revision and answers
						clients on the 2025 revisions the same way. <code className="font-mono text-[13px]">/api/mcp</code> is the same server, for
						clients that want an /api path.
					</p>
					<p className="mt-3 text-[15px] leading-7 text-pretty text-foreground/80">
						OAuth follows the MCP authorization spec. A request without credentials gets a 401 pointing at{" "}
						<code className="font-mono text-[13px]">{resourceMetadataUrl}</code>, whose authorization server is{" "}
						<code className="font-mono text-[13px]">{appUrl}</code>. Apps identify themselves with a client metadata document (Grok Bot,
						on Cursor&apos;s agents, registers instead), sign the user in with the authorization code flow and PKCE, and get tokens bound to{" "}
						<code className="font-mono text-[13px]">{mcpUrl}</code>{" "}
						with the <code className="font-mono text-[13px]">{MCP_SCOPE}</code> scope. Access tokens last an hour; refresh tokens rotate and
						keep the connection for 90 days after its last use.
					</p>
				</section>
			</div>
		</>
	);
}

// This server's way in for Claude, in Ukrainian: sign-in goes through the PIN hub, and OAUTH_ACCESS may limit the app.
function ClaudeHubGuide({ mcpUrl, isDrafts, isKeysLocal }) {
	const steps = [
		"Відкрийте хаб marketing.morkva.co.ua і увійдіть з PIN у браузері, де відбуватиметься підключення: там, де відкритий claude.ai, а для Claude Desktop у системному браузері за замовчуванням. На пристрої, не зареєстрованому в хабі, вхід не спрацює.",
		"У claude.ai: Customize › Connectors › Add custom connector. Назва: Mailer, URL: адреса нижче. Client ID і secret не потрібні. Якщо Claude питає, як він себе ідентифікує, лишіть Use Claude's published identity. Натисніть Add.",
		"Натисніть Connect. Відкриється сторінка Mailer «Claude will be able to…»: перевірте список і натисніть Allow.",
		"Якщо замість неї відкрилася сторінка PIN, введіть PIN. Якщо після цього підключення не продовжилось, натисніть Connect у Claude ще раз.",
		"У чаті: + › Connectors › Mailer. Конектор працює в claude.ai, Claude Desktop і мобільних застосунках.",
	];
	return (
		<section id="claude-morkva" lang="uk" className="scroll-mt-20 rounded-2xl bg-muted/50 p-5 animate-enter sm:p-6">
			<h2 className="text-xl font-semibold tracking-tight">Claude: підключення до цього Mailer</h2>
			<p className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
				Вхід іде через PIN-хаб, а не через сторінку входу Mailer. Ключ API копіювати не треба.
			</p>
			<ol className="mt-4 flex flex-col gap-2.5">
				{steps.map((step, index) => (
					<li key={step} className="flex gap-3 text-[15px] leading-7 text-pretty text-foreground/80">
						<span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-background font-mono text-xs text-muted-foreground tabular-nums">
							{index + 1}
						</span>
						<span>{step}</span>
					</li>
				))}
			</ol>
			<BlockCode title="URL конектора" code={mcpUrl} className="mt-4" />
			{isDrafts && (
				<>
					<h3 className="mt-6 font-semibold tracking-tight">Що Claude може</h3>
					<ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-pretty text-foreground/80">
						<li>Читати розсилку, кампанії та їхні звіти, контакти, теги, поля, сегменти, огляд і щоденні підсумки.</li>
						<li>Рахувати, скільки контактів підходить під будь-які умови, не зберігаючи сегмент (count_segment).</li>
						<li>Створювати й редагувати чернетки кампаній (HTML, Markdown або текст), копіювати кампанії, завантажувати картинки.</li>
					</ul>
					<h3 className="mt-4 font-semibold tracking-tight">Чого не може</h3>
					<p className="mt-2 text-[15px] leading-7 text-pretty text-foreground/80">
						Відправляти й планувати кампанії, надсилати тестові листи, видаляти будь-що, міняти контакти, теги, поля й сегменти, керувати
						ключами та доменами. Цих інструментів Claude навіть не бачить. Сегмент і відправку налаштовуєте ви в Mailer, на сторінці
						чернетки.
					</p>
				</>
			)}
			<h3 className="mt-4 font-semibold tracking-tight">Приклади запитів</h3>
			<ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-7 text-pretty text-foreground/80">
				<li>«Порівняй останні 5 кампаній: відкриття, кліки, відписки. Що спрацювало краще?»</li>
				<li>«Скільки активних контактів із тегом product:… не відкривали листи понад 90 днів?»</li>
				<li>«Створи чернетку кампанії з цим HTML, тема „…“, прехедер „…“»</li>
			</ul>
			<p className="mt-4 text-sm leading-6 text-pretty text-muted-foreground">
				Відключити: сторінка API keys › Connected apps › Revoke, токени перестають працювати одразу. Підключення живе 90 днів після
				останнього використання, далі Claude попросить Connect ще раз.
			</p>
			{isKeysLocal && (
				<p className="mt-2 text-sm leading-6 text-pretty text-muted-foreground">
					Claude Code, Codex і Cursor з ключем API (інструкції нижче) працюють лише на самому сервері, з адресою
					http://127.0.0.1:3001/mailer/mcp. Ззовні MCP приймає тільки підключення через OAuth.
				</p>
			)}
		</section>
	);
}

function Hint({ isOn, tone, children }) {
	if (!isOn) return null;
	return (
		<span
			className={cn(
				"inline-flex h-5 items-center rounded-full px-2",
				tone === "danger" ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-muted text-muted-foreground"
			)}
		>
			{children}
		</span>
	);
}
