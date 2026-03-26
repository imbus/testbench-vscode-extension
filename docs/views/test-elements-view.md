---
sidebar_position: 4
title: Test Elements View
---

**Test Elements View** shows the resource subdivisions and keywords for the currently opened TestBench context.

## Resource identification and action visibility

Subdivisions with a configured resource marker suffix are treated as Robot Framework resources.

The default resource marker suffix is `[Robot-Resource]` and can be changed with the **resourceMarker** extension setting.

- **Create Resource** and **Open Resource** are shown only for subdivisions that match the configured resource marker suffix
- **Open in Explorer View** is shown for subdivision folder nodes

## Create or open resource files

- **Create Resource** creates a `.resource` file for a resource subdivision
- **Open Resource** opens an existing `.resource` file for a resource subdivision
- **Open in Explorer View** reveals the related subdivision folder in the VS Code Explorer view

## Required metadata for synchronization

When the extension creates a resource file, it writes these metadata lines at the top:

- `tb:uid`
- `tb:context`

These metadata lines are required for synchronization and must be kept valid. If metadata is missing or invalid, the extension offers **Quick Fix** actions to restore them.

## Keyword navigation

- single-clicking a keyword opens the corresponding resource file and jumps to the keyword definition
- double-clicking a keyword does the same and also reveals the resource file in the VS Code Explorer view

## Keyword synchronization

CodeLens actions support:

- pulling keyword definitions from TestBench
- pushing local keyword definitions to TestBench
- synchronizing a single keyword or the entire resource file

## Search and refresh

- use **Search** to filter subdivisions and keywords in the tree
- use **Refresh Test Elements** to reload the current context
