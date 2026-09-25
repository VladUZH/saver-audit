import pkg from "../package.json" with { type: "json" };

/** The package version, so the CLI never drifts from package.json. */
export const VERSION: string = pkg.version;
