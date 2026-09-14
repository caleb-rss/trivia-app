const db = require("../db/database");


/* =========================================================
   GET TOPICS
========================================================= */

function getTopics() {
    return db.prepare(`
        SELECT DISTINCT
            topic

        FROM questions

        WHERE
            topic IS NOT NULL
            AND TRIM(topic) != ''

        ORDER BY
            topic
    `).all();
}


/* =========================================================
   GET RESERVED QUESTION IDS

   Questions in READY sets are considered reserved and
   should not appear in newly-generated sets.
========================================================= */

function getReservedQuestionIds() {
    const rows = db.prepare(`
        SELECT DISTINCT
            sq.question_id

        FROM set_questions sq

        JOIN trivia_sets ts
            ON ts.id = sq.set_id

        WHERE
            ts.status = 'ready'
    `).all();


    return new Set(
        rows.map(
            row =>
                Number(
                    row.question_id
                )
        )
    );
}


/* =========================================================
   GET CANDIDATES
========================================================= */

function getCandidates({
    minWeeks = 0,
    topic = ""
}) {

    const params = {
        minDays:
            minWeeks * 7
    };


    const where = [
        "q.enabled = 1"
    ];


    if (topic) {
        where.push(
            "q.topic = @topic"
        );

        params.topic =
            topic;
    }


    return db.prepare(`
        SELECT
            q.id,
            q.question_code,
            q.question,
            q.answer,
            q.topic,
            q.difficulty,

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

        WHERE
            ${where.join(" AND ")}

        GROUP BY
            q.id

        HAVING
            @minDays = 0

            OR MAX(
                CASE
                    WHEN ts.status = 'played'
                    THEN ts.played_at
                END
            ) IS NULL

            OR (
                julianday('now')
                - julianday(
                    MAX(
                        CASE
                            WHEN ts.status = 'played'
                            THEN ts.played_at
                        END
                    )
                )
            ) >= @minDays

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

            COUNT(
                CASE
                    WHEN ts.status = 'played'
                    THEN sq.id
                END
            ) ASC

        LIMIT 1000
    `).all(params);
}


/* =========================================================
   HELPERS
========================================================= */

function shuffle(array) {

    const copy =
        [...array];


    for (
        let i = copy.length - 1;
        i > 0;
        i--
    ) {

        const j =
            Math.floor(
                Math.random()
                * (i + 1)
            );


        [
            copy[i],
            copy[j]
        ] = [
            copy[j],
            copy[i]
        ];
    }


    return copy;
}


/*
 * Lower score = better.
 *
 * Never-used questions are strongly preferred.
 * Older questions are preferred.
 * Questions used many times get a penalty.
 */
function freshnessScore(question) {

    let score = 0;


    if (
        question.last_used === null
    ) {

        score -= 1000;

    } else {

        const lastUsed =
            new Date(
                question.last_used
            );


        const now =
            new Date();


        const ageDays =
            Math.max(
                0,
                (
                    now -
                    lastUsed
                ) /
                86400000
            );


        score -=
            ageDays;
    }


    score +=
        Number(
            question.times_used || 0
        ) * 25;


    return score;
}


function sortByFreshness(
    questions,
    preferUnused
) {

    const randomized =
        shuffle(
            questions
        );


    if (!preferUnused) {
        return randomized;
    }


    return randomized.sort(
        (a, b) => {

            const difference =
                freshnessScore(a)
                -
                freshnessScore(b);


            if (
                Math.abs(
                    difference
                ) > 7
            ) {
                return difference;
            }


            return (
                Math.random()
                - 0.5
            );
        }
    );
}


/* =========================================================
   TOPIC GROUPING
========================================================= */

function groupByTopic(
    questions
) {

    const groups =
        new Map();


    for (
        const question
        of questions
    ) {

        const topic =
            question.topic ||
            "[uncategorized]";


        if (
            !groups.has(
                topic
            )
        ) {

            groups.set(
                topic,
                []
            );
        }


        groups
            .get(topic)
            .push(
                question
            );
    }


    return groups;
}


/* =========================================================
   BALANCED TOPIC SELECTION
========================================================= */

function selectBalancedTopics({
    candidates,
    count,
    preferUnused
}) {

    const groups =
        groupByTopic(
            candidates
        );


    for (
        const [topic, items]
        of groups
    ) {

        groups.set(
            topic,
            sortByFreshness(
                items,
                preferUnused
            )
        );
    }


    let topicNames =
        shuffle(
            Array.from(
                groups.keys()
            )
        );


    const selected =
        [];


    while (
        selected.length <
        count
    ) {

        let addedThisPass =
            false;


        topicNames =
            shuffle(
                topicNames
            );


        for (
            const topic
            of topicNames
        ) {

            if (
                selected.length >=
                count
            ) {
                break;
            }


            const bucket =
                groups.get(
                    topic
                );


            if (
                !bucket ||
                bucket.length === 0
            ) {
                continue;
            }


            selected.push(
                bucket.shift()
            );


            addedThisPass =
                true;
        }


        if (
            !addedThisPass
        ) {
            break;
        }
    }


    return selected;
}


/* =========================================================
   GENERATE SET
========================================================= */

function generateSet({
    count = 30,
    minWeeks = 0,
    topic = "",
    preferUnused = true,
    balanceTopics = true,
    excludeIds = []
}) {

    let pool =
        getCandidates({
            minWeeks,
            topic
        });


    /*
     * Questions in READY sets are reserved.
     */
    const reserved =
        getReservedQuestionIds();


    /*
     * Questions already in the current draft are also
     * excluded, especially during rerolls.
     */
    const excluded =
        new Set(
            excludeIds.map(
                Number
            )
        );


    pool =
        pool.filter(
            question =>
                !reserved.has(
                    question.id
                )
                &&
                !excluded.has(
                    question.id
                )
        );


    if (
        topic ||
        !balanceTopics
    ) {

        return sortByFreshness(
            pool,
            preferUnused
        ).slice(
            0,
            count
        );
    }


    return selectBalancedTopics({
        candidates:
            pool,

        count,

        preferUnused
    });
}


/* =========================================================
   REROLL ONE QUESTION
========================================================= */

function rerollQuestion({
    minWeeks = 0,
    topic = "",
    preferUnused = true,
    balanceTopics = true,
    excludeIds = []
}) {

    const results =
        generateSet({
            count: 1,
            minWeeks,
            topic,
            preferUnused,
            balanceTopics,
            excludeIds
        });


    return (
        results[0] ||
        null
    );
}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
    getTopics,
    generateSet,
    rerollQuestion
};