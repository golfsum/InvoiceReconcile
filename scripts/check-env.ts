import { loadEnvConfig } from "@next/env";
import {
  formatProductionEnvironmentIssues,
  validateProductionEnvironment,
} from "../src/lib/env/production";

loadEnvConfig(process.cwd(), false);

const result = validateProductionEnvironment(process.env);
if (!result.success) {
  process.stderr.write("Production environment validation failed:\n");
  for (const issue of formatProductionEnvironmentIssues(result.error.issues)) {
    process.stderr.write(`- ${issue}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write("Production environment validation passed.\n");
}
