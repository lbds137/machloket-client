import {afterEach, expect, it, vi} from "vitest";
import {captureRequests} from "./test/setup";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
await import("./localuser");
const {ReportMenu} = await import("./reporting/report");

const API = "http://rep.test/api/v9";
const POSTBACK = API + "/reporting/guild";

afterEach(() => {
	vi.restoreAllMocks();
	document.querySelectorAll(".background").forEach((e) => e.remove());
});

const node = (id: number, header: string, extra: Record<string, unknown> = {}) => ({
	id,
	key: header,
	header,
	subheader: null,
	info: null,
	button: null,
	elements: [],
	report_type: null,
	children: [],
	is_multi_select_required: false,
	is_auto_submit: false,
	...extra,
});

/** Root → "Spam" → a reasons checklist with Submit; success and fail screens. */
function guildReport(rootButton: unknown = null) {
	const json = {
		version: "1.0",
		name: "guild",
		variant: "1",
		postback_url: POSTBACK,
		root_node_id: 1,
		success_node_id: 3,
		fail_node_id: 4,
		nodes: {
			0: node(0, "Start over"),
			1: node(1, "What's wrong?", {children: [["Spam", 2]], button: rootButton}),
			2: node(2, "Which kind?", {
				button: {type: "submit", target: null},
				elements: [
					{
						name: "reasons",
						type: "checkbox",
						data: [
							["ads", "Ads"],
							["scam", "Scam"],
						],
						should_submit_data: true,
						skip_if_unlocalized: false,
						is_localized: true,
					},
				],
			}),
			3: node(3, "Thanks for reporting"),
			4: node(4, "Report failed"),
		},
	};
	const menu = new ReportMenu(
		json as never,
		{info: {api: API}, headers: {}} as never,
		{
			guild: {id: "g1"},
		} as never,
	);
	menu.spawnMenu();
	return menu;
}

const menuText = () => document.querySelector(".reportMenu")!.textContent;
const button = (text: string) =>
	[...document.querySelectorAll<HTMLButtonElement>(".reportMenu button")].find(
		(b) => b.textContent === text,
	)!;
const after = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pickScamAndSubmit() {
	button("Spam").click();
	document.querySelectorAll<HTMLElement>(".checkCard")[1].click();
	button(document.querySelector(".reportButtonDiv button:last-child")!.textContent!).click();
	await after(50);
}

it("the reasons picked on the last screen are sent", async () => {
	const sent = captureRequests(POSTBACK, () => new Response(null, {status: 204}));
	guildReport();

	await pickScamAndSubmit();

	expect(sent).toEqual([expect.objectContaining({elements: {reasons: ["scam"]}})]);
	expect(menuText()).toContain("Thanks for reporting");
});

it("a double tap on Submit sends one report", async () => {
	const sent = captureRequests(POSTBACK, async () => {
		await after(50);
		return new Response(null, {status: 204});
	});
	guildReport();
	button("Spam").click();
	const submit = document.querySelector<HTMLButtonElement>(".reportButtonDiv button:last-child")!;

	submit.click();
	submit.click();
	await after(120);

	expect(sent).toHaveLength(1);
});

it("a refusal that isn't JSON still shows the failure screen", async () => {
	captureRequests(POSTBACK, () => new Response("<html>bad gateway</html>", {status: 502}));
	guildReport();

	await pickScamAndSubmit();

	expect(menuText()).toContain("Report failed");
});

it("an unreachable instance shows the failure screen", async () => {
	vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
	guildReport();

	await pickScamAndSubmit();

	expect(menuText()).toContain("Report failed");
});

it("Escape closes the menu", async () => {
	guildReport();

	document.activeElement!.dispatchEvent(
		new KeyboardEvent("keydown", {key: "Escape", bubbles: true}),
	);
	await after(600);

	expect(document.querySelector(".reportMenu")).toBeNull();
});

it("a Next button can lead to screen 0", () => {
	guildReport({type: "next", target: 0});

	document.querySelector<HTMLButtonElement>(".reportButtonDiv button:last-child")!.click();

	expect(menuText()).toContain("Start over");
});

it("a report missing what it's about shows the failure screen", async () => {
	const sent = captureRequests(POSTBACK, () => new Response(null, {status: 204}));
	const menu = guildReport();
	menu.infoMap.guild = undefined;

	await pickScamAndSubmit();

	expect(sent).toEqual([]);
	expect(menuText()).toContain("Report failed");
});
