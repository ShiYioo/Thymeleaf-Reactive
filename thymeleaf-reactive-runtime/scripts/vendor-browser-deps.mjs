// Copies browser-only runtime dependencies into dist so the served bundle
// never references bare module specifiers, which browsers cannot resolve.
import { copyFileSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("node_modules/jsep/dist/jsep.js", "dist/jsep.js");
