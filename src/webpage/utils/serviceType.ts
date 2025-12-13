export type messageTo =
	| {
			code: "ping";
	  }
	| {
			code: "close";
	  }
	| {
			code: "replace";
	  }
	| {
			code: "CheckUpdate";
	  }
	| {
			code: "isValid";
			url: string;
	  }
	| {
			code: "isDev";
			dev: boolean;
	  }
	| {
			code: "apiUrls";
			hosts?: string[];
	  };
export type messageFrom =
	| {
			code: "pong";
			count: number;
	  }
	| {
			code: "close";
	  }
	| {
			code: "closing";
	  }
	| {
			code: "updates";
			updates: boolean;
	  }
	| {
			code: "isValid";
			url: string;
			valid: boolean;
	  }
	| {
			code: "trace";
			trace: string[];
	  };
