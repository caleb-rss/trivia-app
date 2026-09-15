const db = require("../db/database");


/* =========================================================
   DUPLICATE CACHE

   Duplicate scanning is relatively expensive.

   Once scanned, reuse the results until something in the
   catalog changes.
========================================================= */

let duplicateCache = null;


/*
 * Call this whenever question data changes.
 */
function invalidateDuplicateCache() {
    duplicateCache = null;
}


/* =========================================================
   TEXT HELPERS
========================================================= */

function clean(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    const result =
        String(value).trim();

    return result === ""
        ? null
        : result;
}


function normalize(value) {
    const cleaned =
        clean(value);

    if (!cleaned) {
        return "";
    }

    return cleaned
        .toLowerCase()
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/&/g, " and ")
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}


/* =========================================================
   STOP WORDS

   These aren't useful for identifying duplicates.

   Without this, words like "what" or "which" create giant
   candidate groups and we're nearly back to O(n²).
========================================================= */

const STOP_WORDS =
    new Set([
        "the",
        "a",
        "an",
        "and",
        "or",
        "of",
        "to",
        "in",
        "on",
        "at",
        "for",
        "from",
        "by",
        "with",
        "as",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "what",
        "which",
        "who",
        "whom",
        "whose",
        "where",
        "when",
        "why",
        "how",
        "this",
        "that",
        "these",
        "those",
        "it",
        "its",
        "their",
        "there",
        "they",
        "them",
        "he",
        "she",
        "his",
        "her",
        "you",
        "your",
        "we",
        "our",
        "i",
        "my",
        "do",
        "does",
        "did",
        "has",
        "have",
        "had",
        "can",
        "could",
        "would",
        "should",
        "will",
        "most",
        "only",
        "name",
        "called"
    ]);


/* =========================================================
   TOKENIZATION
========================================================= */

function tokenizeNormalized(
    normalizedText
) {
    if (!normalizedText) {
        return new Set();
    }


    return new Set(
        normalizedText
            .split(" ")
            .filter(
                token =>
                    token.length >= 3 &&
                    !STOP_WORDS.has(
                        token
                    )
            )
    );
}


function tokenOverlap(
    firstTokens,
    secondTokens
) {
    if (
        firstTokens.size === 0 ||
        secondTokens.size === 0
    ) {
        return {
            shared: 0,
            jaccard: 0
        };
    }


    let shared = 0;


    /*
     * Iterate over the smaller set.
     */
    const smaller =
        firstTokens.size <=
        secondTokens.size
            ? firstTokens
            : secondTokens;


    const larger =
        smaller === firstTokens
            ? secondTokens
            : firstTokens;


    for (
        const token
        of smaller
    ) {
        if (
            larger.has(token)
        ) {
            shared++;
        }
    }


    const union =
        firstTokens.size +
        secondTokens.size -
        shared;


    return {
        shared,

        jaccard:
            union === 0
                ? 0
                : shared / union
    };
}


/* =========================================================
   LENGTH SIMILARITY
========================================================= */

function lengthSimilarity(
    firstLength,
    secondLength
) {
    if (
        !firstLength ||
        !secondLength
    ) {
        return 0;
    }


    return (
        Math.min(
            firstLength,
            secondLength
        )
        /
        Math.max(
            firstLength,
            secondLength
        )
    );
}


/* =========================================================
   CATALOG QUERY
========================================================= */

