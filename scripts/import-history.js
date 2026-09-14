const path = require("path");
const XLSX = require("xlsx");
const Fuse = require("fuse.js");

const db = require("../db/database");

const {
    normalizeQuestionCode
} = require("../utils/question-code");


/* =========================================================
   SETTINGS
========================================================= */

const workbookPath = path.join(
    __dirname,
    "..",
    "data",
    "source",
    "ct.xlsx"
);


const ignoredSheets = new Set([
    "Table of Contents",
    "Question Bank",
    "Trivia-o-matic (BETA)",
    "Full Format"
]);


const STRONG_FUZZY_THRESHOLD =
    0.18;


/* =========================================================
   HELPERS
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


function looksLikeTime(value) {
    return !!value &&
        /^\d{1,2}:\d{2}$/.test(
            String(value).trim()
        );
}


function isRoundLabel(value) {
    return !!value &&
        /^round\s+\d+/i.test(
            String(value).trim()
        );
}


/* =========================================================
   DATE PARSING
========================================================= */

const monthNumbers = {
    jan: 1,
    january: 1,

    feb: 2,
    february: 2,

    mar: 3,
    march: 3,

    apr: 4,
    april: 4,

    may: 5,

    jun: 6,
    june: 6,

    jul: 7,
    july: 7,

    aug: 8,
    august: 8,

    sep: 9,
    sept: 9,
    september: 9,

    oct: 10,
    october: 10,

    nov: 11,
    november: 11,

    dec: 12,
    december: 12
};


function formatDate(
    year,
    month,
    day
) {
    return [
        year,
        String(month).padStart(
            2,
            "0"
        ),
        String(day).padStart(
            2,
            "0"
        )
    ].join("-");
}


function parseSheetDate(sheetName) {

    const datedMatch =
        sheetName.match(
            /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{2})$/
        );


    if (datedMatch) {

        const month =
            monthNumbers[
                datedMatch[1]
                    .toLowerCase()
            ];


        if (!month) {
            return null;
        }


        return formatDate(
            2000 +
                Number(
                    datedMatch[3]
                ),

            month,

            Number(
                datedMatch[2]
            )
        );
    }


    const oldMatch =
        sheetName.match(
            /^Questions Only\s+(.+)$/
        );


    if (oldMatch) {

        const month =
            monthNumbers[
                oldMatch[1]
                    .toLowerCase()
            ];


        if (!month) {
            return null;
        }


        /*
         * Approximate legacy sheets to first of month.
         */
        return formatDate(
            2025,
            month,
            1
        );
    }


    return null;
}


/* =========================================================
   LOAD QUESTION BANK
========================================================= */

const questions =
    db.prepare(`
        SELECT
            id,
            question_code,
            question,
            answer
        FROM questions
    `)
    .all()
    .map(
        question => ({
            ...question,

            normalizedQuestion:
                normalize(
                    question.question
                ),

            normalizedAnswer:
                normalize(
                    question.answer
                )
        })
    );


const byCode =
    new Map();

const byQuestion =
    new Map();

const byQuestionAnswer =
    new Map();


for (
    const question
    of questions
) {

    const canonicalCode =
        normalizeQuestionCode(
            question.question_code
        );


    if (canonicalCode) {

        byCode.set(
            canonicalCode,
            question
        );
    }


    if (
        !byQuestion.has(
            question.normalizedQuestion
        )
    ) {
        byQuestion.set(
            question.normalizedQuestion,
            []
        );
    }


    byQuestion
        .get(
            question.normalizedQuestion
        )
        .push(question);


    const qaKey =
        `${question.normalizedQuestion}|||${question.normalizedAnswer}`;


    if (
        !byQuestionAnswer.has(
            qaKey
        )
    ) {

        byQuestionAnswer.set(
            qaKey,
            []
        );
    }


    byQuestionAnswer
        .get(qaKey)
        .push(question);
}


/* =========================================================
   FUZZY SEARCH
========================================================= */

const fuse = new Fuse(
    questions,
    {
        includeScore: true,

        keys: [
            "normalizedQuestion"
        ],

        threshold: 0.32,

        ignoreLocation: true,

        minMatchCharLength: 5
    }
);


