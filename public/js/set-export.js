const copyButton =
    document.getElementById(
        "copy-set-qa"
    );


if (copyButton) {

    copyButton.addEventListener(
        "click",
        async () => {

            const rows =
                document.querySelectorAll(
                    ".set-question-row"
                );


            const output =
                Array.from(rows)
                    .map(row => {

                        const question =
                            row.querySelector(
                                ".question-text"
                            )
                            ?.textContent
                            .trim() || "";


                        let answer =
                            row.querySelector(
                                ".question-answer"
                            )
                            ?.textContent
                            .trim() || "";


                        /*
                         * Remove the visual arrow.
                         */
                        answer =
                            answer.replace(
                                /^→\s*/,
                                ""
                            );


                        /*
                         * Tabs/newlines inside a question
                         * would break spreadsheet columns.
                         */
                        const cleanQuestion =
                            question.replace(
                                /[\t\r\n]+/g,
                                " "
                            );


                        const cleanAnswer =
                            answer.replace(
                                /[\t\r\n]+/g,
                                " "
                            );


                        return (
                            cleanQuestion +
                            "\t" +
                            cleanAnswer
                        );
                    })
                    .join("\n");


            try {

                await navigator
                    .clipboard
                    .writeText(
                        output
                    );


                const original =
                    copyButton.textContent;


                copyButton.textContent =
                    "[ COPIED ]";


                setTimeout(
                    () => {

                        copyButton.textContent =
                            original;

                    },
                    1200
                );

            } catch (error) {

                console.error(
                    "Clipboard copy failed:",
                    error
                );


                copyButton.textContent =
                    "[ COPY FAILED ]";
            }
        }
    );
}