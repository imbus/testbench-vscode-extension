---
sidebar_position: 2
title: Quickstart
---

import loginWebm from './videos/login.webm';
import loginMp4 from './videos/login.mp4';
import linkTovWebm from './videos/link_tov.webm';
import linkTovMp4 from './videos/link_tov.mp4';

## 1. Open workspace and sign in

1. Open a workspace folder in VS Code.
2. Open the TestBench view from the side bar.
3. Create or select a connection and sign in. To create a new connection, use the connection form in the TestBench view, enter server, port, username, and password, then sign in.

<video controls preload="metadata" playsinline width="100%">
    <source src={loginWebm} type="video/webm" />
    <source src={loginMp4} type="video/mp4" />
    Your browser does not support the video tag.
</video>

## 2. Set active context from Projects View

1. In Projects View, navigate to a project.
2. Right-click the target test object version (TOV) you want to work with and choose **Set as Active TOV**.

<video controls preload="metadata" playsinline width="100%">
    <source src={linkTovWebm} type="video/webm" />
    <source src={linkTovMp4} type="video/mp4" />
    Your browser does not support the video tag.
</video>

The extension stores this TOV context in `.testbench/ls.config.json`.

## 3. Open the context you want to work with

Open either the test object version you selected as active context, or a cycle that belongs to this test object version.

The context you open determines the available actions:

- If you open a TOV context, test generation is available.
- If you open a cycle context, test generation and execution results upload are available.

## Workspace behavior

- When a workspace is open, the full feature set is available.
- When no workspace is open, the extension is in read-only mode. Test generation, execution results upload, resource creation, and keyword synchronization actions that modify local files or TestBench content are unavailable.

![Read-only mode when no workspace is open](./images/ReadOnlyMode.png)

## Next steps

1. Create or open local `.resource` files in [Create or open resource files](../views/test-elements-view#create-or-open-resource-files).
2. Synchronize keyword definitions in [Keyword synchronization](../views/test-elements-view#keyword-synchronization).
3. Generate Robot Framework suites in [Generate Robot Framework test suites](../views/test-themes-view#generate-robot-framework-test-suites).
4. Execute suites and upload results in [Execute and upload results](../views/test-themes-view#execute-and-upload-results).
