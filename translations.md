# Translations

The translations are stored in `/translations` at the root of the repo, in this format below. `en.json` is the source of truth; other locales fall back to it for missing keys.

```json
{
	"@metadata": {
		"authors": [],
		"last-updated": "XXXX/XX/XX",
		"locale": "ru",
		"comment": ""
	}
}
```

## I want to help translate this

Open a pull request against the `translations/*.json` file for your language — the files are plain JSON, one key per line.

## What is the format?

It's the same format found [here](https://github.com/wikimedia/jquery.i18n#message-file-format), though we are not using jquery, and you might notice some of the strings use markdown, but most do not.

## I want to help correct a translation

Go ahead! We're more than happy to take corrections to translations as well!
