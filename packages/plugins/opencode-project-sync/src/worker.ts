import { runWorker } from "@paperclipai/plugin-sdk";
import plugin from "./plugin.js";

export default plugin;

// Cycle 2.1 keeps remote-link lifecycle inside the existing worker entrypoint.
runWorker(plugin, import.meta.url);
