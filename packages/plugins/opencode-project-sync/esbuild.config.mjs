import esbuild from "esbuild";
import { createPluginBundlerPresets } from "../sdk/dist/bundlers.js";

const presets = createPluginBundlerPresets({
  workerEntry: "src/worker.ts",
  manifestEntry: "src/manifest.ts",
  uiEntry: "src/ui/index.tsx",
});
const watch = process.argv.includes("--watch");

// Keep the worker on the SDK runtime contract instead of bundling the SDK root
// entry, which also re-exports Node-only dev helpers that are irrelevant here.
presets.esbuild.worker.external = [
  ...(presets.esbuild.worker.external ?? []),
  "@paperclipai/plugin-sdk",
];

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = presets.esbuild.ui ? await esbuild.context(presets.esbuild.ui) : null;

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx?.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx?.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx?.dispose()]);
}
