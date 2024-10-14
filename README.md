# TestBench VS Code Extension

This Visual Studio Code Extension for TestBench allows you to:
- Display the project management tree and the test theme tree, where you can navigate through the tree elements.
- Generate robotframework test cases from test cycles directly within Visual Studio Code.

## Features

- Display project management tree and test theme tree in separate views
- Generate robotframework test cases

## Requirements

- testbench2robotframework python library

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions view by clicking on the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Search for "TestBench".
4. Click Install.

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
2. Type `TestBench: Display Commands` and select the command.
3. Login to a TestBench server using the Login command. After successful login, the test theme tree will be initialized automatically.
4. To generate a test case, click the Generate button for a test cycle in the test theme tree.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Release Notes

### 1.0.0

Initial release of the TestBench extension.

**Enjoy!**
