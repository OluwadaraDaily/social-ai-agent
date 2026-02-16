import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  console.error('Error:', err);

  // Handle specific error types
  if (err.status) {
    return res.status(err.status).json({
      error: err.message || 'An error occurred'
    });
  }

  // Default to 500 internal server error
  res.status(500).json({
    error: err.message || 'Internal server error'
  });
}
