export const ERROR_CODES = {
  STEP_UP_REQUIRED: { code: "STEP_UP_REQUIRED", message: "Confirm it's you to continue." },
  NOT_FOUND: { code: "NOT_FOUND", message: "Not found." },
  CANNOT_TARGET_SELF: { code: "CANNOT_TARGET_SELF", message: "You can't do that to your own account." },
  FEATURE_UNAVAILABLE: { code: "FEATURE_UNAVAILABLE", message: "This needs a plugin or option that isn't set up." },
  UNKNOWN_FILTER: { code: "UNKNOWN_FILTER", message: "That filter isn't available here." },
} as const;
