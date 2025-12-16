(function () {
    const vscode = acquireVsCodeApi();
    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            console.log("Sign Out button clicked.");
            try {
                vscode.postMessage({
                    command: "triggerCommand",
                    payload: { commandId: "testbenchExtension.logout" }
                });
            } catch (e) {
                console.error("Failed to send logout command:", e);
            }
        });
    }
})();
