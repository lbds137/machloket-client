### How to statically host Machloket

Machloket due to its service worker, will technically work without any of this, but here's what you need to keep in mind for statically hosting it.

### I will assume the following

- `404.html` will be used for 404 responses
- `index.html` will be used when in that directory
- stuff like `/app` will just use the html file at `/app.html`

Here's the other thing you need to do:

Firstly you'll need to build Machloket like normal and host out the `./dist/webpage` directory.

Build from a git checkout: Client information links "Source for this build" to the commit the build was made from (`VER=<revision>` overrides the commit; with neither, it links the repository itself). A build with your own changes in it must offer its users that changed source (AGPL-3.0, section 13): push it, then build with `MACHLOKET_SOURCE_URL=https://your.host/you/your-fork npm run build`. The link is `<repository>/tree/<revision>`.

You need to make some rewrites, not redirects from these addresses:

- `/channels/*` -> `/app.html`
- `/invite/*` -> `invite.html`
- `/template/*` -> `template.html`

Other than these three rewrites, everything else should work as expected!

_(the reason why the service worker can fix this is due to it doing the rewrites on the client side)_
