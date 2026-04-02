---
sidebar_position: 3
title: Test Themes View
---

**Test Themes View** is used to generate Robot Framework suites from TestBench structures and to upload execution results back to TestBench.

## Open context

Open a TOV or cycle from **Projects View** to load **Test Themes View**. For a complete workflow that includes result import, open a cycle context.

## Generate Robot Framework test suites

Every Test Theme and Test Case Set node has a **Generate Robot Framework Test Suites** action. Running it generates suites for the selected node and its subtree.
Test generation uses the bundled `testbench2robotframework` library. The output location is controlled by the **outputDirectory** extension setting. Optional pre-generation cleanup is controlled by **cleanFilesBeforeTestGeneration**, which deletes existing files in the output directory before new suites are generated. Generated items are visually marked in the tree.

## Open generated files

Single-clicking a generated test case set opens its `.robot` file. Double-clicking opens the file and also reveals it in the VS Code Explorer view.

## Execute and import results

Run generated suites with RobotCode or any other Robot Framework runner before importing results.

Use the tree item action **Upload Execution Results To Testbench** on the node you want to import. You can upload a selected subtree or a single node.
The **Upload Execution Results To Testbench** action is visible for generated nodes and generated subtree contexts. Import reads Robot Framework test execution results from `output.xml`, and the default result path is defined by **outputXmlFilePath** relative to the workspace. After successful import, affected tree items are updated to `Performed` and show verdict details in their tooltips. The import action is available only when **Test Themes View** is opened from a cycle context.

## Search and refresh

Use **Search** to filter the Test Themes tree and **Refresh Test Themes** to reload the current context.
