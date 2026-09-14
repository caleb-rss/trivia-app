const express = require("express");

const db = require("../db/database");

const {
    normalizeQuestionCode
} = require("../utils/question-code");


const router = express.Router();


/* =========================================================
   HELPERS
========================================================= */

function getSet(id) {
    return db.prepare(`
        SELECT *
        FROM trivia_sets
        WHERE id = ?
    `).get(id);
}


function requireReadySet(
    req,
    res
) {

    const set =
        getSet(
            req.params.id
        );


    if (!set) {

        res
            .status(404)
            .send(
                "Set not found."
            );

        return null;
    }


    if (
        set.status !==
        "ready"
    ) {

        res
            .status(400)
            .send(
                "Played sets are locked."
            );

        return null;
    }


    return set;
}


/*
 * Re-number positions after removing
 * or otherwise modifying rows.
 */
function resequenceSet(setId) {

    const rows =
        db.prepare(`
            SELECT id

            FROM set_questions

            WHERE set_id = ?

            ORDER BY
                position,
                id
        `)
        .all(setId);


    const update =
        db.prepare(`
            UPDATE set_questions

            SET position = ?

            WHERE id = ?
        `);


    const transaction =
        db.transaction(
            () => {

                /*
                 * Temporary negative values prevent
                 * position collisions.
                 */
                rows.forEach(
                    (row, index) => {

                        update.run(
                            -(index + 1),
                            row.id
                        );
                    }
                );


                rows.forEach(
                    (row, index) => {

                        update.run(
                            index + 1,
                            row.id
                        );
                    }
                );
            }
        );


    transaction();
}


/* =========================================================
   SET SEARCH / ARCHIVE
========================================================= */

router.get(
    "/",
    (req, res) => {

        const search =
            (
                req.query.search ||
                ""
            ).trim();


        const filter =
            req.query.filter ||
            "all";


        const where = [];
        const params = {};


        if (search) {

            where.push(`
                ts.name LIKE @search
            `);

            params.search =
                `%${search}%`;
        }


        if (
            filter === "ready"
        ) {

            where.push(`
                ts.status = 'ready'
            `);
        }


        if (
            filter === "played"
        ) {

            where.push(`
                ts.status = 'played'
            `);
        }


        const whereClause =
            where.length
                ? `WHERE ${where.join(" AND ")}`
                : "";


        const sets =
            db.prepare(`
                SELECT
                    ts.id,
                    ts.name,
                    ts.status,
                    ts.played_at,
                    ts.created_at,

                    COUNT(sq.id)
                        AS question_count

                FROM trivia_sets ts

                LEFT JOIN set_questions sq
                    ON sq.set_id =
                       ts.id

                ${whereClause}

                GROUP BY
                    ts.id

                ORDER BY
                    CASE
                        WHEN ts.status = 'ready'
                        THEN 0
                        ELSE 1
                    END,

                    ts.played_at DESC,

                    ts.created_at DESC
            `)
            .all(params);


        res.render(
            "sets",
            {
                sets,
                search,
                filter
            }
        );
    }
);


/* =========================================================
   SAVE NEW GENERATED SET
========================================================= */

router.post(
    "/",
    (req, res) => {

        const name =
            (
                req.body.name ||
                ""
            ).trim()
            ||
            `Trivia Set ${
                new Date()
                    .toISOString()
                    .slice(
                        0,
                        10
                    )
            }`;


        const questionIds =
            Array.isArray(
                req.body.question_ids
            )
                ? req.body.question_ids

                : [
                    req.body.question_ids
                ].filter(Boolean);


        if (
            !questionIds.length
        ) {

            return res
                .status(400)
                .send(
                    "No questions supplied."
                );
        }


        const saveSet =
            db.transaction(
                () => {

                    const setResult =
                        db.prepare(`
                            INSERT INTO trivia_sets (
                                name,
                                played_at,
                                source_sheet,
                                status
                            )
                            VALUES (
                                @name,
                                NULL,
                                NULL,
                                'ready'
                            )
                        `)
                        .run({
                            name
                        });


                    const setId =
                        setResult
                            .lastInsertRowid;


                    const insert =
                        db.prepare(`
                            INSERT INTO set_questions (
                                set_id,
                                question_id,
                                position,
                                round,
                                match_method,
                                match_confidence
                            )
                            VALUES (
                                @set_id,
                                @question_id,
                                @position,
                                NULL,
                                'generated',
                                1
                            )
                        `);


                    questionIds.forEach(
                        (
                            questionId,
                            index
                        ) => {

                            insert.run({
                                set_id:
                                    setId,

                                question_id:
                                    Number(
                                        questionId
                                    ),

                                position:
                                    index + 1
                            });
                        }
                    );


                    return setId;
                }
            );


        const setId =
            saveSet();


        res.redirect(
            `/sets/${setId}`
        );
    }
);


