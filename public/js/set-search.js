const searchInput =
    document.getElementById(
        "set-question-search-input"
    );


const results =
    document.getElementById(
        "set-question-search-results"
    );


const wrapper =
    document.querySelector(
        ".set-question-search"
    );


if (
    searchInput &&
    results &&
    wrapper
) {

    const setId =
        wrapper.dataset.setId;


    let timer = null;


    function escapeHtml(value) {

        return String(value)
            .replaceAll(
                "&",
                "&amp;"
            )
            .replaceAll(
                "<",
                "&lt;"
            )
            .replaceAll(
                ">",
                "&gt;"
            )
            .replaceAll(
                '"',
                "&quot;"
            )
            .replaceAll(
                "'",
                "&#039;"
            );
    }


    async function searchQuestions(
        query
    ) {

        const response =
            await fetch(
                `/questions/search?q=${encodeURIComponent(query)}`
            );


        if (!response.ok) {
            throw new Error(
                "Question search failed."
            );
        }


        return response.json();
    }


    function renderResults(
        questions
    ) {

        if (
            !questions.length
        ) {

            results.innerHTML =
                `<p class="muted search-empty">no matches</p>`;

            return;
        }


        results.innerHTML =
            questions.map(
                question => `
                    <article
                        class="set-search-result"
                    >

                        <div
                            class="question-row-top"
                        >

                            <span
                                class="question-code"
                            >
                                ${escapeHtml(
                                    question.question_code
                                )}
                            </span>

                            <span
                                class="question-topic"
                            >
                                ${escapeHtml(
                                    question.topic ||
                                    "[no topic]"
                                )}
                            </span>

                        </div>


                        <p
                            class="question-text"
                        >
                            ${escapeHtml(
                                question.question
                            )}
                        </p>


                        <p
                            class="question-answer"
                        >
                            → ${escapeHtml(
                                question.answer
                            )}
                        </p>


                        <form
                            method="POST"
                            action="/sets/${setId}/questions/add"
                        >

                            <input
                                type="hidden"
                                name="question_code"
                                value="${escapeHtml(
                                    question.question_code
                                )}"
                            >

                            <button
                                type="submit"
                                class="add-search-question"
                            >
                                [add]
                            </button>

                        </form>

                    </article>
                `
            ).join("");
    }


    searchInput.addEventListener(
        "input",
        () => {

            clearTimeout(
                timer
            );


            const query =
                searchInput.value
                    .trim();


            if (
                query.length < 2
            ) {

                results.innerHTML =
                    "";

                return;
            }


            timer =
                setTimeout(
                    async () => {

                        try {

                            const questions =
                                await searchQuestions(
                                    query
                                );


                            renderResults(
                                questions
                            );

                        } catch (error) {

                            console.error(
                                error
                            );


                            results.innerHTML =
                                `<p class="muted search-empty">search error</p>`;
                        }
                    },
                    250
                );
        }
    );
}