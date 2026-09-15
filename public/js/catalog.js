const selectAll = document.getElementById("catalog-select-all");
const rowCheckboxes = Array.from(document.querySelectorAll(".catalog-row-checkbox"));

if (selectAll) {
    selectAll.addEventListener("change", () => {
        for (const checkbox of rowCheckboxes) {
            checkbox.checked = selectAll.checked;
        }
    });
}
