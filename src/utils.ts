// TODO: Move these interfaces to a separate file and import them in the necessary files? testbenchConnection.ts has also these interfaces.
interface Key {
    serial: string;
}

interface TestCycle {
    key: Key;
    parent: Key;
    name: string;
    status: string;
    visibility: boolean;
    creationTime: string;
    startDate: string | null;
    endDate: string | null;
}

interface TestObjectVersion {
    key: Key;
    parent: Key;
    name: string;
    status: string;
    visibility: boolean;
    cloningVisibility: boolean;
    creationTime: string;
    lockerKey: Key;
    isBaseTOV: boolean;
    sourceTOV: any | null;
    variantDef: any | null;
    startDate: string | null;
    endDate: string | null;
    testCycles: TestCycle[];
}

interface Project {
    key: Key;
    name: string;
    status: string;
    visibility: boolean;
    creationTime: string;
    lockerKey: Key;
    testObjectVersions: TestObjectVersion[];
    variantsManagementEnabled: boolean;
}

export function findProjectKeyOfCycle(data: Project[], testCycleKeySerial: string): string | null {
    for (const project of data) {
        for (const testObjectVersion of project.testObjectVersions) {
            for (const testCycle of testObjectVersion.testCycles) {
                if (testCycle.key.serial === testCycleKeySerial) {
                    // Found the test cycle, return its associated project key serial
                    return project.key.serial;
                }
            }
        }
    }
    // Test cycle not found
    return null;
}
