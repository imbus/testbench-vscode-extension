# TestBench Extension for Visual Studio Code

The **TestBench Extension** for Visual Studio Code enables seamless synchronization between [TestBench](https://www.testbench.com/) and [Robot Framework](https://github.com/robotframework/robotframework) files managed in VS Code. It allows you to:

- Synchronize Robot Framework keywords between VS Code and TestBench
- Export test cases specified in TestBench to run them externally
- Import execution results back into TestBench
- Visualize your TestBench project structure and navigate through the corresponding Robot Framework files

## Requirements

- Visual Studio Code version 1.95.0 or higher
- Python 3.10 or higher

## Usage

- **Log in to the TestBench Server**

    Log in to the TestBench server by entering your credentials in the login form. You can securely store your password by selecting the **Store Password** option. If you enable **Automatic Login**, the extension will log in automatically upon activation, provided your password is stored. Once logged in, a project selection form will appear, allowing you to choose a project, a Test Object Version, or a Test Cycle to work with.

- **Extension Views**

    After selecting the context of your project, the **Project Details** will be displayed in the form of **Test Themes** and **Test Elements** views. You can navigate through these elements by expanding or clicking on the tree items. If the corresponding files exist in the local file system, they will open automatically.

- **Generate Test Cases**

    The extension allows you to generate Robot Framework test cases for Test Object Versions, Test Cycles, Test Themes, and Test Case Sets.

    To generate test cases for a TOV or cycle, click the **Generate Test Cases** button on the corresponding element in the project management tree.

    To generate test cases for a specific test theme or a test case set, click the **Generate Test Cases** button on the respective element in the Test Theme Tree.

- **Execute and Import Test Results**

    Once you’ve executed the generated Robot Framework tests (e.g., via [RobotCode](https://robotcode.io/)), you can click the **Import** button in the **Test Themes** view to send the test results back to TestBench. This option does only exist for test cycles.

- **Synchronize Robot Framework Keywords**

    The extension also displays all subdivisions corresponding to Robot Framework resource files in the **Test Elements** view.  
     Each subdivision ending with `[Robot-Resource]` is considered a Robot Framework resource file and is displayed in the tree view. The **Test Elements** view can be used to navigate between different resource files or even to create them if they do not exist.

    When opening a Robot Framework resource file that is linked to a TestBench subdivision, code lenses are displayed in the editor. These can be used to pull or push changes of single keywords or the whole resource file from or to TestBench.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing / Feedback

If you encounter any issues or have suggestions for improvements, please open an issue on our [GitHub repository](https://github.com/imbus/testbench-vs-code-extension).
Please check out our [contribution guidelines](CONTRIBUTING.md) for details on how to report issues or suggest enhancements before submitting a pull request.

## Release Notes

### 1.0.0

Initial release of the TestBench extension.
