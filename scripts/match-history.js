const path = require("path");
const XLSX = require("xlsx");

const db = require("../db/database");

const {
    normalizeQuestionCode
} = require("../utils/question-code");


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
   LOAD QUESTIONS
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
    .all();


const byCode =
    new Map();

const byQuestion =
    new Map();

const byQuestionAnswer =
    new Map();


for (const question of questions) {

    const code =
        normalizeQuestionCode(
            question.question_code
        );


    if (code) {
        byCode.set(
            code,
            question
        );
    }


    const nq =
        normalize(
            question.question
        );

    const na =
        normalize(
            question.answer
        );


    if (!byQuestion.has(nq)) {
        byQuestion.set(
            nq,
            []
        );
    }


    byQuestion
        .get(nq)
        .push(question);


    const key =
        `${nq}|||${na}`;


    if (
        !byQuestionAnswer.has(
            key
        )
    ) {

        byQuestionAnswer.set(
            key,
            []
        );
    }


    byQuestionAnswer
        .get(key)
        .push(question);
}


/* =========================================================
   PROFILES
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
   EXACT MATCH
========================================================= */

function exactMatch(
    rawCode,
    question,
    answer
) {

    const code =
        normalizeQuestionCode(
            rawCode
        );


    if (
        code &&
        byCode.has(code)
    ) {

        return "id";
    }


    const nq =
        normalize(question);

    const na =
        normalize(answer);


    const qa =
        byQuestionAnswer.get(
            `${nq}|||${na}`
        );


    if (
        qa &&
        qa.length === 1
    ) {

        return "question_answer";
    }


    const q =
        byQuestion.get(nq);


    if (
        q &&
        q.length === 1
    ) {

        return "question";
    }


    return null;
}


/* =========================================================
   PROFILE DETECTION
========================================================= */

function detectProfile(rows) {

    const scored =
        profiles.map(
            profile => {

                let score = 0;


                for (
                    const row
                    of rows
                ) {

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
                        isRoundLabel(
                            question
                        ) ||
                        looksLikeTime(
                            answer
                        )
                    ) {
                        continue;
                    }


                    const type =
                        exactMatch(
                            rawCode,
                            question,
                            answer
                        );


                    if (
                        type === "id"
                    ) {
                        score += 5;
                    }

                    else if (
                        type ===
                        "question_answer"
                    ) {
                        score += 3;
                    }

                    else if (
                        type ===
                        "question"
                    ) {
                        score += 2;
                    }
                }


                return {
                    profile,
                    score
                };
            }
        );


    scored.sort(
        (a, b) =>
            b.score - a.score
    );


    return scored[0];
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


let total = 0;

let matchedById = 0;
let matchedByQuestionAnswer = 0;
let matchedByQuestion = 0;

let unmatched = 0;


const sheetReports = [];


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


    const rows =
        XLSX.utils.sheet_to_json(
            workbook.Sheets[
                sheetName
            ],
            {
                header: 1,
                defval: null,
                raw: false
            }
        );


    const detected =
        detectProfile(
            rows
        );


    const profile =
        detected.profile;


    let sheetTotal = 0;
    let sheetMatched = 0;


    for (
        const row
        of rows
    ) {

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
            isRoundLabel(
                question
            ) ||
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


        total++;
        sheetTotal++;


        const type =
            exactMatch(
                rawCode,
                question,
                answer
            );


        if (type) {

            sheetMatched++;


            if (
                type === "id"
            ) {
                matchedById++;
            }

            else if (
                type ===
                "question_answer"
            ) {
                matchedByQuestionAnswer++;
            }

            else {
                matchedByQuestion++;
            }

        } else {
            unmatched++;
        }
    }


    sheetReports.push({
        sheetName,

        profile:
            profile.name,

        score:
            detected.score,

        total:
            sheetTotal,

        matched:
            sheetMatched
    });
}


/* =========================================================
   REPORT
========================================================= */

const matched =
    matchedById +
    matchedByQuestionAnswer +
    matchedByQuestion;


console.log("");
console.log("HISTORY MATCH REPORT");
console.log("--------------------------------");

console.log(
    `Historical rows:          ${total}`
);

console.log(
    `Matched by ID:            ${matchedById}`
);

console.log(
    `Matched question+answer:  ${matchedByQuestionAnswer}`
);

console.log(
    `Matched question only:    ${matchedByQuestion}`
);

console.log(
    `Unmatched:                ${unmatched}`
);

console.log(
    `Match rate:               ${
        total
            ? (
                matched /
                total *
                100
            ).toFixed(1)
            : "0.0"
    }%`
);


console.log("");
console.log("SHEET LAYOUTS");
console.log("--------------------------------");


for (
    const sheet
    of sheetReports
) {

    console.log("");
    console.log(
        sheet.sheetName
    );

    console.log(
        `  layout .... ${sheet.profile}`
    );

    console.log(
        `  score ..... ${sheet.score}`
    );

    console.log(
        `  matched ... ${sheet.matched}/${sheet.total}`
    );
}


console.log("");