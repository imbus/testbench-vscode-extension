# TestBench VS Code Extension

This Visual Studio Code Extension for TestBench allows you to:
- Display the project management tree and the test theme tree, where you can navigate through the tree elements.
- Generate robotframework test cases from test cycles directly within Visual Studio Code.

## Features

- Display project management tree and test theme tree in separate views
- Generate robotframework test cases

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions view by clicking on the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Search for "TestBench".
4. Click Install.
The extension comes preinstalled with the testbench2robotframework library, which contains the functionality to convert reports to robot framework test cases.

## Configuration

The extension settings contains following configurations:
- Testbench server
- Port number
- Username
- Automatic login option
- Workspace location
- Test generation configuration

## Usage

1. Open the Command Palette (`Ctrl+Shift+P`).
2. Type `TestBench: Display Available Commands` and select the command.
3. Login to a TestBench server using the Login command. After successful login, you can execute the `Display Projects List` command to select a project.
4. After the project selection, the project management tree will be initialized. You can navigate through the project elements to find a test cycle to generate test cases. Expanding a test cycle initializes the test theme tree, which can contain test themes, test case sets and test cases of the selected test cycle.
5. To generate a test case, click the `Generate Test Cases` button for a test cycle in the test theme tree.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Release Notes

### 1.0.0

Initial release of the TestBench extension.

**Enjoy!**
