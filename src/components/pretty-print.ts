export function prettyPrintParameters(parameters: unknown): string {
  if (parameters === undefined || parameters === null) {
    return "";
  }
  if (typeof parameters === "string") {
    return parameters;
  }
  return JSON.stringify(parameters, null, 2);
}
