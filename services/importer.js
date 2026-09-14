const db = require("../db/database");


/* =========================================================
   NORMALIZATION
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


function normalizeQuestion(value) {
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


function parseDifficulty(value) {
    const cleaned =
        clean(value);

    if (!cleaned) {
        return null;
    }

    const number =
        Number.parseInt(
            cleaned,
            10
        );

    if (
        Number.isNaN(number) ||
        number < 1 ||
        number > 5
    ) {
        return null;
    }

    return number;
}


/* =========================================================
   ID GENERATION
========================================================= */

function getNextQuestionNumber() {
    const highest = db.prepare(`
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
    `).get();


    if (!highest) {
        return 1;
    }


    return (
        Number.parseInt(
            highest.question_code.slice(1),
            10
        ) + 1
    );
}


function formatQuestionCode(number) {
    return (
        "Q" +
        String(number).padStart(
            5,
            "0"
        )
    );
}


/* =========================================================
   EXISTING QUESTION LOOKUP
========================================================= */

function getExistingQuestions() {
    return db.prepare(`
        SELECT
            id,
            question_code,
            question,
            answer,
            topic

        FROM questions
    `).all();
}


/* =========================================================
   DELIMITER DETECTION
========================================================= */

function detectDelimiter(line) {
    if (line.includes("\t")) {
        return "\t";
    }

    if (line.includes("|")) {
        return "|";
    }

    return null;
}


/* =========================================================
   HEADER DETECTION
========================================================= */

function looksLikeHeader(parts) {
    if (!parts.length) {
        return false;
    }

    const normalized =
        parts.map(
            part =>
                clean(part)
                    ?.toLowerCase()
        );


    return (
        normalized[0] === "question" &&
        normalized[1] === "answer"
    );
}


/* =========================================================
   PARSE PASTED TEXT
========================================================= */

function parsePaste(text) {
    const rawLines =
        String(text || "")
            .split(/\r?\n/);


    const lines =
        rawLines
            .map(
                line =>
                    line.trim()
            )
            .filter(Boolean);


    const parsed = [];


    lines.forEach(
        (line, index) => {

            const delimiter =
                detectDelimiter(line);


            if (!delimiter) {
                parsed.push({
                    sourceRow:
                        index + 1,

                    raw:
                        line,

                    question:
                        null,

                    answer:
                        null,

                    topic:
                        null,

                    difficulty:
                        null,

                    format:
                        null,

                    error:
                        "Could not detect a tab or | delimiter."
                });

                return;
            }


            const parts =
                line
                    .split(delimiter)
                    .map(clean);


            if (
                index === 0 &&
                looksLikeHeader(parts)
            ) {
                return;
            }


            parsed.push({
                sourceRow:
                    index + 1,

                raw:
                    line,

                question:
                    parts[0] || null,

                answer:
                    parts[1] || null,

                topic:
                    parts[2] || null,

                difficulty:
                    parseDifficulty(
                        parts[3]
                    ),

                format:
                    parts[4] || null,

                error:
                    null
            });
        }
    );


    return parsed;
}


/* =========================================================
   CSV PARSING
========================================================= */

function parseCsvRows(rows) {
    return rows.map(
        (row, index) => ({
            sourceRow:
                index + 2,

            raw:
                null,

            question:
                clean(
                    row.Question ??
                    row.question
                ),

            answer:
                clean(
                    row.Answer ??
                    row.answer
                ),

            topic:
                clean(
                    row.Topic ??
                    row.topic
                ),

            difficulty:
                parseDifficulty(
                    row.Difficulty ??
                    row.difficulty
                ),

            format:
                clean(
                    row.Format ??
                    row.format
                ),

            error:
                null
        })
    );
}


/* =========================================================
   VALIDATE + DUPLICATE CHECK
========================================================= */

function reviewRows(rows) {
    const existing =
        getExistingQuestions();


    const existingByNormalized =
        new Map();


    for (const item of existing) {
        const key =
            normalizeQuestion(
                item.question
            );

        if (!key) {
            continue;
        }

        if (
            !existingByNormalized.has(
                key
            )
        ) {
            existingByNormalized.set(
                key,
                []
            );
        }

        existingByNormalized
            .get(key)
            .push(item);
    }


    const batchSeen =
        new Map();


    return rows.map(
        (row) => {

            const issues = [];

            if (!row.question) {
                issues.push(
                    "Missing question"
                );
            }

            if (!row.answer) {
                issues.push(
                    "Missing answer"
                );
            }


            const normalized =
                normalizeQuestion(
                    row.question
                );


            const existingMatches =
                normalized
                    ? (
                        existingByNormalized.get(
                            normalized
                        ) || []
                    )
                    : [];


            const batchMatches =
                normalized
                    ? (
                        batchSeen.get(
                            normalized
                        ) || 0
                    )
                    : 0;


            if (normalized) {
                batchSeen.set(
                    normalized,
                    batchMatches + 1
                );
            }


            const duplicate =
                existingMatches.length > 0;


            const duplicateInBatch =
                batchMatches > 0;


            if (duplicate) {
                issues.push(
                    `Possible duplicate of ${existingMatches[0].question_code}`
                );
            }


            if (duplicateInBatch) {
                issues.push(
                    "Duplicate within import batch"
                );
            }


            if (row.error) {
                issues.push(
                    row.error
                );
            }


            return {
                ...row,

                valid:
                    Boolean(
                        row.question &&
                        row.answer
                    ),

                duplicate,

                duplicateInBatch,

                duplicateQuestion:
                    existingMatches[0] ||
                    null,

                issues
            };
        }
    );
}


/* =========================================================
   COMMIT IMPORT
========================================================= */

function commitImport(rows) {
    const validRows =
        rows.filter(
            row =>
                row.question &&
                row.answer
        );


    if (!validRows.length) {
        return {
            imported: 0,
            firstCode: null,
            lastCode: null
        };
    }


    let nextNumber =
        getNextQuestionNumber();


    const insert =
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
                @needs_review
            )
        `);


    const codes = [];


    const transaction =
        db.transaction(
            () => {

                for (
                    const row
                    of validRows
                ) {

                    const code =
                        formatQuestionCode(
                            nextNumber
                        );


                    insert.run({
                        question_code:
                            code,

                        format:
                            row.format ||
                            null,

                        topic:
                            row.topic ||
                            null,

                        difficulty:
                            row.difficulty ??
                            null,

                        question:
                            row.question.trim(),

                        answer:
                            row.answer.trim(),

                        needs_review:
                            (
                                !row.topic ||
                                !row.format ||
                                row.difficulty === null
                            )
                                ? 1
                                : 0
                    });


                    codes.push(code);

                    nextNumber++;
                }
            }
        );


    transaction();


    return {
        imported:
            validRows.length,

        firstCode:
            codes[0] ||
            null,

        lastCode:
            codes[
                codes.length - 1
            ] ||
            null
    };
}


module.exports = {
    parsePaste,
    parseCsvRows,
    reviewRows,
    commitImport
};