/* =========================================================
   RENAME SET
========================================================= */

router.post(
    "/:id/rename",
    (req, res) => {

        const name =
            (
                req.body.name ||
                ""
            ).trim();


        if (!name) {

            return res
                .status(400)
                .send(
                    "Set name is required."
                );
        }


        const result =
            db.prepare(`
                UPDATE trivia_sets

                SET name = @name

                WHERE id = @id
            `)
            .run({
                id:
                    req.params.id,

                name
            });


        if (
            result.changes === 0
        ) {

            return res
                .status(404)
                .send(
                    "Set not found."
                );
        }


        res.redirect(
            `/sets/${req.params.id}`
        );
    }
);


/* =========================================================
   ADD QUESTION TO READY SET
========================================================= */

router.post(
    "/:id/questions/add",
    (req, res) => {

        const set =
            requireReadySet(
                req,
                res
            );


        if (!set) {
            return;
        }


        const questionCode =
            normalizeQuestionCode(
                req.body.question_code
            );


        if (!questionCode) {

            return res
                .status(400)
                .send(
                    "Invalid question ID."
                );
        }


        const question =
            db.prepare(`
                SELECT
                    id,
                    question_code

                FROM questions

                WHERE
                    question_code = ?
                    AND enabled = 1
            `)
            .get(
                questionCode
            );


        if (!question) {

            return res
                .status(404)
                .send(
                    "Question not found."
                );
        }


        const alreadyInSet =
            db.prepare(`
                SELECT id

                FROM set_questions

                WHERE
                    set_id = ?
                    AND question_id = ?
            `)
            .get(
                set.id,
                question.id
            );


        if (alreadyInSet) {

            return res
                .status(400)
                .send(
                    "That question is already in this set."
                );
        }


        const max =
            db.prepare(`
                SELECT
                    COALESCE(
                        MAX(position),
                        0
                    ) AS position

                FROM set_questions

                WHERE set_id = ?
            `)
            .get(
                set.id
            );


        db.prepare(`
            INSERT INTO set_questions (
                set_id,
                question_id,
                position,
                round,
                match_method,
                match_confidence
            )
            VALUES (
                @set_id,
                @question_id,
                @position,
                NULL,
                'generated',
                1
            )
        `)
        .run({
            set_id:
                set.id,

            question_id:
                question.id,

            position:
                max.position + 1
        });


        res.redirect(
            `/sets/${set.id}`
        );
    }
);


/* =========================================================
   REMOVE QUESTION FROM READY SET
========================================================= */

router.post(
    "/:id/questions/:setQuestionId/remove",
    (req, res) => {

        const set =
            requireReadySet(
                req,
                res
            );


        if (!set) {
            return;
        }


        db.prepare(`
            DELETE FROM set_questions

            WHERE
                id = @set_question_id
                AND set_id = @set_id
        `)
        .run({
            set_question_id:
                req.params
                    .setQuestionId,

            set_id:
                set.id
        });


        resequenceSet(
            set.id
        );


        res.redirect(
            `/sets/${set.id}`
        );
    }
);


/* =========================================================
   REORDER QUESTIONS
========================================================= */

