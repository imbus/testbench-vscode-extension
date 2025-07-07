# TestBench VS Code Extension

TestBench VS Code Extension integrates TestBench with Visual Studio Code to help testers to generate Robot Framework test cases inside VS Code and import test results back to the TestBench server.

## Features

- Visualize your TestBench project structure inside VS Code and navigate through the project contents.
- Generate robotframework test cases for the selected test cycle, test theme or test case set.
- Import test results back to the TestBench server.
- Display test elements, where you can navigate to a robotframework resource file and open it in the VS Code editor.
- Hovering over the tree view elements will display additional information in a tooltip such as the status and unique ID of the element.

## Requirements

- Visual Studio Code version 1.95.0 or higher.

## Installation

1. Open Visual Studio Code.
2. Go to the **Extensions** view by clicking on the Extensions icon in the Activity Bar on the side of the window or by pressing `Ctrl+Shift+X`.
3. Search for **"TestBench"**.
4. Click Install.
   The extension comes preinstalled with the testbench2robotframework library, which contains the functionality to convert reports to robot framework test cases.
5. (Optional) Configure extension settings

## Configuration

The extension settings contains following configurations:

- **TestBench Server Settings:**

    - **Server Name:** Hostname or IP of the TestBench server.
    - **Port Number:** Port on which the server is listening.
    - **Username:** Your TestBench username.
    - **Store Credentials:** Option to securely store your password.
    - **Automatic Login:** Option to log in automatically upon extension activation.

- **Workspace Settings:**

    - **Workspace Location:** Directory for storing and processing files.
    - **Clean Up Options:** Configure automatic cleanup of working directories and report files after processing.

- **Testbench2Robotframework Settings:**

    - **Configuration Path:** Path to the configuration file for testbench2robotframework.
    - **Output Directory:** Directory to store generated robotframework tests.
    - **Resource Regex Patterns:** Resource regex patterns for filtering test elements to display only Robot Framework resources.
    - **Output XML Path:** Path to your Robot Framework `output.xml` file containing test results.

- **Logging:**
    - **Log Level:** Set the minimum log level (Trace, Debug, Info, Warn, Error).

## Usage

- **(Optional) Configure Extension Settings**

    In the extension settings, adjust the configurations according to your requirements.

- **Login to the TestBench Server**

    Log in to the TestBench server by entering your credentials in the login form. You can securely store your password by checking the **Store Password** option. If you enable **Automatic Login**, the extension will log in automatically upon extension activation, provided your password is stored. You can configure your credentials within the extension settings for automatic autofill. Once logged in, a project selection form will appear for you to choose a project to work with.

- **Extension Views**

    After selecting a project, the **Project Contents** will be displayed. Navigate through the project elements by expanding or clicking on the tree items. Clicking on a test cycle in the project management tree will automatically initialize the **Test Themes** and **Test Elements** views. In the test themes view, not executable elements and elements that are locked by the system are hidden.

- **Generate Test Cases**

    The extension allows you to generate Robot Framework test cases for test cycles, test themes, and test case sets.

    To generate test cases for a test cycle, click the **Generate Test Cases** button on a test cycle in the project management tree, which opens a quick pick menu, where you can either generate test cases for a specific test theme by selecting it in the quick pick, or generate all test cases for the chosen test cycle by clicking **Generate All**.

    To generate test cases for a specific test theme or a test case set, click **Generate Test Cases** button on a test theme tree element in the Test Theme Tree.

    During the test generation process, the extension retrieves the report in JSON format as a zip file from the TestBench server and uses the `testbench2robotframework` library to create Robot Framework test cases.

- **Execute and Import Test Results**

    Once you’ve executed the generated Robot Framework tests (for example via [RobotCode](https://robotcode.io/)), you can click the **Import** button in the **Test Themes** view to send the test results back to the TestBench server. The extension locates the output.xml file that stores the Robot Framework test results inside your working directory using the path specified in the extension settings. During the creation process of the test results, a report file named `ReportWithResults_<TIMESTAMP>.zip` with a timestamp at the end of the file will be created, containing the test results. If you choose to clear the report file after processing in the extension settings, this report file will be deleted automatically after the import process.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing / Feedback

If you encounter any issues or have suggestions for improvements, please open an issue on our [GitHub repository](https://github.com/imbus/testbench-vs-code-extension).
Please check out our [contribution guidelines](CONTRIBUTING.md) for details on how to report issues or suggest enhancements before submitting a pull request.

## Release Notes

### 1.0.0

Initial release of the TestBench extension.
