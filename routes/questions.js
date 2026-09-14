const express = require("express");

const db = require("../db/database");

const router = express.Router();

/* =========================================================
   QUESTION SEARCH API
========================================================= */

router.get("/search", (req, res) => {
    const search =
        (req.query.q || "")
            .trim();


    if (
        search.length < 2
    ) {
        return res.json([]);
    }


    const questions =
        db.prepare(`
            SELECT
                q.id,
                q.question_code,
                q.question,
                q.answer,
                q.topic,
                q.format,
                q.difficulty

            FROM questions q

            WHERE
                q.enabled = 1

                AND (
                    q.question LIKE @search
                    OR q.answer LIKE @search
                    OR q.topic LIKE @search
                    OR q.format LIKE @search
                    OR q.question_code LIKE @search
                )

            ORDER BY
                CASE
                    WHEN q.question_code LIKE @starts
                    THEN 0

                    WHEN q.question LIKE @starts
                    THEN 1

                    WHEN q.answer LIKE @starts
                    THEN 2

                    ELSE 3
                END,

                q.question_code ASC

            LIMIT 20
        `)
        .all({
            search:
                `%${search}%`,

            starts:
                `${search}%`
        });


    res.json(
        questions
    );
});

/* =========================================================
   QUESTION DATABASE / SEARCH
========================================================= */

router.get("/", (req, res) => {
    const search =
        (req.query.search || "")
            .trim();

    const filter =
        req.query.filter ||
        "all";

    const topic =
        (req.query.topic || "")
            .trim();

    const where = [];
    const params = {};


    if (search) {
        where.push(`
            (
                q.question LIKE @search
                OR q.answer LIKE @search
                OR q.topic LIKE @search
                OR q.format LIKE @search
                OR q.question_code LIKE @search
            )
        `);

        params.search =
            `%${search}%`;
    }


    if (topic) {
        where.push(`
            q.topic = @topic
        `);

        params.topic =
            topic;
    }


    if (filter === "unused") {
        where.push(`
            NOT EXISTS (
                SELECT 1
                FROM set_questions sq2
                JOIN trivia_sets ts2
                    ON ts2.id = sq2.set_id
                WHERE
                    sq2.question_id = q.id
                    AND ts2.status = 'played'
            )
        `);
    }


    if (filter === "review") {
        where.push(`
            q.needs_review = 1
        `);
    }


    if (filter === "disabled") {
        where.push(`
            q.enabled = 0
        `);
    }


    if (filter === "enabled") {
        where.push(`
            q.enabled = 1
        `);
    }


    const whereClause =
        where.length
            ? `WHERE ${where.join(" AND ")}`
            : "";


    const questions =
        db.prepare(`
            SELECT
                q.id,
                q.question_code,
                q.question,
                q.answer,
                q.topic,
                q.format,
                q.difficulty,
                q.enabled,
                q.needs_review,

                COUNT(
                    CASE
                        WHEN ts.status = 'played'
                        THEN sq.id
                    END
                ) AS times_used,

                MAX(
                    CASE
                        WHEN ts.status = 'played'
                        THEN ts.played_at
                    END
                ) AS last_used,

                q.legacy_last_used,
                q.legacy_freshness_weeks

            FROM questions q

            LEFT JOIN set_questions sq
                ON sq.question_id = q.id

            LEFT JOIN trivia_sets ts
                ON ts.id = sq.set_id

            ${whereClause}

            GROUP BY q.id

            ORDER BY
                CASE
                    WHEN MAX(
                        CASE
                            WHEN ts.status = 'played'
                            THEN ts.played_at
                        END
                    ) IS NULL
                    THEN 0
                    ELSE 1
                END,

                MAX(
                    CASE
                        WHEN ts.status = 'played'
                        THEN ts.played_at
                    END
                ) ASC,

                q.question_code ASC

            LIMIT 500
        `)
        .all(params);


    const topics =
        db.prepare(`
            SELECT DISTINCT
                topic

            FROM questions

            WHERE
                topic IS NOT NULL
                AND TRIM(topic) != ''

            ORDER BY topic
        `)
        .all();


    res.render(
        "questions",
        {
            questions,
            search,
            filter,
            topic,
            topics
        }
    );
});


/* =========================================================
   NEW QUESTION
========================================================= */

router.get("/new", (req, res) => {
    res.render(
        "question-form",
        {
            mode: "new",
            question: null
        }
    );
});


