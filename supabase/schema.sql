-- Demo schema. RLS is on, but policies are fully open to the anon role (demo only).

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text
);

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups,
  title text,
  status text default 'draft',
  created_at timestamptz default now()
);

-- options: [{"label":"A","text":"..."}, ...]
-- misconceptions: null, or {"<wrong label>": "reason shown to the student who picked it"}
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes on delete cascade,
  position int,
  text text,
  topic text,
  options jsonb,
  correct_label text,
  misconceptions jsonb
);

-- answers: {"<question id>": "A" | "B" | "C" | "D" | null}
create table if not exists submissions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes on delete cascade,
  student_name text,
  answers jsonb,
  created_at timestamptz default now()
);

create table if not exists ai_calls (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid,
  kind text,
  model text,
  input_tokens int,
  output_tokens int,
  ms int,
  ok boolean,
  error text,
  created_at timestamptz default now()
);

-- details: for step "reasons", why each wrong option ended as unknown (model_unknown | check_failed: <reason>)
alter table ai_calls add column if not exists details jsonb;

alter table groups enable row level security;
alter table quizzes enable row level security;
alter table questions enable row level security;
alter table submissions enable row level security;
alter table ai_calls enable row level security;

drop policy if exists demo_all on groups;
drop policy if exists demo_all on quizzes;
drop policy if exists demo_all on questions;
drop policy if exists demo_all on submissions;
drop policy if exists demo_all on ai_calls;

create policy demo_all on groups for all to anon using (true) with check (true);
create policy demo_all on quizzes for all to anon using (true) with check (true);
create policy demo_all on questions for all to anon using (true) with check (true);
create policy demo_all on submissions for all to anon using (true) with check (true);
create policy demo_all on ai_calls for all to anon using (true) with check (true);

-- Seed (fixed uuids, safe to re-run)
insert into groups (id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Demo qrup')
on conflict (id) do nothing;

insert into quizzes (id, group_id, title, status) values
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Faizlər — həftəlik quiz', 'live')
on conflict (id) do nothing;

insert into questions (id, quiz_id, position, text, topic, options, correct_label, misconceptions) values
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-222222222222', 1,
   '200-ün 15 faizi neçədir?', 'Faiz',
   '[{"label":"A","text":"20"},{"label":"B","text":"25"},{"label":"C","text":"30"},{"label":"D","text":"35"}]',
   'C', null),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-222222222222', 2,
   'Qiyməti 80 manat olan mala 25% endirim edilib. Yeni qiymət neçə manatdır?', 'Faiz',
   '[{"label":"A","text":"60"},{"label":"B","text":"55"},{"label":"C","text":"65"},{"label":"D","text":"70"}]',
   'A', null),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-222222222222', 3,
   'Bir ədədin 20 faizi 18-ə bərabərdir. Bu ədəd neçədir?', 'Faiz',
   '[{"label":"A","text":"72"},{"label":"B","text":"80"},{"label":"C","text":"100"},{"label":"D","text":"90"}]',
   'D', null),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-222222222222', 4,
   '3/4 + 1/8 məbləği neçədir?', 'Kəsrlər',
   '[{"label":"A","text":"4/12"},{"label":"B","text":"7/8"},{"label":"C","text":"1"},{"label":"D","text":"5/8"}]',
   'B', null),
  ('33333333-3333-4333-8333-000000000005', '22222222-2222-4222-8222-222222222222', 5,
   '2/3 · 9/10 hasili neçədir?', 'Kəsrlər',
   '[{"label":"A","text":"11/13"},{"label":"B","text":"2/5"},{"label":"C","text":"3/5"},{"label":"D","text":"6/7"}]',
   'C', null),
  ('33333333-3333-4333-8333-000000000006', '22222222-2222-4222-8222-222222222222', 6,
   '5/6 − 1/3 fərqi neçədir?', 'Kəsrlər',
   '[{"label":"A","text":"1/2"},{"label":"B","text":"4/3"},{"label":"C","text":"2/3"},{"label":"D","text":"1/3"}]',
   'A', null),
  ('33333333-3333-4333-8333-000000000007', '22222222-2222-4222-8222-222222222222', 7,
   '3x + 5 = 20 tənliyində x neçədir?', 'Tənliklər',
   '[{"label":"A","text":"3"},{"label":"B","text":"5"},{"label":"C","text":"7"},{"label":"D","text":"8"}]',
   'B', null),
  ('33333333-3333-4333-8333-000000000008', '22222222-2222-4222-8222-222222222222', 8,
   '2(x − 4) = 10 tənliyində x neçədir?', 'Tənliklər',
   '[{"label":"A","text":"6"},{"label":"B","text":"7"},{"label":"C","text":"9"},{"label":"D","text":"14"}]',
   'C', null),
  ('33333333-3333-4333-8333-000000000009', '22222222-2222-4222-8222-222222222222', 9,
   '3 : 5 = 12 : x tənasübündə x neçədir?', 'Nisbət və tənasüb',
   '[{"label":"A","text":"20"},{"label":"B","text":"15"},{"label":"C","text":"18"},{"label":"D","text":"24"}]',
   'A', null),
  ('33333333-3333-4333-8333-000000000010', '22222222-2222-4222-8222-222222222222', 10,
   '5 kq alma 12 manatdırsa, 15 kq alma neçə manat edər?', 'Nisbət və tənasüb',
   '[{"label":"A","text":"24"},{"label":"B","text":"30"},{"label":"C","text":"40"},{"label":"D","text":"36"}]',
   'D', null)
on conflict (id) do nothing;
