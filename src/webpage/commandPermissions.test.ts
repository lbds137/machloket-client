import {describe, expect, it} from "vitest";
import {commandAllowedFor} from "./commandPermissions";

describe("commandAllowedFor pure table (2026-10-16 ruling)", () => {
	it("channels[c]:false -> false", () => {
		expect(commandAllowedFor({channels: {c: false}}, "c", new Set())).toBe(false);
	});
	it("channels[c]:true -> true", () => {
		expect(commandAllowedFor({channels: {c: true}}, "c", new Set())).toBe(true);
	});
	it("channels[other]:false with c absent -> null", () => {
		expect(commandAllowedFor({channels: {other: false}}, "c", new Set())).toBeNull();
		expect(commandAllowedFor({channels: {other: false}}, undefined, new Set())).toBeNull();
	});
	it("channels[c]:null counts as absent -> null", () => {
		expect(commandAllowedFor({channels: {c: null}}, "c", new Set())).toBeNull();
	});
	it("channels[c]:true beats user:false (channel tier outranks guild tier)", () => {
		expect(commandAllowedFor({channels: {c: true}, user: false}, "c", new Set())).toBe(true);
	});
	it("user:true -> true", () => {
		expect(commandAllowedFor({user: true}, undefined, new Set())).toBe(true);
	});
	it("user:false -> false", () => {
		expect(commandAllowedFor({user: false}, undefined, new Set())).toBe(false);
	});
	it("user:null counts as absent -> null", () => {
		expect(commandAllowedFor({user: null}, undefined, new Set())).toBeNull();
	});
	it("roles[r]:true for a passed r -> true", () => {
		expect(commandAllowedFor({roles: {r: true}}, undefined, new Set(["r"]))).toBe(true);
	});
	it("roles[r]:false -> false", () => {
		expect(commandAllowedFor({roles: {r: false}}, undefined, new Set(["r"]))).toBe(false);
	});
	it("user:false + roles[mod]:true -> true (allow-wins WITHIN the guild tier — the flagship mods-only config)", () => {
		expect(commandAllowedFor({user: false, roles: {mod: true}}, undefined, new Set(["mod"]))).toBe(true);
		expect(commandAllowedFor({user: false, roles: {mod: true}}, undefined, new Set(["other"]))).toBe(false);
	});
	it("user:true + roles[x]:false -> true", () => {
		expect(commandAllowedFor({user: true, roles: {x: false}}, undefined, new Set(["x"]))).toBe(true);
	});
	it("roles[a]:false + roles[b]:true -> true regardless of iteration order", () => {
		expect(commandAllowedFor({roles: {a: false, b: true}}, undefined, new Set(["a", "b"]))).toBe(true);
	});
	it("channels[c]:false + roles[mod]:true -> false (channel tier outranks guild tier)", () => {
		expect(commandAllowedFor({channels: {c: false}, roles: {mod: true}}, "c", new Set(["mod"]))).toBe(false);
	});
	it("{} -> null", () => {
		expect(commandAllowedFor({}, "c", new Set(["r"]))).toBeNull();
		expect(commandAllowedFor({}, undefined, new Set())).toBeNull();
	});
	it("absent entries -> null", () => {
		expect(commandAllowedFor(null, "c", new Set(["r"]))).toBeNull();
		expect(commandAllowedFor(undefined, "c", new Set(["r"]))).toBeNull();
	});
});
