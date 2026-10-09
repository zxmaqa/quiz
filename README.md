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
- **Class map and summary (follow-up):** topics with a single question show a check mark or cross per student instead of a percentage (weak needs 2+ questions and under 60%). The `class-summary` prompt is now `summary-v2`: topic names only (never codes), and every plan item must name a topic, its question numbers and one concrete classroom action; code drops items that don't. Summaries were regenerated for all quizzes.
- **Photo to quiz:** "Şəkildən quiz" lets the teacher upload photos; they are resized in the browser to at most 1568 px and re-encoded as JPEG through a canvas, then sent to the same `extract` call (`claude-sonnet-4-6` when images are present; the v5/v6 prompts are unchanged). Measured once on the two real pages in `eval/source_images/` against `data/miq_kimya_suallar_TETBIQ_UCUN.json` (spaces normalised): question text exact 2/10, options exact 50/50, topic equal to the stored topic 8/10. Most text differences are typography (superscript digits and arrows) plus table headers read in a different order. Per-question details are in `eval/out_photo_extract.csv`; the images are not in the repository.
- **Manager page `/m`:** per group the number of quizzes, the latest quiz's average score, the weakest topic by name and saved teacher time (submissions × 1.75 min, based on the average time teachers reported, 1.5–2 min per sheet). Code only, no AI. Two groups named "Demo — ..." hold copied questions and synthetic submissions (`supabase/seed_demo_groups.sql`).
- **`solve-v2` (after the blind test):** the solve prompt asks for every intermediate number to be written as an expression of allowed numbers (4*7, not 28), the constant 1000 for unit conversion, and allows the coefficients of an equation written in the question (digits written in the question were already allowed). All code checks are unchanged. One run per quiz: 7/10 (math seed), 3/5 (MIQ_2025-09-03), 0/5 (MIQ_2024-10-03). One of the new chemistry solutions (the pH question) passed the checks but was meaningless arithmetic built to reach the known answer, and was removed; the checks verify arithmetic, not reasoning.
- **`solve-v2` reverted to `solve-v1`:** v2 produced a pseudo-solution that passed the arithmetic check (2025 Q2), so we reverted. The v2 prompt stays in git history (commit `80aae65`).
- **Photo extraction, second comparison (after Unicode normalisation):** on the two real pages, questions equivalent 5/10 (1/10 on spaces only), options exact 50/50, topic equal to the stored topic 9/10. Normalisation maps superscript and subscript digits to normal digits, arrows to "->", and drops options that leaked into the question text. What remains: one cosmetic spacing difference around an arrow, one degree sign read as a superscript zero, and three layout differences (a table read in another order, a side-by-side matching list read across columns, table rows split per formula). `eval/out_photo_extract.csv` has the per-question detail.
- **Invalid JSON is retried once:** if a model reply is not valid JSON (or lacks the expected array), the same call is repeated once with the same model, in every mode (`extract`, `reasons`, `solve`, `class-summary`) and for fallback models too. Both attempts are logged in `ai_calls`. HTTP errors keep their own retry rules (429/500/503/529, then fallbacks).
- **Bug fix: `reasons` failed on a reply with a missing closing bracket.** A smoke test found a code-fenced reply that lacked its final `}`; both attempts were identical (temperature 0), so the call failed. Fixed: before `JSON.parse` the reply is stripped of code fences, read from its opening bracket, and if it ends early the missing `}` / `]` are appended in the right order; the shape check is unchanged. The retry (only after a failed parse) now adds one line, "Return only one complete, valid JSON object, no code fences.", and uses temperature 0.2; the first attempt and the v5/v6 prompts are unchanged. If both attempts fail, the teacher sees a soft note and the flow continues (AI analiz: "AI bu dəfə səbəbləri yaratmadı, quiz saxlanıldı", topics and solutions are still saved and stored reasons are not overwritten; new-quiz preview: the quiz can still be saved). A reply cut off inside a string is accepted with the truncated text, but reasons still go through the arithmetic checks.
