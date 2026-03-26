---
sidebar_position: 2
title: Projects View
---

**Projects View** is the entry point for working with TestBench content in VS Code. It lets you browse projects, Test Object Versions (TOVs), and Test Cycles, then open the context used by the other views.

## Open context

- Opening a **Test Object Version** loads the selected TOV into **Test Themes View** and **Test Elements View**
- Opening a **Test Cycle** loads the selected cycle into **Test Themes View** and **Test Elements View**

## Set the active configuration

- right-click a project to open the context menu and choose **Set as Active Project** if you want to set only the active project
- right-click a TOV to open the context menu and choose **Set as Active TOV** to set that TOV as active; its parent project is set as the active project automatically
- the selected active project and active TOV are visually pinned as the first items in **Projects View**
- the active configuration is written to `.testbench/ls.config.json`

## Generate tests from project nodes

- **Generate Robot Framework Test Suites (TOV based)** starts generation for the selected TOV
- **Generate Robot Framework Test Suites (Cycle based)** starts generation for the selected cycle

## Search and refresh

- use **Search** to filter projects, TOVs, and cycles in the tree
- use **Refresh Projects** to reload the tree content from TestBench

## Persisted state

- tree item expansion/collapse state is preserved across sessions
- visible view configuration is preserved across sessions
- the last active project context is restored when possible
