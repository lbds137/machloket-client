import {expect, it, vi} from "vitest";

// The app's modules import each other in cycles that evaluate correctly only in the entry's
// order (index.ts imports localuser first).
const {Localuser} = await import("./localuser");
const {I18n} = await import("./i18n");
await I18n.done;

const event = (t: string, d: unknown) => ({op: 0, t, d}) as never;

function session(mfaEnabled = false) {
	const userupdate = vi.fn();
	const userMap = new Map<string, {userupdate: typeof userupdate}>([
		["me", {userupdate}],
		["other", {userupdate}],
	]);
	const lu = Object.assign(Object.create(Localuser.prototype), {
		initialized: true,
		user: {id: "me"},
		mfa_enabled: mfaEnabled,
		userMap,
		// Every event ends by redrawing the unread badges; none of that is under test.
		generateFavicon: () => {},
		refreshInboxBadge: () => {},
		refreshInboxMenu: () => {},
	}) as InstanceType<typeof Localuser>;
	return {lu, userupdate};
}

it("own USER_UPDATE flips mfa_enabled and mfaRetry().factor; events without mfa_enabled or for another user leave it", async () => {
	const {lu, userupdate} = session(false);
	expect(lu.mfa_enabled).toBe(false);
	expect(lu.mfaRetry().factor).toBe("webauthn");

	await lu.handleEvent(event("USER_UPDATE", {id: "me", mfa_enabled: true}));
	expect(lu.mfa_enabled).toBe(true);
	expect(lu.mfaRetry().factor).toBe("totp");
	expect(userupdate).toHaveBeenCalledWith({id: "me", mfa_enabled: true});

	// An own USER_UPDATE without mfa_enabled leaves mfa_enabled untouched.
	await lu.handleEvent(event("USER_UPDATE", {id: "me", username: "nyx"}));
	expect(lu.mfa_enabled).toBe(true);
	expect(lu.mfaRetry().factor).toBe("totp");

	// Another user's USER_UPDATE leaves mfa_enabled untouched.
	await lu.handleEvent(event("USER_UPDATE", {id: "other", mfa_enabled: false}));
	expect(lu.mfa_enabled).toBe(true);
	expect(lu.mfaRetry().factor).toBe("totp");

	// Own USER_UPDATE flipping mfa_enabled back to false updates mfaRetry().factor to webauthn.
	await lu.handleEvent(event("USER_UPDATE", {id: "me", mfa_enabled: false}));
	expect(lu.mfa_enabled).toBe(false);
	expect(lu.mfaRetry().factor).toBe("webauthn");

	// Another user's USER_UPDATE with mfa_enabled: true leaves it false.
	await lu.handleEvent(event("USER_UPDATE", {id: "other", mfa_enabled: true}));
	expect(lu.mfa_enabled).toBe(false);
	expect(lu.mfaRetry().factor).toBe("webauthn");
});
