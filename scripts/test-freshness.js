const db =
    require("../db/database");


const rows =
    db.prepare(`
        SELECT
            q.question_code,
            q.question,
            q.topic,

            COUNT(sq.id)
                AS times_used,

            MAX(ts.played_at)
                AS last_used,

            q.legacy_last_used,
            q.legacy_freshness_weeks

        FROM questions q

        LEFT JOIN set_questions sq
            ON sq.question_id = q.id

        LEFT JOIN trivia_sets ts
            ON ts.id = sq.set_id

        GROUP BY q.id

        ORDER BY
            last_used DESC

        LIMIT 20
    `)
    .all();


console.table(rows);