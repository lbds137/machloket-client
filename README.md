# Fermo

Fermo is a [Spacebar](https://spacebar.chat) Client written in TS, HTML, and CSS.

![](src/webpage/public/home/SS1.webp)

To build it, clone the repo and run `npm ci`, then `npm run build`; the static site lands in `dist/webpage/`. For development, run `npx vite --port 8080` and open http://localhost:8080/login.html.

If there are any issues please report them either here, or to me dirrectly on spacebar

## Adding instances to the dropdown

Machloket reads its instance list only from `src/webpage/public/instances.json` (upstream Fermo used the Spacebar Explorer catalog instead). Each entry has a `name` and an instance `url`, plus an optional `icon` URL and `description`. The first entry is the default for new logins. In a `url`, `{hostname}` stands for the host the client was loaded from, so `http://{hostname}:3001` reaches an instance on the same machine as the client, from that machine or from another device on the LAN.

## How to statically host Fermo

[Click here](./howToStaticallyHost.md)

## AI Code

AI code due to not being GPLv3 compatable is not allowed in this repo. I thought this didn't need to be said, but it does.
And to be clear, _any_ use of AI is not allowed in Fermo.

## Link

The official Spacebar server for Fermo: https://sbar.fyi/i/WYbNha?instance=https%3A%2F%2Fspacebar.chat

The current hosted instance of Fermo: https://fermo.sbar.fyi/
