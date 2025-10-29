### How to statically host Fermi
Fermi due to its service worker, will technically work without any of this, but here's what you need to keep in mind for statically hosting it.
### I will assume the following
* 404.html will be used for 404 responses
* index.html will be used when in that directory
* stuff like `/app` will just use the html file at `/app.html`

Here's the other thing you need to do:
You need to make some rewrites, not redirects from these addresses:
* `/channels/*` -> `/app.html`
* `/invite/*` -> `invite.html`
* `/template/*` -> `template.html`
Other than these three rewrites, everything else should work as expected!
(the reason why the service worker can fix this is due to it doing the rewrites on the client side)
