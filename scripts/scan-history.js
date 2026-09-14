const path = require("path");
const XLSX = require("xlsx");


/* =========================================================
   SOURCE WORKBOOK
   ========================================================= */

const workbookPath = path.join(
    __dirname,
    "..",
    "data",
    "source",
    "ct.xlsx"
);


/* =========================================================
   SHEETS WE DO NOT WANT TO TREAT AS HISTORY
   ========================================================= */

const ignoredSheets = new Set([
    "Table of Contents",
    "Question Bank",
    "Trivia-o-matic (BETA)",
    "Full Format"
]);


/* =========================================================
   SHEET PROFILES

   These describe where question data lives in each style
   of historical sheet.

   Column numbers here are zero-based:

   A = 0
   B = 1
   C = 2
   D = 3
   E = 4
   ========================================================= */

function getSheetProfile(sheetName) {

    /*
     * Modern dated sheets:
     *
     * C = question ID
     * D = question
     * E = answer
     */
    if (!sheetName.startsWith("Questions Only")) {
        return {
            codeColumn: 2,
            questionColumn: 3,
            answerColumn: 4
        };
    }


    /*
     * August 2025 is a simple two-column sheet.
     */
    if (sheetName === "Questions Only August") {
        return {
            codeColumn: null,
            questionColumn: 0,
            answerColumn: 1
        };
    }


    /*
     * October 2025 shifted one column to the right.
     */
    if (sheetName === "Questions Only Oct") {
        return {
            codeColumn: null,
            questionColumn: 3,
            answerColumn: 4
        };
    }


    /*
     * Sept / Nov / Dec:
     *
     * C = question
     * D = answer
     */
    return {
        codeColumn: null,
        questionColumn: 2,
        answerColumn: 3
    };
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


function formatDate(year, month, day) {

    return [
        year,
        String(month).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}


function parseSheetDate(sheetName) {

    /*
     * Examples:
     *
     * Sept 8 26
     * Sep 1 26
     * Aug 11 26
     * July 14 26
     */
    const datedMatch = sheetName.match(
        /^([A-Za-z]+)\s+(\d{1,2})\s+(\d{2})$/
    );


    if (datedMatch) {

        const monthName =
            datedMatch[1].toLowerCase();

        const day =
            Number(datedMatch[2]);

        const shortYear =
            Number(datedMatch[3]);

        const month =
            monthNumbers[monthName];


        if (!month) {
            return null;
        }


        const year =
            2000 + shortYear;


        return formatDate(
            year,
            month,
            day
        );
    }


    /*
     * The "Questions Only" tabs appear to be the
     * Aug-Dec 2025 history immediately preceding
     * the January 2026 sheets.
     *
     * Since these don't include an exact day,
     * we'll preserve the month but leave played_at
     * unresolved for now.
     */
    const oldMatch = sheetName.match(
        /^Questions Only\s+(.+)$/
    );


    if (oldMatch) {

        const monthName =
            oldMatch[1].toLowerCase();

        const month =
            monthNumbers[monthName];


        if (!month) {
            return null;
        }


        return {
            year: 2025,
            month,
            day: null,
            exact: false
        };
    }


    return null;
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


function isQuestionCode(value) {

    if (!value) {
        return false;
    }


    return /^Q\d+$/i.test(
        value
    );
}


function isRoundLabel(value) {

    if (!value) {
        return false;
    }


    return /^round\s+\d+/i.test(
        value
    );
}


function isTieBreaker(value) {

    if (!value) {
        return false;
    }


    return String(value)
        .trim()
        .toUpperCase() === "TIE";
}


/* =========================================================
   LOAD WORKBOOK
   ========================================================= */

console.log("");
console.log("TRIVIA HISTORY SCANNER");
console.log("------------------------------");
console.log("");

console.log("Reading workbook...");

const workbook =
    XLSX.readFile(
        workbookPath,
        {
            cellDates: true
        }
    );


/* =========================================================
   SCAN
   ========================================================= */

const report = [];

let totalCandidateQuestions = 0;
let totalTieBreakers = 0;
let totalSkippedRows = 0;


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
        getSheetProfile(
            sheetName
        );


    const parsedDate =
        parseSheetDate(
            sheetName
        );


    const candidates = [];

    let tieBreakers = 0;
    let skippedRows = 0;


    rows.forEach(
        (row, index) => {

            const sourceRow =
                index + 1;


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


            /*
             * Ignore completely empty rows.
             */
            if (
                !question &&
                !answer
            ) {

                skippedRows++;
                return;
            }


            /*
             * Ignore section labels such as:
             *
             * Round 1
             * Round 2
             */
            if (
                isRoundLabel(
                    question
                )
            ) {

                skippedRows++;
                return;
            }


            /*
             * "Questions Only August" has:
             *
             * Questions | Answers
             */
            if (
                question
                    ?.toLowerCase() ===
                    "questions" &&
                answer
                    ?.toLowerCase() ===
                    "answers"
            ) {

                skippedRows++;
                return;
            }


            /*
             * Modern sheets identify tie-breakers with
             * TIE in the ID/timing column.
             *
             * We'll count these separately for now.
             */
            if (
                isTieBreaker(
                    rawCode
                )
            ) {

                tieBreakers++;
                return;
            }


            /*
             * A historical trivia question needs both
             * a question and an answer.
             */
            if (
                !question ||
                !answer
            ) {

                skippedRows++;
                return;
            }


            candidates.push({
                sourceSheet:
                    sheetName,

                sourceRow,

                questionCode:
                    isQuestionCode(
                        rawCode
                    )
                        ? rawCode.toUpperCase()
                        : null,

                question,

                answer
            });
        }
    );


    totalCandidateQuestions +=
        candidates.length;

    totalTieBreakers +=
        tieBreakers;

    totalSkippedRows +=
        skippedRows;


    report.push({
        sheetName,

        parsedDate,

        questions:
            candidates.length,

        withQuestionCode:
            candidates.filter(
                q =>
                    q.questionCode
            ).length,

        tieBreakers,

        skippedRows,

        sample:
            candidates.slice(
                0,
                2
            )
    });
}


/* =========================================================
   OUTPUT
   ========================================================= */

console.log("");
console.log("SHEETS");
console.log("------------------------------");


for (
    const result
    of report
) {

    const dateDescription =
        typeof result.parsedDate ===
        "string"
            ? result.parsedDate

            : result.parsedDate
                ? `${result.parsedDate.year}-${String(
                    result.parsedDate.month
                ).padStart(2, "0")}-??`

                : "[unknown]";


    console.log("");

    console.log(
        result.sheetName
    );

    console.log(
        `  date ........... ${dateDescription}`
    );

    console.log(
        `  questions ...... ${result.questions}`
    );

    console.log(
        `  IDs present .... ${result.withQuestionCode}`
    );

    console.log(
        `  tie breakers ... ${result.tieBreakers}`
    );

    console.log(
        `  skipped rows ... ${result.skippedRows}`
    );


    if (
        result.sample.length
    ) {

        console.log(
            `  sample ......... ${result.sample[0].question}`
        );
    }
}


console.log("");
console.log("");
console.log("SUMMARY");
console.log("------------------------------");

console.log(
    `History sheets:       ${report.length}`
);

console.log(
    `Candidate questions: ${totalCandidateQuestions}`
);

console.log(
    `Tie breakers:        ${totalTieBreakers}`
);

console.log(
    `Skipped rows:        ${totalSkippedRows}`
);

console.log("");