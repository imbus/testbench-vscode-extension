# TestBench Extension for Visual Studio Code

The **TestBench Extension** enables synchronization between [TestBench](https://www.testbench.com/) and [Robot Framework](https://github.com/robotframework/robotframework) files in VS Code. Manage your TestBench projects, generate Robot Framework tests, execute them, and import results back to TestBench from within your IDE.

## Features Overview

- **Secure Connections**: Manage multiple TestBench server connections in Login view
- **Projects View**: Browse and navigate through TestBench projects, Test Object Versions (TOVs), and Test Cycles in Projects view
- **Context Configuration**: Set an active project and TOV to define the current context for the extension in Projects view
- **Test Themes View**: Browse and navigate through Test Themes and Test Case Sets in Test Themes view
- **Test Elements View**: Browse and navigate through Test Elements such as subdivisions and keywords in Test Elements view
- **Search & Filter**: Search functionality across all tree views with configurable search criteria in Projects view, Test Themes view, and Test Elements view
- **Test Generation**: Generate Robot Framework test suites in Test Themes view with configurable test generation settings
- **Result Import**: Import Robot Framework execution results back to TestBench to update execution status and verdicts in Test Themes view
- **Resource Management**: Create, edit, and synchronize Robot Framework resource files with TestBench subdivisions in Test Elements view
- **Keyword Synchronization**: Pull and push Robot Framework keywords between VS Code and TestBench using CodeLens actions in Robot Framework resource files

## Requirements

- **Visual Studio Code** version 1.95.0 or higher
- **Python** 3.10 or higher
- An open VS Code workspace (required for test generation and result import features)

### Required Extensions

The following extensions are automatically installed as dependencies when you install the TestBench extension:

- **Python extension** (`ms-python.python`) - Required for Python support
- **RobotCode extension** (`d-biehl.robotcode`) - Required for Robot Framework test execution

## Quick Start

1. Open the TestBench view in VS Code (activity bar icon)
2. Create or select a TestBench connection and log in
3. After the first login, the Projects view opens automatically
4. Select an active project and TOV to define the current context for the extension in Projects view by right-clicking on a project or TOV and selecting "Set as Active Project" or "Set as Active TOV"
5. Open a TOV or Cycle in the Projects view to open the Test Themes view and Test Elements view together for that context
6. Generate Robot Framework tests by clicking the Robot Framework icon next to any tree item in the Test Themes view
7. Execute the created robotframework tests using RobotCode extension
8. Import results back to TestBench using the Import button next to generated tree items in the Test Themes view

## Documentation

For comprehensive documentation including detailed feature descriptions, configuration settings, and a troubleshooting guide, see the [User Guide](user-guide.md).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing / Feedback

If you encounter any issues or have suggestions for improvements, please open an issue on our [GitHub repository](https://github.com/imbus/testbench-vs-code-extension).
Please check out our [contribution guidelines](CONTRIBUTING.md) for details on how to report issues or suggest enhancements before submitting a pull request.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes.
