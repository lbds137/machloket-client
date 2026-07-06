import {Localuser} from "./localuser.js";
import {Contextmenu} from "./contextmenu.js";
import {getViewportHeight, mobile, Specialuser} from "./utils/utils.js";
import {setTheme} from "./utils/utils.js";
import {MarkDown} from "./markdown.js";
import {Message} from "./message.js";
import {File} from "./file.js";
import {I18n} from "./i18n.js";
import "./utils/pollyfills.js";
import {makeLogin} from "./login.js";
import {Hover} from "./hover.js";
import "./templatePage.js";
import "./more.js";
import "./recover.js";
import "./home.js";
import "./invite.js";
import "./oauth2/auth.js";
if (window.location.pathname.startsWith("/audio")) {
	await import("./audio/page.js");
}
import "./404.js";
import {Channel} from "./channel.js";
import {Guild} from "./guild.js";
import {
	initOpenpanel,
	installOpenpanelErrorTracking,
	sendOpenpanelAnalytics,
} from "./utils/openpanel.js";
import {showChangelogPopup} from "./changelog.js";
import {AutoTranslationService} from "./services/autoTranslation.js";
import {TranslationService} from "./services/translation.js";
import {SovrahiService} from "./services/sovrahi.js";

if (window.location.pathname === "/app") {
	window.location.pathname = "/channels/@me";
}
export interface CustomHTMLDivElement extends HTMLDivElement {
	markdown: MarkDown;
}
if (window.location.pathname.startsWith("/channels")) {
	let templateID = new URLSearchParams(window.location.search).get("templateID");
	await I18n.done;
	await AutoTranslationService.refreshTargetLang();
	await SovrahiService.handleAuthCallback();
	let pendingTranslateMessageId = SovrahiService.consumePendingTranslateMessageId();
	Localuser.loadFont();
	installOpenpanelErrorTracking();

	I18n.translatePage();

	const userInfoElement = document.getElementById("userinfo") as HTMLDivElement;
	userInfoElement.addEventListener("click", (event) => {
		event.stopImmediatePropagation();
		if (thisUser) {
			const rect = userInfoElement.getBoundingClientRect();
			thisUser.user.buildprofile(Math.max(0, rect.left), Math.max(0, rect.top - 360));
		}
	});
	userInfoElement.addEventListener("contextmenu", (event) => {
		event.preventDefault();
		event.stopImmediatePropagation();
		if (thisUser) {
			const rect = userInfoElement.getBoundingClientRect();
			Localuser.userMenu.makemenu(rect.x, rect.top - 10 - getViewportHeight(), thisUser);
		}
	});

	const switchAccountsElement = document.getElementById("switchaccounts") as HTMLDivElement;
	switchAccountsElement.addEventListener("click", async (event) => {
		event.stopImmediatePropagation();
		Localuser.showAccountSwitcher(thisUser);
	});

	let thisUser: Localuser;
	function regSwap(l: Localuser) {
		l.onswap = (l) => {
			thisUser = l;
			regSwap(l);
		};
		l.fileExtange = (img, html) => {
			const blobArr: Blob[] = [];
			const htmlArr = imagesHtml;
			let i = 0;
			for (const file of images) {
				const img = imagesHtml.get(file);
				if (!img) continue;
				if (pasteImageElement.contains(img)) {
					pasteImageElement.removeChild(img);
					blobArr.push(images[i]);
				} else {
					i++;
				}
			}
			images = img;
			imagesHtml = html;
			for (const file of images) {
				const img = imagesHtml.get(file);
				if (!img) throw new Error("Image without HTML, exiting");
				pasteImageElement.append(img);
			}
			return [blobArr, htmlArr];
		};
	}
	const loaddesc = document.getElementById("load-desc") as HTMLSpanElement;
	try {
		const current = sessionStorage.getItem("currentuser") || Localuser.users.currentuser;
		if (!Localuser.users.users[current]) {
			thisUser = new Localuser(await new Promise<Specialuser>((res) => makeLogin(true, "", res)));
		} else {
			thisUser = new Localuser(Localuser.users.users[current]);
		}

		regSwap(thisUser);
		const startupStarted = performance.now();
		thisUser.initwebsocket().then(async () => {
			const loading = document.getElementById("loading") as HTMLDivElement;
			try {
				thisUser.loaduser();
				loaddesc.textContent = I18n.loaded();
				loading.classList.add("doneloading");
				loading.classList.remove("loading");
				await Localuser.showOpenpanelAnalyticsPrompt();
				initOpenpanel();
				thisUser.identifyOpenpanelUser();
				sendOpenpanelAnalytics("app_loaded", {
					startup_ms: Math.round(performance.now() - startupStarted),
				});
				showChangelogPopup();
				if (templateID) {
					thisUser.passTemplateID(templateID);
				}
				console.warn("huh");
				await thisUser.init();
				if (pendingTranslateMessageId && thisUser.channelfocus) {
					const message = await thisUser.channelfocus.getmessage(pendingTranslateMessageId);
					if (message) {
						await message.performTranslate();
					}
				}
				console.warn("huh2");
				sendOpenpanelAnalytics("initial_channel_loaded", {
					startup_ms: Math.round(performance.now() - startupStarted),
					route: window.location.pathname.startsWith("/channels") ? "channel" : "home",
				});
				console.log("done loading");
			} catch (e) {
				console.error(e);
			}
		});
	} catch (e) {
		debugger;
		console.error(e);
		loaddesc.textContent = I18n.accountNotStart();
		thisUser = new Localuser(-1);
	}
	//TODO move this to the channel/guild class, this is a weird spot
	const menu = new Contextmenu<void, void>("create rightclick");
	menu.addButton(
		I18n.channel.createChannel(),
		() => {
			if (thisUser.lookingguild) {
				thisUser.lookingguild.createchannels();
			}
		},
		{
			visible: function () {
				return thisUser.lookingguild?.member.hasPermission("MANAGE_CHANNELS") || false;
			},
		},
	);

	menu.addButton(
		I18n.channel.createCatagory(),
		() => {
			if (thisUser.lookingguild) {
				thisUser.lookingguild.createcategory();
			}
		},
		{
			visible: function () {
				return thisUser.lookingguild?.member.hasPermission("MANAGE_CHANNELS") || false;
			},
		},
	);
	const channelw = document.getElementById("channelw");
	if (channelw) {
		channelw.addEventListener("keypress", (e) => {
			if (e.ctrlKey || e.altKey || e.metaKey || e.metaKey) return;
			let owner = e.target as HTMLElement;
			while (owner !== channelw) {
				if (owner.tagName === "input" || owner.contentEditable !== "false") {
					return;
				}
				owner = owner.parentElement as HTMLElement;
			}
			typebox.markdown.boxupdate(Infinity);
		});
		channelw.addEventListener("keydown", (event) => {
			if (event.key === "PageUp" || event.key === "PageDown" || event.key === "Escape") {
				const div = thisUser.channelfocus?.infinite.div;
				if (!div) return;
				event.preventDefault();
				if (event.key === "Escape") {
					thisUser.channelfocus?.readbottom();
					thisUser.channelfocus?.goToBottom();
					typebox.focus();
				} else {
					const page = div.clientHeight - 50;
					div.scrollTop += event.key === "PageUp" ? -page : page;
				}
			}
		});
	}
	menu.bindContextmenu(document.getElementById("channels") as HTMLDivElement);

	const pasteImageElement = document.getElementById("pasteimage") as HTMLDivElement;
	let replyingTo: Message | null = null;
	window.addEventListener("popstate", (e) => {
		if (e.state instanceof Object) {
			thisUser.goToState(e.state);
		}
		//console.log(e.state,"state:3")
	});
	let nonceMap = new Map<string, string>();
	//@ts-expect-error unused right now, not needed
	function getNonce(id: string) {
		const nonce = nonceMap.get(id) || Math.floor(Math.random() * 1000000000) + "";
		nonceMap.set(id, nonce);
		return nonce;
	}
	const markdown = new MarkDown("", thisUser);
	async function sendMessage(channel: Channel, content: string) {
		if (!channel.canMessageRightNow()) return;
		if (channel.curCommand) {
			channel.submitCommand();
			return;
		}
		markdown.onUpdate("", false);

		replyingTo = thisUser.channelfocus ? thisUser.channelfocus.replyingto : null;
		if (replyingTo?.div) {
			replyingTo.div.classList.remove("replying");
		}
		if (thisUser.channelfocus) {
			thisUser.channelfocus.replyingto = null;
			thisUser.channelfocus.makereplybox();
		}
		const attachments = images.filter((_) => document.contains(imagesHtml.get(_) || null));
		while (images.length) {
			const elm = imagesHtml.get(images.pop() as Blob) as HTMLElement;
			if (pasteImageElement.contains(elm)) pasteImageElement.removeChild(elm);
		}
		typebox.innerHTML = "";
		typebox.markdown.txt = "";
		channel.setDraft("");
		try {
			await new Promise<void>((mres, rej) =>
				channel.sendMessage(
					content,
					{
						attachments,
						embeds: [], // Add an empty array for the embeds property
						replyingto: replyingTo,
						sticker_ids: [],
						//nonce: getNonce(channel.id),
					},
					(res) => {
						if (res === "Ok") {
							sendOpenpanelAnalytics("message_sent", {
								attachment_count: attachments.length,
								has_reply: Boolean(replyingTo),
								sent_from: channel.guild.id === "@me" ? "dm" : "guild",
							});
							mres();
						} else {
							rej();
						}
					},
				),
			);
		} catch {
			images = attachments;
			for (const file of images) {
				const img = imagesHtml.get(file);
				if (!img) continue;
				pasteImageElement.append(img);
			}
			channel.replyingto = replyingTo;
			channel.makereplybox();
			typebox.textContent = content;
			typebox.markdown.txt = content;
			typebox.markdown.boxupdate(Infinity);
			channel.setDraft(content);
		}
		nonceMap.delete(channel.id);
	}
	const mobileSend = document.getElementById("mobileSend");
	if (mobileSend) {
		mobileSend.onclick = () => {
			const channel = thisUser.channelfocus;
			if (!channel) return;
			const content = MarkDown.gatherBoxText(typebox);
			sendMessage(channel, content);
		};
	}
	async function handleEnter(event: KeyboardEvent): Promise<void> {
		if (event.isComposing) return;
		if (event.key === "Escape") {
			if (images.length || thisUser.channelfocus?.replyingto) {
				while (images.length) {
					const elm = imagesHtml.get(images.pop() as Blob) as HTMLElement;
					if (pasteImageElement.contains(elm)) pasteImageElement.removeChild(elm);
				}
				if (thisUser.channelfocus) {
					thisUser.channelfocus?.replyingto?.div?.classList.remove("replying");
					thisUser.channelfocus.replyingto = null;
					thisUser.channelfocus.makereplybox();
				}
			}
			if (thisUser.channelfocus) {
				thisUser.channelfocus.readbottom();
				thisUser.channelfocus.goToBottom();
			}
			typebox.focus();
			return;
		}
		if (thisUser.handleKeyUp(event)) {
			return;
		}

		const channel = thisUser.channelfocus;
		if (!channel) return;
		const content = MarkDown.gatherBoxText(typebox);
		if (content === "" && event.key === "ArrowUp" && !event.altKey) {
			channel.editLast();
			return;
		}

		if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
			channel.typingstart();
		}

		if (event.key === "Enter" && !event.shiftKey && window.innerWidth > 600) {
			event.preventDefault();
			await sendMessage(channel, content);
		}
	}

	const typebox = document.getElementById("typebox") as CustomHTMLDivElement;

	typebox.markdown = markdown;
	typebox.addEventListener("keyup", handleEnter);
	const syncCurrentDraft = () => {
		const channel = thisUser.channelfocus;
		if (!channel || channel.curCommand) return;
		channel.setDraft(MarkDown.gatherBoxText(typebox));
	};
	typebox.addEventListener("input", syncCurrentDraft);
	typebox.addEventListener("keydown", (event) => {
		if (event.isComposing) return;
		thisUser.keydown(event);
		if (event.key === "Enter" && !event.shiftKey && window.innerWidth > 600) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		if (event.key === "PageUp" || event.key === "PageDown") {
			const div = thisUser.channelfocus?.infinite.div;
			if (div) {
				event.preventDefault();
				const page = div.clientHeight - 50;
				div.scrollTop += event.key === "PageUp" ? -page : page;
			}
		}
	});

	const getNavigableChannels = (guild: Guild): Channel[] => {
		if (guild.id === "@me") return [...guild.channels];
		return guild.channels.filter(
			(ch) => ch.visible && ch.type !== 4 && !ch.isThread() && ch.type !== 13,
		);
	};

	const getGuildList = (): Guild[] => {
		const list: Guild[] = [];
		const dm = thisUser.guildids.get("@me");
		if (dm) list.push(dm);
		for (const item of thisUser.guildOrder) {
			if (item instanceof Guild) {
				list.push(item);
			} else {
				list.push(...item.guilds);
			}
		}
		return list;
	};

	document.addEventListener("keydown", (event) => {
		if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
		if (!thisUser?.channelfocus) return;

		event.preventDefault();

		const down = event.key === "ArrowDown";
		const shift = event.shiftKey;
		const step = down ? 1 : -1;

		const currentChannel = thisUser.channelfocus;
		const currentGuild = currentChannel.guild;

		const channels = getNavigableChannels(currentGuild);
		const currentIndex = channels.indexOf(currentChannel);
		if (currentIndex === -1) return;

		let nextIndex = currentIndex + step;

		if (shift) {
			while (nextIndex >= 0 && nextIndex < channels.length) {
				if (channels[nextIndex].hasunreads) break;
				nextIndex += step;
			}
		}

		if (nextIndex >= 0 && nextIndex < channels.length) {
			thisUser.goToChannel(channels[nextIndex].id);
			return;
		}

		const guilds = getGuildList();
		const currentGuildIndex = guilds.indexOf(currentGuild);
		if (currentGuildIndex === -1) return;

		let nextGuildIndex = currentGuildIndex + step;

		while (nextGuildIndex >= 0 && nextGuildIndex < guilds.length) {
			const guild = guilds[nextGuildIndex];
			const guildChannels = getNavigableChannels(guild);
			if (guildChannels.length === 0) {
				nextGuildIndex += step;
				continue;
			}

			if (!shift) {
				thisUser.goToChannel(guildChannels[down ? 0 : guildChannels.length - 1].id);
				return;
			}

			const unreadIndex = guildChannels.findIndex((ch) => ch.hasunreads);
			if (unreadIndex !== -1) {
				thisUser.goToChannel(guildChannels[unreadIndex].id);
				return;
			}

			nextGuildIndex += step;
		}
	});

	markdown.giveBox(typebox);
	{
		const searchBox = document.getElementById("searchBox") as CustomHTMLDivElement;
		const markdown = new MarkDown("", thisUser);
		searchBox.markdown = markdown;
		const searchX = document.getElementById("searchX") as HTMLElement;
		searchBox.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				thisUser.mSearch(markdown.rawString);
			}
		});
		searchBox.addEventListener("keyup", () => {
			if (searchBox.textContent === "") {
				setTimeout(() => (searchBox.innerHTML = ""), 0);
				searchX.classList.add("svg-search");
				searchX.classList.remove("svg-plainx");
				searchBox.parentElement!.classList.remove("searching");
			} else {
				searchX.classList.remove("svg-search");
				searchX.classList.add("svg-plainx");
				searchBox.parentElement!.classList.add("searching");
			}
		});
		const sideContainDiv = document.getElementById("sideContainDiv") as HTMLElement;
		searchBox.onclick = () => {
			sideContainDiv.classList.remove("hideSearchDiv");
		};
		searchX.onclick = () => {
			if (searchX.classList.contains("svg-plainx")) {
				markdown.txt = "";
				searchBox.innerHTML = "";
				searchX.classList.add("svg-search");
				searchBox.parentElement!.classList.remove("searching");
				searchX.classList.remove("svg-plainx");
				thisUser.mSearch("");
			} else {
				searchBox.parentElement!.classList.add("searching");
			}
		};

		markdown.giveBox(searchBox);
		markdown.setCustomBox((e) => {
			const span = document.createElement("span");
			span.textContent = e.replace("\n", "");
			return span;
		});
	}
	let images: Blob[] = [];
	let imagesHtml = new WeakMap<Blob, HTMLElement>();

	document.addEventListener("paste", async (e: ClipboardEvent) => {
		if (!thisUser.channelfocus) return;
		if (!e.clipboardData) return;

		for (const file of Array.from(e.clipboardData.files)) {
			const fileInstance = File.initFromBlob(file);
			e.preventDefault();
			const html = fileInstance.upHTML(images, imagesHtml, file);
			pasteImageElement.appendChild(html);
			images.push(file);
			imagesHtml.set(file, html);
		}
	});

	await setTheme();

	function userSettings(): void {
		thisUser.showusersettings();
	}

	(document.getElementById("settings") as HTMLImageElement).onclick = userSettings;
	const memberListToggle = document.getElementById("memberlisttoggle") as HTMLInputElement;
	const pageEl = document.getElementById("page") as HTMLDivElement | null;
	memberListToggle.checked = !localStorage.getItem("memberNotChecked");
	const updateMemberListClass = () => {
		if (!pageEl) return;
		pageEl.classList.toggle("mobileMembersOpen", memberListToggle.checked);
	};
	memberListToggle.onchange = () => {
		if (!memberListToggle.checked) {
			localStorage.setItem("memberNotChecked", "true");
		} else {
			localStorage.removeItem("memberNotChecked");
		}
		updateMemberListClass();
	};
	updateMemberListClass();
	if (mobile) {
		const channelWrapper = document.getElementById("channelw") as HTMLDivElement;
		const mainArea = document.getElementById("mainarea") as HTMLDivElement;
		const channelList = document.querySelector<HTMLDivElement>(".channelflex");
		const maintoggle = document.getElementById("maintoggle") as HTMLInputElement | null;
		const updateViewportHeight = () => {
			document.documentElement.style.setProperty(
				"--app-height",
				`${Math.round(getViewportHeight())}px`,
			);
		};
		updateViewportHeight();
		window.addEventListener("resize", updateViewportHeight, {passive: true});
		window.addEventListener("orientationchange", updateViewportHeight, {passive: true});
		window.visualViewport?.addEventListener("resize", updateViewportHeight, {passive: true});
		window.visualViewport?.addEventListener("scroll", updateViewportHeight, {passive: true});
		const updateMainClass = () => {
			if (!pageEl || !maintoggle) return;
			pageEl.classList.toggle("mobileMainOpen", maintoggle.checked);
		};
		const setMainOpen = (isOpen: boolean) => {
			if (!maintoggle) return;
			maintoggle.checked = isOpen;
			updateMainClass();
		};
		if (maintoggle) {
			maintoggle.onchange = updateMainClass;
			updateMainClass();
		}
		let ignoreChannelWrapperClick = false;
		channelWrapper.addEventListener("click", (event) => {
			if (ignoreChannelWrapperClick) {
				ignoreChannelWrapperClick = false;
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			if (!maintoggle) return;
			setMainOpen(true);
		});
		const scrollWrap = document.getElementById("scrollWrap") as HTMLElement;
		if (scrollWrap) {
			scrollWrap.addEventListener(
				"click",
				(event) => {
					if (!maintoggle || maintoggle.checked) return;
					event.stopImmediatePropagation();
					event.preventDefault();
					setMainOpen(true);
				},
				{capture: true},
			);
		}
		let swipeGesture: "none" | "horizontal" | "vertical" = "none";
		let swipeStartX = 0;
		let swipeStartY = 0;
		let swipeDeltaX = 0;
		mainArea.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length !== 1) return;
				swipeGesture = "none";
				swipeStartX = event.touches[0].pageX;
				swipeStartY = event.touches[0].pageY;
				swipeDeltaX = 0;
			},
			{passive: true},
		);
		mainArea.addEventListener(
			"touchmove",
			(event) => {
				if (event.touches.length !== 1) return;
				const target = event.target as HTMLElement | null;
				if (target?.closest(".scroller")) return;
				const dx = event.touches[0].pageX - swipeStartX;
				const dy = event.touches[0].pageY - swipeStartY;
				if (swipeGesture === "none" && (Math.abs(dx) > 16 || Math.abs(dy) > 16)) {
					swipeGesture = Math.abs(dx) > Math.abs(dy) * 1.5 ? "horizontal" : "vertical";
				}
				if (swipeGesture === "horizontal") {
					swipeDeltaX = dx;
					event.preventDefault();
				}
			},
			{passive: false},
		);
		mainArea.addEventListener("touchend", () => {
			if (swipeGesture === "horizontal" && swipeDeltaX > 45) {
				setMainOpen(false);
				ignoreChannelWrapperClick = true;
			}
		});
		if (channelList) {
			let listGesture: "none" | "horizontal" | "vertical" = "none";
			let listStartX = 0;
			let listStartY = 0;
			let listDeltaX = 0;
			channelList.addEventListener(
				"touchstart",
				(event) => {
					if (event.touches.length !== 1) return;
					listGesture = "none";
					listStartX = event.touches[0].pageX;
					listStartY = event.touches[0].pageY;
					listDeltaX = 0;
				},
				{passive: true},
			);
			channelList.addEventListener(
				"touchmove",
				(event) => {
					if (event.touches.length !== 1) return;
					const target = event.target as HTMLElement | null;
					if (target?.closest(".scroller")) return;
					const dx = event.touches[0].pageX - listStartX;
					const dy = event.touches[0].pageY - listStartY;
					if (listGesture === "none" && (Math.abs(dx) > 16 || Math.abs(dy) > 16)) {
						listGesture = Math.abs(dx) > Math.abs(dy) * 1.5 ? "horizontal" : "vertical";
					}
					if (listGesture === "horizontal") {
						listDeltaX = dx;
						event.preventDefault();
					}
				},
				{passive: false},
			);
			channelList.addEventListener("touchend", () => {
				if (listGesture === "horizontal" && listDeltaX < -45) {
					setMainOpen(true);
				}
			});
		}
		memberListToggle.checked = false;
		updateMemberListClass();
	}
	const channelPanel = document.querySelector<HTMLDivElement>(".channelflex");
	const sidebarResize = document.getElementById("sidebarResize");
	const CHANNEL_WIDTH_KEY = "channelPanelWidth";
	if (channelPanel) {
		if (mobile) {
			channelPanel.style.removeProperty("width");
		} else {
			const storedWidth = localStorage.getItem(CHANNEL_WIDTH_KEY);
			if (storedWidth) {
				const width = Number(storedWidth);
				if (!Number.isNaN(width)) {
					const clamped = Math.max(180, Math.min(420, width));
					channelPanel.style.width = `${clamped}px`;
				}
			}
		}
	}
	if (sidebarResize && channelPanel) {
		let dragging = false;
		let pointerId: number | null = null;
		const updateWidth = (pageX: number) => {
			const rect = channelPanel.getBoundingClientRect();
			const newWidth = Math.max(180, Math.min(420, pageX - rect.left));
			channelPanel.style.width = `${newWidth}px`;
			localStorage.setItem(CHANNEL_WIDTH_KEY, `${newWidth}`);
		};
		sidebarResize.addEventListener("pointerdown", (event) => {
			dragging = true;
			pointerId = event.pointerId;
			sidebarResize.setPointerCapture(event.pointerId);
			document.body.style.userSelect = "none";
			document.body.style.cursor = "col-resize";
			event.preventDefault();
		});
		document.addEventListener("pointermove", (event) => {
			if (!dragging) return;
			updateWidth(event.clientX);
		});
		document.addEventListener("pointerup", () => {
			if (!dragging) return;
			dragging = false;
			if (pointerId !== null) {
				sidebarResize.releasePointerCapture(pointerId);
				pointerId = null;
			}
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		});
	}
	let dragendtimeout = setTimeout(() => {});
	document.addEventListener("dragover", (e) => {
		clearTimeout(dragendtimeout);
		const data = e.dataTransfer;
		const bg = document.getElementById("gimmefile") as HTMLDivElement;

		if (data) {
			const isfile = data.types.includes("Files") || data.types.includes("application/x-moz-file");
			if (!isfile) {
				bg.hidden = true;
				return;
			}
			e.preventDefault();
			bg.hidden = false;
			//console.log(data.types,data)
		} else {
			bg.hidden = true;
		}
	});
	document.addEventListener("dragleave", (_) => {
		dragendtimeout = setTimeout(() => {
			const bg = document.getElementById("gimmefile") as HTMLDivElement;
			bg.hidden = true;
		}, 1000);
	});
	document.addEventListener("dragenter", (e) => {
		e.preventDefault();
	});
	document.addEventListener("drop", (e) => {
		const data = e.dataTransfer;
		const bg = document.getElementById("gimmefile") as HTMLDivElement;
		bg.hidden = true;
		if (!thisUser.channelfocus) {
			e.preventDefault();
			return;
		}
		if (data) {
			const isfile = data.types.includes("Files") || data.types.includes("application/x-moz-file");
			if (isfile) {
				e.preventDefault();
				console.log(data.files);
				for (const file of Array.from(data.files)) {
					const fileInstance = File.initFromBlob(file);
					const html = fileInstance.upHTML(images, imagesHtml, file);
					pasteImageElement.appendChild(html);
					images.push(file);
					imagesHtml.set(file, html);
				}
			}
		}
	});
	const pinnedM = document.getElementById("pinnedM") as HTMLElement;
	pinnedM.onclick = (e) => {
		thisUser.pinnedClick(pinnedM.getBoundingClientRect());
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	const inboxM = document.getElementById("inboxM") as HTMLElement;
	inboxM.onmousedown = (e) => e.stopImmediatePropagation();
	inboxM.onclick = (e) => {
		thisUser.inboxClick(inboxM.getBoundingClientRect());
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	const umenu = new Contextmenu<void, void>("upload");
	umenu.addButton(
		I18n.makePoll(),
		() => {
			thisUser.makePoll();
		},
		{
			visible: () => !!thisUser.channelfocus?.hasPermission("SEND_POLLS"),
		},
	);
	umenu.addButton(I18n.upload(), () => {
		const input = document.createElement("input");
		input.type = "file";
		input.click();
		input.multiple = true;
		console.log("clicked");
		if (!thisUser.channelfocus) return;
		input.onchange = () => {
			if (input.files) {
				for (const file of Array.from(input.files)) {
					const fileInstance = File.initFromBlob(file);
					const html = fileInstance.upHTML(images, imagesHtml, file);
					pasteImageElement.appendChild(html);
					images.push(file);
					imagesHtml.set(file, html);
				}
			}
		};
	});
	umenu.bindContextmenu(
		document.getElementById("upload")!,
		undefined,
		undefined,
		undefined,
		undefined,
		"left",
		"bottom",
	);
	const emojiTB = document.getElementById("emojiTB") as HTMLElement;
	emojiTB.onmousedown = (e) => e.stopImmediatePropagation();
	emojiTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		thisUser.TBEmojiMenu(emojiTB.getBoundingClientRect());
	};

	const gifTB = document.getElementById("gifTB") as HTMLElement;
	gifTB.onmousedown = (e) => e.stopImmediatePropagation();
	gifTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		thisUser.makeGifBox(gifTB.getBoundingClientRect());
	};

	const translateTB = document.getElementById("translateTB") as HTMLElement;
	translateTB.onmousedown = (e) => e.stopImmediatePropagation();
	translateTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		void TranslationService.translateTypingBox(thisUser.channelfocus);
	};

	const autoTranslateBtn = document.getElementById("autoTranslateBtn") as HTMLElement;
	autoTranslateBtn.onmousedown = (e) => e.stopImmediatePropagation();
	AutoTranslationService.bindButton(autoTranslateBtn, () => thisUser.channelfocus);
	autoTranslateBtn.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		if (AutoTranslationService.isBlocked()) {
			AutoTranslationService.promptReconnect();
			return;
		}
		void AutoTranslationService.toggle();
	};
	const autoTranslateDiv = document.getElementById("autoTranslateDiv") || autoTranslateBtn;
	new Hover(() =>
		AutoTranslationService.isBlocked()
			? I18n.translation.autoTranslateBlocked()
			: I18n.translation.autoTranslate(),
	).addEvent(autoTranslateDiv);

	const stickerTB = document.getElementById("stickerTB") as HTMLElement;
	stickerTB.onmousedown = (e) => e.stopImmediatePropagation();
	stickerTB.onclick = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
		thisUser.makeStickerBox(stickerTB.getBoundingClientRect());
	};
	const updateIcon = document.getElementById("updateIcon");
	if (updateIcon) {
		new Hover(() => updateIcon.textContent || "").addEvent(updateIcon);
		updateIcon.onclick = () => {
			window.location.reload();
		};
	}
}
