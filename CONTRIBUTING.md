# Contributing

Bug reports and pull requests are both welcome on this repository.

For code changes: clone, `npm ci`, make the change, then run the gate
before opening a pull request — it must pass:

```
npm run check && npm test && npm run build
```

Keep pull requests small: one fix or one feature each, though a few
small related fixes can ride together. Reviews happen as spare time
allows; it may take a few days.
