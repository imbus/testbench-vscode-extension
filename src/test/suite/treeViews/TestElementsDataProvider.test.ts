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

    test("finalization pass should assign hierarchical names and virtual markers", function () {
        testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
            if (key === ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER) {
                return "";
            }
            return undefined;
        });

        const resource = createSubdivision("resource", "Resource", true);
        const folder = createSubdivision("folder", "Folder", false, [resource]);
        const root = createSubdivision("root", "Root", false, [folder]);

        folder.parent = root;
        resource.parent = folder;

        (dataProvider as any)._finalizeFilteredTree([root]);

        assert.strictEqual(root.hierarchicalName, "Root");
        assert.strictEqual(folder.hierarchicalName, "Root/Folder");
        assert.strictEqual(resource.hierarchicalName, "Root/Folder/Resource");

        assert.strictEqual(root.hasResourceDescendant, true);
        assert.strictEqual(folder.hasResourceDescendant, true);
        assert.strictEqual(resource.hasResourceDescendant, true);

        assert.strictEqual(root.isVirtual, true);
        assert.strictEqual(folder.isVirtual, true);
    });

    test("finalization pass should warn about nested resources", function () {
        testEnv.sandbox.stub(configuration, "getExtensionSetting").returns("");

        const childResource = createSubdivision("child-resource", "ChildResource", true);
        const parentResource = createSubdivision("parent-resource", "ParentResource", true, [childResource]);

        childResource.parent = parentResource;

        (dataProvider as any)._finalizeFilteredTree([parentResource]);

        assert.strictEqual(mockLogger.warn.calledOnce, true);
        const warningArgs = mockLogger.warn.getCall(0).args;
        assert.strictEqual(warningArgs[0], "[TestElementsDataProvider] Nested robot resources found:");
        assert.strictEqual(Array.isArray(warningArgs[1]), true);
        assert.strictEqual(
            warningArgs[1][0],
            "Robot resource 'ParentResource' contains another resource 'ChildResource'."
        );
    });

    test("finalization pass should stop virtual marking below configured resource-directory marker", function () {
        testEnv.sandbox.stub(configuration, "getExtensionSetting").callsFake((key: string) => {
            if (key === ConfigKeys.TB2ROBOT_RESOURCE_DIRECTORY_MARKER) {
                return "^Marker$";
            }
            return undefined;
        });

        const resource = createSubdivision("resource", "Resource", true);
        const belowMarker = createSubdivision("below-marker", "BelowMarker", false, [resource]);
        const marker = createSubdivision("marker", "Marker", false, [belowMarker]);
        const root = createSubdivision("root", "Root", false, [marker]);

        marker.parent = root;
        belowMarker.parent = marker;
        resource.parent = belowMarker;

        (dataProvider as any)._finalizeFilteredTree([root]);

        assert.strictEqual(root.isVirtual, true, "ancestor before marker should stay virtual");
        assert.strictEqual(marker.isVirtual, true, "marker level should stay virtual");
        assert.strictEqual(belowMarker.isVirtual, false, "subdivision below marker boundary should not be virtual");
    });
});
