---
sidebar_position: 2
title: Quickstart
---

## 1. Open workspace and sign in

1. Open a workspace folder in VS Code.
2. Open the TestBench view from the side bar.
3. Create or select a connection and sign in. To create a new connection, use the connection form in the TestBench view, enter server, port, username, and password, then sign in.

## 2. Set active context from Projects View

1. In Projects View, navigate to a project.
2. Right-click the target TOV you want to work with and choose **Set as Active TOV**.

The extension stores this TOV context in `.testbench/ls.config.json`.

## 3. Open the context you want to work with

Open either the test object version you selected as active context, or a cycle that belongs to this test object version.

The available features depend on what you open from Projects View:

- If you open a TOV context, test generation is available.
- If you open a cycle context, test generation and result import are available.

## 4. Generate tests and run them

You can start test generation from either of these two views:

1. Projects View:
    - run **Generate Robot Framework Test Suites (Cycle based)** on a cycle to generate suites for that cycle scope
    - run **Generate Robot Framework Test Suites (TOV based)** on a TOV when you want TOV-scope generation
2. Test Themes View:
    - run **Generate Robot Framework Test Suites** on a test theme or test case set node to generate that subtree
3. Execute the generated tests (for example with RobotCode).

## 5. Upload execution results

1. Ensure the Robot Framework execution tool you used produced `output.xml`.
2. In Test Themes view, use the **Upload Execution Results To Testbench** button on a generated node. You can import a single generated node or a generated subtree.
3. Verify that uploaded items are updated in TestBench.

## Workspace behavior

- With workspace open: full feature set.
- Without workspace open: read-only mode. Test generation, result import, resource creation, and keyword synchronization actions that modify local files or TestBench content are unavailable.

## Context behavior

- Cycle context: test generation and result import available.
- TOV-only context: generation available, result import unavailable.
