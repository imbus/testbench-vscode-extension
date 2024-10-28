# TestBench VS Code Extension

This Visual Studio Code Extension for TestBench allows you to:
- Display the project management tree and the test theme tree, where you can navigate through the tree elements.
- Generate robotframework test cases from test cycles, test themes and test case sets directly within Visual Studio Code.

## Features

- Display project management tree and test theme tree in separate views.
- Generate robotframework test cases for the selected tree element type.

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

Use the buttons alongside the tree views or open the command palette (Ctrl+Shift+P), type TestBench: Display Commands, and select the desired command.

1. **Login to the TestBench Server**  
   Use the **Login** button or command, then enter your TestBench server credentials. You can configure these credentials within the extension settings for automatic autofill. Once logged in, select **Display Projects List** to choose a project.

2. **Initialize the Project Management Tree**  
   After selecting a project, the **Project Management Tree** will be initialized. Navigate through the project elements to locate a test cycle. Clicking on a test cycle will automatically initialize the **Test Theme Tree**, displaying the associated test themes and test case sets for that cycle.

3. **Generate Test Cases**  
   Within the Project Management Tree, click **Generate Test Cases** on a test cycle. You’ll have the option to either:
   - Generate test cases for a specific test theme by selecting it, or
   - Generate all test cases for the chosen test cycle by clicking **Generate All**.

   After making a selection, the extension retrieves the report from the TestBench server and uses the `testbench2robotframework` library to create Robot Framework test cases.

4. **Execute and Upload Test Results**  
   Once you’ve executed the generated Robot Framework tests, a zip file named `ReportWithResults.zip` will be created, containing the test results. To upload these results back to the TestBench server, click the **Upload** button and select `ReportWithResults.zip` to complete the process.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Release Notes

### 1.0.0

Initial release of the TestBench extension.

**Enjoy!**