/* =========================================================
   MANUAL SAFE MATCHES
========================================================= */

const manualMatches =
    new Map([
        [
            normalize(
                "In the cartoon series Scooby-Doo, Where Are You, which character usually wears a scarf?"
            ),
            "Q01343"
        ],

        [
            normalize(
                "In the cartoon series Scooby-Doo, Where Are You, which character usually wears an ascot?"
            ),
            "Q01344"
        ]
    ]);


/* =========================================================
   ANSWER SIMILARITY
========================================================= */

function answerSimilarity(
    firstValue,
    secondValue
) {

    const first = new Set(
        normalize(firstValue)
            .split(" ")
            .filter(Boolean)
    );


    const second = new Set(
        normalize(secondValue)
            .split(" ")
            .filter(Boolean)
    );


    if (
        first.size === 0 ||
        second.size === 0
    ) {
        return 0;
    }


    let shared = 0;


    for (
        const token
        of first
    ) {

        if (
            second.has(token)
        ) {
            shared++;
        }
    }


    return (
        shared /
        Math.max(
            first.size,
            second.size
        )
    );
}


/* =========================================================
   MATCH QUESTION
========================================================= */

function matchQuestion(
    rawCode,
    questionText,
    answerText
) {

    /* 1. ID */

    const canonicalCode =
        normalizeQuestionCode(
            rawCode
        );


    if (canonicalCode) {

        const match =
            byCode.get(
                canonicalCode
            );


        if (match) {

            return {
                question:
                    match,

                method:
                    "exact_id",

                confidence:
                    1
            };
        }
    }


    const nq =
        normalize(
            questionText
        );


    const na =
        normalize(
            answerText
        );


    /* 2. Exact question + answer */

    const combined =
        byQuestionAnswer.get(
            `${nq}|||${na}`
        );


    if (
        combined &&
        combined.length === 1
    ) {

        return {
            question:
                combined[0],

            method:
                "exact_question_answer",

            confidence:
                1
        };
    }


    /* 3. Exact question */

    const questionMatches =
        byQuestion.get(nq);


    if (
        questionMatches &&
        questionMatches.length === 1
    ) {

        return {
            question:
                questionMatches[0],

            method:
                "exact_question",

            confidence:
                0.98
        };
    }


    /* 4. Manual safe matches */

    const manualCode =
        manualMatches.get(nq);


    if (manualCode) {

        const match =
            byCode.get(
                normalizeQuestionCode(
                    manualCode
                )
            );


        if (match) {

            return {
                question:
                    match,

                method:
                    "manual",

                confidence:
                    1
            };
        }
    }


    /* 5. Strong fuzzy */

    const fuzzyResults =
        fuse.search(
            nq,
            {
                limit: 1
            }
        );


    if (
        !fuzzyResults.length
    ) {
        return null;
    }


    const best =
        fuzzyResults[0];


    const answerScore =
        answerSimilarity(
            answerText,
            best.item.answer
        );


    const questionConfidence =
        1 - best.score;


    const combinedConfidence =
        (
            questionConfidence *
            0.80
        ) +
        (
            answerScore *
            0.20
        );


    if (
        best.score <=
            STRONG_FUZZY_THRESHOLD &&
        combinedConfidence >=
            0.80
    ) {

        return {
            question:
                best.item,

            method:
                "strong_fuzzy",

            confidence:
                combinedConfidence
        };
    }


    return null;
}


/* =========================================================
   SHEET PROFILES
========================================================= */

const profiles = [

    {
        name:
            "C=id D=question E=answer",

        codeColumn: 2,
        questionColumn: 3,
        answerColumn: 4
    },

    {
        name:
            "B=id C=question D=answer",

        codeColumn: 1,
        questionColumn: 2,
        answerColumn: 3
    },

    {
        name:
            "A=id B=question C=answer",

        codeColumn: 0,
        questionColumn: 1,
        answerColumn: 2
    },

    {
        name:
            "C=question D=answer",

        codeColumn: null,
        questionColumn: 2,
        answerColumn: 3
    },

    {
        name:
            "D=question E=answer",

        codeColumn: null,
        questionColumn: 3,
        answerColumn: 4
    },

    {
        name:
            "A=question B=answer",

        codeColumn: null,
        questionColumn: 0,
        answerColumn: 1
    }

];


