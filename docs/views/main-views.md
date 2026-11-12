---
sidebar_position: 1
title: Main Views
---

The extension is organized around three main views. In [Projects View](projects-view.md), you browse projects, TOVs, and cycles, define the active context, and start generation from project nodes.

![Projects View](./images/ProjectsView.png)

In [Test Themes View](test-themes-view.md), you generate Robot Framework suites, open generated files, and upload execution results.

![Test Themes View](./images/TestThemesView.png)

In [Test Elements View](test-elements-view.md), you work with subdivisions and resource files, navigate keywords, and synchronize keyword definitions.

![Test Elements View](./images/TestElementsView.png)

## Shared behavior

Search is available in all three views and filters the currently displayed tree items in real time. You can search by name and tooltip in all views, and by UID in Test Themes and Test Elements, with optional case-sensitive and exact matching. The extension also preserves view state across sessions, including expansion state and which views are currently shown or hidden.

![Search and filtering in tree views](./images/SearchFeature.png)

## Command Palette commands

Most actions are available as buttons in the views. These commands are available from the Command Palette (**Ctrl+Shift+P** / **Cmd+Shift+P**):

| Command                                 | Description                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Login / Switch Connection**           | Signs in to TestBench or switches to another saved connection.                                                                |
| **Logout**                              | Signs you out locally and returns to the login view.                                                                          |
| **Clear Temporary Files**               | Removes temporary files from the `.testbench` folder in the workspace. Log files are kept.                                    |
| **TestBench: Open Issue Reporter**      | Opens the VS Code issue reporter with the TestBench extension preselected.                                                    |
| **TestBench: Clear All Extension Data** | Resets all persisted extension data. See [Troubleshooting](../troubleshooting/troubleshooting.md#reset-and-recovery-actions). |
