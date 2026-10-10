import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";

const WEB = ["apps/web/**/*.{ts,tsx}"];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/next-env.d.ts", "**/playwright-report/**", "**/test-results/**", "**/src/generated/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Next.js, React and accessibility rules, for the web app only.
  ...nextVitals.map((c) => ({ ...c, files: WEB, settings: { ...c.settings, next: { rootDir: "apps/web/" } } })),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
