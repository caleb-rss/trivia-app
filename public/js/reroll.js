const questions =
    document.querySelectorAll(
        ".generated-question"
    );


function getCurrentQuestionIds() {
    return Array.from(
        document.querySelectorAll(
            ".question-id-input"
        )
    ).map(
        input =>
            Number(input.value)
    );
}


questions.forEach((row) => {

    const button =
        row.querySelector(
            ".reroll-button"
        );

    const status =
        row.querySelector(
            ".reroll-status"
        );


    button.addEventListener(
        "click",
        async () => {

            button.disabled =
                true;

            status.textContent =
                "finding replacement...";


            const excludeIds =
                getCurrentQuestionIds();


            try {

                const response =
                    await fetch(
                        "/generate/reroll",
                        {
                            method:
                                "POST",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    minWeeks:
                                        window
                                            .generatorSettings
                                            .minWeeks,

                                    topic:
                                        window
                                            .generatorSettings
                                            .topic,
                                            
                                    balanceTopics:
                                        window
                                            .generatorSettings
                                            .balanceTopics,

                                    preferUnused:
                                        window
                                            .generatorSettings
                                            .preferUnused,

                                    excludeIds
                                })
                        }
                    );


                if (!response.ok) {

                    const result =
                        await response.json();

                    throw new Error(
                        result.error ||
                        "Unable to reroll."
                    );
                }


                const replacement =
                    await response.json();


                /*
                 * Update the hidden form value.
                 */
                row.querySelector(
                    ".question-id-input"
                ).value =
                    replacement.id;


                row.dataset.questionId =
                    replacement.id;


                /*
                 * Update visible content.
                 */
                row.querySelector(
                    ".code-value"
                ).textContent =
                    replacement.question_code;


                row.querySelector(
                    ".question-topic"
                ).textContent =
                    replacement.topic ||
                    "[no topic]";


                row.querySelector(
                    ".question-text"
                ).textContent =
                    replacement.question;


                row.querySelector(
                    ".question-answer"
                ).textContent =
                    `→ ${replacement.answer}`;


                row.querySelector(
                    ".difficulty"
                ).textContent =
                    `difficulty: ${
                        replacement.difficulty ??
                        "-"
                    }`;


                row.querySelector(
                    ".times-used"
                ).textContent =
                    `used: ${replacement.times_used}`;


                row.querySelector(
                    ".last-used"
                ).textContent =
                    `last: ${
                        replacement.last_used ||
                        "never"
                    }`;


                status.textContent =
                    "replaced";


                setTimeout(
                    () => {
                        status.textContent =
                            "";
                    },
                    1200
                );

            } catch (error) {

                console.error(
                    error
                );

                status.textContent =
                    error.message;

            } finally {

                button.disabled =
                    false;
            }
        }
    );
});