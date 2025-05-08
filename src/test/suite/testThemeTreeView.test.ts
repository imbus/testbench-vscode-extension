import * as assert from "assert";
import * as sinon from "sinon";
import { TestThemeTreeDataProvider } from "../../testThemeTreeView";

suite("TestThemeTreeDataProvider Tests", () => {
    let treeDataProvider: TestThemeTreeDataProvider;
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        treeDataProvider = new TestThemeTreeDataProvider();
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    test("refresh should fire onDidChangeTreeData event", () => {
        const spy = sandbox.spy(treeDataProvider["_onDidChangeTreeData"], "fire");
        treeDataProvider.refresh();
        assert.strictEqual(spy.calledOnce, true);
    });

    test("clearTree should clear root elements and refresh the tree", () => {
        const spy = sandbox.spy(treeDataProvider, "refresh");
        treeDataProvider.clearTree();
        assert.deepStrictEqual(treeDataProvider.rootElements, []);
        assert.strictEqual(spy.calledOnce, true);
    });
});
