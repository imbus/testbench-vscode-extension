## Overview

The UI tests use [VS Code Extension Tester](https://github.com/redhat-developer/vscode-extension-tester) to automate interactions with the VS Code interface.

## Prerequisites

Before running UI tests, ensure you have:

1. **Node.js** (v14 or higher)
2. **npm** or **yarn** package manager
3. **Test credentials** for your TestBench server (see [Configuration](#configuration))
4. **Compiled extension** - Run `npm run compile` first

## Dependencies

The UI tests use the following packages:

- **`vscode-extension-tester`** - Main UI testing framework for VS Code extensions
- **`chai`** - Assertion library for tests
- **`@types/chai`** - TypeScript definitions for chai
- **`dotenv`** (optional) - Loads environment variables from `.env` files
- **`mocha`** - Test runner framework

## Quick Start

1. **Set up test credentials** (see [Configuration](#configuration))
2. **Compile the extension:**
    ```bash
    npm run compile
    ```
3. **Run all UI tests:**
    ```bash
    npm run test:ui
    ```

## File Structure

```
src/test/ui/
├── README.md                          # This file - main documentation
├── index.ts                           # Test loader for Mocha
│
├── config/                            # Configuration files
│   ├── .vscode-test.settings.json     # VS Code settings for test environment
│   ├── testConfig.ts                  # Test credentials and configuration management
│   ├── testConfigurations.ts          # Multi-configuration test profiles
│   └── listProfiles.js                # Profile listing utility
│
├── runners/                           # Test runner scripts
│   ├── runUITests.ts                  # Standard single-configuration runner
│   └── runUITestsWithProfiles.ts      # Multi-configuration runner
│
├── utils/                             # Utility functions
│   ├── testUtils.ts                   # Reusable helper functions
│   ├── testHooks.ts                   # Shared test hooks and setup utilities
│   ├── testLogger.ts                  # Persistent file logging utility
│   └── treeViewUtils.ts               # Tree view specific utilities
│
├── pages/                             # Page Object Models
│   ├── BasePage.ts                    # Base page with common methods
│   ├── ConnectionPage.ts              # Connection webview page object
│   ├── ProjectsViewPage.ts            # Projects view page object
│   ├── TestElementsPage.ts            # Test Elements view page object
│   └── TestThemesViewPage.ts          # Test Themes view page object
│
├── fixtures/                          # Static test files (copied to workspace)
│   ├── resources/                     # .resource files for Robot Framework
│   ├── tests/                         # Test file templates
│   └── results/                       # Results directory placeholder
│
├── loginWebview.ui.test.ts            # Login webview UI tests
├── projectsView.ui.test.ts            # Projects tree view UI tests
├── testThemesView.ui.test.ts          # Test Themes view UI tests
├── testElementsView.ui.test.ts        # Test Elements view UI tests
├── resourceCreationFlow.ui.test.ts    # End-to-end resource creation flow tests
├── searchFeature.ui.test.ts           # Search functionality UI tests
├── contextConfiguration.ui.test.ts    # Context configuration and active project/TOV tests
├── toolbarActions.ui.test.ts          # Toolbar button actions UI tests
├── treeExpansionPersistence.ui.test.ts # Tree item expansion state persistence tests
└── subdivisionMarkingPersistence.ui.test.ts # Subdivision marking state persistence tests
```

## Test Fixtures

The `fixtures/` folder contains static files that are copied to the test workspace (`.test-resources/workspace/`) before each test run. This allows you to include pre-configured `.resource` files, test templates, or other files needed during testing.

### Key Files

**Configuration (`config/` folder):**

- **`testConfig.ts`** - Manages test credentials and configuration
- **`testConfigurations.ts`** - Defines test profiles for multi-configuration testing
- **`.vscode-test.settings.json`** - VS Code settings applied during test execution
- **`listProfiles.js`** - Lists available test profiles

**Test Runners (`runners/` folder):**

- **`runUITests.ts`** - Standard single-configuration test runner
- **`runUITestsWithProfiles.ts`** - Multi-configuration test runner

**Utilities (`utils/` folder):**

- **`testUtils.ts`** - Reusable helper functions for common test operations
- **`testHooks.ts`** - Shared before/after hooks for test suites
- **`testLogger.ts`** - Centralized logging utility with file persistence and log rotation
- **`treeViewUtils.ts`** - Tree view specific navigation and manipulation utilities

**Page Objects (`pages/` folder):**

- Page Object Models for different views (Connection, Projects, Test Themes, etc.)

**Other:**

- **`.mocharc.ui.json`** - Mocha test runner configuration (in project root)

## Running Tests

### Run All UI Tests

```bash
npm run test:ui
```

This command will:

1. Compile TypeScript test files
2. Set up the test environment (download VS Code if needed)
3. Run all UI tests
4. Clean up test resources

### Run a Single UI Test

To execute a specific test file instead of the entire suite, use the `test:ui-single` script. You must pass the filename (without the full path) after the `--` separator:

```bash
npm run test:ui-single -- loginWebview.ui.test.ts
npm run test:ui-single -- projectsView.ui.test.ts
npm run test:ui-single -- testThemesView.ui.test.ts
npm run test:ui-single -- testElementsView.ui.test.ts
npm run test:ui-single -- resourceCreationFlow.ui.test.ts
npm run test:ui-single -- searchFeature.ui.test.ts
npm run test:ui-single -- contextConfiguration.ui.test.ts
npm run test:ui-single -- toolbarActions.ui.test.ts
npm run test:ui-single -- treeExpansionPersistence.ui.test.ts
npm run test:ui-single -- subdivisionMarkingPersistence.ui.test.ts
```

### Run Tests with Multiple Configuration Profiles

The test system supports running tests with different extension setting combinations:

```bash
# Interactive mode
npm run test:ui-interactive

# List available profiles
npm run test:ui-list-profiles

# Run with a specific profile
npm run test:ui-profile -- --profile=fully-qualified-keywords

# Run all tests with all configuration profiles
npm run test:ui-all-profiles

# Run specific test with a profile
npm run test:ui-profile -- --profile=default --test=loginWebview.ui.test.ts

# Skip VS Code download for faster re-runs (extension still reinstalled)
npm run test:ui-profile -- --profile=default --skip-setup

# Run in granular mode (each test file separately - slower but gives per-file results)
npm run test:ui-profile -- --granular
```

**Execution Modes:**

**Fast (default)**: Runs all test files per profile in a single VS Code session | For normal testing, CI pipelines
**Granular**: Runs each test file separately, providing per-file pass/fail results | For debugging specific test failures

**Available Configuration Profiles:**

| Profile                    | Description                                       |
| -------------------------- | ------------------------------------------------- |
| `default`                  | Baseline configuration with default settings      |
| `fully-qualified-keywords` | Tests with fully qualified keywords enabled       |
| `clean-files-disabled`     | Tests without cleaning files before generation    |
| `custom-output-path`       | Tests with custom output directories              |
| `suite-logging`            | Tests with COMMENT-level compound keyword logging |
| `config-file-mode`         | Tests using configuration file mode               |
| `open-testing-view`        | Tests with automatic testing view opening         |
| `clear-internal-directory` | Tests with internal directory clearing            |

**Creating Custom Profiles:**

Edit `src/test/ui/config/testConfigurations.ts` and add to `TEST_PROFILES` array:

```typescript
{
    name: "my-profile",
    description: "What this profile tests",
    settings: {
        ...DEFAULT_EXTENSION_SETTINGS,
        "testbenchExtension.someSetting": true
        // Override any extension settings
    }
}
```

**Profile Settings Files:**

Generated settings files are stored in `src/test/ui/config/profiles/` (auto-created, can be deleted).

### Setup Test Environment (One-Time)

If you need to set up the test environment separately:

```bash
npm run test:ui-setup
```

Then run tests:

```bash
npm run test:ui-run
```

### Keep VS Code Open After Tests

To debug tests, you can modify `runUITests.ts` and set `cleanup: false`:

```typescript
await exTester.runTests(testFilesPattern, {
    settings: "./src/test/ui/.vscode-test.settings.json",
    resources: [],
    cleanup: false // Keep VS Code open after tests
});
```

## Configuration

### Required Environment Variables

UI tests require test credentials to connect to a TestBench server. Set these environment variables before running tests:

**Required:**

- `TESTBENCH_TEST_SERVER_NAME` - TestBench server hostname
- `TESTBENCH_TEST_USERNAME` - Test username
- `TESTBENCH_TEST_PASSWORD` - Test password

**Optional (with defaults):**

- `TESTBENCH_TEST_PORT_NUMBER` - Server port (default: "9445")
- `TESTBENCH_TEST_CONNECTION_LABEL` - Connection label (default: "TestLabel")

**Test Data Configuration (for navigation tests):**

- `TEST_PROJECT_NAME` - Project name to navigate to (default: "TestBench Demo Agil 1")
- `TEST_VERSION_NAME` - Version/TOV name (default: "Version 3.0")
- `TEST_CYCLE_NAME` - Cycle name (default: "3.0.2")
- `TEST_SUBDIVISION_NAME` - Subdivision name for resource tests (default: "Resource Subdivision 1")
- `TEST_RESOURCE_FILE_NAME` - Expected resource file name (default: "Resource Subdivision 1.resource")
- `TEST_THEME_NAME` - Test theme name for test generation tests (default: "Reihenfolge")

**UI Test Configuration:**

- `UI_TEST_SLOW_MOTION` - Enable slow motion mode for visible test actions (default: disabled)
    - Set to `"true"` to enable slow motion mode
    - When enabled, visible UI actions are delayed to allow human observation
- `UI_TEST_SLOW_MOTION_DELAY` - Delay in milliseconds for slow motion (default: 1000ms)
    - Only used when `UI_TEST_SLOW_MOTION` is enabled
    - Example: `"2000"` for 2 second delays

### Setting Environment Variables

#### Windows PowerShell (Current Session)

```powershell
$env:TESTBENCH_TEST_SERVER_NAME="your-test-server.com"
$env:TESTBENCH_TEST_USERNAME="test-username"
$env:TESTBENCH_TEST_PASSWORD="test-password"
$env:TESTBENCH_TEST_PORT_NUMBER="443"
$env:TESTBENCH_TEST_CONNECTION_LABEL="TestLabel"

# Optional: Enable slow motion mode for debugging
$env:UI_TEST_SLOW_MOTION="true"
$env:UI_TEST_SLOW_MOTION_DELAY="2000"  # 2 second delays
```

#### Windows PowerShell (Permanent - User Level)

```powershell
[System.Environment]::SetEnvironmentVariable("TESTBENCH_TEST_SERVER_NAME", "your-test-server.com", "User")
[System.Environment]::SetEnvironmentVariable("TESTBENCH_TEST_USERNAME", "test-username", "User")
[System.Environment]::SetEnvironmentVariable("TESTBENCH_TEST_PASSWORD", "test-password", "User")
[System.Environment]::SetEnvironmentVariable("TESTBENCH_TEST_PORT_NUMBER", "443", "User")
[System.Environment]::SetEnvironmentVariable("TESTBENCH_TEST_CONNECTION_LABEL", "TestLabel", "User")
```

#### Windows CMD

```cmd
set TESTBENCH_TEST_SERVER_NAME=your-test-server.com
set TESTBENCH_TEST_USERNAME=test-username
set TESTBENCH_TEST_PASSWORD=test-password
set TESTBENCH_TEST_PORT_NUMBER=443
set TESTBENCH_TEST_CONNECTION_LABEL=TestLabel

REM Optional: Enable slow motion mode for debugging
set UI_TEST_SLOW_MOTION=true
set UI_TEST_SLOW_MOTION_DELAY=2000
```

#### Linux/macOS

```bash
export TESTBENCH_TEST_SERVER_NAME="your-test-server.com"
export TESTBENCH_TEST_USERNAME="test-username"
export TESTBENCH_TEST_PASSWORD="test-password"
export TESTBENCH_TEST_PORT_NUMBER="443"
export TESTBENCH_TEST_CONNECTION_LABEL="TestLabel"

# Optional: Enable slow motion mode for debugging
export UI_TEST_SLOW_MOTION="true"
export UI_TEST_SLOW_MOTION_DELAY="2000"  # 2 second delays
```

### Using .env File (Recommended for Local Development)

1. Create a `.env` file in the project root (ensure it's in `.gitignore`):

```env
TESTBENCH_TEST_SERVER_NAME=your-test-server.com
TESTBENCH_TEST_USERNAME=test-username
TESTBENCH_TEST_PASSWORD=test-password
TESTBENCH_TEST_PORT_NUMBER=443
TESTBENCH_TEST_CONNECTION_LABEL=TestLabel

# Optional: Enable slow motion mode for debugging
UI_TEST_SLOW_MOTION=true
UI_TEST_SLOW_MOTION_DELAY=2000
```

2. Install `dotenv` (if not already installed):

```bash
npm install --save-dev dotenv
```

3. The test loader (`index.ts`) will automatically load the `.env` file if `dotenv` is available.

For more detailed examples, see [USAGE_EXAMPLES.md](./USAGE_EXAMPLES.md).

## Slow Motion Mode

Slow motion mode allows you to observe UI test actions in real-time by adding configurable delays to visible actions. This is useful for:

- Debugging test failures
- Understanding test flow
- Demonstrating test behavior
- Learning how the UI automation works

### Enabling Slow Motion

Set the `UI_TEST_SLOW_MOTION` environment variable to `"true"`:

```bash
export UI_TEST_SLOW_MOTION="true"
```

### Configuring Delay

By default, slow motion adds a 1000ms (1 second) delay. You can customize this with `UI_TEST_SLOW_MOTION_DELAY`:

```bash
export UI_TEST_SLOW_MOTION_DELAY="2000"  # 2 second delays
```

### What Gets Delayed

Slow motion delays are only applied to **visible user actions**:

- Typing in form fields
- Clicking buttons (save, edit, delete, login, cancel)
- Opening/closing sidebar
- Switching to webview
- Clicking confirmation dialogs
- UI updates after actions

### Example

```bash
# Run tests with slow motion enabled (2 second delays)
export UI_TEST_SLOW_MOTION="true"
export UI_TEST_SLOW_MOTION_DELAY="2000"
npm run test:ui
```

## Logging

UI tests include a logging system that writes persistent logs to files while also outputting to the console. Logs are stored in `.test-resources/logs/` with automatic rotation.

### Log Files

Log files are created with a session-based naming convention:

- Format: `ui-tests-YYYY-MM-DD_HH-MM-SS.log`
- Location: `.test-resources/logs/`
- Maximum files: 5 (older files are automatically deleted)
- Maximum file size: 5 MB per file

### Log Levels

The logger supports the following log levels (in order of verbosity):

| Level   | Description                                     |
| ------- | ----------------------------------------------- |
| `trace` | Most verbose, detailed debugging info (default) |
| `debug` | Debugging information, less verbose than trace  |
| `info`  | General information                             |
| `warn`  | Warnings that don't prevent test execution      |
| `error` | Errors and failures                             |
| `none`  | Disable logging                                 |

### Configuration

**Environment Variables:**

- `UI_TEST_LOG_LEVEL` - Set the minimum log level (default: `trace`)
    - Values: `trace`, `debug`, `info`, `warn`, `error`, `none`
- `UI_TEST_LOG_TO_FILE` - Enable/disable file logging (default: `true`)
    - Set to `"false"` or `"0"` to disable
- `UI_TEST_LOG_TO_CONSOLE` - Enable/disable console output (default: `true`)
    - Set to `"false"` or `"0"` to disable

## Test Utilities

The `testUtils.ts` file provides reusable helper functions for common test operations:

### Modal Button Handling

```typescript
import { handleAuthenticationModals } from "./testUtils";

// Handle both authentication and certificate modals
await handleAuthenticationModals(driver);
```

### Logout Helper

```typescript
import { attemptLogout } from "./testUtils";

// Attempt to logout if a session is active
const wasLoggedOut = await attemptLogout(driver);
```

### Using Test Credentials

```typescript
import { getTestCredentials, hasTestCredentials } from "./config/testConfig";

// Check if credentials are available
if (hasTestCredentials()) {
    const credentials = getTestCredentials();
    // Use credentials.serverName, credentials.username, etc.
}
```

## Folder Organization

The UI test folder is organized into subdirectories by purpose:

- **`config/`** - All configuration files (settings, profiles, test credentials)
- **`runners/`** - Test execution scripts (single-config and multi-config runners)
- **`utils/`** - Shared utility functions and test helpers
- **`pages/`** - Page Object Models for different UI views
- **`fixtures/`** - Static test files copied to workspace before tests
- **Test files** - Remain at root level (`*.ui.test.ts`)

This structure keeps related files together and makes the codebase easier to navigate and maintain.