function getCatalog({
    search = "",
    filter = "all",
    topic = "",
    limit = 250
}) {
    const where = [];
    const params = {
        limit
    };


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


    if (
        filter ===
        "missing_difficulty"
    ) {
        where.push(`
            q.difficulty IS NULL
        `);
    }


    if (
        filter ===
        "missing_topic"
    ) {
        where.push(`
            (
                q.topic IS NULL
                OR TRIM(q.topic) = ''
            )
        `);
    }


    if (
        filter ===
        "missing_format"
    ) {
        where.push(`
            (
                q.format IS NULL
                OR TRIM(q.format) = ''
            )
        `);
    }


    if (
        filter === "review"
    ) {
        where.push(`
            q.needs_review = 1
        `);
    }


    if (
        filter === "disabled"
    ) {
        where.push(`
            q.enabled = 0
        `);
    }


    if (
        filter === "enabled"
    ) {
        where.push(`
            q.enabled = 1
        `);
    }


    const whereClause =
        where.length
            ? `WHERE ${where.join(" AND ")}`
            : "";


    return db.prepare(`
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
            ) AS last_used

        FROM questions q

        LEFT JOIN set_questions sq
            ON sq.question_id =
               q.id

        LEFT JOIN trivia_sets ts
            ON ts.id =
               sq.set_id

        ${whereClause}

        GROUP BY
            q.id

        ORDER BY
            q.question_code ASC

        LIMIT @limit
    `).all(params);
}


/* =========================================================
   TOPICS / FORMATS
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


function getFormats() {
    return db.prepare(`
        SELECT DISTINCT
            format

        FROM questions

        WHERE
            format IS NOT NULL
            AND TRIM(format) != ''

        ORDER BY
            format
    `).all();
}


/* =========================================================
   BULK UPDATE
========================================================= */

function bulkUpdate({
    ids,
    difficulty,
    topic,
    format,
    enabled,
    markReviewed
}) {
    if (!ids.length) {
        return 0;
    }


    const statements = [];
    const params = {};


    if (
        difficulty !== undefined &&
        difficulty !== ""
    ) {
        statements.push(
            "difficulty = @difficulty"
        );

        params.difficulty =
            Number(difficulty);
    }


    if (
        topic !== undefined &&
        topic !== ""
    ) {
        statements.push(
            "topic = @topic"
        );

        params.topic =
            topic;
    }


    if (
        format !== undefined &&
        format !== ""
    ) {
        statements.push(
            "format = @format"
        );

        params.format =
            format;
    }


    if (
        enabled === "1" ||
        enabled === "0"
    ) {
        statements.push(
            "enabled = @enabled"
        );

        params.enabled =
            Number(enabled);
    }


    if (markReviewed) {
        statements.push(
            "needs_review = 0"
        );
    }


    if (!statements.length) {
        return 0;
    }


    statements.push(
        "updated_at = CURRENT_TIMESTAMP"
    );


    const placeholders =
        ids.map(
            (_, index) =>
                `@id${index}`
        );


    ids.forEach(
        (id, index) => {

            params[
                `id${index}`
            ] =
                Number(id);
        }
    );


    const result =
        db.prepare(`
            UPDATE questions

            SET
                ${statements.join(", ")}

            WHERE id IN (
                ${placeholders.join(", ")}
            )
        `)
        .run(params);


    if (
        result.changes > 0
    ) {
        invalidateDuplicateCache();
    }


    return result.changes;
}


/* =========================================================
   INLINE UPDATE
========================================================= */

function updateOne({
    id,
    difficulty,
    topic,
    format,
    enabled,
    needsReview
}) {
    const result =
        db.prepare(`
            UPDATE questions

            SET
                difficulty = @difficulty,
                topic = @topic,
                format = @format,
                enabled = @enabled,
                needs_review = @needs_review,
                updated_at =
                    CURRENT_TIMESTAMP

            WHERE id = @id
        `)
        .run({
            id:
                Number(id),

            difficulty:
                difficulty === ""
                    ? null
                    : Number(
                        difficulty
                    ),

            topic:
                clean(topic),

            format:
                clean(format),

            enabled:
                enabled
                    ? 1
                    : 0,

            needs_review:
                needsReview
                    ? 1
                    : 0
        });


    if (
        result.changes > 0
    ) {
        invalidateDuplicateCache();
    }


    return result;
}


/* =========================================================
   DUPLICATE PREPARATION

   Expensive text work happens ONCE per question.
========================================================= */

