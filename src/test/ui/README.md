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
├── README.md                          # This file - documentation
├── USAGE_EXAMPLES.md                  # Detailed examples for environment variables
├── index.ts                           # Test loader for Mocha
├── runUITests.ts                      # Custom test runner using ExTester
├── testUtils.ts                       # Reusable helper functions
├── testConfig.ts                      # Test credentials and configuration management
├── .vscode-test.settings.json         # VS Code settings for test environment
├── loginFlow.ui.test.ts               # End-to-end login flow tests
├── loginWebview.ui.test.ts            # Login webview UI tests
└── connectionManagement.ui.test.ts    # Connection management UI tests
```

### Key Files

- **`testUtils.ts`** - Provides reusable helper functions for common test operations

- **`testConfig.ts`** - Manages test credentials and configuration

- **`.vscode-test.settings.json`** - VS Code settings applied during test execution

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

### Run Specific Tests

To run tests matching a specific pattern:

```bash
npm run test:ui -- --grep "Login Flow"
```

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

- ✅ Typing in form fields
- ✅ Clicking buttons (save, edit, delete, login, cancel)
- ✅ Opening/closing sidebar
- ✅ Switching to webview
- ✅ Clicking confirmation dialogs
- ✅ UI updates after actions

**Not delayed:**

- ❌ Internal waits and timeouts
- ❌ Error handling
- ❌ Background operations
- ❌ Element location checks

### Example

```bash
# Run tests with slow motion enabled (2 second delays)
export UI_TEST_SLOW_MOTION="true"
export UI_TEST_SLOW_MOTION_DELAY="2000"
npm run test:ui
```

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
import { getTestCredentials, hasTestCredentials } from "./testConfig";

// Check if credentials are available
if (hasTestCredentials()) {
    const credentials = getTestCredentials();
    // Use credentials.serverName, credentials.username, etc.
}
```
