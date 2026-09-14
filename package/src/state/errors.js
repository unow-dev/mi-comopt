export class StateControlPlaneError extends Error {
  constructor(code, message, options = {}) {
    super(`${code}: ${message}`, options);
    this.name = "StateControlPlaneError";
    this.code = code;
    this.details = options.details ?? undefined;
  }
}

export function stateError(code, message, options = {}) {
  return new StateControlPlaneError(code, message, options);
}

export function isStateError(error, code) {
  return error instanceof StateControlPlaneError && (code === undefined || error.code === code);
}
