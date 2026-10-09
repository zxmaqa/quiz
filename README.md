# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Changes after the blind test

The blind test stands as run: quiz MIQ_2024-10-03, chemistry prompt **v6**, `claude-haiku-4-5`, started about 16:11 Baku time on 2026-10-09 (before the 16:30 freeze; the prompt was not changed afterwards). Its exports are in `eval/out_topics_2024.csv`, `eval/out_reasons_2024.csv` and `eval/t2_details.csv`. It was not re-run. The v5 (math) and v6 (chemistry) prompts are unchanged. Everything below was added after it.

- **Unknown and unchecked reasons are not shown.** An option without a verified reason shows nothing. For chemistry, unchecked reasons (`check_applicable=false`) are hidden but stay stored in the database. Unchecked reasons hidden: in the blind test 1 of 6 was false and 4 of 6 were non-diagnostic. Math v5 reasons are unchanged.
- **Verified solutions (`solve` mode, `solve-v1`)** in the same `analyze-quiz` function, for both groups. Model `claude-sonnet-4-6` with the same retry and fallbacks. Each step is plain arithmetic that code evaluates with the existing evaluator. Allowed numbers: numbers in the question (including formula digits and given Mr/Ar), a fixed atomic mass table in code (H, C, N, O, Na, Mg, Al, S, Cl, K, Ca, Fe, Cu), the constants 100, 1000 and 22.4, and earlier step values. The final value must equal the value of the teacher's correct option. Anything that fails is not stored. Non-numeric questions get no solution. It runs automatically after the teacher saves a new quiz, and as part of the "AI analiz" button. Stored in `questions.solution`; every call is logged in `ai_calls`.
- **Student result page order:** score, "Bu mövzular üzərində işlə" (weak topics, computed in code), wrong or blank questions with the correct answer and "Düzgün həll" (only if verified), then a verified reason only where one exists.
- **Teacher results page:** "Sinif xəritəsi" is a topic × students accuracy table built in code (weak cells highlighted, with the number of weak students per topic). Under it, an AI summary (`class-summary` mode, `summary-v1`, `claude-haiku-4-5`) built only from per-topic numbers, never student names. It is cached per quiz in `quizzes.class_summary`, labelled "AI təhlili · ehtimal", and has a "Yenilə" button. Code keeps only items whose numbers come from the input.
- **Measured after the blind test (not blind-test results):** one `solve` run per quiz verified 7/10 (math seed), 1/5 (MIQ_2025-09-03) and 1/5 (MIQ_2024-10-03).
