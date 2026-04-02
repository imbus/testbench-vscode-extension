---
sidebar_position: 2
title: Projects View
---

**Projects View** is the entry point for working with TestBench content in VS Code. It lets you browse projects, Test Object Versions (TOVs), and Test Cycles, then open the context used by the other views.

## Open context

Opening a **Test Object Version** loads the selected TOV into **Test Themes View** and **Test Elements View**. Opening a **Test Cycle** also loads its context into **Test Themes View** and **Test Elements View**.

## Set the active configuration

To define the working context, right-click a project and choose **Set as Active Project** when you only want to set the project. Right-click a TOV and choose **Set as Active TOV** when you want to set both the active TOV and its parent project in one step. The selected active project and active TOV are visually pinned as the first items in **Projects View**, and the active configuration is written to `.testbench/ls.config.json`.

## Generate tests from project nodes

Use **Generate Robot Framework Test Suites (TOV based)** to start generation for a selected TOV. Use **Generate Robot Framework Test Suites (Cycle based)** to start generation for a selected cycle.

## Search and refresh

Use **Search** to filter projects, TOVs, and cycles in the tree. Use **Refresh Projects** to reload tree content from TestBench.

## Persisted state

Tree expansion and collapse state is preserved across sessions, visible view configuration is persisted, and the last active project context is restored when possible.
