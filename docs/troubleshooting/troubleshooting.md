---
sidebar_position: 1
title: Troubleshooting
---

| Symptom                                           | Likely Cause                                 | Resolution                                                                                                                                  |
| ------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension in read-only mode                       | No folder/workspace opened                   | Open a workspace folder in VS Code.                                                                                                         |
| Import action/button is missing in Test Themes    | Test Themes opened from TOV instead of cycle | Open a cycle from Projects View; import is cycle-context only.                                                                              |
| Import results fail                               | `output.xml` missing or wrong path           | Verify **outputXmlFilePath** and test runner output location.                                                                               |
| No CodeLens actions available for a resource file | Invalid or missing resource metadata/context | Ensure the correct TOV context is selected in Projects View and verify that `tb:uid` and `tb:context` exist and match the selected context. |
| TLS/certificate errors                            | Untrusted server certificate                 | Configure **certificatePath** or **NODE_EXTRA_CA_CERTS**.                                                                                   |

Quick reset actions:

- **Reload Window** command
- **TestBench: Clear All Extension Data** (destructive)

:::warning
**Clear All Extension Data** removes persisted extension data, including stored connections. This operation cannot be undone.
:::
