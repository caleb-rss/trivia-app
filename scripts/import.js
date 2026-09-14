const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const db = require("../db/database");

const {
    normalizeQuestionCode
} = require("../utils/question-code");


/* =========================================================
   SOURCE FILE
========================================================= */

const csvPath = path.join(
    __dirname,
    "..",
    "data",
    "source",
    "Claud's Trivia - Question Bank.csv"
);


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


function parseInteger(value) {
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

    return Number.isNaN(number)
        ? null
        : number;
}


/* =========================================================
   READ CSV
========================================================= */

console.log("");
console.log("CLAUD'S TRIVIA IMPORTER");
console.log("-----------------------");
console.log("");

console.log("Reading question bank...");


const csv = fs.readFileSync(
    csvPath,
    "utf8"
);


const rows = parse(
    csv,
    {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        bom: true
    }
);


console.log(
    `Source rows: ${rows.length}`
);

console.log("");


/* =========================================================
   INSERT
========================================================= */

const insertQuestion = db.prepare(`
    INSERT INTO questions (
        question_code,
        format,
        topic,
        difficulty,
        question,
        answer,
        notes,
        enabled,
        needs_review,
        legacy_last_used,
        legacy_freshness_weeks
    )
    VALUES (
        @question_code,
        @format,
        @topic,
        @difficulty,
        @question,
        @answer,
        @notes,
        1,
        @needs_review,
        @legacy_last_used,
        @legacy_freshness_weeks
    )
`);


/* =========================================================
   IMPORT
========================================================= */

let imported = 0;
let skipped = 0;
let review = 0;
let duplicateCodes = 0;


const importQuestions =
    db.transaction(() => {

        db.prepare(`
            DELETE FROM questions
        `).run();


        for (const row of rows) {

            const questionCode =
                normalizeQuestionCode(
                    row.ID
                );


            const format =
                clean(
                    row.Format
                );


            const topic =
                clean(
                    row.Topic
                );


            const difficulty =
                parseInteger(
                    row.Difficulty
                );


            const question =
                clean(
                    row.Question
                );


            const answer =
                clean(
                    row.Answer
                );


            /*
             * Skip rows that aren't usable questions.
             */
            if (
                !question ||
                !answer
            ) {
                skipped++;
                continue;
            }


            const needsReview =
                !questionCode ||
                !format ||
                !topic ||
                difficulty === null
                    ? 1
                    : 0;


            if (needsReview) {
                review++;
            }


            try {

                insertQuestion.run({
                    question_code:
                        questionCode,

                    format,

                    topic,

                    difficulty,

                    question,

                    answer,

                    notes:
                        null,

                    needs_review:
                        needsReview,

                    legacy_last_used:
                        clean(
                            row.Used
                        ),

                    legacy_freshness_weeks:
                        parseInteger(
                            row.Freshness
                        )
                });


                imported++;

            } catch (error) {

                if (
                    error.code ===
                    "SQLITE_CONSTRAINT_UNIQUE"
                ) {

                    duplicateCodes++;

                    console.warn(
                        `Duplicate ID skipped: ${questionCode}`
                    );

                    continue;
                }


                throw error;
            }
        }
    });


importQuestions();


/* =========================================================
   REPORT
========================================================= */

const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM questions
`).get();


const byTopic = db.prepare(`
    SELECT
        COALESCE(
            topic,
            '[missing]'
        ) AS topic,

        COUNT(*) AS count

    FROM questions

    GROUP BY topic

    ORDER BY count DESC

    LIMIT 10
`).all();


console.log("IMPORT COMPLETE");
console.log("-----------------------");

console.log(
    `Imported:       ${imported}`
);

console.log(
    `Needs review:   ${review}`
);

console.log(
    `Skipped:        ${skipped}`
);

console.log(
    `Duplicate IDs:  ${duplicateCodes}`
);

console.log("");

console.log(
    `Database total: ${total.count}`
);

console.log("");
console.log("TOP TOPICS");
console.log("-----------------------");


for (const topic of byTopic) {

    console.log(
        `${String(topic.count).padStart(4)}  ${topic.topic}`
    );
}


console.log("");