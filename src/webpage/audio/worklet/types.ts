type sendMessage =
	| {
			name: "bin";
			bin: ArrayBuffer;
	  }
	| {
			name: "getTracks";
	  }
	| {
			name: "start";
			data: {name: string; volume: number};
	  }
	| {name: "clear"};
type recvMessage = {
	name: "tracks";
	tracks: string[];
};
