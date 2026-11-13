import { WordPressApiError } from "../wordpress-client.js";

export function toToolResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof WordPressApiError
    ? `WordPress API error (HTTP ${error.status}${error.code ? `, code: ${error.code}` : ""}): ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
}

export function toErrorResult(error: unknown) {
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: formatErrorMessage(error),
      },
    ],
  };
}
