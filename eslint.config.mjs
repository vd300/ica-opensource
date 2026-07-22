import js from "@eslint/js";
import globals from "globals";
import tseslintPlugin from "@typescript-eslint/eslint-plugin";
import tseslintParser from "@typescript-eslint/parser";

export default [
  {
    ignores: [
      "build/**",
      "dist/**",
      "dist-electron/**",
      "node_modules/**",
      "release/**",
      "docs/**",
      "renderer/**",
      "**/*.md",
      "**/*.json",
      "**/*.jsonc",
      "**/*.json5",
      "**/*.css"
    ],
  },
  js.configs.recommended,

  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: tseslintParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslintPlugin,
    },
    rules: {
      ...tseslintPlugin.configs.recommended.rules, 
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-var-requires": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-useless-escape": "off",
    },
  },
];
