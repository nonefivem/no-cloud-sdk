# no-cloud-sdk

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Compatibility

This package is compatible with both Node.js and browser environments. The build output in `dist/index.js` is an ES module suitable for modern browsers and Node.js runtimes.

- For Node.js: Use `import` or `require` from `dist/index.js`.
- For browsers: Include `dist/index.js` as an ES module in your application.

No Node-specific APIs are used, ensuring cross-platform support.
