import { defineConfig } from "tsup";

// Bundle the workspace package into the output so production only needs real npm deps.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  noExternal: ["@redart/shared"],
  sourcemap: true,
  clean: true,
});