/* =========================================================
   PROFILE DETECTION
========================================================= */

function scoreProfile(
    rows,
    profile
) {

    let score = 0;


    for (const row of rows) {

        const rawCode =
            profile.codeColumn === null
                ? null
                : clean(
                    row[
                        profile.codeColumn
                    ]
                );


        const question =
            clean(
                row[
                    profile.questionColumn
                ]
            );


        const answer =
            clean(
                row[
                    profile.answerColumn
                ]
            );


        if (
            !question ||
            !answer ||
            isRoundLabel(question) ||
            looksLikeTime(answer)
        ) {
            continue;
        }


        const canonicalCode =
            normalizeQuestionCode(
                rawCode
            );


        if (
            canonicalCode &&
            byCode.has(
                canonicalCode
            )
        ) {
            score += 5;
            continue;
        }


        const nq =
            normalize(question);

        const na =
            normalize(answer);


        if (
            byQuestionAnswer.has(
                `${nq}|||${na}`
            )
        ) {
            score += 3;
        }

        else if (
            byQuestion.has(nq)
        ) {
            score += 2;
        }
    }


    return score;
}


function detectProfile(rows) {

    return profiles
        .map(
            profile => ({
                profile,

                score:
                    scoreProfile(
                        rows,
                        profile
                    )
            })
        )
        .sort(
            (a, b) =>
                b.score -
                a.score
        )[0]
        .profile;
}


/* =========================================================
   DATABASE STATEMENTS
========================================================= */

const insertSet =
    db.prepare(`
        INSERT INTO trivia_sets (
            name,
            played_at,
            source_sheet,
            status
        )
        VALUES (
            @name,
            @played_at,
            @source_sheet,
            'played'
        )
    `);


const insertSetQuestion =
    db.prepare(`
        INSERT INTO set_questions (
            set_id,
            question_id,
            position,
            round,
            question_snapshot,
            answer_snapshot,
            match_method,
            match_confidence
        )
        VALUES (
            @set_id,
            @question_id,
            @position,
            @round,
            @question_snapshot,
            @answer_snapshot,
            @match_method,
            @match_confidence
        )
    `);


const insertUnmatched =
    db.prepare(`
        INSERT INTO unmatched_history (
            set_id,
            source_sheet,
            source_row,
            question_text,
            answer_text,
            question_code,
            reason
        )
        VALUES (
            @set_id,
            @source_sheet,
            @source_row,
            @question_text,
            @answer_text,
            @question_code,
            @reason
        )
    `);


/* =========================================================
   LOAD WORKBOOK
========================================================= */

const workbook =
    XLSX.readFile(
        workbookPath,
        {
            cellDates: true
        }
    );


/* =========================================================
   COUNTERS
========================================================= */

let setCount = 0;
let matchedCount = 0;
let unmatchedCount = 0;


const matchMethods = {
    exact_id: 0,
    exact_question_answer: 0,
    exact_question: 0,
    manual: 0,
    strong_fuzzy: 0
};


/* =========================================================
   IMPORT TRANSACTION
========================================================= */

