const list =
    document.getElementById(
        "set-question-list"
    );


const status =
    document.getElementById(
        "reorder-status"
    );


if (
    list &&
    list.dataset.editable ===
        "true"
) {

    const setId =
        list.dataset.setId;


    function updatePositionLabels() {

        const rows =
            list.querySelectorAll(
                ".set-question-row"
            );


        rows.forEach(
            (row, index) => {

                const label =
                    row.querySelector(
                        ".set-position"
                    );


                if (label) {

                    label.textContent =
                        String(
                            index + 1
                        ).padStart(
                            2,
                            "0"
                        );
                }
            }
        );
    }


    async function saveOrder() {

        const rows =
            Array.from(
                list.querySelectorAll(
                    ".set-question-row"
                )
            );


        const order =
            rows.map(
                row =>
                    Number(
                        row.dataset
                            .setQuestionId
                    )
            );


        status.textContent =
            "saving order...";


        try {

            const response =
                await fetch(
                    `/sets/${setId}/reorder`,
                    {
                        method:
                            "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                order
                            })
                    }
                );


            if (!response.ok) {

                const result =
                    await response.json();

                throw new Error(
                    result.error ||
                    "Unable to save order."
                );
            }


            status.textContent =
                "order saved";


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
        }
    }


    Sortable.create(
        list,
        {
            animation: 120,

            handle:
                ".drag-handle",

            ghostClass:
                "drag-ghost",

            chosenClass:
                "drag-chosen",

            delayOnTouchOnly:
                true,

            delay:
                120,

            onEnd() {

                updatePositionLabels();

                saveOrder();
            }
        }
    );
}