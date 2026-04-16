import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["src/client/legacy-bridge.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  outfile: "public/multiplayer-bridge.js",
  sourcemap: true,
  logLevel: "info",
  loader: {
    ".png": "file",
    ".gif": "file"
  },
  define: {
    __PARTYKIT_HOST__: JSON.stringify(process.env.PARTYKIT_HOST || ""),
    __PARTYKIT_PARTY__: JSON.stringify(process.env.PARTYKIT_PARTY || "main")
  }
});

if (watch) {
  await ctx.watch();
  console.log("esbuild watching...");
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