function prepareQuestions() {
    const rows =
        db.prepare(`
            SELECT
                id,
                question_code,
                question,
                answer,
                topic,
                difficulty,
                format

            FROM questions

            WHERE enabled = 1

            ORDER BY id
        `)
        .all();


    return rows.map(
        row => {

            const normalizedQuestion =
                normalize(
                    row.question
                );


            const normalizedAnswer =
                normalize(
                    row.answer
                );


            return {
                ...row,

                normalizedQuestion,

                normalizedAnswer,

                questionTokens:
                    tokenizeNormalized(
                        normalizedQuestion
                    ),

                answerTokens:
                    tokenizeNormalized(
                        normalizedAnswer
                    ),

                questionLength:
                    normalizedQuestion.length,

                answerLength:
                    normalizedAnswer.length
            };
        }
    );
}


/* =========================================================
   INVERTED INDEX
========================================================= */

function addToIndex(
    index,
    key,
    questionIndex
) {
    if (!key) {
        return;
    }


    if (!index.has(key)) {
        index.set(
            key,
            []
        );
    }


    index
        .get(key)
        .push(
            questionIndex
        );
}


/* =========================================================
   BUILD CANDIDATE PAIRS

   Instead of 500,000 comparisons, only compare questions
   that share useful information.
========================================================= */

function buildCandidatePairs(
    questions
) {
    const exactAnswerIndex =
        new Map();

    const answerTokenIndex =
        new Map();

    const questionTokenIndex =
        new Map();


    questions.forEach(
        (
            question,
            index
        ) => {

            /*
             * Exact answer is our strongest cheap signal.
             */
            addToIndex(
                exactAnswerIndex,
                question.normalizedAnswer,
                index
            );


            for (
                const token
                of question.answerTokens
            ) {
                addToIndex(
                    answerTokenIndex,
                    token,
                    index
                );
            }


            for (
                const token
                of question.questionTokens
            ) {
                addToIndex(
                    questionTokenIndex,
                    token,
                    index
                );
            }
        }
    );


    /*
     * pairKey -> evidence count
     */
    const candidatePairs =
        new Map();


    function registerPair(
        firstIndex,
        secondIndex,
        weight
    ) {
        if (
            firstIndex ===
            secondIndex
        ) {
            return;
        }


        const low =
            Math.min(
                firstIndex,
                secondIndex
            );


        const high =
            Math.max(
                firstIndex,
                secondIndex
            );


        const key =
            `${low}:${high}`;


        candidatePairs.set(
            key,
            (
                candidatePairs.get(
                    key
                ) || 0
            ) + weight
        );
    }


    /*
     * Exact answers:
     * compare all questions sharing the answer.
     */
    for (
        const group
        of exactAnswerIndex.values()
    ) {

        if (
            group.length < 2
        ) {
            continue;
        }


        /*
         * Avoid pathological giant groups.
         */
        if (
            group.length > 100
        ) {
            continue;
        }


        for (
            let i = 0;
            i < group.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < group.length;
                j++
            ) {

                registerPair(
                    group[i],
                    group[j],
                    4
                );
            }
        }
    }


    /*
     * Shared answer tokens.

     * Skip huge token buckets because they're usually
     * generic words/numbers and create too much noise.
     */
    for (
        const group
        of answerTokenIndex.values()
    ) {

        if (
            group.length < 2 ||
            group.length > 60
        ) {
            continue;
        }


        for (
            let i = 0;
            i < group.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < group.length;
                j++
            ) {

                registerPair(
                    group[i],
                    group[j],
                    2
                );
            }
        }
    }


    /*
     * Shared significant question tokens.

     * These are weaker evidence, so each match only
     * contributes one point.
     */
    for (
        const group
        of questionTokenIndex.values()
    ) {

        if (
            group.length < 2 ||
            group.length > 50
        ) {
            continue;
        }


        for (
            let i = 0;
            i < group.length;
            i++
        ) {

            for (
                let j = i + 1;
                j < group.length;
                j++
            ) {

                registerPair(
                    group[i],
                    group[j],
                    1
                );
            }
        }
    }


    return candidatePairs;
}


