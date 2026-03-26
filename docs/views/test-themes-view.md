---
sidebar_position: 3
title: Test Themes View
---

**Test Themes View** is used to generate Robot Framework suites from TestBench structures and to upload execution results back to TestBench.

## Open context

- open a TOV or cycle from **Projects View** to load **Test Themes View**
- for a complete workflow including importing test results, open a cycle context

## Generate Robot Framework test suites

Every Test Theme and Test Case Set node has a **Generate Robot Framework Test Suites** action. Running it generates suites for the selected node and its subtree.

Generation behavior:

- uses the bundled `testbench2robotframework` library
- output location is controlled by the **outputDirectory** extension setting
- optional pre-generation cleanup is controlled by the **cleanFilesBeforeTestGeneration** extension setting, which deletes existing files in the output directory before new suites are generated
- generated items are visually marked in the tree

## Open generated files

- single-click on a generated test case set opens its `.robot` file
- double-click opens the file and also reveals it in the VS Code Explorer view

## Execute and import results

Run generated suites with RobotCode or any other Robot Framework runner before importing results.

Use the tree item action **Upload Execution Results To Testbench** on the node you want to import. You can upload a selected subtree or a single node.

Import behavior:

- the **Upload Execution Results To Testbench** action becomes visible on generated nodes and their generated subtree context
- import reads Robot Framework test execution results from `output.xml`
- the default result file path comes from the **outputXmlFilePath** extension setting, relative to the workspace
- after a successful import, affected tree items are updated to `Performed` and show verdict information in their tooltips
- the **Upload Execution Results To Testbench** action is available only when **Test Themes View** is opened from a cycle context

## Search and refresh

- use **Search** to filter the Test Themes tree
- use **Refresh Test Themes** to reload the current context
