import { ArgumentMetadata, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import { badRequest } from './errors';

export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown, _meta: ArgumentMetadata): z.infer<T> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      const fieldErrors = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code }));
      throw badRequest(fieldErrors[0]?.message ? `Validation failed: ${fieldErrors[0].path ? fieldErrors[0].path + ' – ' : ''}${fieldErrors[0].message}` : 'Validation failed', {
        fieldErrors,
      });
    }
    return result.data;
  }
}

export function toOpenApiSchema(schema: ZodType): Record<string, unknown> {
  try {
    const s = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    delete s.$schema;
    return s;
  } catch {
    return { type: 'object' };
  }
}

/** Validates the request body with a Zod schema and documents it in OpenAPI. */
export function ZBody(schema: ZodType): ParameterDecorator {
  return (target, key, index) => {
    if (key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (descriptor) ApiBody({ schema: toOpenApiSchema(schema) as any })(target, key, descriptor);
    }
    Body(new ZodValidationPipe(schema))(target, key, index);
  };
}

/** Validates the query string with a Zod schema and documents each property in OpenAPI. */
export function ZQuery(schema: ZodType): ParameterDecorator {
  return (target, key, index) => {
    if (key) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      const json = toOpenApiSchema(schema) as { properties?: Record<string, any>; required?: string[] };
      if (descriptor && json.properties) {
        for (const [name, prop] of Object.entries(json.properties)) {
          ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: prop })(target, key, descriptor);
        }
      }
    }
    Query(new ZodValidationPipe(schema))(target, key, index);
  };
}
