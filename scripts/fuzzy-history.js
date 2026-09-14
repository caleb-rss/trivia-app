const path = require("path");
const XLSX = require("xlsx");
const Fuse = require("fuse.js");

const db = require("../db/database");


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


/*
 * Fuse scores:
 *
 * 0.0 = exact
 * 1.0 = completely different
 *
 * We're intentionally conservative.
 */
const STRONG_THRESHOLD = 0.18;
const POSSIBLE_THRESHOLD = 0.32;


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

    return result || null;
}


function normalize(value) {
    const cleaned = clean(value);

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


function isQuestionCode(value) {
    return !!value &&
        /^Q\d+$/i.test(value);
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
   QUESTION BANK
========================================================= */

const questions = db
    .prepare(`
        SELECT
            id,
            question_code,
            question,
            answer
        FROM questions
    `)
    .all()
    .map((question) => ({
        ...question,

        normalizedQuestion:
            normalize(question.question),

        normalizedAnswer:
            normalize(question.answer)
    }));


const byCode = new Map();
const byQuestion = new Map();
const byQuestionAnswer = new Map();


for (const question of questions) {

    if (question.question_code) {
        byCode.set(
            question.question_code.toUpperCase(),
            question
        );
    }


    if (!byQuestion.has(
        question.normalizedQuestion
    )) {
        byQuestion.set(
            question.normalizedQuestion,
            []
        );
    }

    byQuestion
        .get(question.normalizedQuestion)
        .push(question);


    const qaKey =
        `${question.normalizedQuestion}|||${question.normalizedAnswer}`;


    if (!byQuestionAnswer.has(qaKey)) {
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
   FUZZY INDEX
========================================================= */

const fuse = new Fuse(
    questions,
    {
        includeScore: true,

        /*
         * We search question text only.
         * Answer similarity gets checked separately.
         */
        keys: [
            "normalizedQuestion"
        ],

        threshold:
            POSSIBLE_THRESHOLD,

        ignoreLocation: true,

        minMatchCharLength: 5
    }
);


/* =========================================================
   SHEET PROFILES
========================================================= */

const profiles = [

    {
        name: "C=id D=question E=answer",
        codeColumn: 2,
        questionColumn: 3,
        answerColumn: 4
    },

    {
        name: "B=id C=question D=answer",
        codeColumn: 1,
        questionColumn: 2,
        answerColumn: 3
    },

    {
        name: "A=id B=question C=answer",
        codeColumn: 0,
        questionColumn: 1,
        answerColumn: 2
    },

    {
        name: "C=question D=answer",
        codeColumn: null,
        questionColumn: 2,
        answerColumn: 3
    },

    {
        name: "D=question E=answer",
        codeColumn: null,
        questionColumn: 3,
        answerColumn: 4
    },

    {
        name: "A=question B=answer",
        codeColumn: null,
        questionColumn: 0,
        answerColumn: 1
    }

];


/* =========================================================
   EXACT MATCH
========================================================= */

function exactMatch(
    rawCode,
    questionText,
    answerText
) {

    if (isQuestionCode(rawCode)) {

        const match =
            byCode.get(
                rawCode.toUpperCase()
            );

        if (match) {
            return {
                type: "id",
                question: match
            };
        }
    }


    const nq =
        normalize(questionText);

    const na =
        normalize(answerText);


    const combined =
        byQuestionAnswer.get(
            `${nq}|||${na}`
        );


    if (
        combined &&
        combined.length === 1
    ) {
        return {
            type: "question_answer",
            question: combined[0]
        };
    }


    const questionMatches =
        byQuestion.get(nq);


    if (
        questionMatches &&
        questionMatches.length === 1
    ) {
        return {
            type: "question",
            question: questionMatches[0]
        };
    }


    return null;
}


/* =========================================================
   ANSWER SIMILARITY

   Lightweight token overlap.
========================================================= */

function answerSimilarity(a, b) {

    const first =
        new Set(
            normalize(a)
                .split(" ")
                .filter(Boolean)
        );

    const second =
        new Set(
            normalize(b)
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


    for (const token of first) {
        if (second.has(token)) {
            shared++;
        }
    }


    return shared /
        Math.max(
            first.size,
            second.size
        );
}


/* =========================================================
   FUZZY MATCH
========================================================= */

function fuzzyMatch(
    questionText,
    answerText
) {

    const nq =
        normalize(questionText);


    const results =
        fuse.search(
            nq,
            {
                limit: 3
            }
        );


    if (!results.length) {
        return null;
    }


    const best =
        results[0];


    const answerScore =
        answerSimilarity(
            answerText,
            best.item.answer
        );


    /*
     * Fuse score gets converted into an easier
     * "confidence" number:
     *
     * 1 = perfect
     * 0 = bad
     */
    const questionConfidence =
        1 - best.score;


    /*
     * Question wording matters more than answer wording.
     */
    const combinedConfidence =
        (
            questionConfidence * 0.80
        ) +
        (
            answerScore * 0.20
        );


    return {
        question:
            best.item,

        fuseScore:
            best.score,

        answerScore,

        confidence:
            combinedConfidence,

        alternatives:
            results
                .slice(1)
                .map(result => ({
                    code:
                        result.item.question_code,

                    question:
                        result.item.question,

                    score:
                        result.score
                }))
    };
}


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


        const questionText =
            clean(
                row[
                    profile.questionColumn
                ]
            );


        const answerText =
            clean(
                row[
                    profile.answerColumn
                ]
            );


        if (
            !questionText ||
            !answerText ||
            isRoundLabel(questionText) ||
            looksLikeTime(answerText)
        ) {
            continue;
        }


        const result =
            exactMatch(
                rawCode,
                questionText,
                answerText
            );


        if (!result) {
            continue;
        }


        if (result.type === "id") {
            score += 5;
        }

        else if (
            result.type ===
            "question_answer"
        ) {
            score += 3;
        }

        else {
            score += 2;
        }
    }


    return score;
}


function detectProfile(rows) {

    return profiles
        .map(profile => ({
            profile,
            score:
                scoreProfile(
                    rows,
                    profile
                )
        }))
        .sort(
            (a, b) =>
                b.score - a.score
        )[0]
        .profile;
}


/* =========================================================
   WORKBOOK
========================================================= */

const workbook =
    XLSX.readFile(
        workbookPath,
        {
            cellDates: true
        }
    );


/* =========================================================
   RESULTS
========================================================= */

let exact = 0;

let strongFuzzy = 0;

let possibleFuzzy = 0;

let unmatched = 0;


const strongExamples = [];
const possibleExamples = [];
const unmatchedExamples = [];


/* =========================================================
   SCAN
========================================================= */

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
        workbook.Sheets[sheetName];


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
        detectProfile(rows);


    for (
        let index = 0;
        index < rows.length;
        index++
    ) {

        const row =
            rows[index];


        const code =
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


        if (
            question.toLowerCase() ===
                "questions" &&
            answer.toLowerCase() ===
                "answers"
        ) {
            continue;
        }


        /*
         * Already solved by exact matching.
         */
        const exactResult =
            exactMatch(
                code,
                question,
                answer
            );


        if (exactResult) {
            exact++;
            continue;
        }


        /*
         * Try fuzzy match.
         */
        const result =
            fuzzyMatch(
                question,
                answer
            );


        if (!result) {

            unmatched++;


            if (
                unmatchedExamples.length < 15
            ) {
                unmatchedExamples.push({
                    sheetName,
                    row: index + 1,
                    question,
                    answer
                });
            }

            continue;
        }


        /*
         * VERY LIKELY SAME QUESTION
         */
        if (
            result.fuseScore <=
                STRONG_THRESHOLD &&
            result.confidence >=
                0.80
        ) {

            strongFuzzy++;


            if (
                strongExamples.length < 15
            ) {
                strongExamples.push({
                    sheetName,

                    original:
                        question,

                    matched:
                        result.question.question,

                    code:
                        result.question.question_code,

                    fuseScore:
                        result.fuseScore,

                    answerScore:
                        result.answerScore,

                    confidence:
                        result.confidence
                });
            }

            continue;
        }


        /*
         * MAYBE SAME QUESTION
         */
        if (
            result.fuseScore <=
                POSSIBLE_THRESHOLD
        ) {

            possibleFuzzy++;


            if (
                possibleExamples.length < 20
            ) {
                possibleExamples.push({
                    sheetName,

                    original:
                        question,

                    answer,

                    matched:
                        result.question.question,

                    matchedAnswer:
                        result.question.answer,

                    code:
                        result.question.question_code,

                    fuseScore:
                        result.fuseScore,

                    answerScore:
                        result.answerScore,

                    confidence:
                        result.confidence
                });
            }

            continue;
        }


        unmatched++;

    }
}


/* =========================================================
   REPORT
========================================================= */

console.log("");
console.log("FUZZY HISTORY REPORT");
console.log("--------------------------------");
console.log("");

console.log(
    `Exact matches:          ${exact}`
);

console.log(
    `Strong fuzzy matches:   ${strongFuzzy}`
);

console.log(
    `Possible fuzzy matches: ${possibleFuzzy}`
);

console.log(
    `Still unmatched:        ${unmatched}`
);


console.log("");
console.log("STRONG FUZZY EXAMPLES");
console.log("--------------------------------");


for (
    const item
    of strongExamples
) {

    console.log("");

    console.log(
        `${item.sheetName}`
    );

    console.log(
        `OLD: ${item.original}`
    );

    console.log(
        `NEW: ${item.matched}`
    );

    console.log(
        `ID: ${item.code || "-"}`
    );

    console.log(
        `Confidence: ${
            (
                item.confidence *
                100
            ).toFixed(1)
        }%`
    );
}


console.log("");
console.log("POSSIBLE MATCH EXAMPLES");
console.log("--------------------------------");


for (
    const item
    of possibleExamples
) {

    console.log("");

    console.log(
        `${item.sheetName}`
    );

    console.log(
        `OLD Q: ${item.original}`
    );

    console.log(
        `OLD A: ${item.answer}`
    );

    console.log(
        `NEW Q: ${item.matched}`
    );

    console.log(
        `NEW A: ${item.matchedAnswer}`
    );

    console.log(
        `ID: ${item.code || "-"}`
    );

    console.log(
        `Confidence: ${
            (
                item.confidence *
                100
            ).toFixed(1)
        }%`
    );
}


console.log("");
console.log("STILL UNMATCHED EXAMPLES");
console.log("--------------------------------");


for (
    const item
    of unmatchedExamples
) {

    console.log("");

    console.log(
        `${item.sheetName} / row ${item.row}`
    );

    console.log(
        `Q: ${item.question}`
    );

    console.log(
        `A: ${item.answer}`
    );
}


console.log("");