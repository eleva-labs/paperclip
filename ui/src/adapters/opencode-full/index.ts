import type { UIAdapterModule } from "../types";
import {
  buildOpenCodeFullConfig,
  parseStdoutLine as parseOpenCodeFullStdoutLine,
} from "../../../../packages/adapters/opencode-full/src/ui/index";
import { SchemaConfigFields } from "../schema-config-fields";

export const openCodeFullUIAdapter: UIAdapterModule = {
  type: "opencode_full",
  label: "OpenCode (full)",
  parseStdoutLine: parseOpenCodeFullStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildOpenCodeFullConfig,
};
