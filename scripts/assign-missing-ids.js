const db = require("../db/database");


/* =========================================================
   SETTINGS
========================================================= */

const PREFIX = "Q";
const WIDTH = 5;


/* =========================================================
   FIND HIGHEST EXISTING QUESTION NUMBER
========================================================= */

const existing = db.prepare(`
    SELECT question_code
    FROM questions
    WHERE question_code IS NOT NULL
`).all();


let highestNumber = 0;


for (const row of existing) {

    const match =
        String(row.question_code)
            .toUpperCase()
            .match(/^Q(\d+)$/);


    if (!match) {
        continue;
    }


    const number =
        Number.parseInt(
            match[1],
            10
        );


    if (
        !Number.isNaN(number) &&
        number > highestNumber
    ) {

        highestNumber = number;
    }
}


/* =========================================================
   FIND QUESTIONS WITHOUT IDs
========================================================= */

const missing = db.prepare(`
    SELECT
        id,
        question
    FROM questions
    WHERE
        question_code IS NULL
        OR TRIM(question_code) = ''
    ORDER BY id
`).all();


console.log("");
console.log("ASSIGN MISSING QUESTION IDs");
console.log("--------------------------------");

console.log(
    `Highest existing ID: ${PREFIX}${String(highestNumber).padStart(WIDTH, "0")}`
);

console.log(
    `Missing IDs:         ${missing.length}`
);

console.log("");


/* =========================================================
   UPDATE
========================================================= */

const update = db.prepare(`
    UPDATE questions
    SET question_code = @question_code
    WHERE id = @id
`);


const assignIds = db.transaction(() => {

    let nextNumber =
        highestNumber + 1;


    for (const question of missing) {

        const code =
            `${PREFIX}${String(nextNumber).padStart(WIDTH, "0")}`;


        update.run({
            id:
                question.id,

            question_code:
                code
        });


        console.log(
            `${code}  ${question.question}`
        );


        nextNumber++;
    }
});


assignIds();


console.log("");
console.log(
    `Assigned ${missing.length} IDs.`
);

console.log("");