router.post(
    "/:id/reorder",
    (req, res) => {

        const set =
            requireReadySet(
                req,
                res
            );


        if (!set) {
            return;
        }


        const order =
            Array.isArray(
                req.body.order
            )
                ? req.body.order
                    .map(Number)

                : [];


        const current =
            db.prepare(`
                SELECT id

                FROM set_questions

                WHERE set_id = ?

                ORDER BY position
            `)
            .all(
                set.id
            )
            .map(
                row =>
                    Number(
                        row.id
                    )
            );


        if (
            order.length !==
            current.length
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Invalid question order."
                });
        }


        const supplied =
            new Set(order);


        if (
            supplied.size !==
            current.length
            ||
            !current.every(
                id =>
                    supplied.has(id)
            )
        ) {

            return res
                .status(400)
                .json({
                    error:
                        "Question order does not match this set."
                });
        }


        const update =
            db.prepare(`
                UPDATE set_questions

                SET position = @position

                WHERE
                    id = @id
                    AND set_id = @set_id
            `);


        const reorder =
            db.transaction(
                () => {

                    order.forEach(
                        (
                            id,
                            index
                        ) => {

                            update.run({
                                id,

                                set_id:
                                    set.id,

                                position:
                                    -(index + 1)
                            });
                        }
                    );


                    order.forEach(
                        (
                            id,
                            index
                        ) => {

                            update.run({
                                id,

                                set_id:
                                    set.id,

                                position:
                                    index + 1
                            });
                        }
                    );
                }
            );


        reorder();


        res.json({
            success: true
        });
    }
);


/* =========================================================
   DELETE READY SET
========================================================= */

router.post(
    "/:id/delete",
    (req, res) => {

        const set =
            getSet(
                req.params.id
            );


        if (!set) {

            return res
                .status(404)
                .send(
                    "Set not found."
                );
        }


        if (
            set.status !==
            "ready"
        ) {

            return res
                .status(400)
                .send(
                    "Played sets cannot be deleted."
                );
        }


        const removeSet =
            db.transaction(
                () => {

                    db.prepare(`
                        DELETE FROM set_questions
                        WHERE set_id = ?
                    `)
                    .run(
                        set.id
                    );


                    db.prepare(`
                        DELETE FROM trivia_sets
                        WHERE id = ?
                    `)
                    .run(
                        set.id
                    );
                }
            );


        removeSet();


        res.redirect(
            "/sets"
        );
    }
);


/* =========================================================
   MARK PLAYED
========================================================= */

router.post(
    "/:id/play",
    (req, res) => {

        const set =
            getSet(
                req.params.id
            );


        if (!set) {

            return res
                .status(404)
                .send(
                    "Set not found."
                );
        }


        if (
            set.status ===
                "played"
            &&
            set.played_at
        ) {

            return res.redirect(
                `/sets/${set.id}`
            );
        }


        const playedAt =
            new Date()
                .toISOString()
                .slice(
                    0,
                    10
                );


        db.prepare(`
            UPDATE trivia_sets

            SET
                status = 'played',
                played_at = @played_at

            WHERE
                id = @id
        `)
        .run({
            id:
                set.id,

            played_at:
                playedAt
        });


        res.redirect(
            `/sets/${set.id}`
        );
    }
);


/* =========================================================
   RETURN TO READY
========================================================= */

router.post(
    "/:id/unplay",
    (req, res) => {

        const set =
            getSet(
                req.params.id
            );


        if (!set) {

            return res
                .status(404)
                .send(
                    "Set not found."
                );
        }


        db.prepare(`
            UPDATE trivia_sets

            SET
                status = 'ready',
                played_at = NULL

            WHERE id = ?
        `)
        .run(
            set.id
        );


        res.redirect(
            `/sets/${set.id}`
        );
    }
);


/* =========================================================
   VIEW SET
========================================================= */

router.get(
    "/:id",
    (req, res) => {

        const set =
            getSet(
                req.params.id
            );


        if (!set) {

            return res
                .status(404)
                .send(
                    "Set not found."
                );
        }


        const questions =
            db.prepare(`
                SELECT
                    sq.id
                        AS set_question_id,

                    sq.position,

                    q.id,
                    q.question_code,
                    q.question,
                    q.answer,
                    q.topic,
                    q.difficulty

                FROM set_questions sq

                JOIN questions q
                    ON q.id =
                       sq.question_id

                WHERE
                    sq.set_id = ?

                ORDER BY
                    sq.position
            `)
            .all(
                set.id
            );


        res.render(
            "set-detail",
            {
                set,
                questions
            }
        );
    }
);


module.exports = router;