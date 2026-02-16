import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { ZodSchema } from 'zod';

export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.issues.map((err: any) => ({
            path: err.path.join('.'),
            message: err.message
          }))
        });
      } else {
        next(error);
      }
    }
  };
}

export const generatePostSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query must be less than 1000 characters'),
  social_platform: z.string().min(1, 'Social platform is required')
});
