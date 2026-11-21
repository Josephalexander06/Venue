export class AppError extends Error {
    statusCode;
    code;
    fieldErrors;
    constructor(statusCode, code, message, fieldErrors) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.fieldErrors = fieldErrors;
        this.name = 'AppError';
    }
    toBody() {
        return {
            statusCode: this.statusCode,
            code: this.code,
            message: this.message,
            ...(this.fieldErrors ? { fieldErrors: this.fieldErrors } : {}),
        };
    }
}
export function fieldErrorsFromZod(issues) {
    const fieldErrors = {};
    for (const issue of issues) {
        const key = issue.path.length > 0 ? issue.path.join('.') : 'form';
        (fieldErrors[key] ??= []).push(issue.message);
    }
    return fieldErrors;
}
//# sourceMappingURL=errors.js.map