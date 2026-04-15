(function () {
    const vscode = acquireVsCodeApi();
    const connectionsListEl = document.getElementById("connectionsList");
    const noConnectionsMessageEl = document.getElementById("noConnectionsMessage");
    const connectionsLoadingMessageEl = document.getElementById("connectionsLoadingMessage");
    const messagesEl = document.getElementById("messages");
    const cancelEditBtn = document.getElementById("cancelEditBtn");
    const editActionsDiv = document.getElementById("editActions");
    const sectionTitle = document.getElementById("sectionTitle");
    const sectionIcon = document.querySelector(".add-connection-section h3 .icon");
    const saveButtonText = document.getElementById("saveButtonText");
    const connectionSectionEl = document.querySelector(".connection-section");

    let currentEditingConnectionId = null;
    let isEditMode = false;
    let hasStoredPasswordWhileEditing = false;
    let isLoginInProgress = false;
    let loginInProgressConnectionId = null;
    let loginInProgressConnectionLabel = null;
    let latestConnectionPayload = null;

    // Form elements
    const connectionLabelInput = document.getElementById("connectionLabel");
    const serverNameInput = document.getElementById("serverName");
    const portNumberInput = document.getElementById("portNumber");
    const usernameInput = document.getElementById("username");
    const passwordInput = document.getElementById("password");
    const storePasswordCheckbox = document.getElementById("storePasswordCheckbox");
    const saveConnectionBtn = document.getElementById("saveConnectionBtn");
    const addConnectionForm = document.getElementById("addConnectionForm");

    if (
        !connectionsListEl ||
        !saveConnectionBtn ||
        !noConnectionsMessageEl ||
        !messagesEl ||
        !addConnectionForm ||
        !connectionsLoadingMessageEl
    ) {
        console.error("[WebviewScript] Critical UI elements not found. Aborting script setup.");
        return;
    }

    function displayMessage(type, text) {
        messagesEl.textContent = text;
        messagesEl.className = "message-" + type;
        messagesEl.classList.remove("hidden");
        messagesEl.setAttribute("role", type === "error" ? "alert" : "status");

        // Clear message after a delay
        if (type !== "error") {
            setTimeout(() => {
                messagesEl.textContent = "";
                messagesEl.className = "";
                messagesEl.classList.add("hidden");
            }, 7000);
        }
    }

    function updateLoginProgressFeedback() {
        if (connectionSectionEl) {
            connectionSectionEl.setAttribute("aria-busy", isLoginInProgress ? "true" : "false");
        }
    }

    function setLoginState(state) {
        if (!state || typeof state.loginInProgress !== "boolean") {
            return;
        }

        isLoginInProgress = state.loginInProgress;
        loginInProgressConnectionId = state.loginConnectionId || null;
        loginInProgressConnectionLabel = state.loginConnectionLabel || null;

        updateLoginProgressFeedback();

        if (latestConnectionPayload) {
            if (Array.isArray(latestConnectionPayload)) {
                renderConnections(latestConnectionPayload);
                return;
            }

            const payloadWithCurrentLoginState = {
                ...latestConnectionPayload,
                loginInProgress: isLoginInProgress,
                loginConnectionId: loginInProgressConnectionId,
                loginConnectionLabel: loginInProgressConnectionLabel
            };

            renderConnections(payloadWithCurrentLoginState);
        }
    }

    function renderConnections(data) {
        latestConnectionPayload = data;

        let connections, editingConnectionId;
        if (Array.isArray(data)) {
            connections = data;
            editingConnectionId = null;
        } else {
            connections = data.connections || [];
            editingConnectionId = data.editingConnectionId || null;

            if (typeof data.loginInProgress === "boolean") {
                isLoginInProgress = data.loginInProgress;
                loginInProgressConnectionId = data.loginConnectionId || null;
                loginInProgressConnectionLabel = data.loginConnectionLabel || null;
                updateLoginProgressFeedback();
            }
        }

        const isAnyConnectionBeingEdited = editingConnectionId !== null;
        const areActionsBlocked = isAnyConnectionBeingEdited || isLoginInProgress;

        if (connectionsLoadingMessageEl) {
            connectionsLoadingMessageEl.style.display = "none";
        }
        connectionsListEl.innerHTML = "";

        if (!connections || connections.length === 0) {
            if (noConnectionsMessageEl) {
                noConnectionsMessageEl.style.display = "block";
            }
            if (connectionsListEl) {
                connectionsListEl.style.display = "none";
            }
        } else {
            if (noConnectionsMessageEl) {
                noConnectionsMessageEl.style.display = "none";
            }
            if (connectionsListEl) {
                connectionsListEl.style.display = "block";
            }

            // Sort connections alphabetically by label
            const sortedConnections = [...connections].sort((a, b) =>
                a.label.toLowerCase().localeCompare(b.label.toLowerCase())
            );

            sortedConnections.forEach((connection) => {
                const li = document.createElement("li");
                const isBeingEdited = editingConnectionId === connection.id;
                const isLoginTarget = isLoginInProgress && loginInProgressConnectionId === connection.id;

                let loginButtonTitle = "Login with this connection";
                if (isLoginTarget) {
                    loginButtonTitle = "Login in progress";
                } else if (isLoginInProgress) {
                    loginButtonTitle = "Please wait for the current login request to complete";
                } else if (isAnyConnectionBeingEdited) {
                    loginButtonTitle = "Finish editing before login";
                }

                const editButtonTitle = isLoginInProgress
                    ? "Please wait for the current login request to complete"
                    : "Edit this connection";

                let deleteButtonTitle = "Delete this connection";
                if (isLoginInProgress) {
                    deleteButtonTitle = "Please wait for the current login request to complete";
                } else if (isAnyConnectionBeingEdited) {
                    deleteButtonTitle = "Cannot delete while editing";
                }

                // Add visual indication for connection being edited
                if (isBeingEdited) {
                    li.classList.add("connection-being-edited");
                }

                li.setAttribute("tabindex", "0");
                li.setAttribute(
                    "aria-label",
                    `Connection: ${connection.label}, user ${connection.username} at ${connection.serverName}`
                );

                li.innerHTML = `
                <div class="connection-details">
                    <div class="connection-label">
                        ${connection.label}
                        ${isBeingEdited ? '<span class="editing-indicator">(editing)</span>' : ""}
                    </div>
                    <div class="connection-info">${connection.username}@${connection.serverName}:${connection.portNumber}</div>
                </div>
                <div class="connection-actions">
                    <button class="login-btn${isLoginTarget ? " is-loading" : ""}" data-connection-id="${connection.id}" 
                            aria-label="Login with connection ${connection.label}" 
                            title="${loginButtonTitle}"
                            ${areActionsBlocked ? "disabled" : ""}>
                        <span class="icon icon-login"></span>
                        <span class="spinner ${isLoginTarget ? "" : "hidden"}" aria-hidden="true"></span>
                    </button>
                    <button class="edit-btn" data-connection-id="${connection.id}" 
                            aria-label="Edit connection ${connection.label}" 
                            title="${editButtonTitle}"
                            ${isBeingEdited || isLoginInProgress ? "disabled" : ""}
                            style="${isBeingEdited ? "opacity: 0.5; cursor: not-allowed;" : ""}">
                        <span class="icon icon-edit"></span>
                    </button>
                    <button class="delete-btn" data-connection-id="${connection.id}" 
                            aria-label="Delete connection ${connection.label}" 
                            title="${deleteButtonTitle}"
                            ${areActionsBlocked ? "disabled" : ""}
                            style="${areActionsBlocked ? "opacity: 0.3; cursor: not-allowed;" : ""}">
                        <span class="icon icon-delete"></span>
                    </button>
                </div>
                `;
                connectionsListEl.appendChild(li);
            });
        }
    }

    function enterEditMode(connection, hasStoredPassword) {
        console.log("[WebviewScript] Entering edit mode for connection:", connection);
        isEditMode = true;
        currentEditingConnectionId = connection.id;
        hasStoredPasswordWhileEditing = hasStoredPassword;

        // Update UI state
        document.body.classList.add("edit-mode");
        sectionTitle.textContent = "Edit connection";
        if (sectionIcon) {
            sectionIcon.className = "icon icon-edit-connection-header";
        }
        saveButtonText.textContent = "Save Changes";

        // Show cancel button
        editActionsDiv.style.display = "block";

        // Populate form with connection data
        connectionLabelInput.value = connection.label || "";
        serverNameInput.value = connection.serverName || "";
        portNumberInput.value = connection.portNumber || "";
        usernameInput.value = connection.username || "";
        passwordInput.value = ""; // Don't pre-fill password for security

        if (hasStoredPassword) {
            passwordInput.placeholder = "Leave empty to keep stored password";
        } else {
            passwordInput.placeholder = "Enter your password";
        }

        // Update checkbox state
        storePasswordCheckbox.checked = true;

        // Focus on the label field
        connectionLabelInput.focus();

        displayMessage("info", `Editing connection: ${connection.label}`);
    }

    function exitEditMode() {
        console.log("[WebviewScript] Exiting edit mode");
        isEditMode = false;
        currentEditingConnectionId = null;
        hasStoredPasswordWhileEditing = false;

        // Reset UI state
        document.body.classList.remove("edit-mode");
        sectionTitle.textContent = "Add New Connection";
        if (sectionIcon) {
            sectionIcon.className = "icon icon-add-connection-header";
        }
        saveButtonText.textContent = "Save New Connection";

        // Hide cancel button
        editActionsDiv.style.display = "none";

        // Clear and reset form
        addConnectionForm.reset();
        passwordInput.placeholder = "Enter your password";
        portNumberInput.value = "9443"; // Reset default port
        storePasswordCheckbox.checked = true; // Reset default
    }

    function handleSaveConnection() {
        if (!serverNameInput.value.trim() || !portNumberInput.value.trim() || !usernameInput.value.trim()) {
            displayMessage("error", "Server, Port, and Username are required fields.");
            if (!serverNameInput.value.trim()) {
                serverNameInput.focus();
            } else if (!portNumberInput.value.trim()) {
                portNumberInput.focus();
            } else if (!usernameInput.value.trim()) {
                usernameInput.focus();
            }
            return;
        }
        if (isNaN(parseInt(portNumberInput.value, 10))) {
            displayMessage("error", "Port must be a valid number.");
            portNumberInput.focus();
            return;
        }

        const payload = {
            label: connectionLabelInput.value.trim() || `${usernameInput.value.trim()}@${serverNameInput.value.trim()}`,
            serverName: serverNameInput.value.trim(),
            portNumber: parseInt(portNumberInput.value, 10),
            username: usernameInput.value.trim()
        };

        if (isEditMode && currentEditingConnectionId) {
            // Update existing connection
            payload.id = currentEditingConnectionId;
            if (storePasswordCheckbox.checked) {
                if (passwordInput.value) {
                    payload.password = passwordInput.value;
                } else if (hasStoredPasswordWhileEditing) {
                    // Empty password, but had one before
                    payload.keepExistingPassword = true;
                }
            } else {
                payload.password = undefined;
            }
            saveConnectionBtn.disabled = true;
            saveButtonText.textContent = "Updating...";
            vscode.postMessage({ command: "updateConnection", payload });
        } else {
            // Save new connection
            payload.password = storePasswordCheckbox.checked ? passwordInput.value : undefined;
            saveConnectionBtn.disabled = true;
            saveButtonText.textContent = "Saving...";
            vscode.postMessage({ command: "saveNewConnection", payload });
        }

        setTimeout(() => {
            passwordInput.value = "";
            saveConnectionBtn.disabled = false;
            if (isEditMode) {
                saveButtonText.textContent = "Save Changes";
            } else {
                saveButtonText.textContent = "Save New Connection";
            }
        }, 1000);
    }

    // Event listeners
    saveConnectionBtn.addEventListener("click", handleSaveConnection);

    connectionsListEl.addEventListener("click", function (event) {
        const targetButton = event.target.closest("button");
        if (targetButton && !targetButton.disabled) {
            const connectionId = targetButton.dataset.connectionId;
            if (targetButton.classList.contains("login-btn")) {
                vscode.postMessage({ command: "loginWithConnection", payload: { connectionId: connectionId } });
            } else if (targetButton.classList.contains("edit-btn")) {
                vscode.postMessage({ command: "editConnection", payload: { connectionId: connectionId } });
            } else if (targetButton.classList.contains("delete-btn")) {
                vscode.postMessage({ command: "requestDeleteConfirmation", payload: { connectionId: connectionId } });
            }
        } else if (targetButton && targetButton.disabled) {
            if (isLoginInProgress) {
                const connectionLabelText = loginInProgressConnectionLabel
                    ? ` for "${loginInProgressConnectionLabel}"`
                    : "";
                displayMessage("info", `Login is already in progress${connectionLabelText}. Please wait.`);
            } else if (targetButton.classList.contains("delete-btn")) {
                displayMessage(
                    "info",
                    "Cannot delete connection while editing it. Please save or cancel your changes first."
                );
            } else if (targetButton.classList.contains("login-btn") || targetButton.classList.contains("edit-btn")) {
                displayMessage("info", "Please save or cancel your current changes before performing other actions.");
            }
        }
    });

    if (cancelEditBtn) {
        cancelEditBtn.addEventListener("click", function () {
            vscode.postMessage({ command: "cancelEditConnection" });
        });
    }

    // Handle messages from the extension host
    window.addEventListener("message", (event) => {
        const message = event.data;
        console.log("[WebviewScript] Message received from host:", message);
        switch (message.command) {
            case "displayConnectionsInWebview":
                renderConnections(message.payload);
                break;
            case "showWebviewMessage":
                displayMessage(message.payload.type, message.payload.text);
                // Reset button states
                if (saveConnectionBtn) {
                    saveConnectionBtn.disabled = false;
                    if (isEditMode) {
                        saveButtonText.textContent = "Save Changes";
                    } else {
                        saveButtonText.textContent = "Save New Connection";
                    }
                }
                break;
            case "enterEditMode":
                enterEditMode(message.payload.connection, message.payload.hasStoredPassword);
                break;
            case "exitEditMode":
                exitEditMode();
                break;
            case "updateLoginState":
                setLoginState(message.payload);
                break;
        }
    });

    // Tell the extension the UI is ready
    console.log("[WebviewScript] Requesting initial connections via connectionUiLoaded.");
    vscode.postMessage({ command: "connectionUiLoaded" });
    messagesEl.classList.add("hidden");
    updateLoginProgressFeedback();
})();
