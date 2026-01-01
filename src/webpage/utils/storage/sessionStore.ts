export type UserAuth = {
	serverName: string;
	token: string;
	id: string;
	cachedUsername: string;
	cachedAvatarUrl: string;
	// @deprecated
	cachedEmail?: string;
	sessionId: string;
}

export class SessionStore {
	currentSession: string;
	sessions: Map<string, UserAuth> = {};

	constructor(init?: Partial<SessionStore>) {
		Object.assign(this, init);
	}

	getCurrentSession(): UserAuth | null {
		return this.sessions.get(this.currentSession) || null;
	}
}