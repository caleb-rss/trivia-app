const db = require("../db/database");


/* =========================================================
   SETTINGS
========================================================= */

const PREFIX = "Q";
const WIDTH = 5;


/* =========================================================
   LOAD ALL QUESTIONS
========================================================= */

const questions = db.prepare(`
    SELECT
        id,
        question_code,
        question
    FROM questions
    ORDER BY id
`).all();


/* =========================================================
   HELPERS
========================================================= */

function parseQuestionNumber(code) {
    if (!code) {
        return null;
    }

    const match = String(code)
        .trim()
        .toUpperCase()
        .match(/^Q(\d+)$/);

    if (!match) {
        return null;
    }

    const number =
        Number.parseInt(
            match[1],
            10
        );

    return Number.isNaN(number)
        ? null
        : number;
}


function formatQuestionCode(number) {
    return (
        PREFIX +
        String(number).padStart(
            WIDTH,
            "0"
        )
    );
}


/* =========================================================
   PASS 1
   FIND HIGHEST EXISTING NUMERIC ID
========================================================= */

let highestNumber = 0;

for (const question of questions) {
    const number =
        parseQuestionNumber(
            question.question_code
        );

    if (
        number !== null &&
        number > highestNumber
    ) {
        highestNumber = number;
    }
}


/* =========================================================
   REPORT
========================================================= */

const validExisting =
    questions.filter(
        q =>
            parseQuestionNumber(
                q.question_code
            ) !== null
    );

const missing =
    questions.filter(
        q =>
            !q.question_code ||
            !String(
                q.question_code
            ).trim()
    );

const invalid =
    questions.filter(
        q =>
            q.question_code &&
            parseQuestionNumber(
                q.question_code
            ) === null
    );


console.log("");
console.log("NORMALIZE QUESTION IDs");
console.log("--------------------------------");
console.log(
    `Total questions:       ${questions.length}`
);
console.log(
    `Valid existing IDs:    ${validExisting.length}`
);
console.log(
    `Missing IDs:           ${missing.length}`
);
console.log(
    `Invalid IDs:           ${invalid.length}`
);
console.log(
    `Highest numeric ID:    ${highestNumber}`
);
console.log("");


/* =========================================================
   PREPARE UPDATE
========================================================= */

const updateQuestionCode =
    db.prepare(`
        UPDATE questions
        SET question_code = @question_code
        WHERE id = @id
    `);


/* =========================================================
   NORMALIZE
========================================================= */

const normalizeIds =
    db.transaction(() => {

        /*
         * First normalize every valid existing Q-number.
         *
         * Example:
         * Q1007 -> Q01007
         */
        for (
            const question
            of validExisting
        ) {
            const number =
                parseQuestionNumber(
                    question.question_code
                );

            const normalizedCode =
                formatQuestionCode(
                    number
                );

            if (
                normalizedCode !==
                question.question_code
            ) {
                updateQuestionCode.run({
                    id:
                        question.id,

                    question_code:
                        normalizedCode
                });

                console.log(
                    `${question.question_code} -> ${normalizedCode}`
                );
            }
        }


        /*
         * Then assign new IDs to missing values,
         * starting after the highest existing number.
         */
        let nextNumber =
            highestNumber + 1;

        for (
            const question
            of missing
        ) {
            const newCode =
                formatQuestionCode(
                    nextNumber
                );

            updateQuestionCode.run({
                id:
                    question.id,

                question_code:
                    newCode
            });

            console.log(
                `[NEW] ${newCode}  ${question.question}`
            );

            nextNumber++;
        }
    });


normalizeIds();


/* =========================================================
   FINAL CHECK
========================================================= */

const finalMissing =
    db.prepare(`
        SELECT COUNT(*) AS count
        FROM questions
        WHERE
            question_code IS NULL
            OR TRIM(question_code) = ''
    `)
    .get();


const finalDuplicates =
    db.prepare(`
        SELECT
            question_code,
            COUNT(*) AS count
        FROM questions
        WHERE question_code IS NOT NULL
        GROUP BY question_code
        HAVING COUNT(*) > 1
    `)
    .all();


console.log("");
console.log("DONE");
console.log("--------------------------------");
console.log(
    `Missing IDs remaining: ${finalMissing.count}`
);
console.log(
    `Duplicate IDs:         ${finalDuplicates.length}`
);

if (finalDuplicates.length) {
    console.log("");
    console.log(
        "Duplicate codes found:"
    );

    console.table(
        finalDuplicates
    );
}

console.log("");