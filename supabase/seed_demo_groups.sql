-- Two DEMO groups for the manager page. Everything here is synthetic and named "Demo — ...".
-- Questions are copies of existing non-blind quizzes (math seed, MIQ_2025-09-03); submissions are generated
-- deterministically (hash based), with a different strength per topic. Safe to re-run.

insert into groups (id, name, subject) values
  ('77777777-7777-4777-8777-777777777777', 'Demo — Riyaziyyat 9-A', 'math'),
  ('88888888-8888-4888-8888-888888888888', 'Demo — Kimya 11-B', 'chemistry')
on conflict (id) do nothing;

insert into quizzes (id, group_id, title, status) values
  ('77777777-7777-4777-8777-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777', 'Demo — Faizlər (9-A)', 'live'),
  ('88888888-8888-4888-8888-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888888', 'Demo — MİQ nümunə (11-B)', 'live')
on conflict (id) do nothing;

-- copies of the source questions (math seed quiz, MIQ_2025-09-03)
insert into questions (id, quiz_id, position, text, topic, options, correct_label, misconceptions, solution)
select md5('demo-q-' || '77777777-7777-4777-8777-aaaaaaaaaaaa' || s.position)::uuid,
       '77777777-7777-4777-8777-aaaaaaaaaaaa', s.position, s.text, s.topic, s.options, s.correct_label, s.misconceptions, s.solution
from questions s where s.quiz_id = '22222222-2222-4222-8222-222222222222'
on conflict (id) do nothing;

insert into questions (id, quiz_id, position, text, topic, options, correct_label, misconceptions, solution)
select md5('demo-q-' || '88888888-8888-4888-8888-aaaaaaaaaaaa' || s.position)::uuid,
       '88888888-8888-4888-8888-aaaaaaaaaaaa', s.position, s.text, s.topic, s.options, s.correct_label, s.misconceptions, s.solution
from questions s where s.quiz_id = '55555555-5555-4555-8555-555555555555'
on conflict (id) do nothing;

-- synthetic submissions: 14 students in 9-A, 12 in 11-B. ~6% of answers are blank.
insert into submissions (id, quiz_id, student_name, answers)
select md5('demo-sub-' || qz.id || '-' || i)::uuid, qz.id, 'Demo şagird ' || lpad(i::text, 2, '0'),
  (
    select jsonb_object_agg(
      q.id::text,
      case
        when abs(hashtext('b' || i::text || q.id::text)) % 100 < 6 then null
        when abs(hashtext('c' || i::text || q.id::text)) % 100 <
          case q.topic
            when 'Faiz' then 75 when 'Kəsrlər' then 35 when 'Tənliklər' then 60 when 'Nisbət və tənasüb' then 50
            when 'K03' then 40 when 'K13' then 70 when 'K12' then 55 when 'K09' then 65 else 50
          end
        then q.correct_label
        else (
          select t.o ->> 'label'
          from jsonb_array_elements(q.options) with ordinality as t(o, ord)
          where t.o ->> 'label' <> q.correct_label
          order by t.ord
          offset abs(hashtext('w' || i::text || q.id::text)) % (jsonb_array_length(q.options) - 1)
          limit 1
        )
      end
    )
    from questions q where q.quiz_id = qz.id
  )
from quizzes qz
cross join lateral generate_series(1, case when qz.id = '77777777-7777-4777-8777-aaaaaaaaaaaa' then 14 else 12 end) as i
where qz.id in ('77777777-7777-4777-8777-aaaaaaaaaaaa', '88888888-8888-4888-8888-aaaaaaaaaaaa')
on conflict (id) do nothing;
