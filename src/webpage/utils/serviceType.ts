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
	  };
