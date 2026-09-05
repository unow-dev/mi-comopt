export class WorkflowValidationError extends Error {
  constructor(errors, message = "候補キーワード契約の検証に失敗しました") {
    super(message);
    this.name = "WorkflowValidationError";
    this.errors = errors;
  }
}
