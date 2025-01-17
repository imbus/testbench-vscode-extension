# TestBench VS Code Extension

This Visual Studio Code Extension for TestBench allows you to:

-   Display the project management tree and the test theme tree, where you can navigate through the tree elements.
-   Hovering over the tree view elements will display additional information such as the status and unique ID of the element.
-   Generate robotframework test cases from test cycles, test themes and test case sets directly within Visual Studio Code, and upload the test results back to the TestBench server.

## Features

-   Display project management tree and test theme tree in separate views.
-   Generate robotframework test cases for the selected test cycle, test theme or test case set.
-   Upload test results back to the TestBench server.

## Requirements
-  Visual Studio Code version 1.95.0 or higher.
-  Robot Framework version 7.2 or higher.

## Installation

1. Open Visual Studio Code.
2. Go to the Extensions view by clicking on the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Search for "TestBench".
4. Click Install.
   The extension comes preinstalled with the testbench2robotframework library, which contains the functionality to convert reports to robot framework test cases.

## Configuration

The extension settings contains following configurations:

-   Testbench server
-   Port number
-   Username
-   Store credentials
-   Automatic login option
-   Workspace location
-   Clean up option after processing reports
-   Clean up report file after processing
-   testbench2robotframework configuration
-   Path to execution results folder (output.xml)
-   Log level

## Usage

-   **(Optional) Configure Extension Settings**

    Click on the gear icon located on the side of the project management tree view, which will open the extension settings. Configure the TestBench server, port number, username, and other settings as needed.

-   **Login to the TestBench Server**

    Click on the **Login** button located on the side of the project management tree view, then enter your TestBench server credentials. You can configure these credentials within the extension settings for automatic autofill. Once logged in, click on the **Display Projects List** button to choose a project.

-   **Initialize the Project Management Tree**

    After selecting a project, the **Project Management Tree** will be initialized. Navigate through the project elements by expanding or clicking on the tree items. Clicking on a test cycle in the project management tree will automatically initialize the **Test Theme Tree**, displaying the associated test themes and test case sets for that cycle. In the test theme tree, not executable elements and elements that are locked by the system are hidden.

-   **Generate Test Cases**

    The extension allows you to generate Robot Framework test cases for test cycles, test themes, and test case sets.

    To generate test cases for a test cycle, click the **Generate Test Cases** button on a test cycle in the project management tree, which opens a quick pick menu, where you can either generate test cases for a specific test theme by selecting it in the quick pick, or generate all test cases for the chosen test cycle by clicking **Generate All**.

    To generate test cases for a specific test theme or a test case set, click **Generate Test Cases** button on a test theme tree element in the Test Theme Tree.

    During the test generation process, the extension retrieves the report in JSON format as a zip file from the TestBench server and uses the `testbench2robotframework` library to create Robot Framework test cases.

-   **Execute and Upload Test Results**

    Once you’ve executed the generated Robot Framework tests (for example via [RobotCode](https://robotcode.io/)), you can click the **Upload** button to send the test results back to the TestBench server. The extension automatically locates the output.xml file that stores the Robot Framework test results inside your working directory, where you can set the working directory path in the extension settings. During the creation process of the results, a report file named `ReportWithResults_<TIMESTAMP>.zip` with a timestamp at the end of the file will be created, containing the test results. If you choose to clear the report file after processing in the extension settings, this report file will be deleted automatically after the upload process.

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md) before submitting a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Release Notes

### 1.0.0

Initial release of the TestBench extension.

**Enjoy!**
