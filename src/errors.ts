export class DependencyVersionError extends Error {
    public readonly dependency: string;
    public readonly expected: string;
    public readonly actual: string;

    constructor(dependency: string, expected: string, actual: string) {
        super(`Unsupported version for ${dependency}. Expected ${expected}, got ${actual}`);

        this.name = "DependencyVersionError";

        this.dependency = dependency;
        this.expected = expected;
        this.actual = actual;

        Object.setPrototypeOf(this, DependencyVersionError.prototype);
    }
}
