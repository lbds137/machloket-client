# Machloket

Machloket (מחלוקת, "discord") is a Discord-like web client for self-hostable [Spacebar](https://spacebar.chat) instances, written in TypeScript, HTML and CSS. The goal is parity: someone switching from Discord should feel at home — same layout, interaction patterns and shortcuts.

It is a fork of **Fermo** (AGPL-3.0), reworked for Discord-parity UX. Donor code also comes from **Fuzzy** (AGPL-3.0, the look-and-feel reference) and **Flicker** (GPL-3.0); AGPL notices and author credits are kept.

## Building

Clone the repo and run `npm ci`, then `npm run build`; the static site lands in `dist/webpage/`. For development, run `npx vite --port 8080` and open http://localhost:8080/login.html.

## Adding instances to the dropdown

Machloket reads its instance list only from `src/webpage/public/instances.json` (upstream Fermo used the Spacebar Explorer catalog instead). Each entry has a `name` and an instance `url`, plus an optional `icon` URL and `description`. New logins default to the first entry whose scheme matches the page's (an https page can't call an http instance), else the first usable entry. In a `url`, `{hostname}` stands for the host the client was loaded from: `http://{hostname}:3001` reaches an instance on the same machine as the client, from that machine or another device on the LAN, and an `https://{hostname}:<port>` entry works the same way for an instance served with TLS on that host.

## How to statically host Machloket

[Click here](./howToStaticallyHost.md)

## Reporting issues

Please report Machloket issues on this repository only. Machloket is a fork: the upstream Fermo project is a separate project with its own policies, and issues or contributions for this client don't belong there.

## AI-assisted development

Development of Machloket is AI-assisted (Claude Code), openly labeled as such. Every change is reviewed and tested by the maintainer before it lands.

## Licence

AGPL-3.0 — see [LICENSE](./LICENSE). As a web application, the source you are reading is the offer of source required by section 13.