/* =========================================================
   SCORE ONE DUPLICATE CANDIDATE
========================================================= */

function scoreDuplicatePair(
    first,
    second
) {

    const questionOverlap =
        tokenOverlap(
            first.questionTokens,
            second.questionTokens
        );


    const answerOverlap =
        tokenOverlap(
            first.answerTokens,
            second.answerTokens
        );


    const exactAnswer =
        (
            first.normalizedAnswer &&
            first.normalizedAnswer ===
            second.normalizedAnswer
        );


    const exactQuestion =
        (
            first.normalizedQuestion &&
            first.normalizedQuestion ===
            second.normalizedQuestion
        );


    /*
     * Exact normalized question is essentially certain.
     */
    if (exactQuestion) {

        return 1;
    }


    const questionLengthScore =
        lengthSimilarity(
            first.questionLength,
            second.questionLength
        );


    /*
     * If wording length is wildly different and the
     * answers differ, it's probably not worth scoring.
     */
    if (
        !exactAnswer &&
        questionLengthScore < 0.35
    ) {
        return 0;
    }


    let score =
        (
            questionOverlap.jaccard *
            0.62
        )
        +
        (
            answerOverlap.jaccard *
            0.23
        )
        +
        (
            questionLengthScore *
            0.10
        );


    /*
     * Same answer is a powerful trivia-specific signal.
     */
    if (exactAnswer) {
        score += 0.15;
    }


    /*
     * Multiple meaningful question words in common
     * deserves a small boost.
     */
    if (
        questionOverlap.shared >= 4
    ) {
        score += 0.05;
    }


    /*
     * Questions with no meaningful wording overlap
     * shouldn't match solely because of a generic answer.
     */
    if (
        questionOverlap.shared === 0
    ) {
        score *= 0.45;
    }


    return Math.min(
        score,
        1
    );
}


/* =========================================================
   RUN DUPLICATE SCAN

   This computes all reasonable candidate scores ONCE.
========================================================= */

function scanDuplicates() {
    const started =
        Date.now();


    const questions =
        prepareQuestions();


    const candidatePairs =
        buildCandidatePairs(
            questions
        );


    const scored =
        [];


    for (
        const [key, evidence]
        of candidatePairs
    ) {

        /*
         * Very weak candidates:
         * require at least two pieces of evidence unless
         * they came from exact-answer grouping.
         */
        if (
            evidence < 2
        ) {
            continue;
        }


        const [
            firstIndex,
            secondIndex
        ] =
            key
                .split(":")
                .map(Number);


        const first =
            questions[
                firstIndex
            ];


        const second =
            questions[
                secondIndex
            ];


        const score =
            scoreDuplicatePair(
                first,
                second
            );


        /*
         * Cache somewhat broad results so changing the UI
         * threshold does not require rescanning.
         */
        if (
            score >= 0.45
        ) {

            scored.push({
                first: {
                    id:
                        first.id,

                    question_code:
                        first.question_code,

                    question:
                        first.question,

                    answer:
                        first.answer,

                    topic:
                        first.topic,

                    difficulty:
                        first.difficulty,

                    format:
                        first.format
                },

                second: {
                    id:
                        second.id,

                    question_code:
                        second.question_code,

                    question:
                        second.question,

                    answer:
                        second.answer,

                    topic:
                        second.topic,

                    difficulty:
                        second.difficulty,

                    format:
                        second.format
                },

                score
            });
        }
    }


    scored.sort(
        (a, b) =>
            b.score -
            a.score
    );


    duplicateCache = {
        results:
            scored,

        questionCount:
            questions.length,

        candidateCount:
            candidatePairs.size,

        durationMs:
            Date.now() -
            started
    };


    console.log(
        `Duplicate scan: ${questions.length} questions, ` +
        `${candidatePairs.size} candidates, ` +
        `${scored.length} possible matches, ` +
        `${duplicateCache.durationMs}ms`
    );


    return duplicateCache;
}


/* =========================================================
   DUPLICATE FINDER
========================================================= */

