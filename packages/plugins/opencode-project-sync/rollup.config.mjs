import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({
  workerEntry: "src/worker.ts",
  manifestEntry: "src/manifest.ts",
  uiEntry: "src/ui/index.tsx",
});

function withPlugins(config) {
  return {
    ...config,
    plugins: [
      nodeResolve({
        extensions: [".ts", ".js", ".mjs"],
      }),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
    ],
  };
}

export default [
  withPlugins(presets.rollup.manifest),
  withPlugins(presets.rollup.worker),
  ...(presets.rollup.ui ? [withPlugins(presets.rollup.ui)] : []),
];