const importHistory =
    db.transaction(() => {

        db.prepare(`
            DELETE FROM set_questions
        `).run();


        db.prepare(`
            DELETE FROM unmatched_history
        `).run();


        db.prepare(`
            DELETE FROM trivia_sets
        `).run();


        for (
            const sheetName
            of workbook.SheetNames
        ) {

            if (
                ignoredSheets.has(
                    sheetName
                )
            ) {
                continue;
            }


            const worksheet =
                workbook.Sheets[
                    sheetName
                ];


            const rows =
                XLSX.utils.sheet_to_json(
                    worksheet,
                    {
                        header: 1,
                        defval: null,
                        raw: false
                    }
                );


            const profile =
                detectProfile(
                    rows
                );


            const result =
                insertSet.run({
                    name:
                        sheetName,

                    played_at:
                        parseSheetDate(
                            sheetName
                        ),

                    source_sheet:
                        sheetName
                });


            const setId =
                result.lastInsertRowid;


            setCount++;


            let position = 0;
            let currentRound = null;


            for (
                let index = 0;
                index < rows.length;
                index++
            ) {

                const row =
                    rows[index];


                const rawCode =
                    profile.codeColumn === null
                        ? null
                        : clean(
                            row[
                                profile.codeColumn
                            ]
                        );


                const question =
                    clean(
                        row[
                            profile.questionColumn
                        ]
                    );


                const answer =
                    clean(
                        row[
                            profile.answerColumn
                        ]
                    );


                if (
                    question &&
                    isRoundLabel(
                        question
                    )
                ) {

                    const roundMatch =
                        question.match(
                            /^round\s+(\d+)/i
                        );


                    currentRound =
                        roundMatch
                            ? Number(
                                roundMatch[1]
                            )
                            : null;


                    continue;
                }


                if (
                    !question ||
                    !answer ||
                    looksLikeTime(
                        answer
                    )
                ) {
                    continue;
                }


                if (
                    question.toLowerCase() ===
                        "questions" &&
                    answer.toLowerCase() ===
                        "answers"
                ) {
                    continue;
                }


                position++;


                const match =
                    matchQuestion(
                        rawCode,
                        question,
                        answer
                    );


                if (match) {

                    insertSetQuestion.run({
                        set_id:
                            setId,

                        question_id:
                            match.question.id,

                        position,

                        round:
                            currentRound,

                        question_snapshot:
                            question,

                        answer_snapshot:
                            answer,

                        match_method:
                            match.method,

                        match_confidence:
                            match.confidence
                    });


                    matchedCount++;


                    matchMethods[
                        match.method
                    ]++;


                    continue;
                }


                insertUnmatched.run({
                    set_id:
                        setId,

                    source_sheet:
                        sheetName,

                    source_row:
                        index + 1,

                    question_text:
                        question,

                    answer_text:
                        answer,

                    question_code:
                        normalizeQuestionCode(
                            rawCode
                        ),

                    reason:
                        "No confident match"
                });


                unmatchedCount++;
            }
        }
    });


/* =========================================================
   RUN
========================================================= */

console.log("");
console.log("IMPORTING TRIVIA HISTORY");
console.log("--------------------------------");


importHistory();


console.log("");
console.log("IMPORT COMPLETE");
console.log("--------------------------------");

console.log(
    `Sets imported:        ${setCount}`
);

console.log(
    `Matched uses:         ${matchedCount}`
);

console.log(
    `Unmatched uses:       ${unmatchedCount}`
);

console.log("");

console.log("MATCH METHODS");
console.log("--------------------------------");

console.log(
    `Exact ID:             ${matchMethods.exact_id}`
);

console.log(
    `Exact Q+A:            ${matchMethods.exact_question_answer}`
);

console.log(
    `Exact question:       ${matchMethods.exact_question}`
);

console.log(
    `Manual:               ${matchMethods.manual}`
);

console.log(
    `Strong fuzzy:         ${matchMethods.strong_fuzzy}`
);


const stats =
    db.prepare(`
        SELECT
            COUNT(DISTINCT question_id)
                AS questions_used,

            COUNT(*)
                AS historical_uses

        FROM set_questions
    `)
    .get();


const neverUsed =
    db.prepare(`
        SELECT
            COUNT(*) AS count

        FROM questions q

        WHERE NOT EXISTS (
            SELECT 1
            FROM set_questions sq
            WHERE sq.question_id = q.id
        )
    `)
    .get();


console.log("");
console.log("HISTORY STATS");
console.log("--------------------------------");

console.log(
    `Distinct questions used: ${stats.questions_used}`
);

console.log(
    `Historical uses linked:  ${stats.historical_uses}`
);

console.log(
    `No reconstructed use:    ${neverUsed.count}`
);

console.log("");