function findDuplicatePairs({
    threshold = 0.72,
    limit = 150
} = {}) {

    const cache =
        duplicateCache ||
        scanDuplicates();


    return cache.results
        .filter(
            pair =>
                pair.score >=
                threshold
        )
        .slice(
            0,
            limit
        );
}


/* =========================================================
   MERGE DUPLICATES
========================================================= */

function mergeQuestions({
    keeperId,
    duplicateId
}) {

    keeperId =
        Number(
            keeperId
        );

    duplicateId =
        Number(
            duplicateId
        );


    if (
        !keeperId ||
        !duplicateId ||
        keeperId === duplicateId
    ) {

        throw new Error(
            "Invalid merge selection."
        );
    }


    const keeper =
        db.prepare(`
            SELECT *
            FROM questions
            WHERE id = ?
        `)
        .get(
            keeperId
        );


    const duplicate =
        db.prepare(`
            SELECT *
            FROM questions
            WHERE id = ?
        `)
        .get(
            duplicateId
        );


    if (
        !keeper ||
        !duplicate
    ) {

        throw new Error(
            "Question not found."
        );
    }


    /*
     * Prepare statements once instead of rebuilding them
     * inside every loop iteration.
     */
    const findKeeperUse =
        db.prepare(`
            SELECT id

            FROM set_questions

            WHERE
                set_id = ?
                AND question_id = ?
        `);


    const deleteUse =
        db.prepare(`
            DELETE FROM set_questions
            WHERE id = ?
        `);


    const moveUse =
        db.prepare(`
            UPDATE set_questions

            SET question_id = ?

            WHERE id = ?
        `);


    const transaction =
        db.transaction(
            () => {

                const duplicateUses =
                    db.prepare(`
                        SELECT
                            id,
                            set_id

                        FROM set_questions

                        WHERE
                            question_id = ?
                    `)
                    .all(
                        duplicateId
                    );


                for (
                    const usage
                    of duplicateUses
                ) {

                    const keeperAlreadyInSet =
                        findKeeperUse.get(
                            usage.set_id,
                            keeperId
                        );


                    if (
                        keeperAlreadyInSet
                    ) {

                        /*
                         * Both duplicate questions appeared in
                         * the same set. Keep one historical use.
                         */
                        deleteUse.run(
                            usage.id
                        );

                    } else {

                        moveUse.run(
                            keeperId,
                            usage.id
                        );
                    }
                }


                /*
                 * Fill missing metadata on keeper from
                 * duplicate where useful.
                 */
                db.prepare(`
                    UPDATE questions

                    SET
                        topic =
                            COALESCE(
                                NULLIF(
                                    topic,
                                    ''
                                ),
                                @duplicate_topic
                            ),

                        format =
                            COALESCE(
                                NULLIF(
                                    format,
                                    ''
                                ),
                                @duplicate_format
                            ),

                        difficulty =
                            COALESCE(
                                difficulty,
                                @duplicate_difficulty
                            ),

                        needs_review =
                            CASE
                                WHEN
                                    needs_review = 1
                                    AND
                                    @duplicate_needs_review = 0
                                THEN 0

                                ELSE
                                    needs_review
                            END,

                        updated_at =
                            CURRENT_TIMESTAMP

                    WHERE id =
                        @keeper_id
                `)
                .run({
                    keeper_id:
                        keeperId,

                    duplicate_topic:
                        duplicate.topic,

                    duplicate_format:
                        duplicate.format,

                    duplicate_difficulty:
                        duplicate.difficulty,

                    duplicate_needs_review:
                        duplicate.needs_review
                });


                db.prepare(`
                    DELETE FROM questions
                    WHERE id = ?
                `)
                .run(
                    duplicateId
                );
            }
        );


    transaction();


    /*
     * Database changed — next duplicate page load
     * should rescan.
     */
    invalidateDuplicateCache();


    return keeper.question_code;
}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {
    getCatalog,
    getTopics,
    getFormats,
    bulkUpdate,
    updateOne,
    findDuplicatePairs,
    mergeQuestions
};