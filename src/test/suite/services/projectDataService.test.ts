/**
 * @file src/test/suite/services/projectDataService.test.ts
 * @description Tests for the ProjectDataService.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import { ProjectDataService } from "../../../views/projectManagement/projectDataService";
import { PlayServerConnection } from "../../../testBenchConnection";
import { createMockProject } from "../../utils/mockDataFactory";
import { Project } from "../../../testBenchTypes";

suite("ProjectDataService Tests", () => {
    let testEnv: TestEnvironment;
    let mockConnection: sinon.SinonStubbedInstance<PlayServerConnection>;
    let getConnectionStub: sinon.SinonStub<[], PlayServerConnection | null>;

    setup(() => {
        testEnv = setupTestEnvironment();
        mockConnection = testEnv.sandbox.createStubInstance(PlayServerConnection);
        getConnectionStub = testEnv.sandbox.stub();
    });

    teardown(() => {
        testEnv.sandbox.restore();
    });

    suite("getProjectsList()", () => {
        test("should return a list of projects when connection is active", async () => {
            // Arrange
            const mockProjectList: Project[] = [createMockProject({ name: "Project X" })];
            mockConnection.getProjectsList.resolves(mockProjectList);
            getConnectionStub.returns(mockConnection);
            const dataService = new ProjectDataService(getConnectionStub, testEnv.logger);

            // Act
            const result = await dataService.getProjectsList();

            // Assert
            assert.deepStrictEqual(result, mockProjectList, "Should return the mock project list");
            assert.ok(mockConnection.getProjectsList.calledOnce, "getProjectsList on the connection should be called");
        });

        test("should return null and log an ERROR when no connection is active", async () => {
            // Arrange
            getConnectionStub.returns(null); // Simulate no active connection
            const dataService = new ProjectDataService(getConnectionStub, testEnv.logger);

            // Act
            const result = await dataService.getProjectsList();

            // Assert
            assert.strictEqual(result, null, "Should return null when no connection is available");
            assert.ok(
                testEnv.logger.error.calledOnceWith(
                    "[ProjectDataService] No active connection. Cannot fetch projects list."
                ),
                "Should log a specific error message"
            );
        });

        test("should return null and log a WARNING if the connection's method returns null", async () => {
            // Arrange
            mockConnection.getProjectsList.resolves(null); // Simulate the API returning null
            getConnectionStub.returns(mockConnection);
            const dataService = new ProjectDataService(getConnectionStub, testEnv.logger);

            // Act
            const result = await dataService.getProjectsList();

            // Assert
            assert.strictEqual(result, null, "Should return null when the connection method returns null");
            assert.ok(
                testEnv.logger.warn.calledOnceWith("[ProjectDataService] getProjectsList returned null."),
                "Should log a specific warning message"
            );
        });

        test("should return null and log an ERROR if the connection's method throws an error", async () => {
            // Arrange
            const apiError = new Error("API request failed");
            mockConnection.getProjectsList.rejects(apiError); // Configure the connection to throw an error
            getConnectionStub.returns(mockConnection);
            const dataService = new ProjectDataService(getConnectionStub, testEnv.logger);

            // Act
            const result = await dataService.getProjectsList();

            // Assert
            assert.strictEqual(result, null, "Should return null on an API error");
            assert.ok(
                testEnv.logger.error.calledOnceWith(sinon.match("Error fetching projects list:"), apiError),
                "Should log the specific error"
            );
        });
    });

    suite("getProjectTree()", () => {
        test("should return null and log an ERROR if projectKey is not provided", async () => {
            // Arrange
            getConnectionStub.returns(mockConnection);
            const dataService = new ProjectDataService(getConnectionStub, testEnv.logger);

            // Act
            const result = await dataService.getProjectTree(null);

            // Assert
            assert.strictEqual(result, null, "Should return null when projectKey is null");
            assert.ok(
                testEnv.logger.error.calledOnceWith(
                    "[ProjectDataService] Project key is null or undefined. Cannot fetch project tree."
                ),
                "Should log a specific error for missing project key"
            );
        });
    });
});
