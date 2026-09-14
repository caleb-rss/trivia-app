const express = require("express");
const multer = require("multer");
const { parse } = require("csv-parse/sync");

const {
    parsePaste,
    parseCsvRows,
    reviewRows,
    commitImport
} = require("../services/importer");


const router =
    express.Router();


const upload =
    multer({
        storage:
            multer.memoryStorage(),

        limits: {
            fileSize:
                2 * 1024 * 1024
        }
    });


/* =========================================================
   IMPORT FORM
========================================================= */

router.get(
    "/",
    (req, res) => {

        res.render(
            "import",
            {
                result:
                    req.query.imported
                        ? {
                            imported:
                                req.query.imported,

                            firstCode:
                                req.query.first,

                            lastCode:
                                req.query.last
                        }
                        : null
            }
        );
    }
);


/* =========================================================
   PASTE PREVIEW
========================================================= */

router.post(
    "/preview-paste",
    (req, res) => {

        const rows =
            parsePaste(
                req.body.bulk_text
            );


        const reviewed =
            reviewRows(
                rows
            );


        res.render(
            "import-preview",
            {
                rows:
                    reviewed,

                source:
                    "paste"
            }
        );
    }
);


/* =========================================================
   CSV PREVIEW
========================================================= */

router.post(
    "/preview-csv",
    upload.single("csv_file"),
    (req, res) => {

        if (!req.file) {

            return res
                .status(400)
                .send(
                    "No CSV file uploaded."
                );
        }


        const text =
            req.file.buffer.toString(
                "utf8"
            );


        const parsed =
            parse(
                text,
                {
                    columns: true,
                    skip_empty_lines: true,
                    relax_column_count: true,
                    bom: true
                }
            );


        const rows =
            parseCsvRows(
                parsed
            );


        const reviewed =
            reviewRows(
                rows
            );


        res.render(
            "import-preview",
            {
                rows:
                    reviewed,

                source:
                    "csv"
            }
        );
    }
);


/* =========================================================
   COMMIT
========================================================= */

router.post(
    "/commit",
    (req, res) => {

        const encoded =
            req.body.rows;


        if (!encoded) {
            return res
                .status(400)
                .send(
                    "No import data supplied."
                );
        }


        let rows;


        try {

            rows =
                JSON.parse(
                    Buffer
                        .from(
                            encoded,
                            "base64"
                        )
                        .toString(
                            "utf8"
                        )
                );

        } catch (error) {

            return res
                .status(400)
                .send(
                    "Import payload could not be decoded."
                );
        }


        /*
         * Browser checkbox controls which rows
         * actually get committed.
         */
        const selectedIndexes =
            Array.isArray(
                req.body.include
            )
                ? req.body.include

                : req.body.include
                    ? [
                        req.body.include
                    ]
                    : [];


        const selectedSet =
            new Set(
                selectedIndexes.map(
                    Number
                )
            );


        const selectedRows =
            rows.filter(
                (row, index) =>
                    selectedSet.has(
                        index
                    )
            );


        const result =
            commitImport(
                selectedRows
            );


        const params =
            new URLSearchParams({
                imported:
                    String(
                        result.imported
                    ),

                first:
                    result.firstCode ||
                    "",

                last:
                    result.lastCode ||
                    ""
            });


        res.redirect(
            `/import?${params.toString()}`
        );
    }
);


module.exports =
    router;
