import esbuild from "esbuild";
import process from "process";

const production = process.argv[2] === "production";
const tests = process.argv[2] === "tests";

// The plugin bundle: obsidian is provided by the app, everything else is bundled
// so that `main.js` is the only file a user needs.
if (!tests) {
  const context = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", "builtin-modules"],
    format: "cjs",
    target: "es2018",
    logLevel: "info",
    sourcemap: production ? false : "inline",
    treeShaking: true,
    outfile: "main.js",
  });

  if (production) {
    await context.rebuild();
    await context.dispose();
  } else {
    await context.watch();
  }
} else {
  // The test bundle: pure modules only, no Obsidian and no bundling of the plugin.
  await esbuild.build({
    entryPoints: ["tests/run.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    logLevel: "info",
    outfile: "build/tests.js",
  });
  if (process.argv[3]) process.exit(0);
}
