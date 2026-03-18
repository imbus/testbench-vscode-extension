/**
 * @file src/test/suite/treeViews/TestElementsDataProvider.test.ts
 * @description Unit tests for TestElementsDataProvider filtering modes.
 */

import * as assert from "assert";
import * as sinon from "sinon";
import { TestElementsDataProvider } from "../../../treeViews/implementations/testElements/TestElementsDataProvider";
import { TestElementData, TestElementType } from "../../../treeViews/implementations/testElements/TestElementsTreeItem";
import { TestBenchLogger } from "../../../testBenchLogger";
import { EventBus } from "../../../treeViews/utils/EventBus";
import { setupTestEnvironment, TestEnvironment } from "../../setup/testSetup";
import * as configuration from "../../../configuration";
import { ConfigKeys } from "../../../constants";

suite("TestElementsDataProvider", function () {
    let testEnv: TestEnvironment;
    let dataProvider: TestElementsDataProvider;
    let mockLogger: sinon.SinonStubbedInstance<TestBenchLogger>;

    const createSubdivision = (
        id: string,
        displayName: string,
        directRegexMatch: boolean,
        children: TestElementData[] = []
    ): TestElementData => ({
        id,
        parentId: null,
        displayName,
        originalName: displayName,
        uniqueID: `${id}-uid`,
        libraryKey: null,
        jsonString: "{}",
        details: {},
        testElementType: TestElementType.Subdivision,
        directRegexMatch,
        children,
        hierarchicalName: displayName
    });

    this.beforeEach(function () {
        testEnv = setupTestEnvironment();
        mockLogger = testEnv.sandbox.createStubInstance(TestBenchLogger);

        dataProvider = new TestElementsDataProvider(mockLogger, () => null, new EventBus());
    });

    this.afterEach(function () {
        testEnv.sandbox.restore();
        dataProvider.dispose();
    });

    test("resourceOnly mode should hide plain subdivisions without resource matches", function () {
        testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
            if (key === ConfigKeys.TEST_ELEMENTS_VISIBILITY_MODE) {
                return "resourceOnly";
            }
            if (key === ConfigKeys.TB2ROBOT_RESOURCE_MARKER) {
                return ["[Robot-Resource]"];
            }
            return undefined;
        });

        const visibleResource = createSubdivision("child-resource", "Resource [Robot-Resource]", true);
        const hiddenPlain = createSubdivision("child-plain", "Plain Folder", false);

        const roots = [createSubdivision("root", "Root", false, [visibleResource, hiddenPlain])];
        const filtered = (dataProvider as any)._filterElementTree(roots) as TestElementData[];

        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].children?.length, 1, "Only resource-related child should remain");
        assert.strictEqual(filtered[0].children?.[0].displayName, "Resource [Robot-Resource]");
    });

    test("allSubdivisions mode should keep plain subdivisions without resource matches", function () {
        testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
            if (key === ConfigKeys.TEST_ELEMENTS_VISIBILITY_MODE) {
                return "allSubdivisions";
            }
            if (key === ConfigKeys.TB2ROBOT_RESOURCE_MARKER) {
                return ["[Robot-Resource]"];
            }
            return undefined;
        });

        const visibleResource = createSubdivision("child-resource", "Resource [Robot-Resource]", true);
        const visiblePlain = createSubdivision("child-plain", "Plain Folder", false);

        const roots = [createSubdivision("root", "Root", false, [visibleResource, visiblePlain])];
        const filtered = (dataProvider as any)._filterElementTree(roots) as TestElementData[];

        assert.strictEqual(filtered.length, 1);
        assert.strictEqual(filtered[0].children?.length, 2, "Both plain and marker subdivisions should remain");
    });
});
