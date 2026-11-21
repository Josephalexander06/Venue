import { ZodError } from 'zod';
import { AppError, fieldErrorsFromZod } from './errors.js';
export function parseInput(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', fieldErrorsFromZod(result.error.issues));
    }
    return result.data;
}
export { ZodError };
//# sourceMappingURL=validation.js.map