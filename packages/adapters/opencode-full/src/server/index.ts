import type {
  AdapterConfigSchema,
  AdapterModel,
} from "@paperclipai/adapter-utils";
import { sessionCodec } from "./session-codec.js";
import { getOpencodeFullConfigSchema } from "./config-schema.js";
import { execute } from "./execute.js";
import { listModels } from "./models.js";
import { testEnvironment } from "./test.js";

export { sessionCodec };

export function getConfigSchema(): AdapterConfigSchema {
  return getOpencodeFullConfigSchema();
}

export { execute, listModels, testEnvironment };