/* =========================================================
   CREATE QUESTION
========================================================= */

router.post("/", (req, res) => {
    const {
        question,
        answer,
        topic,
        format,
        difficulty
    } = req.body;


    if (!question || !answer) {
        return res
            .status(400)
            .send(
                "Question and answer are required."
            );
    }


    const highest =
        db.prepare(`
            SELECT
                question_code

            FROM questions

            WHERE
                question_code IS NOT NULL

            ORDER BY
                CAST(
                    SUBSTR(
                        question_code,
                        2
                    )
                    AS INTEGER
                ) DESC

            LIMIT 1
        `)
        .get();


    let nextNumber = 1;


    if (highest) {
        nextNumber =
            Number.parseInt(
                highest.question_code
                    .slice(1),
                10
            ) + 1;
    }


    const questionCode =
        "Q" +
        String(nextNumber)
            .padStart(
                5,
                "0"
            );


    const result =
        db.prepare(`
            INSERT INTO questions (
                question_code,
                format,
                topic,
                difficulty,
                question,
                answer,
                enabled,
                needs_review
            )
            VALUES (
                @question_code,
                @format,
                @topic,
                @difficulty,
                @question,
                @answer,
                1,
                0
            )
        `)
        .run({
            question_code:
                questionCode,

            format:
                format || null,

            topic:
                topic || null,

            difficulty:
                difficulty
                    ? Number(difficulty)
                    : null,

            question:
                question.trim(),

            answer:
                answer.trim()
        });


    res.redirect(
        `/questions/${result.lastInsertRowid}`
    );
});


/* =========================================================
   DETAIL
========================================================= */

router.get("/:id", (req, res) => {
    const question =
        db.prepare(`
            SELECT
                q.*,

                COUNT(
                    CASE
                        WHEN ts.status = 'played'
                        THEN sq.id
                    END
                ) AS times_used,

                MAX(
                    CASE
                        WHEN ts.status = 'played'
                        THEN ts.played_at
                    END
                ) AS last_used

            FROM questions q

            LEFT JOIN set_questions sq
                ON sq.question_id = q.id

            LEFT JOIN trivia_sets ts
                ON ts.id = sq.set_id

            WHERE
                q.id = ?

            GROUP BY q.id
        `)
        .get(
            req.params.id
        );


    if (!question) {
        return res
            .status(404)
            .send(
                "Question not found"
            );
    }


    const history =
        db.prepare(`
            SELECT
                ts.id AS set_id,
                ts.name,
                ts.played_at,
                ts.status,
                sq.position,
                sq.round,
                sq.match_method

            FROM set_questions sq

            JOIN trivia_sets ts
                ON ts.id = sq.set_id

            WHERE
                sq.question_id = ?

            ORDER BY
                ts.played_at DESC,
                ts.created_at DESC
        `)
        .all(
            req.params.id
        );


    res.render(
        "question-detail",
        {
            question,
            history
        }
    );
});


/* =========================================================
   EDIT FORM
========================================================= */

router.get("/:id/edit", (req, res) => {
    const question =
        db.prepare(`
            SELECT *
            FROM questions
            WHERE id = ?
        `)
        .get(
            req.params.id
        );


    if (!question) {
        return res
            .status(404)
            .send(
                "Question not found"
            );
    }


    res.render(
        "question-form",
        {
            mode: "edit",
            question
        }
    );
});


/* =========================================================
   UPDATE QUESTION
========================================================= */

router.post("/:id", (req, res) => {
    const {
        question,
        answer,
        topic,
        format,
        difficulty,
        enabled
    } = req.body;


    db.prepare(`
        UPDATE questions

        SET
            question = @question,
            answer = @answer,
            topic = @topic,
            format = @format,
            difficulty = @difficulty,
            enabled = @enabled,
            needs_review = 0,
            updated_at = CURRENT_TIMESTAMP

        WHERE
            id = @id
    `)
    .run({
        id:
            req.params.id,

        question:
            question.trim(),

        answer:
            answer.trim(),

        topic:
            topic || null,

        format:
            format || null,

        difficulty:
            difficulty
                ? Number(difficulty)
                : null,

        enabled:
            enabled
                ? 1
                : 0
    });


    res.redirect(
        `/questions/${req.params.id}`
    );
});


module.exports = router;