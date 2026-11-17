import { defineConfig } from "tsup";
import { packageConfig } from "../../tsup.config.base";

export default defineConfig(packageConfig(import.meta.dirname));
