import {pathToFileURL} from "node:url";

// The server's harness boots a throwaway instance: postgres in a container, a synced schema
// and the checkout's built server on ephemeral localhost ports. It lives outside this repo,
// so the environment names the file.
interface ServerHarness {
	bootInstance(): Promise<{port: number; logPath: string; close(): Promise<void>}>;
}

async function loadHarness(): Promise<ServerHarness> {
	const file = process.env.MACHLOKET_SERVER_HARNESS;
	if (!file) {
		throw new Error(
			"MACHLOKET_SERVER_HARNESS is not set: point it at the instance harness file of a built " +
				"server checkout, then run `npm run test:e2e:real` again.",
		);
	}
	return (await import(pathToFileURL(file).href)) as ServerHarness;
}

export default async function globalSetup() {
	const {bootInstance} = await loadHarness();
	const inst = await bootInstance();
	// Workers inherit this process's environment.
	process.env.MACHLOKET_E2E_PORT = String(inst.port);
	console.log(`real tier: throwaway instance on 127.0.0.1:${inst.port}, log ${inst.logPath}`);
	return () => inst.close();
}
