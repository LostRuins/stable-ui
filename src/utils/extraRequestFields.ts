export type ExtraRequestFields = Record<string, unknown>;

/**
 * Parses user-supplied fields that are merged into the final generation
 * request. Only objects are accepted because arrays and primitives cannot
 * provide named request fields.
 */
export function parseExtraRequestFields(input: string): ExtraRequestFields {
    if (input.trim() === "") return {};

    let parsed: unknown;
    try {
        parsed = JSON.parse(input);
    } catch {
        throw new Error("Extra request fields must be valid JSON.");
    }

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("Extra request fields must be a JSON object.");
    }

    return parsed as ExtraRequestFields;
}
