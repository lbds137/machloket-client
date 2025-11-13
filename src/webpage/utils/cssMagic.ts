export function unnest(str: string, check = true) {
	if (check && CSS.supports("selector(&)")) {
		//no need to unnest if it's supported lol
		return str;
	}
	let specificity: string[] = [];
	let buildStr = str.split("\n");
	const rules: string[] = [];
	let last = false;
	let prop = false;
	let conbuild = "";
	let ani = 0;
	function append(str: string, line = rules.length - 1) {
		let build = specificity[line] || "";
		build += str;
		specificity[line] = build;
	}
	for (const uline of buildStr) {
		const line = uline
			.trim()
			.split("//")[0]
			.replace(/\/\*.*\*\//gm, "")
			.trim();
		if (ani) {
			conbuild += "\n" + uline;
			if (line.includes("{")) {
				ani++;
			}
			if (line.includes("}")) {
				ani--;
			}
			if (!ani) {
				append(conbuild, 1);
				console.log(conbuild);
				conbuild = "";
			}

			continue;
		}
		if (prop) {
			conbuild += line + "\n";

			if (line.endsWith(";")) {
				append(conbuild);
				prop = false;
				conbuild = "";
			}
			continue;
		}
		if (line.endsWith(",")) {
			conbuild += line;
			console.log(conbuild, line);
		} else if (line.endsWith("{") && line.startsWith("@keyframes")) {
			conbuild = uline;
			ani++;
		} else if (line.endsWith("{")) {
			let rule = conbuild + line.slice(0, line.length - 1).trim();
			conbuild = "";
			if (rule.startsWith("&")) {
				rule = rule.slice(1, line.length);
			} else {
				rule = " " + rule;
			}
			if (last) append("}\n");
			rules.push(rule);

			last = true;
			append(rules.join("") + "{\n");
		} else if (line === "}") {
			if (last) append("}\n");
			rules.pop();

			if (rules.length) {
				append(rules.join("") + "{\n");
			} else {
				last = false;
			}
		} else if (line.includes(":")) {
			if (line.endsWith(";")) {
				append(line);
			} else {
				console.warn(line);
				prop = true;
				conbuild = "";
				conbuild += line + "\n";
			}
		}
	}
	if (last) alert("huh");
	console.log(specificity);
	return specificity.join("\n");
}
export function fix() {
	if (!CSS.supports("selector(&)")) {
		fetch("/style.css")
			.then((_) => _.text())
			.then((txt) => {
				const link = Array.from(document.getElementsByTagName("link")).find((_) =>
					_.href.endsWith("/style.css"),
				);
				if (!link) {
					alert("link not found");
					return;
				}
				const css = unnest(txt);
				console.log(css);

				const style = document.createElement("style");
				style.textContent = css;
				link.after(style);
				link.remove();
			});
	}
}
